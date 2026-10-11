-- TF-009 preparation: append-only qualification and machine-decision evidence.
-- This grants no writer, source approval, public reader or activation function.
begin;

create table terra_private.automatic_route_qualifications (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references terra_private.source_registrations(id),
  change_class text not null check (change_class = 'structured_observation'),
  revision integer not null check (revision > 0),
  decision text not null check (decision in ('qualified', 'suspended')),
  exact_endpoint text not null check (exact_endpoint ~ '^https://'),
  policy_version text not null check (length(btrim(policy_version)) between 1 and 120),
  parser_version text not null check (length(btrim(parser_version)) between 1 and 120),
  decision_reference text not null check (length(btrim(decision_reference)) between 1 and 240),
  decided_by text not null check (length(btrim(decided_by)) between 1 and 120),
  decided_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (registration_id, change_class, revision)
);

create function terra_private.check_automatic_qualification_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
declare source_row terra_private.source_registrations%rowtype;
declare prior_revision integer;
declare prior_time timestamptz;
begin
  select * into source_row from terra_private.source_registrations
    where id = new.registration_id for update;
  if not found then
    raise exception 'Qualification source is missing' using errcode = '23503';
  end if;
  select revision, decided_at into prior_revision, prior_time
    from terra_private.automatic_route_qualifications
    where registration_id = new.registration_id
      and change_class = new.change_class
    order by revision desc limit 1;
  if new.revision <> coalesce(prior_revision, 0) + 1
     or (prior_revision is null and new.decision <> 'qualified')
     or (prior_time is not null and new.decided_at < prior_time) then
    raise exception 'Qualification decisions must be consecutive and ordered'
      using errcode = '23514';
  end if;
  if new.exact_endpoint <> source_row.exact_endpoint then
    raise exception 'Qualification endpoint differs from registration'
      using errcode = '23514';
  end if;
  if new.decision = 'qualified' and
     (source_row.registration_state <> 'approved'
      or not source_row.allow_fetch
      or not source_row.allow_public_derived
      or source_row.reviewed_at is null
      or new.decided_at < source_row.reviewed_at) then
    raise exception 'Source is not eligible for qualification'
      using errcode = '23514';
  end if;
  return new;
end;
$guard$;

create function terra_private.block_automatic_decision_change()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
begin
  raise exception 'Automatic decision records are append-only' using errcode = '23514';
end;
$guard$;

create trigger automatic_qualification_insert_guard
before insert on terra_private.automatic_route_qualifications
for each row execute function terra_private.check_automatic_qualification_insert();
create trigger automatic_qualification_immutable
before update or delete on terra_private.automatic_route_qualifications
for each row execute function terra_private.block_automatic_decision_change();

create table terra_private.machine_candidate_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references terra_private.update_runs(id),
  qualification_id uuid not null
    references terra_private.automatic_route_qualifications(id),
  source_version_id uuid not null references terra_private.source_versions(id),
  candidate_key text not null check (length(btrim(candidate_key)) between 1 and 160),
  disposition text not null
    check (disposition in ('eligible', 'held', 'rejected', 'unchanged')),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_locator text not null check (length(btrim(evidence_locator)) between 1 and 400),
  check_trace jsonb not null check (jsonb_typeof(check_trace) = 'object'),
  reason_codes text[] not null check (cardinality(reason_codes) between 1 and 24),
  machine_actor text not null check (length(btrim(machine_actor)) between 1 and 120),
  decided_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (run_id, candidate_key)
);
create index machine_decisions_source_version_idx
  on terra_private.machine_candidate_decisions (source_version_id, decided_at desc);

create function terra_private.check_machine_candidate_decision_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
declare qualification_row terra_private.automatic_route_qualifications%rowtype;
declare source_row terra_private.source_registrations%rowtype;
declare version_row terra_private.source_versions%rowtype;
declare run_row terra_private.update_runs%rowtype;
declare latest_revision integer;
begin
  select * into qualification_row from terra_private.automatic_route_qualifications
    where id = new.qualification_id;
  if not found then
    raise exception 'Qualification is missing' using errcode = '23503';
  end if;
  select * into source_row from terra_private.source_registrations
    where id = qualification_row.registration_id for update;
  select * into version_row from terra_private.source_versions
    where id = new.source_version_id;
  select * into run_row from terra_private.update_runs
    where id = new.run_id for update;
  if version_row.id is null or run_row.id is null then
    raise exception 'Decision source version or run is missing' using errcode = '23503';
  end if;
  if version_row.registration_id <> qualification_row.registration_id
     or version_row.source_url <> qualification_row.exact_endpoint
     or version_row.content_sha256 <> new.content_sha256
     or new.decided_at < version_row.retrieved_at
     or new.decided_at < run_row.created_at then
    raise exception 'Decision evidence does not match source, run or receipt'
      using errcode = '23514';
  end if;
  if new.disposition = 'eligible' then
    select max(revision) into latest_revision
      from terra_private.automatic_route_qualifications
      where registration_id = qualification_row.registration_id
        and change_class = qualification_row.change_class;
    if run_row.mode <> 'publish_eligible'
       or run_row.run_state <> 'running'
       or run_row.policy_version is distinct from qualification_row.policy_version
       or qualification_row.decision <> 'qualified'
       or qualification_row.revision <> latest_revision
       or source_row.registration_state <> 'approved'
       or not source_row.allow_public_derived then
      raise exception 'Current policy, source or run does not permit eligibility'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$guard$;

create trigger machine_candidate_decision_insert_guard
before insert on terra_private.machine_candidate_decisions
for each row execute function terra_private.check_machine_candidate_decision_insert();
create trigger machine_candidate_decision_immutable
before update or delete on terra_private.machine_candidate_decisions
for each row execute function terra_private.block_automatic_decision_change();

alter table terra_private.automatic_route_qualifications enable row level security;
alter table terra_private.machine_candidate_decisions enable row level security;
revoke all on terra_private.automatic_route_qualifications,
  terra_private.machine_candidate_decisions
  from public, anon, authenticated, service_role, terra_collector,
       terra_operator, terra_issue_reader;
grant select on terra_private.automatic_route_qualifications,
  terra_private.machine_candidate_decisions to terra_reviewer;
create policy reviewer_read on terra_private.automatic_route_qualifications
  for select to terra_reviewer using (true);
create policy reviewer_read on terra_private.machine_candidate_decisions
  for select to terra_reviewer using (true);
revoke all on function terra_private.check_automatic_qualification_insert(),
  terra_private.block_automatic_decision_change(),
  terra_private.check_machine_candidate_decision_insert()
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;
commit;
