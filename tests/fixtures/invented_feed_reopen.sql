-- Owner-only original feed reopening. No source fetch/role/queue/grant/migration.
create schema tf_feed_reopen;
revoke all on schema tf_feed_reopen from public;
create function tf_feed_reopen.original(p jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,pg_temp as $$
declare
 keys text[];field text;c tf_feed_windows.collections%rowtype;w tf_feed_windows.windows%rowtype;
 page tf_feed_rehearsal.pages%rowtype;i tf_feed_rehearsal.items%rowtype;result jsonb;
begin
 if current_setting('transaction_isolation')<>'repeatable read' or current_setting('transaction_read_only')<>'on' then
  raise exception using errcode='25006',message='invented_reopen_requires_coherent_read_only';end if;
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>4096 then
  raise exception using errcode='22023',message='invented_reopen_input_invalid';end if;
 select array_agg(key order by key) into keys from jsonb_object_keys(p) key;
 if keys is distinct from array['capture_operation_id','item_id','item_position','page_id','page_revision','scope','stream_id','window_revision']
  or jsonb_typeof(p->'scope') is distinct from 'object' then raise exception using errcode='22023',message='invented_reopen_input_invalid';end if;
 select array_agg(key order by key) into keys from jsonb_object_keys(p->'scope') key;
 if keys is distinct from array['collection_id','format','initial_url','source_key']
  or exists(select 1 from jsonb_each(p->'scope') e where jsonb_typeof(e.value)<>'string')
  or p->'scope'->>'collection_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
  raise exception using errcode='22023',message='invented_reopen_scope_invalid';end if;
 foreach field in array array['capture_operation_id','item_id','page_id','stream_id'] loop
  if jsonb_typeof(p->field) is distinct from 'string' or p->>field !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invented_reopen_identity_invalid';end if;
 end loop;
 foreach field in array array['window_revision','page_revision','item_position'] loop
  if jsonb_typeof(p->field) is distinct from 'number' or p->>field !~ '^[1-9][0-9]?$' then
   raise exception using errcode='22023',message='invented_reopen_position_invalid';end if;
 end loop;
 if (p->>'window_revision')::integer>32 or (p->>'page_revision')::integer>64 or (p->>'item_position')::integer>50 then
  raise exception using errcode='22023',message='invented_reopen_position_invalid';end if;
 select * into c from tf_feed_windows.collections where id=(p->'scope'->>'collection_id')::uuid;
 if not found or c.source_key is distinct from p->'scope'->>'source_key' or c.initial_url is distinct from p->'scope'->>'initial_url'
  or c.format is distinct from p->'scope'->>'format' then raise exception using errcode='22023',message='invented_reopen_unavailable';end if;
 select * into w from tf_feed_windows.windows where collection_id=c.id and revision=(p->>'window_revision')::integer;
 if not found or w.stream_id<>(p->>'stream_id')::uuid then raise exception using errcode='22023',message='invented_reopen_unavailable';end if;
 select * into page from tf_feed_rehearsal.pages where operation_id=(p->>'capture_operation_id')::uuid;
 if not found or page.stream_id<>w.stream_id or page.page_id<>(p->>'page_id')::uuid or page.revision<>(p->>'page_revision')::integer then
  raise exception using errcode='22023',message='invented_reopen_unavailable';end if;
 select * into i from tf_feed_rehearsal.items where item_id=(p->>'item_id')::uuid;
 if not found or i.stream_id<>w.stream_id or i.page_id<>page.page_id or i.position<>(p->>'item_position')::integer then
  raise exception using errcode='22023',message='invented_reopen_unavailable';end if;
 result:=jsonb_build_object('schema_version',1,'kind','invented_feed_reopened_original','request',p,
  'raw_base64',replace(encode(page.raw,'base64'),E'\n',''),'source',page.input->'source','format',page.input->'format',
  'parser_identity',page.input->'parser_identity','allowed_next_url',page.input->'allowed_next_url',
  'expected_revision',page.input->'expected_revision',
  'stored_at',to_char(page.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'observed_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 if octet_length(result::text)>131072 then raise exception using errcode='54000',message='invented_reopen_output_limit';end if;
 return result;
end $$;
revoke all on all functions in schema tf_feed_reopen from public;
