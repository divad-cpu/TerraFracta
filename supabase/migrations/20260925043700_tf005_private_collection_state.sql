-- TF-005 preparation: durable one-page collection state, without a writer.
-- Source approval, exact-query checks and permitted retention remain external gates.

alter table terra_private.source_versions
  add constraint source_versions_id_registration_key unique (id, registration_id);

create table terra_private.source_work_items (
  source_version_id uuid primary key,
  registration_id uuid not null,
  processing_state text not null default 'pending'
    check (processing_state in ('pending', 'processing', 'processed', 'held', 'failed')),
  first_seen_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_code text check (last_error_code is null or length(btrim(last_error_code)) > 0),
  unique (source_version_id, registration_id),
  foreign key (source_version_id, registration_id)
    references terra_private.source_versions (id, registration_id),
  check (processed_at is null or processed_at >= first_seen_at),
  check (processing_state <> 'processed' or processed_at is not null)
);
create index source_work_items_state_seen_idx
  on terra_private.source_work_items (processing_state, first_seen_at);
create index source_work_items_registration_idx
  on terra_private.source_work_items (registration_id);

create table terra_private.source_checkpoints (
  registration_id uuid primary key references terra_private.source_registrations(id),
  last_source_version_id uuid not null,
  last_successful_retrieved_at timestamptz not null,
  last_attempted_at timestamptz not null,
  updated_at timestamptz not null default now(),
  foreign key (last_source_version_id, registration_id)
    references terra_private.source_work_items (source_version_id, registration_id),
  check (last_successful_retrieved_at <= last_attempted_at)
);
create index source_checkpoints_version_idx
  on terra_private.source_checkpoints (last_source_version_id, registration_id);

alter table terra_private.source_work_items enable row level security;
alter table terra_private.source_checkpoints enable row level security;

revoke all on terra_private.source_work_items, terra_private.source_checkpoints
  from public, anon, authenticated, service_role, terra_collector;
grant select on terra_private.source_work_items, terra_private.source_checkpoints
  to terra_reviewer;
grant select on terra_private.source_checkpoints to terra_operator;

create policy reviewer_read on terra_private.source_work_items
  for select to terra_reviewer using (true);
create policy reviewer_read on terra_private.source_checkpoints
  for select to terra_reviewer using (true);
create policy operator_read_checkpoints on terra_private.source_checkpoints
  for select to terra_operator using (true);
