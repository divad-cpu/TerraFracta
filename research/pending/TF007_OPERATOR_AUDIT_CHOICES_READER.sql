-- Draft only: install solely in a fresh owned constructed-record trial.
-- Existing broad reviewer, no LOGIN, table grants, primary migration or wiring.
-- Plain invoker cannot infer invisible records; trusted unconditional effective
-- RLS visibility on all three dependencies is required before enumeration.
create function terra_private.read_operator_audit_choices(p_run uuid default null,
  p_before_created timestamptz default null,p_before_run uuid default null)
returns jsonb language plpgsql stable security invoker
set search_path = '' as $choices$
declare
  observed timestamptz := statement_timestamp();
  floor_time constant timestamptz := '0001-01-01T00:00:00Z';
  ceiling_time constant timestamptz := '10000-01-01T00:00:00Z';
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  table_name text; table_oid oid; policy_ok boolean;
  row_value record; run_value jsonb;
  runs jsonb := '[]'::jsonb; issues jsonb := '[]'::jsonb;
  selected_run jsonb := null; selected_jurisdiction text;
  requested_cursor jsonb := null; next_cursor jsonb := null;
  run_count integer := 0; issue_count integer := 0;
  response jsonb;
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception 'Operator audit choices requires read-only transaction' using errcode = '25006';
  end if;
  if current_user <> 'terra_reviewer' or not exists (
    select 1 from pg_catalog.pg_roles where rolname = current_user
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls) then
    raise exception 'Operator audit choices reviewer unavailable' using errcode = '42501';
  end if;
  foreach table_name in array array['jurisdictions','update_runs','issue_dossiers'] loop
    table_oid := pg_catalog.to_regclass('terra_private.' || table_name);
    if table_oid is null or not pg_catalog.has_table_privilege(current_user,table_oid,'SELECT')
      or not exists (select 1 from pg_catalog.pg_class where oid=table_oid and relkind='r' and relrowsecurity) then
      raise exception 'Operator audit choices read configuration unavailable' using errcode = '42501';
    end if;
    select exists (select 1 from pg_catalog.pg_policy p where p.polrelid=table_oid
      and p.polcmd in ('r','*') and p.polpermissive
      and pg_catalog.pg_get_expr(p.polqual,p.polrelid)='true'
      and exists (select 1 from unnest(p.polroles) role_id where case when role_id=0 then true
        else pg_catalog.pg_has_role(current_user,role_id,'USAGE') end))
      and not exists (select 1 from pg_catalog.pg_policy p where p.polrelid=table_oid
        and p.polcmd in ('r','*') and not p.polpermissive
        and pg_catalog.pg_get_expr(p.polqual,p.polrelid) is distinct from 'true'
        and exists (select 1 from unnest(p.polroles) role_id where case when role_id=0 then true
          else pg_catalog.pg_has_role(current_user,role_id,'USAGE') end))
      into policy_ok;
    if not policy_ok then
      raise exception 'Operator audit choices visibility unavailable' using errcode = '42501';
    end if;
  end loop;
  if not isfinite(observed) or observed < floor_time or observed >= ceiling_time
    or (p_run is not null and p_run::text !~ uuid_pattern)
    or (p_before_created is null) <> (p_before_run is null)
    or (p_before_run is not null and p_before_run::text !~ uuid_pattern)
    or (p_before_created is not null and (not isfinite(p_before_created)
      or p_before_created < floor_time or p_before_created >= ceiling_time)) then
    raise exception 'Operator audit choices request invalid' using errcode = '23514';
  end if;
  if p_before_created is not null then
    requested_cursor := jsonb_build_object('createdAt',
      to_char(p_before_created at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'runId',p_before_run);
    -- An absent or moved boundary is an ordinary changed selection. Inspect
    -- the exact anchor in this STABLE statement snapshot before enumerating;
    -- do not return an older page under an unverified boundary.
    select id,jurisdiction_id,created_at,run_state into row_value
      from terra_private.update_runs where id=p_before_run and created_at=p_before_created;
    if not found then
      return jsonb_build_object('schemaVersion',2,'status','changed',
        'requestedRunId',p_run,'requestedCursor',requested_cursor);
    end if;
    if row_value.id::text !~ uuid_pattern
      or row_value.jurisdiction_id !~ '^[a-z0-9][a-z0-9:-]{0,79}$'
      or not exists (select 1 from terra_private.jurisdictions where id=row_value.jurisdiction_id)
      or not isfinite(row_value.created_at) or row_value.created_at < floor_time
      or row_value.created_at >= ceiling_time or row_value.created_at > observed
      or row_value.run_state not in ('queued','running','completed','partial','failed','rejected') then
      raise exception 'Operator audit choices cursor dependency invalid' using errcode = '23514';
    end if;
  end if;
  -- At most 21 projected records enter memory. Validate the sentinel too:
  -- an invalid extra record cannot supply a successful "more" observation.
  for row_value in select id,jurisdiction_id,created_at,run_state
    from terra_private.update_runs
    where p_before_created is null or (created_at,id)<(p_before_created,p_before_run)
    order by created_at desc,id desc limit 21 loop
    if row_value.id::text !~ uuid_pattern
      or row_value.jurisdiction_id !~ '^[a-z0-9][a-z0-9:-]{0,79}$'
      or not exists (select 1 from terra_private.jurisdictions where id=row_value.jurisdiction_id)
      or not isfinite(row_value.created_at) or row_value.created_at < floor_time
      or row_value.created_at >= ceiling_time or row_value.created_at > observed
      or row_value.run_state not in ('queued','running','completed','partial','failed','rejected') then
      raise exception 'Operator audit choices run dependency invalid' using errcode = '23514';
    end if;
    run_count := run_count+1;
    if run_count <= 20 then
      run_value := jsonb_build_object('runId',row_value.id,'jurisdictionId',row_value.jurisdiction_id,
        'createdAt',to_char(row_value.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'runState',row_value.run_state);
      runs := runs || jsonb_build_array(run_value);
      if run_count=20 then
        next_cursor := jsonb_build_object('createdAt',run_value->'createdAt','runId',row_value.id);
      end if;
    end if;
  end loop;
  if run_count<=20 then next_cursor := null; end if;
  -- A known selection may lie outside this page. Resolve it independently,
  -- without interpreting absence from the bounded list as a missing run.
  if p_run is not null then
    select id,jurisdiction_id,created_at,run_state into row_value
      from terra_private.update_runs where id=p_run;
    if found then
      if row_value.id::text !~ uuid_pattern
        or row_value.jurisdiction_id !~ '^[a-z0-9][a-z0-9:-]{0,79}$'
        or not exists (select 1 from terra_private.jurisdictions where id=row_value.jurisdiction_id)
        or not isfinite(row_value.created_at) or row_value.created_at < floor_time
        or row_value.created_at >= ceiling_time or row_value.created_at > observed
        or row_value.run_state not in ('queued','running','completed','partial','failed','rejected') then
        raise exception 'Operator audit choices selected run invalid' using errcode = '23514';
      end if;
      selected_jurisdiction := row_value.jurisdiction_id;
      selected_run := jsonb_build_object('runId',row_value.id,'jurisdictionId',row_value.jurisdiction_id,
        'createdAt',to_char(row_value.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'runState',row_value.run_state);
      -- Bounded projection before aggregation; private titles and all raw
      -- request/evidence fields are neither selected nor returned.
      for row_value in select id,issue_key from terra_private.issue_dossiers
        where jurisdiction_id=selected_jurisdiction
        order by issue_key collate "C",id limit 51 loop
        if row_value.id::text !~ uuid_pattern
          or row_value.issue_key !~ '^[a-z0-9][a-z0-9-]{0,119}$' then
          raise exception 'Operator audit choices issue dependency invalid' using errcode = '23514';
        end if;
        issue_count := issue_count+1;
        if issue_count <= 50 then
          issues := issues || jsonb_build_array(jsonb_build_object('issueId',row_value.id,'issueKey',row_value.issue_key));
        end if;
      end loop;
    end if;
  end if;
  response := jsonb_build_object('schemaVersion',2,'status','ok',
    'observedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'requestedRunId',p_run,'requestedCursor',requested_cursor,'runs',runs,'moreRuns',run_count>20,
    'selectedRun',selected_run,'issues',issues,'moreIssues',issue_count>50,'nextCursor',next_cursor);
  if octet_length(response::text)>65536 then
    raise exception 'Operator audit choices output bound exceeded' using errcode = '23514';
  end if;
  return response;
end;
$choices$;
revoke all on function terra_private.read_operator_audit_choices(uuid,timestamptz,uuid)
  from public,anon,authenticated,service_role,terra_collector,terra_operator;
grant execute on function terra_private.read_operator_audit_choices(uuid,timestamptz,uuid) to terra_reviewer;
