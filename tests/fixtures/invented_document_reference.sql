-- Fresh invented per-occurrence HISTORICAL reference only, not a migration.
-- Existing allowed_streams is shared with old writer operations. This route
-- reads only and supplies no independent binding/rights/baseline decision.
set local role tf_feed_lab_owner;
create function tf_feed_runtime.document_reference(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare actual_stream uuid;r tf_feed_rehearsal.document_results%rowtype;o tf_feed_rehearsal.outcomes%rowtype;candidate jsonb:=null;result jsonb;
begin
 if current_setting('transaction_isolation')<>'repeatable read' or current_setting('transaction_read_only')<>'on' then
  raise exception using errcode='25006',message='invented_document_reference_requires_read_only';end if;
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>4096
  or jsonb_typeof(p->'capture_operation_id') is distinct from 'string'
  or p->>'capture_operation_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
  raise exception using errcode='22023',message='invented_document_reference_input_invalid';end if;
 select stream_id into actual_stream from tf_feed_rehearsal.pages where operation_id=(p->>'capture_operation_id')::uuid;
 perform tf_feed_runtime.require_stream(actual_stream);
 -- Reuse the existing exact collection/window/page/item membership guard. Its
 -- bounded original envelope is discarded; no source body enters the response.
 perform tf_feed_reopen.original(p);
 select * into r from tf_feed_rehearsal.document_results where feed_item_id=(p->>'item_id')::uuid;
 if found then
  select * into o from tf_feed_rehearsal.outcomes where operation_id=r.outcome_operation_id;
  if not found or r.feed_operation_id<>(p->>'capture_operation_id')::uuid or r.feed_stream_id<>actual_stream
   or r.feed_page_id<>(p->>'page_id')::uuid or o.item_id<>r.feed_item_id or o.state<>'processed'
   or exists(select 1 from tf_feed_rehearsal.outcomes where item_id=o.item_id and revision>o.revision) then
   raise exception using errcode='22023',message='invented_document_reference_unavailable';end if;
  candidate:=jsonb_build_object('artifact_id',r.artifact_id,'operation_id',r.operation_id,'outcome_revision',o.revision,
   'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'source_key',r.document_source_key,'item_key',r.document_item_key,'source_version_id',r.document_source_version_id,
   'source_url',r.input->'document'->>'source_url','content_sha256',r.document_sha256,'retrieved_at',r.input->'document'->>'retrieved_at',
   'mapping_sha256',r.input->'mapping'->>'mapping_sha256','language_code',r.input->'mapping'->>'language_code',
   'feed_capture_operation_id',r.feed_operation_id,'feed_stream_id',r.feed_stream_id,'feed_page_id',r.feed_page_id,'feed_item_id',r.feed_item_id);
 end if;
 result:=jsonb_build_object('schema_version',1,'kind','invented_stored_document_reference','request',p,'reference',candidate,
  'observed_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 if octet_length(result::text)>16384 then raise exception using errcode='54000',message='invented_document_reference_output_limit';end if;
 return result;
end $$;
revoke all on function tf_feed_runtime.document_reference(jsonb) from public,tf_feed_lab_writer,tf_feed_lab_observer;
grant execute on function tf_feed_runtime.document_reference(jsonb) to tf_feed_lab_writer,tf_feed_lab_observer;
reset role;
