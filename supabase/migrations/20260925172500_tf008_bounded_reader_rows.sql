-- TF-008 preparation: stop oversized private row text at the NOLOGIN reader
-- boundary. The inner candidate remains owner-only; the new wrapper returns
-- SQL null when its fixed row fields or total output exceed the v1 budget.
-- No writer, login, public route or table grant is introduced.
begin;

create function terra_private.is_bounded_reader_candidate(value jsonb)
returns boolean
language plpgsql immutable strict
set search_path = pg_catalog, pg_temp
as $bound$
declare item jsonb;
declare field text;
begin
  if jsonb_typeof(value) is distinct from 'object'
     or octet_length(value::text) > 1310720
     or jsonb_typeof(value->'claims') is distinct from 'array'
     or jsonb_typeof(value->'citations') is distinct from 'array'
     or jsonb_typeof(value->'sources') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(value->'claims') > 30
     or jsonb_array_length(value->'citations') > 360
     or jsonb_array_length(value->'sources') > 120 then
    return false;
  end if;
  if length(coalesce(value #>> '{requestedRoute,jurisdictionSlug}', '')) > 80
     or length(coalesce(value #>> '{requestedRoute,issueSlug}', '')) > 100
     or length(coalesce(value #>> '{country,id}', '')) > 80 then
    return false;
  end if;
  for item in select part from jsonb_array_elements(value->'claims') as rows(part) loop
    field := item->>'assertion';
    if jsonb_typeof(item->'assertion') is distinct from 'string'
       or length(btrim(coalesce(field, ''))) not between 1 and 1200 then
      return false;
    end if;
  end loop;
  for item in select part from jsonb_array_elements(value->'citations') as rows(part) loop
    field := item->>'locator';
    if jsonb_typeof(item->'locator') is distinct from 'string'
       or length(btrim(coalesce(field, ''))) not between 1 and 300 then
      return false;
    end if;
  end loop;
  for item in select part from jsonb_array_elements(value->'sources') as rows(part) loop
    if jsonb_typeof(item #> '{registration,publisher}') is distinct from 'string'
       or length(btrim(coalesce(item #>> '{registration,publisher}', '')))
            not between 1 and 160
       or jsonb_typeof(item #> '{version,source_url}') is distinct from 'string'
       or length(coalesce(item #>> '{version,source_url}', '')) not between 1 and 2048 then
      return false;
    end if;
  end loop;
  return true;
end;
$bound$;

-- Rename retains the prior function's OID and ACL. Close its reader grant
-- before creating the new public-issue entry point in this transaction.
alter function terra_private.read_issue_candidate(text, text)
  rename to read_issue_candidate_prebound;
revoke all on function terra_private.read_issue_candidate_prebound(text, text)
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;
revoke all on function terra_private.is_bounded_reader_candidate(jsonb)
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;

create function terra_private.read_issue_candidate(text, text)
returns jsonb
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
as $read$
with selected as materialized (
  select terra_private.read_issue_candidate_prebound($1, $2) as candidate
)
select case
  when candidate is null then null
  when terra_private.is_bounded_reader_candidate(candidate) then candidate
  else null
end
from selected
$read$;

revoke all on function terra_private.read_issue_candidate(text, text)
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator;
grant execute on function terra_private.read_issue_candidate(text, text)
  to terra_issue_reader;
commit;
