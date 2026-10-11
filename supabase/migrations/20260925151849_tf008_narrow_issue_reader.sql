-- TF-008 local preparation: one bounded candidate read, with no login credential.
-- The owner executes this fixed single-statement query. Its arbitrary JSON
-- snapshot still needs the strict server-side materializer before display.
begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'terra_issue_reader') then
    create role terra_issue_reader nologin noinherit;
  end if;
end;
$$;

create function terra_private.read_issue_candidate(text, text)
returns jsonb
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
as $read$
select jsonb_build_object(
  'requestedRoute', jsonb_build_object('jurisdictionSlug', $1, 'issueSlug', $2),
  'country', jsonb_build_object(
    'id', j.id, 'public_slug', j.public_slug, 'coverage_state', j.coverage_state),
  'dossier', jsonb_build_object(
    'id', d.id, 'jurisdiction_id', d.jurisdiction_id,
    'public_slug', d.public_slug, 'editorial_state', d.editorial_state),
  'head', jsonb_build_object(
    'issue_id', h.issue_id, 'current_publication_id', h.current_publication_id),
  'publication', jsonb_build_object(
    'id', p.id, 'issue_id', p.issue_id, 'revision', p.revision,
    'publication_kind', p.publication_kind, 'snapshot', p.snapshot,
    'dependency_manifest', p.dependency_manifest),
  'claims', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'issue_id', c.issue_id, 'claim_type', c.claim_type,
      'assertion', c.assertion, 'evidence_state', c.evidence_state)
      order by c.id), '[]'::jsonb)
    from terra_private.claims c
    where c.issue_id = d.id
      and exists (
        select 1 from terra_private.issue_publication_citations pc
        where pc.publication_id = p.id and pc.claim_id = c.id)),
  'citations', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'publication_id', pc.publication_id, 'issue_id', pc.issue_id,
      'claim_id', pc.claim_id, 'source_version_id', pc.source_version_id,
      'locator', pc.locator, 'relation', pc.relation)
      order by pc.claim_id, pc.source_version_id, pc.locator, pc.relation), '[]'::jsonb)
    from terra_private.issue_publication_citations pc
    where pc.publication_id = p.id),
  'sources', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'version', jsonb_build_object(
        'id', sv.id, 'registration_id', sv.registration_id,
        'source_url', sv.source_url, 'retrieved_at', sv.retrieved_at),
      'registration', jsonb_build_object(
        'id', sr.id, 'publisher', sr.publisher,
        'registration_state', sr.registration_state,
        'allow_public_derived', sr.allow_public_derived,
        'reviewed_at', sr.reviewed_at)) order by sv.id), '[]'::jsonb)
    from terra_private.source_versions sv
    join terra_private.source_registrations sr on sr.id = sv.registration_id
    where exists (
      select 1 from terra_private.issue_publication_citations pc
      where pc.publication_id = p.id and pc.source_version_id = sv.id))
)
from terra_private.jurisdictions j
join terra_private.issue_dossiers d on d.jurisdiction_id = j.id
join terra_private.issue_heads h on h.issue_id = d.id
join terra_private.issue_publications p
  on p.id = h.current_publication_id and p.issue_id = d.id
where j.public_slug = $1 and d.public_slug = $2
  and j.coverage_state = 'published'
  and d.editorial_state = 'accepted'
  and p.publication_kind in ('accepted', 'correction')
$read$;

-- PostgreSQL grants EXECUTE to PUBLIC by default; close it in this transaction.
revoke all on function terra_private.read_issue_candidate(text, text)
  from public, anon, authenticated, service_role,
       terra_collector, terra_reviewer, terra_operator;
grant usage on schema terra_private to terra_issue_reader;
grant execute on function terra_private.read_issue_candidate(text, text)
  to terra_issue_reader;
commit;
