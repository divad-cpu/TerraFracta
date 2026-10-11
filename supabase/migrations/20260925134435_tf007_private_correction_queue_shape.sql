-- TF-007 preparation: private shape for a future moderated correction queue.
-- No public intake route, reporter identity, writer role, notification or retention policy.

create table terra_private.correction_reports (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null,
  publication_id uuid not null,
  claim_id uuid,
  report_kind text not null
    check (report_kind in ('incorrect_statement', 'missing_context', 'broken_source_link', 'accessibility_problem')),
  details text not null
    check (char_length(btrim(details)) between 10 and 1000),
  source_url text
    check (source_url is null or (char_length(source_url) <= 2048 and source_url ~ '^https://[^[:space:]]+$')),
  review_state text not null default 'new'
    check (review_state in ('new', 'in_review', 'closed')),
  reported_at timestamptz not null default now(),
  reviewed_at timestamptz,
  resolution_note text
    check (resolution_note is null or char_length(btrim(resolution_note)) between 1 and 1000),
  foreign key (publication_id, issue_id)
    references terra_private.issue_publications (id, issue_id),
  foreign key (claim_id, issue_id)
    references terra_private.claims (id, issue_id),
  check (reviewed_at is null or reviewed_at >= reported_at),
  check (
    (review_state = 'new' and reviewed_at is null and resolution_note is null)
    or (review_state = 'in_review' and reviewed_at is not null)
    or (review_state = 'closed' and reviewed_at is not null and resolution_note is not null)
  )
);
create index correction_reports_review_queue_idx
  on terra_private.correction_reports (review_state, reported_at);
create index correction_reports_issue_idx
  on terra_private.correction_reports (issue_id, reported_at desc);

alter table terra_private.correction_reports enable row level security;
revoke all on terra_private.correction_reports
  from public, anon, authenticated, service_role, terra_collector, terra_operator;
grant select on terra_private.correction_reports to terra_reviewer;
create policy reviewer_read on terra_private.correction_reports
  for select to terra_reviewer using (true);
