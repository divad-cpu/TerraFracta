-- Add only after invented_feed_journal.sql in a new owned network-none cluster.
-- Owner-only rehearsal, not an operational migration or restricted writer role.
alter table tf_feed_rehearsal.items add constraint result_item_page unique(item_id,page_id);
alter table tf_feed_rehearsal.outcomes add constraint result_outcome_item unique(operation_id,item_id);
create table tf_feed_rehearsal.document_results (
 operation_id uuid primary key,
 artifact_id uuid not null unique default gen_random_uuid(),
 feed_operation_id uuid not null references tf_feed_rehearsal.pages(operation_id),
 feed_stream_id uuid not null,
 feed_page_id uuid not null,
 feed_item_id uuid not null unique,
 document_source_key text not null check(document_source_key ~ '^fictional-[a-z0-9:-]{1,109}$'),
 document_item_key text not null check(char_length(document_item_key) between 1 and 120),
 document_source_version_id uuid not null,
 document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
 raw bytea not null check(octet_length(raw) between 1 and 65536),
 input jsonb not null check(jsonb_typeof(input)='object'),
 fingerprint bytea not null check(octet_length(fingerprint)=32),
 stored_at timestamptz not null check(isfinite(stored_at)),
 outcome_operation_id uuid not null unique check(outcome_operation_id=operation_id),
 foreign key(feed_page_id,feed_stream_id) references tf_feed_rehearsal.pages(page_id,stream_id),
 foreign key(feed_item_id,feed_page_id) references tf_feed_rehearsal.items(item_id,page_id),
 foreign key(outcome_operation_id,feed_item_id) references tf_feed_rehearsal.outcomes(operation_id,item_id)
);
alter table tf_feed_rehearsal.document_results enable row level security;
revoke all on tf_feed_rehearsal.document_results from public;

create function tf_feed_rehearsal.document_result_receipt(p_operation uuid,p_document_raw bytea,p_feed_raw bytea)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('schema_version',1,'kind','invented_document_result_stored',
  'operation_id',r.operation_id,'artifact_id',r.artifact_id,
  'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'stored_raw_matches_input',r.raw=p_document_raw,'stored_raw_sha256',encode(sha256(r.raw),'hex'),
  'stored_raw_bytes',octet_length(r.raw),'input',r.input,
  'page',tf_feed_rehearsal.page_receipt(r.feed_operation_id,p_feed_raw),'outcome',to_jsonb(o))
 from tf_feed_rehearsal.document_results r join tf_feed_rehearsal.outcomes o on o.operation_id=r.outcome_operation_id
 where r.operation_id=p_operation
$$;

create function tf_feed_rehearsal.complete_document_result(p jsonb,p_feed_raw bytea)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare
 keys text[];field_name text;operation uuid;feed_operation uuid;item uuid;expected integer;
 document jsonb;association jsonb;raw bytea;fingerprint bytea;at timestamptz;outcome_receipt jsonb;artifact_time timestamptz;
 i tf_feed_rehearsal.items%rowtype;page tf_feed_rehearsal.pages%rowtype;
 old tf_feed_rehearsal.document_results%rowtype;
 m jsonb;snapshot jsonb;span jsonb;passage jsonb;position integer:=0;previous_end integer:=0;
 span_start integer;span_end integer;body bytea;total integer:=0;locators text[]:=array[]::text[];
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>262144 then
  raise exception using errcode='22023',message='invented_document_result_input_invalid'; end if;
 select array_agg(key order by key) into keys from jsonb_object_keys(p) key;
 if keys is distinct from array['adapter_identity','association','document','expected_outcome_revision','feed_item_id',
  'feed_operation_id','feed_page_id','feed_stream_id','kind','mapping','operation_id','raw_base64','schema_version',
  'snapshot','span_manifest_sha256'] or p->'schema_version' is distinct from '1'::jsonb
  or p->>'kind' is distinct from 'invented_document_passage_result'
  or p->>'adapter_identity' is distinct from 'terrafracta-utf8-byte-spans/v1'
  or (p->>'expected_outcome_revision') !~ '^[0-7]$'
  or jsonb_typeof(p->'expected_outcome_revision') is distinct from 'number'
  or jsonb_typeof(p->'document') is distinct from 'object'
  or jsonb_typeof(p->'association') is distinct from 'object'
  or jsonb_typeof(p->'mapping') is distinct from 'object'
  or jsonb_typeof(p->'snapshot') is distinct from 'object'
  or (p->>'span_manifest_sha256') !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='22023',message='invented_document_result_input_invalid'; end if;
 foreach field_name in array array['adapter_identity','feed_item_id','feed_operation_id','feed_page_id','feed_stream_id',
  'kind','operation_id','raw_base64','span_manifest_sha256'] loop
  if jsonb_typeof(p->field_name) is distinct from 'string' then
   raise exception using errcode='22023',message='invented_document_result_field_invalid'; end if;
 end loop;
 foreach field_name in array array['feed_item_id','feed_operation_id','feed_page_id','feed_stream_id','operation_id'] loop
  if p->>field_name !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invented_document_result_identity_invalid'; end if;
 end loop;
 operation:=(p->>'operation_id')::uuid;feed_operation:=(p->>'feed_operation_id')::uuid;
 item:=(p->>'feed_item_id')::uuid;expected:=(p->>'expected_outcome_revision')::integer;
 document:=p->'document';association:=p->'association';
 if document->>'media_type' is distinct from 'text/plain' or document->>'encoding' is distinct from 'utf-8'
  or document->>'source_key' !~ '^fictional-[a-z0-9:-]{1,109}$'
  or jsonb_typeof(p->'raw_base64') is distinct from 'string' then
  raise exception using errcode='22023',message='invented_document_result_profile_invalid'; end if;
 raw:=decode(p->>'raw_base64','base64');
 if octet_length(raw) not between 1 and 65536 or replace(encode(raw,'base64'),E'\n','') is distinct from p->>'raw_base64'
  or encode(sha256(raw),'hex') is distinct from document->>'content_sha256' then
  raise exception using errcode='22023',message='invented_document_result_bytes_invalid'; end if;
 -- Native binary slicing verifies mechanics against actual original bytes;
 -- it does not qualify semantic locators, language, source rights or support.
 select array_agg(key order by key) into keys from jsonb_object_keys(document) key;
 if keys is distinct from array['content_sha256','encoding','item_key','media_type','retrieved_at','source_key','source_url','source_version_id']
  or exists(select 1 from jsonb_each(document) e where jsonb_typeof(e.value)<>'string') then
  raise exception using errcode='22023',message='invented_document_result_document_invalid'; end if;
 select array_agg(key order by key) into keys from jsonb_object_keys(association) key;
 if keys is distinct from array['document_content_sha256','document_item_key','document_source_key','document_source_url',
  'document_source_version_id','feed_item_id','feed_operation_id']
  or exists(select 1 from jsonb_each(association) e where jsonb_typeof(e.value)<>'string')
  or document->>'source_version_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or document->>'retrieved_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$' then
  raise exception using errcode='22023',message='invented_document_result_association_invalid'; end if;
 m:=p->'mapping';snapshot:=p->'snapshot';
 select array_agg(key order by key) into keys from jsonb_object_keys(m) key;
 if keys is distinct from array['content_sha256','language_code','mapping_sha256','source_version_id','spans']
  or exists(select 1 from jsonb_each(m) e where e.key<>'spans' and jsonb_typeof(e.value)<>'string') then
  raise exception using errcode='22023',message='invented_document_result_mapping_invalid'; end if;
 select array_agg(key order by key) into keys from jsonb_object_keys(snapshot) key;
 if keys is distinct from array['content_sha256','item_key','language_code','mapping_sha256','passages','source_key','source_version_id']
  or exists(select 1 from jsonb_each(snapshot) e where e.key<>'passages' and jsonb_typeof(e.value)<>'string') then
  raise exception using errcode='22023',message='invented_document_result_snapshot_invalid'; end if;
 if m->>'source_version_id' is distinct from document->>'source_version_id'
  or m->>'content_sha256' is distinct from document->>'content_sha256'
  or m->>'mapping_sha256' !~ '^[a-f0-9]{64}$'
  or m->>'language_code' !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'
  or snapshot->>'source_key' is distinct from document->>'source_key'
  or snapshot->>'item_key' is distinct from document->>'item_key'
  or snapshot->>'source_version_id' is distinct from document->>'source_version_id'
  or snapshot->>'content_sha256' is distinct from document->>'content_sha256'
  or snapshot->>'mapping_sha256' is distinct from m->>'mapping_sha256'
  or snapshot->>'language_code' is distinct from m->>'language_code'
  or jsonb_typeof(m->'spans') is distinct from 'array' or jsonb_array_length(m->'spans')>128
  or jsonb_typeof(snapshot->'passages') is distinct from 'array'
  or jsonb_array_length(snapshot->'passages')<>jsonb_array_length(m->'spans') then
  raise exception using errcode='22023',message='invented_document_result_mapping_invalid'; end if;
 -- Reject malformed UTF-8 even outside selected ranges.
 perform convert_from(raw,'UTF8');
 for span in select value from jsonb_array_elements(m->'spans') loop
  passage:=snapshot->'passages'->position;position:=position+1;
  if jsonb_typeof(span) is distinct from 'object' or jsonb_typeof(passage) is distinct from 'object'
   or jsonb_typeof(span->'start') is distinct from 'number' or span->>'start' !~ '^(0|[1-9][0-9]{0,4})$'
   or jsonb_typeof(span->'end') is distinct from 'number' or span->>'end' !~ '^[1-9][0-9]{0,4}$'
   or jsonb_typeof(span->'locator') is distinct from 'string' or char_length(span->>'locator') not between 1 and 200
   or span->>'locator'=any(locators) or passage->>'locator' is distinct from span->>'locator' then
   raise exception using errcode='22023',message='invented_document_result_span_invalid'; end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(span) key;
  if keys is distinct from array['end','locator','start'] then
   raise exception using errcode='22023',message='invented_document_result_span_invalid'; end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(passage) key;
  if keys is distinct from array['locator','text','text_sha256']
   or exists(select 1 from jsonb_each(passage) e where jsonb_typeof(e.value)<>'string') then
   raise exception using errcode='22023',message='invented_document_result_passage_invalid'; end if;
  span_start:=(span->>'start')::integer;span_end:=(span->>'end')::integer;
  if span_start<previous_end or span_end<=span_start or span_end>octet_length(raw) or span_end-span_start>8192 then
   raise exception using errcode='22023',message='invented_document_result_span_invalid'; end if;
  body:=substring(raw from span_start+1 for span_end-span_start);total:=total+octet_length(body);
  if passage->>'text' is distinct from convert_from(body,'UTF8')
   or passage->>'text_sha256' is distinct from encode(sha256(body),'hex') or total>65536 then
   raise exception using errcode='22023',message='invented_document_result_passage_invalid'; end if;
  previous_end:=span_end;locators:=array_append(locators,span->>'locator');
 end loop;
 fingerprint:=sha256(convert_to(p::text,'UTF8'));
 select * into i from tf_feed_rehearsal.items where item_id=item for update;
 if not found or i.base_state<>'pending' then
  raise exception using errcode='22023',message='invented_document_result_item_invalid'; end if;
 select * into page from tf_feed_rehearsal.pages where operation_id=feed_operation;
 if not found or page.page_id<>i.page_id or page.stream_id<>i.stream_id or page.raw is distinct from p_feed_raw
  or p->>'feed_page_id' is distinct from page.page_id::text or p->>'feed_stream_id' is distinct from page.stream_id::text
  or document->>'source_version_id'=page.source_version_id::text
  or document->>'source_url' is distinct from i.metadata->>'url'
  or association->>'feed_operation_id' is distinct from feed_operation::text
  or association->>'feed_item_id' is distinct from item::text
  or association->>'document_source_key' is distinct from document->>'source_key'
  or association->>'document_item_key' is distinct from document->>'item_key'
  or association->>'document_source_version_id' is distinct from document->>'source_version_id'
  or association->>'document_content_sha256' is distinct from document->>'content_sha256'
  or association->>'document_source_url' is distinct from document->>'source_url' then
  raise exception using errcode='22023',message='invented_document_result_binding_invalid'; end if;
 select * into old from tf_feed_rehearsal.document_results where operation_id=operation;
 if found then
  if old.feed_item_id<>item or old.fingerprint<>fingerprint then
   raise exception using errcode='22023',message='invented_document_result_operation_conflict'; end if;
  return tf_feed_rehearsal.document_result_receipt(operation,raw,p_feed_raw);
 end if;
 at:=clock_timestamp();
 if (document->>'retrieved_at')::timestamptz<(page.input->'source'->>'retrieved_at')::timestamptz then
  raise exception using errcode='22023',message='invented_document_result_chronology_invalid'; end if;
 if not isfinite((document->>'retrieved_at')::timestamptz) or (document->>'retrieved_at')::timestamptz>at then
  raise exception using errcode='22023',message='invented_document_result_chronology_invalid'; end if;
 if exists(select 1 from tf_feed_rehearsal.outcomes where operation_id=operation) then
  raise exception using errcode='22023',message='invented_document_result_outcome_already_exists'; end if;
 -- The event and artifact are one transaction. A later constraint/error rolls
 -- this event back too; a pre-existing processed event is not adopted.
 outcome_receipt:=tf_feed_rehearsal.record_outcome(operation,item,expected,'processed');
 artifact_time:=clock_timestamp();
 if (outcome_receipt->>'recorded_at')::timestamptz<(document->>'retrieved_at')::timestamptz
  or artifact_time<greatest((document->>'retrieved_at')::timestamptz,(outcome_receipt->>'recorded_at')::timestamptz) then
  raise exception using errcode='22023',message='invented_document_result_chronology_invalid'; end if;
 insert into tf_feed_rehearsal.document_results(operation_id,feed_operation_id,feed_stream_id,feed_page_id,feed_item_id,
  document_source_key,document_item_key,document_source_version_id,document_sha256,raw,input,fingerprint,stored_at,outcome_operation_id)
 values(operation,feed_operation,page.stream_id,page.page_id,item,document->>'source_key',document->>'item_key',
  (document->>'source_version_id')::uuid,document->>'content_sha256',raw,p-'raw_base64',fingerprint,artifact_time,operation);
 return tf_feed_rehearsal.document_result_receipt(operation,raw,p_feed_raw);
end
$$;
revoke all on function tf_feed_rehearsal.document_result_receipt(uuid,bytea,bytea) from public;
revoke all on function tf_feed_rehearsal.complete_document_result(jsonb,bytea) from public;
