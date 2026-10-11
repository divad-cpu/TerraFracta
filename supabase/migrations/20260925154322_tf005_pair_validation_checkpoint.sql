-- TF-005 private attempt disposition and pair-bound success checkpoint.
-- A 'usable' row is only a technical private disposition supplied by a later
-- reviewed writer; it is not source-rights, editorial or public approval.
-- No collector writer or login credential is granted here.
begin;

alter table terra_private.source_response_pairs
  add constraint source_response_pairs_id_registration_key
    unique (id, registration_id),
  add constraint source_response_pairs_checkpoint_identity_key
    unique (id, registration_id, data_version_id, data_retrieved_at);

create table terra_private.source_pair_validations (
  pair_id uuid primary key,
  registration_id uuid not null,
  validation_state text not null default 'pending'
    check (validation_state in ('pending', 'usable', 'held', 'invalid')),
  reason_code text
    check (reason_code is null or reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  created_at timestamptz not null default now(),
  assessed_at timestamptz,
  unique (pair_id, registration_id, validation_state),
  foreign key (pair_id, registration_id)
    references terra_private.source_response_pairs (id, registration_id),
  check (
    (validation_state = 'pending' and reason_code is null and assessed_at is null)
    or (validation_state = 'usable' and reason_code is null and assessed_at is not null)
    or (validation_state in ('held', 'invalid')
        and reason_code is not null and assessed_at is not null)
  ),
  check (assessed_at is null or assessed_at >= created_at)
);
create index source_pair_validations_registration_state_idx
  on terra_private.source_pair_validations (registration_id, validation_state);

alter table terra_private.source_checkpoints
  add column last_response_pair_id uuid not null,
  add column last_pair_state text not null default 'usable'
    check (last_pair_state = 'usable'),
  add constraint source_checkpoints_pair_identity_fkey
    foreign key (last_response_pair_id, registration_id,
                 last_source_version_id, last_successful_retrieved_at)
    references terra_private.source_response_pairs
      (id, registration_id, data_version_id, data_retrieved_at),
  add constraint source_checkpoints_usable_pair_fkey
    foreign key (last_response_pair_id, registration_id, last_pair_state)
    references terra_private.source_pair_validations
      (pair_id, registration_id, validation_state);
create index source_checkpoints_pair_idx
  on terra_private.source_checkpoints (last_response_pair_id, registration_id);

alter table terra_private.source_pair_validations enable row level security;
revoke all on terra_private.source_pair_validations
  from public, anon, authenticated, service_role,
       terra_collector, terra_operator, terra_issue_reader;
grant select on terra_private.source_pair_validations to terra_reviewer;
create policy reviewer_read on terra_private.source_pair_validations
  for select to terra_reviewer using (true);

commit;
