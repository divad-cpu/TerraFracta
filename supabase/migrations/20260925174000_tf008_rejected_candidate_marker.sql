-- TF-008 preparation: distinguish a missing route from a malformed or
-- oversized candidate without exposing any private row or route identifier.
-- The generic marker is for future server handling, never direct display.
begin;

create or replace function terra_private.read_issue_candidate(text, text)
returns jsonb
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
as $read$
with selected as materialized (
  select terra_private.read_issue_candidate_prebound($1, $2) as candidate
)
select case
  when candidate is null then null
  when coalesce(candidate #> '{publication,snapshot}', 'null'::jsonb)
         = 'null'::jsonb
    or coalesce(candidate #> '{publication,dependency_manifest}', 'null'::jsonb)
         = 'null'::jsonb
    or not terra_private.is_bounded_reader_candidate(candidate)
      then '{"candidate_state":"rejected"}'::jsonb
  else candidate
end
from selected
$read$;

revoke all on function terra_private.read_issue_candidate(text, text)
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator;
grant execute on function terra_private.read_issue_candidate(text, text)
  to terra_issue_reader;
commit;
