\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- All rows and test-only role memberships disappear with the final rollback.
grant terra_collector, terra_reviewer, terra_operator to postgres;

insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint)
values
  ('a1111111-1111-4111-8111-111111111111', 'synthetic-one', 'Synthetic', 'https://example.test/one'),
  ('a2222222-2222-4222-8222-222222222222', 'synthetic-two', 'Synthetic', 'https://example.test/two');
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
values
  ('b1111111-1111-4111-8111-111111111111',
   'a1111111-1111-4111-8111-111111111111',
   'synthetic-item', 'https://example.test/one/item', now(), repeat('a', 64)),
  ('b2222222-2222-4222-8222-222222222222',
   'a1111111-1111-4111-8111-111111111111',
   'synthetic-other', 'https://example.test/one/other', now(), repeat('b', 64));

insert into terra_private.source_response_pairs
  (id, registration_id, attempt_key, metadata_version_id, data_version_id,
   metadata_retrieved_at, data_retrieved_at)
values ('c1111111-1111-4111-8111-111111111111',
        'a1111111-1111-4111-8111-111111111111', 'synthetic-checkpoint-pair',
        'b2222222-2222-4222-8222-222222222222',
        'b1111111-1111-4111-8111-111111111111', now(), now());
insert into terra_private.source_pair_validations
  (pair_id, registration_id, validation_state, assessed_at)
values ('c1111111-1111-4111-8111-111111111111',
        'a1111111-1111-4111-8111-111111111111', 'usable', now());

do $$
begin
  begin
    insert into terra_private.source_checkpoints
      (registration_id, last_response_pair_id, last_source_version_id,
       last_successful_retrieved_at, last_attempted_at)
    values ('a1111111-1111-4111-8111-111111111111',
            'c1111111-1111-4111-8111-111111111111',
            'b1111111-1111-4111-8111-111111111111', now(), now());
    raise exception 'Checkpoint unexpectedly accepted before a work item';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'checkpoint requires a durable source work item');

insert into terra_private.source_work_items (source_version_id, registration_id)
values ('b1111111-1111-4111-8111-111111111111',
        'a1111111-1111-4111-8111-111111111111');
insert into terra_private.source_checkpoints
  (registration_id, last_response_pair_id, last_source_version_id,
   last_successful_retrieved_at, last_attempted_at)
values ('a1111111-1111-4111-8111-111111111111',
        'c1111111-1111-4111-8111-111111111111',
        'b1111111-1111-4111-8111-111111111111', now(), now());
select is(
  (select processing_state from terra_private.source_work_items
   where source_version_id = 'b1111111-1111-4111-8111-111111111111'),
  'pending', 'checkpoint can advance while extraction remains pending'
);

do $$
begin
  begin
    insert into terra_private.source_checkpoints
      (registration_id, last_response_pair_id, last_source_version_id,
       last_successful_retrieved_at, last_attempted_at)
    values ('a2222222-2222-4222-8222-222222222222',
            'c1111111-1111-4111-8111-111111111111',
            'b1111111-1111-4111-8111-111111111111', now(), now());
    raise exception 'Checkpoint crossed source registration';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'checkpoint cannot reference another source registration');

do $$
begin
  begin
    insert into terra_private.source_work_items (source_version_id, registration_id)
    values ('b2222222-2222-4222-8222-222222222222',
            'a2222222-2222-4222-8222-222222222222');
    raise exception 'Work item crossed source registration';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'work item cannot reference a version from another registration');

do $$
begin
  begin
    update terra_private.source_work_items
    set processing_state = 'processed'
    where source_version_id = 'b1111111-1111-4111-8111-111111111111';
    raise exception 'Processed state unexpectedly accepted without completion time';
  exception when check_violation then null;
  end;
end;
$$;
select ok(true, 'processed state needs a completion time');

select is(
  (select count(*)::integer from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'terra_private' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'no private table is missing RLS'
);

set local role anon;
do $$
begin
  begin
    perform count(*) from terra_private.source_work_items;
    raise exception 'Anonymous role read private work items';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'anonymous role cannot read private work items');

set local role service_role;
do $$
begin
  begin
    perform count(*) from terra_private.source_checkpoints;
    raise exception 'Service role read private checkpoints';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'service role has no access to private checkpoints');

-- Check table ACLs separately from schema USAGE denial. In particular,
-- service_role can bypass RLS if a future schema grant exposes a table.
select ok(
  not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role'), ('terra_collector'))
      as excluded(role_name)
    cross join (values ('source_work_items'), ('source_checkpoints'))
      as private_table(table_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                       ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'))
      as operation(privilege_name)
    where has_table_privilege(
      excluded.role_name,
      format('terra_private.%I', private_table.table_name),
      operation.privilege_name
    )
  ),
  'excluded roles have no direct privileges on either collection-state table'
);

-- A future accidental SQL grant must still meet the RLS policy boundary.
grant usage on schema terra_private to anon, authenticated;
grant select on terra_private.source_work_items to anon;
grant select on terra_private.source_checkpoints to authenticated;

set local role anon;
do $$
declare visible_items integer;
begin
  select count(*) into visible_items from terra_private.source_work_items;
  if visible_items <> 0 then
    raise exception 'Anonymous role saw % private work items through RLS', visible_items;
  end if;
end;
$$;
reset role;
select ok(true, 'RLS hides work items even with temporary anonymous SELECT');

set local role authenticated;
do $$
declare visible_checkpoints integer;
begin
  select count(*) into visible_checkpoints from terra_private.source_checkpoints;
  if visible_checkpoints <> 0 then
    raise exception 'Authenticated role saw % private checkpoints through RLS', visible_checkpoints;
  end if;
end;
$$;
reset role;
select ok(true, 'RLS hides checkpoints even with temporary authenticated SELECT');

set local role terra_collector;
do $$
begin
  begin
    insert into terra_private.source_work_items (source_version_id, registration_id)
    values ('b1111111-1111-4111-8111-111111111111',
            'a1111111-1111-4111-8111-111111111111');
    raise exception 'Collector unexpectedly wrote a work item';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'collector still has no write path');

set local role terra_reviewer;
do $$
declare item_count integer;
begin
  select count(*) into item_count from terra_private.source_work_items;
  if item_count <> 1 then
    raise exception 'Reviewer expected one private work item, saw %', item_count;
  end if;
  begin
    update terra_private.source_work_items set processing_state = 'held';
    raise exception 'Reviewer unexpectedly rewrote a work item';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'reviewer sees work state but cannot rewrite it');

set local role terra_operator;
do $$
declare checkpoint_count integer;
begin
  select count(*) into checkpoint_count from terra_private.source_checkpoints;
  if checkpoint_count <> 1 then
    raise exception 'Operator expected one checkpoint, saw %', checkpoint_count;
  end if;
  begin
    perform count(*) from terra_private.source_work_items;
    raise exception 'Operator unexpectedly read work items';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'operator sees checkpoints but not work-item content');

do $$
begin
  begin
    update terra_private.source_checkpoints
    set last_attempted_at = last_successful_retrieved_at - interval '1 second';
    raise exception 'Checkpoint accepted attempt earlier than success';
  exception when check_violation then null;
  end;
end;
$$;
select ok(true, 'checkpoint attempt cannot predate its successful retrieval');

select * from finish();
rollback;
