-- Keep eligible decisions bound to the registration's currently enabled URL.
-- This closes a gap where an old qualification could survive an endpoint change.
begin;

create function terra_private.check_machine_current_route_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
declare registration_endpoint text;
declare registration_fetch_enabled boolean;
declare qualification_endpoint text;
begin
  if new.disposition <> 'eligible' then
    return new;
  end if;
  select registration.exact_endpoint, registration.fetch_enabled,
         qualification.exact_endpoint
    into registration_endpoint, registration_fetch_enabled, qualification_endpoint
    from terra_private.automatic_route_qualifications qualification
    join terra_private.source_registrations registration
      on registration.id = qualification.registration_id
    where qualification.id = new.qualification_id;
  if not found or registration_endpoint <> qualification_endpoint
     or not registration_fetch_enabled then
    raise exception 'Current source route does not permit eligibility'
      using errcode = '23514';
  end if;
  return new;
end;
$guard$;

create trigger machine_current_route_insert_guard
before insert on terra_private.machine_candidate_decisions
for each row execute function terra_private.check_machine_current_route_insert();
revoke all on function terra_private.check_machine_current_route_insert()
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;
commit;
