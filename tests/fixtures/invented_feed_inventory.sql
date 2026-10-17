-- Owner-only read-only invented collection inventory; no queue/lease or grants.
-- Install only with frozen feed/window fixtures in a new isolated test cluster.
create schema tf_feed_inventory;
revoke all on schema tf_feed_inventory from public;
create function tf_feed_inventory.page(p jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,pg_temp as $$
declare
 keys text[];field text;v_collection uuid;v_limit integer;c tf_feed_windows.collections%rowtype;
 s tf_feed_rehearsal.streams%rowtype;v_cut jsonb;v_after jsonb;v_scope jsonb;v_window integer;v_page_revision integer;
 v_stream uuid;v_page uuid;v_stored timestamptz;v_recorded timestamptz;
 aw integer:=0;ap integer:=0;ai integer:=0;v_rows jsonb;v_count integer;v_more boolean;v_cursor jsonb;result jsonb;
begin
 if current_setting('transaction_isolation')<>'repeatable read' or current_setting('transaction_read_only')<>'on' then
  raise exception using errcode='25006',message='invented_inventory_requires_coherent_read_only';end if;
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>4096 then
  raise exception using errcode='22023',message='invented_inventory_input_invalid';end if;
 select array_agg(key order by key) into keys from jsonb_object_keys(p) key;
 if keys is distinct from array['after','cut','item_limit','scope'] or jsonb_typeof(p->'scope') is distinct from 'object'
  or jsonb_typeof(p->'item_limit') is distinct from 'number' or coalesce(p->>'item_limit','') !~ '^([1-9]|1[0-9]|20)$' then
  raise exception using errcode='22023',message='invented_inventory_input_invalid';end if;
 v_scope:=p->'scope';v_limit:=(p->>'item_limit')::integer;v_cut:=p->'cut';v_after:=p->'after';
 select array_agg(key order by key) into keys from jsonb_object_keys(v_scope) key;
 if keys is distinct from array['collection_id','format','initial_url','source_key']
  or exists(select 1 from jsonb_each(v_scope) e where jsonb_typeof(e.value)<>'string')
  or v_scope->>'collection_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
  raise exception using errcode='22023',message='invented_inventory_scope_invalid';end if;
 v_collection:=(v_scope->>'collection_id')::uuid;
 select * into c from tf_feed_windows.collections where id=v_collection;
 if not found or c.source_key is distinct from v_scope->>'source_key' or c.initial_url is distinct from v_scope->>'initial_url'
  or c.format is distinct from v_scope->>'format' then
  raise exception using errcode='22023',message='invented_inventory_scope_unavailable';end if;
 if v_cut='null'::jsonb then
  if v_after is distinct from 'null'::jsonb then raise exception using errcode='22023',message='invented_inventory_cursor_invalid';end if;
  select * into s from tf_feed_rehearsal.streams where id=c.current_stream_id;
  v_window:=c.revision;v_stream:=s.id;v_page_revision:=s.revision;v_page:=s.last_page_id;
  select stored_at into v_stored from tf_feed_rehearsal.pages where page_id=v_page;
  select recorded_at into v_recorded from tf_feed_windows.windows where collection_id=c.id and revision=c.revision;
 else
  if jsonb_typeof(v_cut) is distinct from 'object' then raise exception using errcode='22023',message='invented_inventory_cut_invalid';end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(v_cut) key;
  if keys is distinct from array['page_id','page_stored_at','stream_id','stream_revision','window_recorded_at','window_revision'] then
   raise exception using errcode='22023',message='invented_inventory_cut_invalid';end if;
  foreach field in array array['page_id','stream_id'] loop
   if jsonb_typeof(v_cut->field) is distinct from 'string' or v_cut->>field !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
    raise exception using errcode='22023',message='invented_inventory_cut_invalid';end if;
  end loop;
  foreach field in array array['page_stored_at','window_recorded_at'] loop
   if jsonb_typeof(v_cut->field) is distinct from 'string' or v_cut->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$' then
    raise exception using errcode='22023',message='invented_inventory_cut_invalid';end if;
  end loop;
  if jsonb_typeof(v_cut->'window_revision') is distinct from 'number' or coalesce(v_cut->>'window_revision','') !~ '^([1-9]|[12][0-9]|3[0-2])$'
   or jsonb_typeof(v_cut->'stream_revision') is distinct from 'number' or coalesce(v_cut->>'stream_revision','') !~ '^([1-9]|[1-5][0-9]|6[0-4])$' then
   raise exception using errcode='22023',message='invented_inventory_cut_invalid';end if;
  v_window:=(v_cut->>'window_revision')::integer;v_stream:=(v_cut->>'stream_id')::uuid;
  v_page_revision:=(v_cut->>'stream_revision')::integer;v_page:=(v_cut->>'page_id')::uuid;
  v_stored:=(v_cut->>'page_stored_at')::timestamptz;v_recorded:=(v_cut->>'window_recorded_at')::timestamptz;
  if not exists(select 1 from tf_feed_windows.windows w join tf_feed_rehearsal.pages p0 on p0.stream_id=w.stream_id
   where w.collection_id=c.id and w.revision=v_window and w.stream_id=v_stream and w.recorded_at=v_recorded
    and p0.page_id=v_page and p0.revision=v_page_revision and p0.stored_at=v_stored) or v_window>c.revision then
   raise exception using errcode='22023',message='invented_inventory_cut_unavailable';end if;
 end if;
 v_cut:=jsonb_build_object('window_revision',v_window,'stream_id',v_stream,'stream_revision',v_page_revision,'page_id',v_page,
  'page_stored_at',to_char(v_stored at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'window_recorded_at',to_char(v_recorded at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 if v_after is distinct from 'null'::jsonb then
  if jsonb_typeof(v_after) is distinct from 'object' then raise exception using errcode='22023',message='invented_inventory_cursor_invalid';end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(v_after) key;
  if keys is distinct from array['item_position','page_revision','window_revision']
   or jsonb_typeof(v_after->'window_revision') is distinct from 'number' or coalesce(v_after->>'window_revision','') !~ '^([1-9]|[12][0-9]|3[0-2])$'
   or jsonb_typeof(v_after->'page_revision') is distinct from 'number' or coalesce(v_after->>'page_revision','') !~ '^([1-9]|[1-5][0-9]|6[0-4])$'
   or jsonb_typeof(v_after->'item_position') is distinct from 'number' or coalesce(v_after->>'item_position','') !~ '^([1-9]|[1-4][0-9]|50)$' then
   raise exception using errcode='22023',message='invented_inventory_cursor_invalid';end if;
  aw:=(v_after->>'window_revision')::integer;ap:=(v_after->>'page_revision')::integer;ai:=(v_after->>'item_position')::integer;
  if not exists(select 1 from tf_feed_windows.windows w join tf_feed_rehearsal.pages p0 on p0.stream_id=w.stream_id
   join tf_feed_rehearsal.items i on i.page_id=p0.page_id where w.collection_id=c.id and w.revision=aw and p0.revision=ap and i.position=ai
    and (w.revision<v_window or (w.revision=v_window and p0.revision<=v_page_revision))) then
   raise exception using errcode='22023',message='invented_inventory_cursor_unavailable';end if;
 end if;
 if exists(select 1 from tf_feed_windows.windows w join tf_feed_rehearsal.pages p0 on p0.stream_id=w.stream_id
  where w.collection_id=c.id and (w.revision<v_window or (w.revision=v_window and p0.revision<=v_page_revision))
   and p0.input->>'format' is distinct from c.format) then
  raise exception using errcode='22023',message='invented_inventory_profile_unavailable';end if;
 with bounded as (
  select w.revision window_revision,w.stream_id,p0.revision page_revision,p0.page_id,p0.operation_id capture_operation_id,
   p0.source_version_id,p0.input->'source'->>'content_sha256' source_sha256,p0.input->'source'->>'feed_url' feed_url,
   to_char(p0.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') page_stored_at,
   p0.input->'source'->>'retrieved_at' source_retrieved_at,p0.input->>'format' format,p0.input->>'parser_identity' parser_identity,
   i.item_id,i.position,i.locator,i.entry_id,i.held_reason,i.base_state
  from tf_feed_windows.windows w join tf_feed_rehearsal.pages p0 on p0.stream_id=w.stream_id
  join tf_feed_rehearsal.items i on i.page_id=p0.page_id where w.collection_id=c.id
   and (w.revision<v_window or (w.revision=v_window and p0.revision<=v_page_revision))
   and (w.revision,p0.revision,i.position)>(aw,ap,ai)
  order by w.revision,p0.revision,i.position limit v_limit+1
 ), selected as (
  select to_jsonb(b)||jsonb_build_object('outcomes',coalesce((select jsonb_agg(to_jsonb(o) order by o.revision)
    from tf_feed_rehearsal.outcomes o where o.item_id=b.item_id),'[]'::jsonb)) item_row,
   b.window_revision,b.page_revision,b.position from bounded b
 ) select coalesce(jsonb_agg(item_row order by window_revision,page_revision,position),'[]'::jsonb),count(*) into v_rows,v_count from selected;
 v_more:=v_count>v_limit;
 if v_more then
  v_rows:=v_rows-(v_count-1);
  v_cursor:=jsonb_build_object('window_revision',v_rows->(v_limit-1)->'window_revision',
   'page_revision',v_rows->(v_limit-1)->'page_revision','item_position',v_rows->(v_limit-1)->'position');
 else v_cursor:=null;end if;
 result:=jsonb_build_object('schema_version',1,'kind','invented_collection_inventory_page','request',p,'cut',v_cut,
  'rows',v_rows,'has_more',v_more,'next_cursor',v_cursor,
  'observed_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 if octet_length(result::text)>131072 then raise exception using errcode='54000',message='invented_inventory_output_limit';end if;
 return result;
end
$$;
revoke all on function tf_feed_inventory.page(jsonb) from public;
