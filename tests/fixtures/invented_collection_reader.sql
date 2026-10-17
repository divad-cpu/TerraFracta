-- Fresh invented existing-NOLOGIN-role metadata reader only. Not a migration.
-- Must follow frozen owner feed/window/inventory/document + runtime role setup.
-- Does not add raw-byte, capture, outcome, window advance or document grants.
alter schema tf_feed_windows owner to tf_feed_lab_owner;
alter table tf_feed_windows.collections owner to tf_feed_lab_owner;
alter table tf_feed_windows.windows owner to tf_feed_lab_owner;
alter function tf_feed_windows.initialize(uuid,uuid) owner to tf_feed_lab_owner;
alter function tf_feed_windows.head(uuid,bytea) owner to tf_feed_lab_owner;
alter function tf_feed_windows.receipt(uuid,bytea) owner to tf_feed_lab_owner;
alter function tf_feed_windows.advance(jsonb) owner to tf_feed_lab_owner;
alter schema tf_feed_inventory owner to tf_feed_lab_owner;
alter function tf_feed_inventory.page(jsonb) owner to tf_feed_lab_owner;
revoke all on schema tf_feed_windows,tf_feed_inventory from public,tf_feed_lab_writer,tf_feed_lab_observer;
revoke all on all tables in schema tf_feed_windows from public,tf_feed_lab_writer,tf_feed_lab_observer;
revoke all on all functions in schema tf_feed_windows,tf_feed_inventory from public,tf_feed_lab_writer,tf_feed_lab_observer;
set local role tf_feed_lab_owner;
create table tf_feed_runtime.allowed_collections (
 collection_id uuid primary key references tf_feed_windows.collections(id)
);
alter table tf_feed_runtime.allowed_collections enable row level security;
revoke all on tf_feed_runtime.allowed_collections from public,tf_feed_lab_writer,tf_feed_lab_observer;
create function tf_feed_runtime.collection_inventory(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'scope') is distinct from 'object'
  or jsonb_typeof(p->'scope'->'collection_id') is distinct from 'string'
  or p->'scope'->>'collection_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or not exists(select 1 from tf_feed_runtime.allowed_collections where collection_id=(p->'scope'->>'collection_id')::uuid) then
  raise exception using errcode='42501',message='invented_collection_inventory_scope_denied';end if;
 return tf_feed_inventory.page(p);
end $$;
revoke all on function tf_feed_runtime.collection_inventory(jsonb) from public,tf_feed_lab_writer,tf_feed_lab_observer;
grant execute on function tf_feed_runtime.collection_inventory(jsonb) to tf_feed_lab_writer,tf_feed_lab_observer;
reset role;
