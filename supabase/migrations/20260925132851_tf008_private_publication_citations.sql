-- TF-008 preparation: select exact pre-existing evidence for one private issue revision.
-- No publication activation, reviewer decision, source-rights assertion or public read grant.

alter table terra_private.claims
  add constraint claims_id_issue_key unique (id, issue_id);

create table terra_private.issue_publication_citations (
  publication_id uuid not null,
  issue_id uuid not null,
  claim_id uuid not null,
  source_version_id uuid not null,
  locator text not null,
  relation text not null
    check (relation in ('supports', 'contradicts', 'context')),
  created_at timestamptz not null default now(),
  primary key (publication_id, claim_id, source_version_id, locator, relation),
  foreign key (publication_id, issue_id)
    references terra_private.issue_publications (id, issue_id),
  foreign key (claim_id, issue_id)
    references terra_private.claims (id, issue_id),
  foreign key (claim_id, source_version_id, locator, relation)
    references terra_private.claim_evidence (claim_id, source_version_id, locator, relation)
);
create index issue_publication_citations_source_idx
  on terra_private.issue_publication_citations (source_version_id);

alter table terra_private.issue_publication_citations enable row level security;
revoke all on terra_private.issue_publication_citations
  from public, anon, authenticated, service_role, terra_collector, terra_operator;
grant select on terra_private.issue_publication_citations to terra_reviewer;
create policy reviewer_read on terra_private.issue_publication_citations
  for select to terra_reviewer using (true);
