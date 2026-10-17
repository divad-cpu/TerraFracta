-- UNINSTALLED invented permission-semantics fixture, never operational policy.
-- Raw stream access alone does not disclose independently generated output.
-- No detached context, held/page words or full appended association is exposed.
set local role tf_feed_lab_owner;
create table tf_feed_runtime.private_result_read_scopes (
 operation_id uuid primary key references tf_private_extraction.results(operation_id),
 reader_role text not null check(reader_role='tf_feed_lab_observer')
);
alter table tf_feed_runtime.private_result_read_scopes enable row level security;
revoke all on tf_feed_runtime.private_result_read_scopes from public,tf_feed_lab_observer,tf_feed_lab_writer;
create function tf_feed_runtime.private_result_receipt(p_operation uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare current_stream uuid;previous_stream uuid;
begin
 if current_setting('transaction_read_only')<>'on' or current_setting('transaction_isolation')<>'repeatable read' then
  raise exception using errcode='25006',message='invented_private_reader_read_only_required';end if;
 if session_user<>'tf_feed_lab_observer' or p_operation is null or not exists(
   select 1 from tf_feed_runtime.private_result_read_scopes where operation_id=p_operation and reader_role=session_user) then
  raise exception using errcode='42501',message='invented_private_reader_unavailable';end if;
 select current_doc.feed_stream_id,previous_doc.feed_stream_id into current_stream,previous_stream
 from tf_private_extraction.results r
 join tf_feed_rehearsal.document_results current_doc on current_doc.operation_id=r.current_document_operation_id
 join tf_feed_rehearsal.document_results previous_doc on previous_doc.operation_id=r.previous_document_operation_id
 where r.operation_id=p_operation;
 if not found or current_stream is null or previous_stream is null then
  raise exception using errcode='42501',message='invented_private_reader_unavailable';end if;
 begin
  perform tf_feed_runtime.require_stream(current_stream);
  perform tf_feed_runtime.require_stream(previous_stream);
 exception when insufficient_privilege then
  raise exception using errcode='42501',message='invented_private_reader_unavailable';
 end;
 return tf_private_extraction.result_receipt(p_operation);
end $$;
revoke all on function tf_feed_runtime.private_result_receipt(uuid)from public,tf_feed_lab_writer,tf_feed_lab_observer;
grant execute on function tf_feed_runtime.private_result_receipt(uuid)to tf_feed_lab_observer;
reset role;
