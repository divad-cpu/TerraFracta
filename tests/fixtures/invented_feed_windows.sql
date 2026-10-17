-- Owner-only invented incremental-window fixture, never an operational migration.
-- Install only after the unchanged feed fixture in a newly owned test cluster.
-- No runtime/principal/source-rights grants or roles are created.
create schema tf_feed_windows;
revoke all on schema tf_feed_windows from public;
create table tf_feed_windows.collections (
 id uuid primary key,
 source_key text not null,
 initial_url text not null,
 format text not null check(format in ('rss20','atom10')),
 revision smallint not null check(revision between 1 and 32),
 current_stream_id uuid not null unique references tf_feed_rehearsal.streams(id),
 created_at timestamptz not null check(isfinite(created_at))
);
create table tf_feed_windows.windows (
 operation_id uuid primary key references tf_feed_rehearsal.pages(operation_id),
 collection_id uuid not null references tf_feed_windows.collections(id),
 revision smallint not null check(revision between 1 and 32),
 previous_stream_id uuid references tf_feed_rehearsal.streams(id),
 previous_page_id uuid references tf_feed_rehearsal.pages(page_id),
 stream_id uuid not null unique references tf_feed_rehearsal.streams(id),
 page_id uuid not null unique references tf_feed_rehearsal.pages(page_id),
 source_version_id uuid not null,
 input jsonb not null,
 fingerprint bytea not null check(octet_length(fingerprint)=32),
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 unique(collection_id,revision),unique(collection_id,source_version_id),
 check((revision=1)=(previous_stream_id is null and previous_page_id is null)),
 check(revision=1 or (previous_stream_id is not null and previous_page_id is not null and previous_stream_id<>stream_id))
);
alter table tf_feed_windows.collections enable row level security;
alter table tf_feed_windows.windows enable row level security;
revoke all on all tables in schema tf_feed_windows from public;

create function tf_feed_windows.initialize(p_collection uuid,p_stream uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog,pg_temp as $$
declare s tf_feed_rehearsal.streams%rowtype;p tf_feed_rehearsal.pages%rowtype;at timestamptz;
begin
 if p_collection is null or p_stream is null then raise exception using errcode='22023',message='invented_collection_identity_invalid';end if;
 perform 1 from tf_feed_windows.collections where id=p_collection for update;
 if found then raise exception using errcode='22023',message='invented_collection_already_exists';end if;
 select * into s from tf_feed_rehearsal.streams where id=p_stream for update;
 if not found or s.revision=0 then raise exception using errcode='22023',message='invented_collection_not_captured';end if;
 select * into p from tf_feed_rehearsal.pages where stream_id=p_stream and revision=1;
 if not found then raise exception using errcode='22023',message='invented_collection_first_page_missing';end if;
 if exists(select 1 from tf_feed_rehearsal.pages p0 where p0.stream_id=s.id and p0.input->>'format' is distinct from p.input->>'format') then
  raise exception using errcode='22023',message='invented_collection_mixed_format';end if;
 at:=clock_timestamp();
 if at<p.stored_at or at<(select max(stored_at) from tf_feed_rehearsal.pages where stream_id=s.id) then raise exception using errcode='22023',message='invented_collection_clock_invalid';end if;
 insert into tf_feed_windows.collections values(p_collection,s.source_key,s.initial_url,p.input->>'format',1,s.id,at);
 insert into tf_feed_windows.windows values(p.operation_id,p_collection,1,null,null,s.id,p.page_id,p.source_version_id,
  jsonb_build_object('collection_id',p_collection,'expected_window_revision',0,'previous_stream_id',null,'previous_page_id',null),
  sha256(convert_to(jsonb_build_object('collection_id',p_collection,'initial_stream_id',p_stream)::text,'UTF8')),at);
end
$$;

create function tf_feed_windows.head(p_collection uuid,p_expected_raw bytea)
returns jsonb language sql stable security invoker set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('schema_version',1,'kind','invented_collection_head','collection_id',c.id,
  'source_key',c.source_key,'initial_url',c.initial_url,'format',c.format,'window_revision',c.revision,
  'stream_id',s.id,'latest_page_id',s.last_page_id,'latest_stream_revision',s.revision,
  'window_recorded_at',to_char(w.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'page',tf_feed_rehearsal.page_receipt(p.operation_id,p_expected_raw))
 from tf_feed_windows.collections c join tf_feed_rehearsal.streams s on s.id=c.current_stream_id
 join tf_feed_rehearsal.pages p on p.page_id=s.last_page_id
 join tf_feed_windows.windows w on w.collection_id=c.id and w.revision=c.revision and w.stream_id=s.id where c.id=p_collection
$$;

create function tf_feed_windows.receipt(p_operation uuid,p_expected_raw bytea)
returns jsonb language sql stable security invoker set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('schema_version',1,'kind','invented_collection_window_started','collection_id',w.collection_id,
  'operation_id',w.operation_id,'window_revision',w.revision,'previous_stream_id',w.previous_stream_id,
  'previous_page_id',w.previous_page_id,'stream_id',w.stream_id,'page_id',w.page_id,
  'recorded_at',to_char(w.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'input',w.input,'page',tf_feed_rehearsal.page_receipt(w.operation_id,p_expected_raw))
 from tf_feed_windows.windows w where w.operation_id=p_operation
$$;

create function tf_feed_windows.advance(p jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,pg_temp as $$
declare
 keys text[];field text;collection uuid;previous_stream uuid;previous_page uuid;new_stream uuid;operation uuid;expected integer;
 c tf_feed_windows.collections%rowtype;s tf_feed_rehearsal.streams%rowtype;old tf_feed_windows.windows%rowtype;
 capture jsonb;first_page jsonb;fingerprint bytea;at timestamptz;retrieved timestamptz;previous_at timestamptz;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>262144 then
  raise exception using errcode='22023',message='invented_collection_input_invalid';end if;
 select array_agg(key order by key) into keys from jsonb_object_keys(p) key;
 if keys is distinct from array['capture','collection_id','expected_window_revision','previous_page_id','previous_stream_id']
  or jsonb_typeof(p->'capture') is distinct from 'object'
  or jsonb_typeof(p->'expected_window_revision') is distinct from 'number'
  or coalesce(p->>'expected_window_revision','') !~ '^([1-9]|[12][0-9]|3[0-2])$' then
  raise exception using errcode='22023',message='invented_collection_input_invalid';end if;
 foreach field in array array['collection_id','previous_page_id','previous_stream_id'] loop
  if jsonb_typeof(p->field) is distinct from 'string' or p->>field !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invented_collection_identity_invalid';end if;
 end loop;
 capture:=p->'capture';
 foreach field in array array['operation_id','stream_id'] loop
  if jsonb_typeof(capture->field) is distinct from 'string' or capture->>field !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invented_collection_identity_invalid';end if;
 end loop;
 collection:=(p->>'collection_id')::uuid;previous_stream:=(p->>'previous_stream_id')::uuid;
 previous_page:=(p->>'previous_page_id')::uuid;expected:=(p->>'expected_window_revision')::integer;
 operation:=(capture->>'operation_id')::uuid;new_stream:=(capture->>'stream_id')::uuid;
 fingerprint:=sha256(convert_to(p::text,'UTF8'));
 select * into c from tf_feed_windows.collections where id=collection for update;
 if not found then raise exception using errcode='22023',message='invented_collection_missing';end if;
 select * into old from tf_feed_windows.windows where operation_id=operation;
 if found then
  if old.collection_id<>collection or old.fingerprint<>fingerprint then
   raise exception using errcode='22023',message='invented_collection_operation_conflict';end if;
  return tf_feed_windows.receipt(operation,decode(capture->>'raw_base64','base64'));
 end if;
 select * into s from tf_feed_rehearsal.streams where id=c.current_stream_id for update;
 if c.revision<>expected or c.revision>=32 or c.current_stream_id<>previous_stream or s.last_page_id<>previous_page
  or s.state<>'window_boundary' or s.next_url is not null or s.revision not between 1 and 64 then
  raise exception using errcode='22023',message='invented_collection_predecessor_conflict';end if;
 if exists(select 1 from tf_feed_rehearsal.pages p0 where p0.stream_id=s.id and p0.input->>'format' is distinct from c.format) then
  raise exception using errcode='22023',message='invented_collection_mixed_format';end if;
 if capture->'expected_revision' is distinct from '0'::jsonb
  or capture->>'format' is distinct from c.format
  or capture->'source'->>'source_key' is distinct from c.source_key
  or capture->'source'->>'feed_url' is distinct from c.initial_url
  or new_stream=s.id then
  raise exception using errcode='22023',message='invented_collection_profile_mismatch';end if;
 -- The unchanged capture validates full UTC/source/bytes/parser/item structure;
 -- this cross-window guard additionally prevents chronological regression.
 previous_at:=greatest(c.created_at,
  (select max(recorded_at) from tf_feed_windows.windows where collection_id=collection),
  (select max(stored_at) from tf_feed_rehearsal.pages where stream_id=s.id));
 if clock_timestamp()<previous_at then
  raise exception using errcode='22023',message='invented_collection_clock_invalid';end if;
 retrieved:=(capture->'source'->>'retrieved_at')::timestamptz;
 if not isfinite(retrieved) or retrieved<s.latest_retrieved_at then
  raise exception using errcode='22023',message='invented_collection_chronology_invalid';end if;
 if exists(select 1 from tf_feed_rehearsal.pages p0 join tf_feed_windows.windows w0 on w0.stream_id=p0.stream_id
   where w0.collection_id=collection and p0.source_version_id=(capture->'source'->>'source_version_id')::uuid) then
  raise exception using errcode='22023',message='invented_collection_source_version_reused';end if;
 insert into tf_feed_rehearsal.streams(id,source_key,initial_url,next_url)
 values(new_stream,c.source_key,c.initial_url,c.initial_url);
 first_page:=tf_feed_rehearsal.capture(capture);
 at:=clock_timestamp();
 if at<(first_page->>'stored_at')::timestamptz or (first_page->>'stored_at')::timestamptz<previous_at then
  raise exception using errcode='22023',message='invented_collection_clock_invalid';end if;
 insert into tf_feed_windows.windows values(operation,collection,expected+1,s.id,s.last_page_id,new_stream,
  (first_page->>'page_id')::uuid,(capture->'source'->>'source_version_id')::uuid,p-'capture',fingerprint,at);
 update tf_feed_windows.collections set revision=revision+1,current_stream_id=new_stream where id=collection and revision=expected;
 if not found then raise exception using errcode='22023',message='invented_collection_predecessor_conflict';end if;
 return tf_feed_windows.receipt(operation,decode(capture->>'raw_base64','base64'));
end
$$;
revoke all on all functions in schema tf_feed_windows from public;
