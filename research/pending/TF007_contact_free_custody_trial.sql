-- Invented-only standalone PostgreSQL experiment, NOT a migration or installer.
-- Run only in a new network-none, portless, disposable test cluster. No existing
-- project database, credentials, sources or publications are read or changed.
create role tf_trial_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role tf_trial_public nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role tf_trial_writer nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role tf_trial_reviewer nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role tf_trial_custodian nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create schema tf_contact_free_trial authorization tf_trial_owner;
revoke all on schema tf_contact_free_trial from public;
set role tf_trial_owner;
-- Schema-local defaults cannot undo the global PUBLIC function default.
alter default privileges revoke execute on functions from public;

-- Elapsed UTC milliseconds reproduce the accepted TypeScript limits without
-- timezone-dependent calendar-day interval arithmetic.
create table tf_contact_free_trial.clock_state (
  singleton boolean primary key check(singleton), known boolean not null,
  now_ms bigint not null check(now_ms between 0 and 9007199254740991 - 15552000000)
);
create function tf_contact_free_trial.guard_clock() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.now_ms < old.now_ms then raise exception 'Invented clock refused'; end if;
  return new;
end $$;
create trigger monotonic_clock before update on tf_contact_free_trial.clock_state
for each row execute function tf_contact_free_trial.guard_clock();

create function tf_contact_free_trial.valid_text(value text, minimum integer, maximum integer)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select value is not null and
    coalesce((select sum(case when ascii(substr(value, n, 1)) > 65535 then 2 else 1 end)
              from generate_series(1, length(value)) n), 0) between minimum and maximum
    and not exists(select from generate_series(1, length(value)) n
      where ascii(substr(value, n, 1)) between 1 and 8
         or ascii(substr(value, n, 1)) in (11,12,127)
         or ascii(substr(value, n, 1)) between 14 and 31)
$$;
create table tf_contact_free_trial.records (
  report_id uuid primary key, request_id uuid unique not null,
  -- The owner inserts a target already checked by the established TS contract.
  -- This fixture has no current publication provider and cannot qualify intake.
  target jsonb not null check(jsonb_typeof(target) = 'object'),
  received_at_ms bigint not null check(received_at_ms between 0 and 9007199254740991 - 15552000000),
  closed_at_ms bigint check(closed_at_ms >= received_at_ms),
  closed_reason text check(closed_reason in ('corrected','unsubstantiated','duplicate','outside_scope','withdrawn')),
  reviewer_id uuid,
  erased_at_ms bigint check(erased_at_ms >= received_at_ms),
  erase_reason text check(erase_reason in ('reporter_request','sensitive_material','expired')),
  version bigint not null default 1 check(version > 0),
  check((closed_at_ms is null) = (closed_reason is null)),
  check((closed_reason is null) = (reviewer_id is null)),
  check((erased_at_ms is null) = (erase_reason is null))
);
create table tf_contact_free_trial.payloads (
  report_id uuid primary key references tf_contact_free_trial.records(report_id) on delete cascade,
  kind text not null check(kind in ('incorrect_statement','missing_context','broken_source_link','accessibility_problem')),
  details text not null check(tf_contact_free_trial.valid_text(details,10,1000)),
  source_url text not null check(length(source_url) <= 2048),
  resolution text check(resolution is null or tf_contact_free_trial.valid_text(resolution,1,1000))
);
alter table tf_contact_free_trial.records enable row level security;
alter table tf_contact_free_trial.payloads enable row level security;
alter table tf_contact_free_trial.clock_state enable row level security;
-- No ordinary role has table grants. The private NOLOGIN owner deliberately
-- owns the definer functions; each must enforce its own clock/retention filter.

create function tf_contact_free_trial.payload_expiry(r tf_contact_free_trial.records)
returns bigint language sql immutable set search_path = pg_catalog as $$
  select least(r.received_at_ms + 7776000000,
    coalesce(r.closed_at_ms + 2592000000, 9007199254740991),
    coalesce(r.erased_at_ms, 9007199254740991))
$$;
create function tf_contact_free_trial.read_private(selected uuid) returns jsonb
language sql security definer set search_path = pg_catalog as $$
  select coalesce((select jsonb_build_object('kind','private_copy','reportId',r.report_id,
    'target',r.target,'payload',jsonb_build_object('kind',p.kind,'details',p.details,
    'sourceUrl',p.source_url,'resolution',p.resolution),
    'expiresAtMs',tf_contact_free_trial.payload_expiry(r))
    from tf_contact_free_trial.clock_state c
    join tf_contact_free_trial.records r on r.report_id = selected
    join tf_contact_free_trial.payloads p on p.report_id = r.report_id
    where c.singleton and c.known and c.now_ms >= r.received_at_ms
      and (r.closed_at_ms is null or r.closed_at_ms <= c.now_ms)
      and (r.erased_at_ms is null or r.erased_at_ms <= c.now_ms)
      and c.now_ms < tf_contact_free_trial.payload_expiry(r)
      and c.now_ms < r.received_at_ms + 15552000000), '{"kind":"held"}'::jsonb)
$$;

create function tf_contact_free_trial.close_private(selected uuid, reason text, note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare r tf_contact_free_trial.records; at_ms bigint;
begin
  select now_ms into at_ms from tf_contact_free_trial.clock_state where singleton and known for share;
  if at_ms is null or reason is null or reason not in ('corrected','unsubstantiated','duplicate','outside_scope','withdrawn')
    or (note is not null and not tf_contact_free_trial.valid_text(note,1,1000)) then return '{"kind":"held"}'; end if;
  select * into r from tf_contact_free_trial.records where report_id=selected for update;
  if not found or at_ms < r.received_at_ms or r.closed_at_ms is not null or r.erased_at_ms is not null
    or at_ms >= tf_contact_free_trial.payload_expiry(r)
    or not exists(select from tf_contact_free_trial.payloads where report_id=selected) then return '{"kind":"held"}'; end if;
  update tf_contact_free_trial.records set closed_at_ms=at_ms, closed_reason=reason,
    reviewer_id='b8200000-3333-4333-8333-333333333333',version=version+1 where report_id=selected;
  update tf_contact_free_trial.payloads set resolution=note where report_id=selected;
  return jsonb_build_object('kind','closed_private','reportId',selected);
end $$;

create function tf_contact_free_trial.erase_private(selected uuid, reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare r tf_contact_free_trial.records; at_ms bigint;
begin
  select now_ms into at_ms from tf_contact_free_trial.clock_state where singleton and known for share;
  if at_ms is null or reason is null or reason not in ('reporter_request','sensitive_material') then return '{"kind":"held"}'; end if;
  select * into r from tf_contact_free_trial.records where report_id=selected for update;
  if not found or at_ms < r.received_at_ms or at_ms >= r.received_at_ms+15552000000
    or r.closed_at_ms > at_ms or r.erased_at_ms > at_ms then return '{"kind":"held"}'; end if;
  if r.erased_at_ms is null then
    update tf_contact_free_trial.records set erased_at_ms=at_ms,erase_reason=reason,version=version+1 where report_id=selected;
  end if;
  delete from tf_contact_free_trial.payloads where report_id=selected;
  return jsonb_build_object('kind','erased_private','reportId',selected);
end $$;

create function tf_contact_free_trial.sweep_private() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare at_ms bigint; r tf_contact_free_trial.records; payload_count integer := 0;
record_count integer := 0; affected integer;
begin
  select now_ms into at_ms from tf_contact_free_trial.clock_state where singleton and known for share;
  if at_ms is null or exists(select from tf_contact_free_trial.records
    where received_at_ms > at_ms or closed_at_ms > at_ms or erased_at_ms > at_ms) then return '{"kind":"held"}'; end if;
  for r in select * from tf_contact_free_trial.records order by report_id for update loop
    if at_ms >= tf_contact_free_trial.payload_expiry(r) then
      delete from tf_contact_free_trial.payloads where report_id=r.report_id;
      get diagnostics affected = row_count;
      payload_count := payload_count + affected;
      if r.erased_at_ms is null then
        update tf_contact_free_trial.records set erased_at_ms=at_ms,erase_reason='expired',version=version+1 where report_id=r.report_id;
      end if;
    end if;
    if at_ms >= r.received_at_ms + 15552000000 then
      delete from tf_contact_free_trial.records where report_id=r.report_id;
      record_count := record_count + 1;
    end if;
  end loop;
  return jsonb_build_object('kind','swept','removedPayloads',payload_count,'removedRecords',record_count);
end $$;
reset role;
revoke all on all functions in schema tf_contact_free_trial from public;
grant usage on schema tf_contact_free_trial to tf_trial_reviewer, tf_trial_custodian;
grant execute on function tf_contact_free_trial.read_private(uuid),
  tf_contact_free_trial.close_private(uuid,text,text),tf_contact_free_trial.erase_private(uuid,text) to tf_trial_reviewer;
grant execute on function tf_contact_free_trial.sweep_private() to tf_trial_custodian;
-- Public and writer roles receive nothing. No intake or publisher exists here.
