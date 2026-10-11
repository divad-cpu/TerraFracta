-- TF-005: describe one privately retained raw JSON pair by its attempt folder.
-- The folder lives outside PostgreSQL and is not created or deleted here.
-- No collector write role, source activation, timer, or public read path.

alter table terra_private.source_response_pairs
  add constraint source_response_pairs_id_retrieval_times_key
  unique (id, metadata_retrieved_at, data_retrieved_at);

create table terra_private.source_raw_pair_artifacts (
  pair_id uuid primary key,
  metadata_retrieved_at timestamptz not null,
  data_retrieved_at timestamptz not null,
  raw_attempt_id text not null unique
    check (raw_attempt_id ~ '^[0-9a-f]{32}$'),
  metadata_sha256 text not null
    check (metadata_sha256 ~ '^[0-9a-f]{64}$'),
  data_sha256 text not null
    check (data_sha256 ~ '^[0-9a-f]{64}$'),
  stored_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (pair_id, metadata_retrieved_at, data_retrieved_at)
    references terra_private.source_response_pairs
      (id, metadata_retrieved_at, data_retrieved_at),
  check (stored_at >= data_retrieved_at),
  check (stored_at < expires_at),
  -- 720 hours is an elapsed-time bound, including across daylight saving.
  check (expires_at = metadata_retrieved_at + interval '720 hours')
);

alter table terra_private.source_raw_pair_artifacts enable row level security;
revoke all on terra_private.source_raw_pair_artifacts
  from public, anon, authenticated, service_role, terra_collector, terra_operator;
grant select on terra_private.source_raw_pair_artifacts to terra_reviewer;
create policy reviewer_read on terra_private.source_raw_pair_artifacts
  for select to terra_reviewer using (true);
