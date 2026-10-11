-- TF-008 preparation: do not return arbitrary publication JSON to the reader role.
-- Malformed or extended payloads become null fields so the server materializer
-- rejects the candidate without receiving an unapproved private field.
-- No login, table grant, writer, public route or publication approval is added.
begin;

create function terra_private.has_exact_json_keys(value jsonb, expected text[])
returns boolean
language plpgsql immutable strict
set search_path = pg_catalog, pg_temp
as $shape$
declare valid boolean;
begin
  if jsonb_typeof(value) is distinct from 'object' then
    return false;
  end if;
  select count(*) = cardinality(expected)
     and coalesce(bool_and(key = any(expected)), false)
    into valid
    from jsonb_object_keys(value) as keys(key);
  return valid;
end;
$shape$;

create function terra_private.is_closed_public_issue_payload(
  issue_snapshot jsonb, source_manifest jsonb)
returns boolean
language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $shape$
declare claim jsonb;
declare evidence jsonb;
declare source_id jsonb;
begin
  if issue_snapshot is null or source_manifest is null
     or octet_length(issue_snapshot::text) > 1048576
     or octet_length(source_manifest::text) > 16384
     or not terra_private.has_exact_json_keys(issue_snapshot,
       array['schemaVersion', 'jurisdictionSlug', 'issueSlug', 'title',
             'summary', 'lastEvidenceReviewOn', 'claims'])
     or not terra_private.has_exact_json_keys(source_manifest,
       array['sourceVersionIds']) then
    return false;
  end if;
  if issue_snapshot->'schemaVersion' <> '1'::jsonb
     or jsonb_typeof(issue_snapshot->'jurisdictionSlug') is distinct from 'string'
     or jsonb_typeof(issue_snapshot->'issueSlug') is distinct from 'string'
     or jsonb_typeof(issue_snapshot->'title') is distinct from 'string'
     or jsonb_typeof(issue_snapshot->'summary') is distinct from 'string'
     or jsonb_typeof(issue_snapshot->'lastEvidenceReviewOn') is distinct from 'string'
     or jsonb_typeof(issue_snapshot->'claims') is distinct from 'array'
     or jsonb_typeof(source_manifest->'sourceVersionIds') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(issue_snapshot->'claims') > 30
     or jsonb_array_length(source_manifest->'sourceVersionIds') > 120 then
    return false;
  end if;
  for source_id in select value from jsonb_array_elements(source_manifest->'sourceVersionIds') loop
    if jsonb_typeof(source_id) is distinct from 'string' then return false; end if;
  end loop;
  for claim in select value from jsonb_array_elements(issue_snapshot->'claims') loop
    if not terra_private.has_exact_json_keys(claim,
         array['id', 'type', 'assertion', 'periodLabel', 'evidence']) then
      return false;
    end if;
    if jsonb_typeof(claim->'id') is distinct from 'string'
       or jsonb_typeof(claim->'type') is distinct from 'string'
       or jsonb_typeof(claim->'assertion') is distinct from 'string'
       or jsonb_typeof(claim->'periodLabel') is distinct from 'string'
       or jsonb_typeof(claim->'evidence') is distinct from 'array' then
      return false;
    end if;
    if jsonb_array_length(claim->'evidence') > 12 then return false; end if;
    for evidence in select value from jsonb_array_elements(claim->'evidence') loop
      if not terra_private.has_exact_json_keys(evidence,
           array['sourceVersionId', 'publisher', 'title', 'url', 'locator',
                 'relation', 'sourcePublishedOn', 'retrievedAt']) then
        return false;
      end if;
      if jsonb_typeof(evidence->'sourceVersionId') is distinct from 'string'
         or jsonb_typeof(evidence->'publisher') is distinct from 'string'
         or jsonb_typeof(evidence->'title') is distinct from 'string'
         or jsonb_typeof(evidence->'url') is distinct from 'string'
         or jsonb_typeof(evidence->'locator') is distinct from 'string'
         or jsonb_typeof(evidence->'relation') is distinct from 'string'
         or coalesce(jsonb_typeof(evidence->'sourcePublishedOn'), 'missing')
              not in ('string', 'null')
         or jsonb_typeof(evidence->'retrievedAt') is distinct from 'string' then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$shape$;

-- Rename retains the old function's OID and privileges. Close its reader grant
-- before installing the new narrow entry point in this same transaction.
alter function terra_private.read_issue_candidate(text, text)
  rename to read_issue_candidate_unfiltered;
revoke all on function terra_private.read_issue_candidate_unfiltered(text, text)
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;
revoke all on function terra_private.has_exact_json_keys(jsonb, text[])
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;
revoke all on function terra_private.is_closed_public_issue_payload(jsonb, jsonb)
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;

create function terra_private.read_issue_candidate(text, text)
returns jsonb
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
as $read$
with raw as materialized (
  select terra_private.read_issue_candidate_unfiltered($1, $2) as candidate
)
select case
  when candidate is null then null
  when terra_private.is_closed_public_issue_payload(
    candidate #> '{publication,snapshot}',
    candidate #> '{publication,dependency_manifest}') then candidate
  else jsonb_set(
    jsonb_set(candidate, '{publication,snapshot}', 'null'::jsonb),
    '{publication,dependency_manifest}', 'null'::jsonb)
  end
from raw
$read$;

revoke all on function terra_private.read_issue_candidate(text, text)
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator;
grant execute on function terra_private.read_issue_candidate(text, text)
  to terra_issue_reader;
commit;
