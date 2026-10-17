-- Fresh invented NOLOGIN observer/writer scope only, not a migration.
-- Existing allowed_streams ALSO enables old writer operations; it is not an
-- isolated read-only grant. The three NEW functions below only read.
alter schema tf_feed_reopen owner to tf_feed_lab_owner;
alter function tf_feed_reopen.original(jsonb) owner to tf_feed_lab_owner;
alter schema tf_document_reopen owner to tf_feed_lab_owner;
alter function tf_document_reopen.original(jsonb) owner to tf_feed_lab_owner;
revoke all on schema tf_feed_reopen,tf_document_reopen from public,tf_feed_lab_writer,tf_feed_lab_observer;
revoke all on all functions in schema tf_feed_reopen,tf_document_reopen from public,tf_feed_lab_writer,tf_feed_lab_observer;
set local role tf_feed_lab_owner;
create function tf_feed_runtime.feed_original(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare actual_stream uuid;
begin
 if current_setting('transaction_isolation')<>'repeatable read' or current_setting('transaction_read_only')<>'on' then
  raise exception using errcode='25006',message='invented_stream_reader_requires_read_only';end if;
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>4096
  or jsonb_typeof(p->'capture_operation_id') is distinct from 'string'
  or p->>'capture_operation_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
  raise exception using errcode='22023',message='invented_stream_reader_input_invalid';end if;
 select stream_id into actual_stream from tf_feed_rehearsal.pages where operation_id=(p->>'capture_operation_id')::uuid;
 perform tf_feed_runtime.require_stream(actual_stream);
 return tf_feed_reopen.original(p);
end $$;
create function tf_feed_runtime.document_original(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare actual_stream uuid;
begin
 if current_setting('transaction_isolation')<>'repeatable read' or current_setting('transaction_read_only')<>'on' then
  raise exception using errcode='25006',message='invented_stream_reader_requires_read_only';end if;
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16384
  or jsonb_typeof(p->'outcome_operation_id') is distinct from 'string'
  or p->>'outcome_operation_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
  raise exception using errcode='22023',message='invented_stream_reader_input_invalid';end if;
 select feed_stream_id into actual_stream from tf_feed_rehearsal.document_results where operation_id=(p->>'outcome_operation_id')::uuid;
 perform tf_feed_runtime.require_stream(actual_stream);
 return tf_document_reopen.original(p);
end $$;
create function tf_feed_runtime.item_history(p_operation uuid,p_item uuid,p_expected_raw bytea)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare page tf_feed_rehearsal.pages%rowtype;result jsonb;
begin
 if current_setting('transaction_isolation')<>'repeatable read' or current_setting('transaction_read_only')<>'on' then
  raise exception using errcode='25006',message='invented_stream_reader_requires_read_only';end if;
 if p_operation is null or p_item is null or p_expected_raw is null or octet_length(p_expected_raw) not between 1 and 65536 then
  raise exception using errcode='22023',message='invented_stream_reader_input_invalid';end if;
 select * into page from tf_feed_rehearsal.pages where operation_id=p_operation;
 perform tf_feed_runtime.require_stream(page.stream_id);
 if page.raw is distinct from p_expected_raw or not exists(select 1 from tf_feed_rehearsal.items i
   where i.item_id=p_item and i.page_id=page.page_id and i.stream_id=page.stream_id) then
  raise exception using errcode='22023',message='invented_stream_reader_item_mismatch';end if;
 result:=jsonb_build_object('item_id',p_item,'page',tf_feed_rehearsal.page_receipt(p_operation,p_expected_raw),
  'outcomes',coalesce((select jsonb_agg(to_jsonb(o) order by o.revision) from tf_feed_rehearsal.outcomes o where o.item_id=p_item),'[]'::jsonb));
 if octet_length(result::text)>131072 then raise exception using errcode='54000',message='invented_stream_reader_output_limit';end if;
 return result;
end $$;
revoke all on function tf_feed_runtime.feed_original(jsonb),tf_feed_runtime.document_original(jsonb),tf_feed_runtime.item_history(uuid,uuid,bytea)
 from public,tf_feed_lab_writer,tf_feed_lab_observer;
grant execute on function tf_feed_runtime.feed_original(jsonb),tf_feed_runtime.document_original(jsonb),tf_feed_runtime.item_history(uuid,uuid,bytea)
 to tf_feed_lab_writer,tf_feed_lab_observer;
reset role;
