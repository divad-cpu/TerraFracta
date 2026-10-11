-- Specifically authorized by David on 2026-09-30: two private qualification timeline guards only.
-- Reviewed SQL preserved; no fields, deletion, role or runtime activation.
begin;
-- Reviewed draft for a separate additive change; rollback tests only.
-- No role, source, schedule, writer or public route activation.
create function terra_private.check_machine_qualification_timeline_insert()
returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
declare q terra_private.automatic_route_qualifications%rowtype;
begin
  if new.disposition <> 'eligible' then return new; end if;
  select * into q from terra_private.automatic_route_qualifications
    where id=new.qualification_id;
  if q.id is null or not isfinite(q.decided_at) or not isfinite(new.decided_at)
     or new.decided_at<q.decided_at or new.decided_at>transaction_timestamp() then
    raise exception 'Machine qualification timeline is invalid' using errcode='23514';
  end if;
  return new;
end;
$guard$;
create trigger machine_qualification_timeline_insert_guard
before insert on terra_private.machine_candidate_decisions
for each row execute function terra_private.check_machine_qualification_timeline_insert();
revoke all on function terra_private.check_machine_qualification_timeline_insert()
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;

create function terra_private.check_publication_qualification_timeline_insert()
returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
declare q_time timestamptz;
declare d_time timestamptz;
begin
  select q.decided_at,d.decided_at into q_time,d_time
    from terra_private.machine_candidate_decisions d
    join terra_private.automatic_route_qualifications q on q.id=d.qualification_id
    where d.id=new.decision_id;
  if q_time is null or d_time is null or not isfinite(q_time) or not isfinite(d_time)
     or d_time<q_time or new.linked_at<q_time then
    raise exception 'Publication qualification timeline is invalid' using errcode='23514';
  end if;
  return new;
end;
$guard$;
create trigger publication_qualification_timeline_insert_guard
before insert on terra_private.issue_publication_machine_bindings
for each row execute function terra_private.check_publication_qualification_timeline_insert();
revoke all on function terra_private.check_publication_qualification_timeline_insert()
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;

commit;
