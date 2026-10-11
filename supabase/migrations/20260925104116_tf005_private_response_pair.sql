-- TF-005: durable identity for one validated two-response source pair.
-- No source activation, collector grant, writer function or public route.

create table terra_private.source_response_pairs (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references terra_private.source_registrations(id),
  attempt_key text not null unique check (length(btrim(attempt_key)) > 0),
  metadata_version_id uuid not null,
  data_version_id uuid not null,
  metadata_retrieved_at timestamptz not null,
  data_retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (metadata_version_id, registration_id)
    references terra_private.source_versions (id, registration_id),
  foreign key (data_version_id, registration_id)
    references terra_private.source_versions (id, registration_id),
  check (metadata_version_id <> data_version_id),
  check (metadata_retrieved_at <= data_retrieved_at)
);

create index source_response_pairs_registration_created_idx
  on terra_private.source_response_pairs (registration_id, created_at desc);
create index source_response_pairs_metadata_version_idx
  on terra_private.source_response_pairs (metadata_version_id, registration_id);
create index source_response_pairs_data_version_idx
  on terra_private.source_response_pairs (data_version_id, registration_id);

alter table terra_private.source_response_pairs enable row level security;
revoke all on terra_private.source_response_pairs
  from public, anon, authenticated, service_role, terra_collector, terra_operator;
grant select on terra_private.source_response_pairs to terra_reviewer;
create policy reviewer_read on terra_private.source_response_pairs
  for select to terra_reviewer using (true);
