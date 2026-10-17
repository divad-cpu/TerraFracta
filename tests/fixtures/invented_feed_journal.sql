-- Owner-driven invented PostgreSQL17 trial only. Not a Supabase migration.
-- Install only in a fresh, independently identified network-none test cluster.
-- SECURITY INVOKER is intentionally owner-only, not an application writer role.
create schema tf_feed_rehearsal;
revoke all on schema tf_feed_rehearsal from public;

create table tf_feed_rehearsal.streams (
 id uuid primary key,
 source_key text not null check(source_key ~ '^fictional-[a-z0-9:-]{1,109}$'),
 initial_url text not null check(initial_url ~ '^https://example[.]org/feed[.]xml([?][a-zA-Z0-9=&%_-]{1,200})?$'),
 revision integer not null default 0 check(revision between 0 and 64),
 next_url text,
 state text not null default 'ready' check(state in ('ready','next_ready','next_permission_unresolved','window_boundary')),
 last_page_id uuid,
 latest_retrieved_at timestamptz,
 check((revision=0 and state='ready' and next_url=initial_url and last_page_id is null and latest_retrieved_at is null)
       or (revision>0 and state<>'ready' and last_page_id is not null and latest_retrieved_at is not null)),
 check((state in ('ready','next_ready'))=(next_url is not null))
);

create table tf_feed_rehearsal.pages (
 operation_id uuid primary key,
 stream_id uuid not null references tf_feed_rehearsal.streams(id),
 source_version_id uuid not null,
 page_id uuid not null unique default gen_random_uuid(),
 batch_id uuid not null default gen_random_uuid(),
 fingerprint bytea not null check(octet_length(fingerprint)=32),
 raw bytea not null check(octet_length(raw) between 1 and 65536),
 input jsonb not null check(jsonb_typeof(input)='object'),
 revision integer not null check(revision between 1 and 64),
 stored_at timestamptz not null check(isfinite(stored_at)),
 next_url text,
 state text not null check(state in ('next_ready','next_permission_unresolved','window_boundary')),
 unique(stream_id,source_version_id),unique(stream_id,revision),unique(page_id,stream_id),
 check((state='next_ready')=(next_url is not null))
);

alter table tf_feed_rehearsal.streams add constraint head_page_in_stream
 foreign key(last_page_id,id) references tf_feed_rehearsal.pages(page_id,stream_id);

create table tf_feed_rehearsal.items (
 item_id uuid primary key default gen_random_uuid(),
 stream_id uuid not null,
 page_id uuid not null,
 position smallint not null check(position between 1 and 50),
 locator text not null check(locator='feed-entry:'||position::text),
 entry_id text check(entry_id is null or char_length(entry_id) between 1 and 300),
 held_reason text check(held_reason is null or held_reason in ('entry_identity_invalid','entry_identity_duplicate',
  'entry_title_invalid','entry_link_invalid_or_ambiguous','entry_date_text_invalid')),
 base_state text not null check(base_state in ('pending','parse_held')),
 metadata jsonb,
 foreign key(page_id,stream_id) references tf_feed_rehearsal.pages(page_id,stream_id),
 unique(page_id,position),unique(page_id,locator),
 check((base_state='pending' and entry_id is not null and held_reason is null and metadata is not null)
       or (base_state='parse_held' and held_reason is not null and metadata is null)),
 check(held_reason is distinct from 'entry_identity_invalid' or entry_id is null)
);
create unique index one_pending_entry_identity on tf_feed_rehearsal.items(page_id,entry_id) where base_state='pending';

create table tf_feed_rehearsal.outcomes (
 operation_id uuid primary key,
 item_id uuid not null references tf_feed_rehearsal.items(item_id),
 revision smallint not null check(revision between 1 and 8),
 state text not null check(state in ('failed','processed')),
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 unique(item_id,revision)
);

-- Private defense in depth. Owner/superuser bypass is explicit in this trial;
-- no table/API grants to an application, anon, authenticated or worker exist.
alter table tf_feed_rehearsal.streams enable row level security;
alter table tf_feed_rehearsal.pages enable row level security;
alter table tf_feed_rehearsal.items enable row level security;
alter table tf_feed_rehearsal.outcomes enable row level security;
revoke all on all tables in schema tf_feed_rehearsal from public;

create function tf_feed_rehearsal.page_receipt(p_operation uuid,p_expected_raw bytea)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object(
  'schema_version',1,'kind','invented_feed_pg_page','operation_id',p.operation_id,'stream_id',p.stream_id,
  'page_id',p.page_id,'batch_id',p.batch_id,'source',p.input->'source','format',p.input->'format',
  'parser_identity',p.input->'parser_identity','stored_raw_matches_input',p.raw=p_expected_raw,
  'stored_raw_sha256',encode(sha256(p.raw),'hex'),'stored_raw_bytes',octet_length(p.raw),
  'stored_at',to_char(p.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'allowed_next_url',p.input->'allowed_next_url',
  'cursor',jsonb_build_object('revision',p.revision,'next_url',p.next_url,'state',p.state),
  'items',coalesce((select jsonb_agg(jsonb_build_object('item_id',i.item_id,'position',i.position,
   'locator',i.locator,'entry_id',i.entry_id,'held_reason',i.held_reason,'state',i.base_state,
   'metadata',i.metadata) order by i.position) from tf_feed_rehearsal.items i where i.page_id=p.page_id),'[]'::jsonb)
 ) from tf_feed_rehearsal.pages p where p.operation_id=p_operation
$$;

create function tf_feed_rehearsal.capture(p jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare
 s tf_feed_rehearsal.streams%rowtype;
 old tf_feed_rehearsal.pages%rowtype;
 input_keys text[];source_keys text[];item_keys text[];
 raw bytea;fingerprint bytea;operation uuid;stream uuid;version uuid;expected integer;
 source jsonb;entry jsonb;position integer:=0;entries integer;retrieved timestamptz;stored timestamptz;
 advertised text;allowed text;v_next_url text;next_state text;page uuid;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>262144 then
  raise exception using errcode='22023',message='invented_feed_input_invalid'; end if;
 select array_agg(key order by key) into input_keys from jsonb_object_keys(p) key;
 if input_keys is distinct from array['advertised_next_url','allowed_next_url','expected_revision','format',
    'items','kind','operation_id','parser_identity','raw_base64','schema_version','source','stream_id']
    or p->'schema_version' is distinct from '1'::jsonb or p->>'kind' is distinct from 'invented_feed_pg_capture'
    or jsonb_typeof(p->'format') is distinct from 'string' or p->>'format' not in ('rss20','atom10')
    or p->>'parser_identity' is distinct from 'terrafracta-feed-discovery/v1:feedparser/6.0.14'
    or jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items')>50
    or jsonb_typeof(p->'source') is distinct from 'object'
    or jsonb_typeof(p->'expected_revision') is distinct from 'number'
    or (p->>'expected_revision') !~ '^(0|[1-9][0-9]?)$' then
  raise exception using errcode='22023',message='invented_feed_input_invalid'; end if;
 if (p->>'operation_id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    or (p->>'stream_id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
  raise exception using errcode='22023',message='invented_feed_identity_invalid'; end if;
 operation:=(p->>'operation_id')::uuid;stream:=(p->>'stream_id')::uuid;expected:=(p->>'expected_revision')::integer;
 source:=p->'source';
 select array_agg(key order by key) into source_keys from jsonb_object_keys(source) key;
 if source_keys is distinct from array['content_sha256','feed_url','retrieved_at','source_key','source_version_id']
    or exists(select 1 from jsonb_each(source) e where jsonb_typeof(e.value)<>'string')
    or (source->>'source_version_id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    or (source->>'content_sha256') !~ '^[a-f0-9]{64}$'
    or (source->>'retrieved_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$'
    or jsonb_typeof(p->'raw_base64') is distinct from 'string' then
  raise exception using errcode='22023',message='invented_feed_source_invalid'; end if;
 raw:=decode(p->>'raw_base64','base64');
 if octet_length(raw) not between 1 and 65536 or replace(encode(raw,'base64'),E'\n','') is distinct from p->>'raw_base64'
    or encode(sha256(raw),'hex') is distinct from source->>'content_sha256' then
  raise exception using errcode='22023',message='invented_feed_bytes_invalid'; end if;
 version:=(source->>'source_version_id')::uuid;retrieved:=(source->>'retrieved_at')::timestamptz;
 advertised:=p->>'advertised_next_url';allowed:=p->>'allowed_next_url';
 if (advertised is not null and advertised !~ '^https://example[.]org/feed[.]xml([?][a-zA-Z0-9=&%_-]{1,200})?$')
    or (allowed is not null and allowed is distinct from advertised) then
  raise exception using errcode='22023',message='invented_feed_next_permission_invalid'; end if;
 fingerprint:=sha256(convert_to(p::text,'UTF8'));
 select * into s from tf_feed_rehearsal.streams where id=stream for update;
 if not found then raise exception using errcode='22023',message='invented_feed_scope_missing'; end if;
 select * into old from tf_feed_rehearsal.pages where operation_id=operation;
 if found then
  if old.stream_id<>stream or old.fingerprint<>fingerprint then
   raise exception using errcode='22023',message='invented_feed_operation_conflict'; end if;
  return tf_feed_rehearsal.page_receipt(operation,raw);
 end if;
 stored:=clock_timestamp();
 if s.revision<>expected or s.revision>=64 or s.state not in ('ready','next_ready')
    or source->>'source_key' is distinct from s.source_key or source->>'feed_url' is distinct from s.next_url
    or not isfinite(retrieved) or retrieved>stored
    or (s.latest_retrieved_at is not null and retrieved<s.latest_retrieved_at) then
  raise exception using errcode='22023',message='invented_feed_predecessor_conflict'; end if;
 v_next_url:=case when allowed is not null then advertised else null end;
 next_state:=case when advertised is null then 'window_boundary' when allowed is null then 'next_permission_unresolved' else 'next_ready' end;
 insert into tf_feed_rehearsal.pages(operation_id,stream_id,source_version_id,fingerprint,raw,input,revision,stored_at,next_url,state)
 values(operation,stream,version,fingerprint,raw,p-'raw_base64',expected+1,stored,v_next_url,next_state) returning page_id into page;
 for entry in select value from jsonb_array_elements(p->'items') loop
  position:=position+1;
  if jsonb_typeof(entry) is distinct from 'object' then
   raise exception using errcode='22023',message='invented_feed_item_invalid'; end if;
  select array_agg(key order by key) into item_keys from jsonb_object_keys(entry) key;
  if item_keys is distinct from array['entry_id','held_reason','locator','metadata','position','state']
     or entry->'position' is distinct from to_jsonb(position)
     or entry->>'locator' is distinct from 'feed-entry:'||position::text
     or jsonb_typeof(entry->'state') is distinct from 'string'
     or jsonb_typeof(entry->'entry_id') not in ('string','null')
     or jsonb_typeof(entry->'held_reason') not in ('string','null')
     or (entry->>'state'='pending' and jsonb_typeof(entry->'metadata') is distinct from 'object') then
   raise exception using errcode='22023',message='invented_feed_item_invalid'; end if;
  insert into tf_feed_rehearsal.items(stream_id,page_id,position,locator,entry_id,held_reason,base_state,metadata)
  values(stream,page,position,entry->>'locator',entry->>'entry_id',entry->>'held_reason',entry->>'state',
    case when entry->'metadata'='null'::jsonb then null else entry->'metadata' end);
 end loop;
 update tf_feed_rehearsal.streams set revision=revision+1,next_url=v_next_url,state=next_state,
  last_page_id=page,latest_retrieved_at=retrieved where id=stream and revision=expected;
 if not found then raise exception using errcode='22023',message='invented_feed_predecessor_conflict'; end if;
 return tf_feed_rehearsal.page_receipt(operation,raw);
end
$$;

create function tf_feed_rehearsal.record_outcome(p_operation uuid,p_item uuid,p_expected integer,p_state text)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare i tf_feed_rehearsal.items%rowtype;prior tf_feed_rehearsal.outcomes%rowtype;
 old tf_feed_rehearsal.outcomes%rowtype;at timestamptz;page_time timestamptz;
begin
 if p_operation is null or p_item is null or p_expected is null or p_expected not between 0 and 7
    or p_state is null or p_state not in ('failed','processed') then
  raise exception using errcode='22023',message='invented_feed_outcome_invalid'; end if;
 select * into i from tf_feed_rehearsal.items where item_id=p_item for update;
 if not found then raise exception using errcode='22023',message='invented_feed_item_missing'; end if;
 select * into old from tf_feed_rehearsal.outcomes where operation_id=p_operation;
 if found then
  if (old.item_id,old.revision,old.state) is distinct from (p_item,p_expected+1,p_state) then
   raise exception using errcode='22023',message='invented_feed_outcome_conflict'; end if;
  return to_jsonb(old);
 end if;
 select * into prior from tf_feed_rehearsal.outcomes where item_id=p_item order by revision desc limit 1;
 select stored_at into page_time from tf_feed_rehearsal.pages where page_id=i.page_id;
 at:=clock_timestamp();
 if i.base_state<>'pending' or coalesce(prior.revision,0)<>p_expected or prior.state='processed'
    or at<coalesce(prior.recorded_at,page_time) then
  raise exception using errcode='22023',message='invented_feed_outcome_predecessor_conflict'; end if;
 insert into tf_feed_rehearsal.outcomes values(p_operation,p_item,p_expected+1,p_state,at) returning * into old;
 return to_jsonb(old);
end
$$;

revoke all on all functions in schema tf_feed_rehearsal from public;
