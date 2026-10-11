-- TF-004 staging model. No public grants, ingestion route, or publication function.
-- Future runtime roles need separate credential binding and reviewed write policies.

create schema terra_private;
revoke all on schema terra_private from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'terra_collector') then
    create role terra_collector nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'terra_reviewer') then
    create role terra_reviewer nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'terra_operator') then
    create role terra_operator nologin;
  end if;
end;
$$;

create table terra_private.jurisdictions (
  id text primary key,
  display_name text not null check (length(btrim(display_name)) > 0),
  coverage_state text not null default 'researching'
    check (coverage_state in ('not_started', 'researching', 'published', 'maintenance_paused', 'archived')),
  created_at timestamptz not null default now()
);

create table terra_private.source_registrations (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique check (length(btrim(source_key)) > 0),
  publisher text not null check (length(btrim(publisher)) > 0),
  exact_endpoint text not null check (exact_endpoint ~ '^https://'),
  registration_state text not null default 'candidate'
    check (registration_state in ('candidate', 'approved', 'suspended', 'retired')),
  allow_fetch boolean not null default false,
  allow_retain boolean not null default false,
  allow_model_processing boolean not null default false,
  allow_quote boolean not null default false,
  allow_public_derived boolean not null default false,
  fetch_enabled boolean not null default false,
  rights_basis_url text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (not fetch_enabled or (registration_state = 'approved' and allow_fetch)),
  check (registration_state <> 'approved' or reviewed_at is not null)
);

create table terra_private.source_versions (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references terra_private.source_registrations(id),
  item_key text not null check (length(btrim(item_key)) > 0),
  source_url text not null check (source_url ~ '^https://'),
  language_code text,
  published_at timestamptz,
  source_updated_at timestamptz,
  retrieved_at timestamptz not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  retained_kind text not null default 'metadata_only'
    check (retained_kind in ('metadata_only', 'permitted_numeric_sample', 'permitted_excerpt')),
  retained_reference text,
  created_at timestamptz not null default now(),
  unique (registration_id, item_key, content_sha256),
  check (retained_kind = 'metadata_only' or retained_reference is not null)
);
create index source_versions_registration_retrieved_idx
  on terra_private.source_versions (registration_id, retrieved_at desc);

create table terra_private.issue_dossiers (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id text not null references terra_private.jurisdictions(id),
  issue_key text not null check (length(btrim(issue_key)) > 0),
  title text not null check (length(btrim(title)) > 0),
  affected_population text not null,
  selection_rationale text not null,
  editorial_state text not null default 'research'
    check (editorial_state in ('research', 'review', 'accepted', 'retired')),
  created_at timestamptz not null default now(),
  unique (jurisdiction_id, issue_key)
);

create table terra_private.claims (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references terra_private.issue_dossiers(id),
  claim_type text not null
    check (claim_type in ('condition', 'policy_action', 'funding', 'delivery', 'attributed_finding', 'evaluation')),
  assertion text not null check (length(btrim(assertion)) > 0),
  period_start date,
  period_end date,
  period_precision text not null default 'unknown'
    check (period_precision in ('day', 'month', 'year', 'interval', 'unknown')),
  evidence_state text not null default 'unreviewed'
    check (evidence_state in ('unreviewed', 'supported', 'limited', 'conflicted', 'unsupported', 'withdrawn')),
  created_at timestamptz not null default now(),
  check (period_start is null or period_end is null or period_end >= period_start)
);
create index claims_issue_idx on terra_private.claims (issue_id);

create table terra_private.claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references terra_private.claims(id),
  source_version_id uuid not null references terra_private.source_versions(id),
  locator text not null check (length(btrim(locator)) > 0),
  relation text not null check (relation in ('supports', 'contradicts', 'context')),
  origin_group text not null check (length(btrim(origin_group)) > 0),
  created_at timestamptz not null default now(),
  unique (claim_id, source_version_id, locator, relation)
);
create index claim_evidence_source_version_idx
  on terra_private.claim_evidence (source_version_id);

create table terra_private.issue_publications (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references terra_private.issue_dossiers(id),
  revision integer not null check (revision > 0),
  predecessor_id uuid,
  publication_kind text not null default 'draft'
    check (publication_kind in ('draft', 'accepted', 'correction', 'suppression')),
  snapshot jsonb not null,
  dependency_manifest jsonb not null,
  created_at timestamptz not null default now(),
  unique (issue_id, revision),
  unique (id, issue_id),
  foreign key (predecessor_id, issue_id)
    references terra_private.issue_publications (id, issue_id),
  check (revision = 1 or predecessor_id is not null),
  check (jsonb_typeof(snapshot) = 'object'),
  check (jsonb_typeof(dependency_manifest) = 'object')
);
create index issue_publications_predecessor_idx
  on terra_private.issue_publications (predecessor_id, issue_id)
  where predecessor_id is not null;

create table terra_private.issue_heads (
  issue_id uuid primary key references terra_private.issue_dossiers(id),
  current_publication_id uuid,
  changed_at timestamptz,
  foreign key (current_publication_id, issue_id)
    references terra_private.issue_publications (id, issue_id),
  check ((current_publication_id is null) = (changed_at is null))
);
create index issue_heads_publication_idx
  on terra_private.issue_heads (current_publication_id, issue_id)
  where current_publication_id is not null;

create table terra_private.update_runs (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique check (length(btrim(request_key)) > 0),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  jurisdiction_id text not null references terra_private.jurisdictions(id),
  requested_by text not null check (length(btrim(requested_by)) > 0),
  mode text not null check (mode in ('shadow', 'publish_eligible')),
  run_state text not null default 'queued'
    check (run_state in ('queued', 'running', 'completed', 'partial', 'failed', 'rejected')),
  commit_state text not null default 'none'
    check (commit_state in ('none', 'committed', 'partial')),
  visibility_state text not null default 'not_required'
    check (visibility_state in ('not_required', 'pending', 'verified', 'failed', 'mixed')),
  code_version text,
  policy_version text,
  limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (finished_at is null or finished_at >= created_at)
);
create index update_runs_jurisdiction_created_idx
  on terra_private.update_runs (jurisdiction_id, created_at desc);

-- All tables are private even if this schema is accidentally added to the Data API.
alter table terra_private.jurisdictions enable row level security;
alter table terra_private.source_registrations enable row level security;
alter table terra_private.source_versions enable row level security;
alter table terra_private.issue_dossiers enable row level security;
alter table terra_private.claims enable row level security;
alter table terra_private.claim_evidence enable row level security;
alter table terra_private.issue_publications enable row level security;
alter table terra_private.issue_heads enable row level security;
alter table terra_private.update_runs enable row level security;

-- No database role can write through the application path in TF-004.
-- The reviewer can inspect private staging data via a future dedicated server connection.
grant usage on schema terra_private to terra_reviewer, terra_operator;
grant select on all tables in schema terra_private to terra_reviewer;
grant select on terra_private.update_runs to terra_operator;

create policy reviewer_read on terra_private.jurisdictions
  for select to terra_reviewer using (true);
create policy reviewer_read on terra_private.source_registrations
  for select to terra_reviewer using (true);
create policy reviewer_read on terra_private.source_versions
  for select to terra_reviewer using (true);
create policy reviewer_read on terra_private.issue_dossiers
  for select to terra_reviewer using (true);
create policy reviewer_read on terra_private.claims
  for select to terra_reviewer using (true);
create policy reviewer_read on terra_private.claim_evidence
  for select to terra_reviewer using (true);
create policy reviewer_read on terra_private.issue_publications
  for select to terra_reviewer using (true);
create policy reviewer_read on terra_private.issue_heads
  for select to terra_reviewer using (true);
create policy reviewer_read on terra_private.update_runs
  for select to terra_reviewer using (true);
create policy operator_read_runs on terra_private.update_runs
  for select to terra_operator using (true);
