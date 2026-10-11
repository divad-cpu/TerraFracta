-- A qualified structured route needs a bounded review window and recorded
-- sample result before a new eligible decision can be stored. The fields are
-- assertions by a future trusted reviewer, not proof of semantic correctness.
begin;

alter table terra_private.automatic_route_qualifications
  add column qualification_expires_at timestamptz,
  add column reviewed_sample_count integer
    check (reviewed_sample_count between 0 and 1000),
  add column unresolved_sample_errors integer
    check (unresolved_sample_errors between 0 and 1000),
  add column semantic_contract_sha256 text
    check (semantic_contract_sha256 ~ '^[0-9a-f]{64}$');

alter table terra_private.machine_candidate_decisions
  add column semantic_contract_sha256 text
    check (semantic_contract_sha256 ~ '^[0-9a-f]{64}$');

create function terra_private.check_machine_qualification_window_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
declare qualification_row terra_private.automatic_route_qualifications%rowtype;
begin
  if new.disposition <> 'eligible' then
    return new;
  end if;
  select * into qualification_row
    from terra_private.automatic_route_qualifications
    where id = new.qualification_id;
  if not found
     or qualification_row.qualification_expires_at is null
     or new.decided_at >= qualification_row.qualification_expires_at
     or qualification_row.reviewed_sample_count is null
     or qualification_row.reviewed_sample_count < 3
     or qualification_row.unresolved_sample_errors is distinct from 0
     or qualification_row.semantic_contract_sha256 is null
     or new.semantic_contract_sha256 is distinct from
        qualification_row.semantic_contract_sha256 then
    raise exception 'Qualification review window or sample basis is missing'
      using errcode = '23514';
  end if;
  return new;
end;
$guard$;

create trigger machine_qualification_window_insert_guard
before insert on terra_private.machine_candidate_decisions
for each row execute function terra_private.check_machine_qualification_window_insert();
revoke all on function terra_private.check_machine_qualification_window_insert()
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;
commit;
