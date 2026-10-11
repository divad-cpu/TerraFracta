-- Specifically authorized by David on 2026-09-30: private citation reader binding only.
-- Reviewed body preserved; no writer, source, schedule or publication activation.
begin;
-- Reviewed development draft only. Apply inside the fixed rollback rehearsal.
-- No permanent table, function replacement or role change is authorized here.
create table terra_private.issue_publication_machine_bindings (
  publication_id uuid not null references terra_private.issue_publications(id),
  claim_id uuid not null references terra_private.claims(id),
  decision_id uuid not null unique references terra_private.machine_candidate_decisions(id),
  linked_at timestamptz not null default transaction_timestamp(),
  primary key (publication_id, claim_id)
);

create function terra_private.check_publication_machine_binding_insert()
returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
declare
  d terra_private.machine_candidate_decisions%rowtype;
  q terra_private.automatic_route_qualifications%rowtype;
  s terra_private.source_registrations%rowtype;
  v terra_private.source_versions%rowtype;
  r terra_private.update_runs%rowtype;
  p terra_private.issue_publications%rowtype;
  c terra_private.claims%rowtype;
  dossier_jurisdiction text;
begin
  select * into d from terra_private.machine_candidate_decisions where id=new.decision_id;
  select * into q from terra_private.automatic_route_qualifications where id=d.qualification_id;
  select * into s from terra_private.source_registrations where id=q.registration_id for update;
  select * into v from terra_private.source_versions where id=d.source_version_id for update;
  select * into r from terra_private.update_runs where id=d.run_id for update;
  select * into p from terra_private.issue_publications where id=new.publication_id for update;
  select * into c from terra_private.claims where id=new.claim_id;
  select jurisdiction_id into dossier_jurisdiction from terra_private.issue_dossiers where id=p.issue_id;
  if d.id is null or q.id is null or s.id is null or v.id is null or r.id is null
     or p.id is null or c.id is null or dossier_jurisdiction is null
     or d.disposition<>'eligible' or q.decision<>'qualified'
     or q.revision<>(select max(revision) from terra_private.automatic_route_qualifications
       where registration_id=s.id and change_class=q.change_class)
     or s.registration_state<>'approved' or not s.allow_fetch or not s.fetch_enabled
     or not s.allow_public_derived or s.reviewed_at is null or s.reviewed_at>transaction_timestamp()
     or s.exact_endpoint is distinct from q.exact_endpoint
     or v.source_url is distinct from q.exact_endpoint or v.registration_id<>s.id
     or v.content_sha256 is distinct from d.content_sha256
     or v.id is distinct from (select id from terra_private.source_versions
       where registration_id=s.id and item_key=v.item_key
       order by retrieved_at desc,id desc limit 1)
     or q.qualification_expires_at is null or not isfinite(q.qualification_expires_at)
     or transaction_timestamp()>=q.qualification_expires_at
     or new.linked_at>=q.qualification_expires_at
     or new.linked_at<greatest(p.created_at,d.decided_at)
     or new.linked_at>transaction_timestamp()
     or q.reviewed_sample_count is null or q.reviewed_sample_count<3
     or q.unresolved_sample_errors is distinct from 0
     or q.semantic_contract_sha256 is null
     or d.semantic_contract_sha256 is distinct from q.semantic_contract_sha256
     or q.public_citation_url is null or d.public_citation_url is distinct from q.public_citation_url
     or r.mode<>'publish_eligible' or r.run_state<>'running'
     or r.policy_version is distinct from q.policy_version
     or r.jurisdiction_id is distinct from dossier_jurisdiction
     or c.issue_id<>p.issue_id or c.claim_type<>'condition' or c.evidence_state<>'supported'
     or p.publication_kind not in ('accepted','correction') then
    raise exception 'Publication machine authority is not current' using errcode='23514';
  end if;
  if not exists (select 1 from terra_private.issue_publication_citations
      where publication_id=p.id and issue_id=p.issue_id and claim_id=c.id
        and source_version_id=v.id and locator=d.evidence_locator and relation='supports')
     or not terra_private.is_closed_public_issue_payload(p.snapshot,p.dependency_manifest)
     or not exists (
       select 1 from jsonb_array_elements(p.snapshot->'claims') as claim(item),
         jsonb_array_elements(claim.item->'evidence') as evidence(item)
       where claim.item->>'id'=c.id::text
         and claim.item->>'assertion'=c.assertion
         and claim.item->>'type'=c.claim_type
         and evidence.item->>'sourceVersionId'=v.id::text
         and evidence.item->>'locator'=d.evidence_locator
         and evidence.item->>'relation'='supports'
         and evidence.item->>'url'=d.public_citation_url
     ) then
    raise exception 'Publication machine evidence is not selected' using errcode='23514';
  end if;
  return new;
end;
$guard$;
create trigger publication_machine_binding_insert_guard
before insert on terra_private.issue_publication_machine_bindings
for each row execute function terra_private.check_publication_machine_binding_insert();
create trigger publication_machine_binding_immutable
before update or delete on terra_private.issue_publication_machine_bindings
for each row execute function terra_private.block_automatic_decision_change();
alter table terra_private.issue_publication_machine_bindings enable row level security;
revoke all on terra_private.issue_publication_machine_bindings
  from public, anon, authenticated, service_role, terra_collector, terra_operator, terra_issue_reader;
grant select on terra_private.issue_publication_machine_bindings to terra_reviewer;
create policy reviewer_read on terra_private.issue_publication_machine_bindings
  for select to terra_reviewer using (true);
revoke all on function terra_private.check_publication_machine_binding_insert()
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;

-- Renaming keeps the old OID and grants. Revoke reader access before replacing
-- the fixed wrapper; the application reader retains only the outer EXECUTE.
alter function terra_private.read_issue_candidate(text,text)
  rename to read_issue_candidate_without_machine_bindings;
revoke all on function terra_private.read_issue_candidate_without_machine_bindings(text,text)
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;

create function terra_private.read_issue_candidate(text,text)
returns jsonb language sql stable strict security definer
set search_path = pg_catalog, pg_temp
as $read$
with base as materialized (
  select terra_private.read_issue_candidate_without_machine_bindings($1,$2) as candidate
), linked as (
  select case when candidate is null or candidate ? 'candidate_state' then candidate
    else jsonb_set(jsonb_set(candidate,'{citations}',coalesce((
      select jsonb_agg(citation.item || jsonb_build_object('machine_binding',(
        select jsonb_build_object(
          'decisionId',d.id,'qualificationId',q.id,'disposition',d.disposition,
          'sourceVersionId',d.source_version_id,'contentSha256',d.content_sha256,
          'semanticContractSha256',d.semantic_contract_sha256,
          'qualificationSemanticContractSha256',q.semantic_contract_sha256,
          'publicCitationUrl',d.public_citation_url,
          'qualificationPublicCitationUrl',q.public_citation_url,
          'qualifiedRetrievalUrl',q.exact_endpoint,'evidenceLocator',d.evidence_locator)
        from terra_private.issue_publication_machine_bindings b
        join terra_private.machine_candidate_decisions d on d.id=b.decision_id
        join terra_private.automatic_route_qualifications q on q.id=d.qualification_id
        where b.publication_id=(citation.item->>'publication_id')::uuid
          and b.claim_id=(citation.item->>'claim_id')::uuid
          and d.source_version_id=(citation.item->>'source_version_id')::uuid
          and d.evidence_locator=citation.item->>'locator'
          and citation.item->>'relation'='supports'
      )) order by citation.ordinality)
      from jsonb_array_elements(candidate->'citations') with ordinality as citation(item,ordinality)
    ),'[]'::jsonb)), '{sources}',coalesce((
      select jsonb_agg(jsonb_set(source.item,'{version}',source.item->'version' ||
        jsonb_build_object('content_sha256',v.content_sha256)) order by source.ordinality)
      from jsonb_array_elements(candidate->'sources') with ordinality as source(item,ordinality)
      join terra_private.source_versions v on v.id=(source.item #>> '{version,id}')::uuid
    ),'[]'::jsonb)) end as candidate from base
)
select case
  when candidate is null or candidate ? 'candidate_state' then candidate
  when terra_private.is_bounded_reader_candidate(candidate) then candidate
  else jsonb_build_object('candidate_state','rejected')
end from linked
$read$;
revoke all on function terra_private.read_issue_candidate(text,text)
  from public, anon, authenticated, service_role, terra_collector, terra_reviewer, terra_operator;
grant execute on function terra_private.read_issue_candidate(text,text) to terra_issue_reader;

commit;
