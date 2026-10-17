-- Read-only owner-only stored document bytes, no migration or operational grant.
create schema tf_document_reopen;
revoke all on schema tf_document_reopen from public;
create function tf_document_reopen.original(p jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,pg_temp as $$
declare keys text[];r tf_feed_rehearsal.document_results%rowtype;o tf_feed_rehearsal.outcomes%rowtype;result jsonb;b jsonb;a jsonb;
begin
 if current_setting('transaction_isolation')<>'repeatable read' or current_setting('transaction_read_only')<>'on' then
  raise exception using errcode='25006',message='invented_document_reopen_requires_read_only';end if;
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16384 then
  raise exception using errcode='22023',message='invented_document_reopen_input_invalid';end if;
 select array_agg(key order by key) into keys from jsonb_object_keys(p) key;
 if keys is distinct from array['association','binding','feed','outcome_operation_id','outcome_revision']
  or jsonb_typeof(p->'binding') is distinct from 'object' or jsonb_typeof(p->'association') is distinct from 'object'
  or jsonb_typeof(p->'outcome_operation_id') is distinct from 'string'
  or p->>'outcome_operation_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or jsonb_typeof(p->'outcome_revision') is distinct from 'number' or p->>'outcome_revision' !~ '^[1-8]$' then
  raise exception using errcode='22023',message='invented_document_reopen_input_invalid';end if;
 -- Reuse exact real collection/window/page/item membership guard.
 perform tf_feed_reopen.original(p->'feed');b:=p->'binding';a:=p->'association';
 select array_agg(key order by key) into keys from jsonb_object_keys(b) key;
 if keys is distinct from array['content_sha256','item_key','language_code','mapping_sha256','retrieved_at','source_key','source_url','source_version_id']
  or exists(select 1 from jsonb_each(b) e where jsonb_typeof(e.value)<>'string') then
  raise exception using errcode='22023',message='invented_document_reopen_binding_invalid';end if;
 select * into r from tf_feed_rehearsal.document_results where operation_id=(p->>'outcome_operation_id')::uuid;
 if not found or r.feed_item_id<>(p->'feed'->>'item_id')::uuid or r.feed_operation_id<>(p->'feed'->>'capture_operation_id')::uuid then
  raise exception using errcode='22023',message='invented_document_reopen_unavailable';end if;
 select * into o from tf_feed_rehearsal.outcomes where operation_id=r.outcome_operation_id;
 if not found or o.item_id<>r.feed_item_id or o.state<>'processed' or o.revision<>(p->>'outcome_revision')::integer
  or exists(select 1 from tf_feed_rehearsal.outcomes where item_id=o.item_id and revision>o.revision)
  or r.input->'association' is distinct from a
  or r.input->'document'->>'source_key' is distinct from b->>'source_key'
  or r.input->'document'->>'item_key' is distinct from b->>'item_key'
  or r.input->'document'->>'source_version_id' is distinct from b->>'source_version_id'
  or r.input->'document'->>'source_url' is distinct from b->>'source_url'
  or r.input->'document'->>'content_sha256' is distinct from b->>'content_sha256'
  or r.input->'document'->>'retrieved_at' is distinct from b->>'retrieved_at'
  or r.input->'mapping'->>'mapping_sha256' is distinct from b->>'mapping_sha256'
  or r.input->'mapping'->>'language_code' is distinct from b->>'language_code' then
  raise exception using errcode='22023',message='invented_document_reopen_binding_mismatch';end if;
 result:=jsonb_build_object('schema_version',1,'kind','invented_document_reopened_original','request',p,
  'raw_base64',replace(encode(r.raw,'base64'),E'\n',''),'artifact_id',r.artifact_id,
  'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'observed_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 if octet_length(result::text)>131072 then raise exception using errcode='54000',message='invented_document_reopen_output_limit';end if;
 return result;
end $$;
revoke all on all functions in schema tf_document_reopen from public;
