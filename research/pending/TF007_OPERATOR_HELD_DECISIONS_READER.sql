-- Draft only: fresh owned constructed-history reader trial, never primary.
-- Existing broad NOLOGIN reviewer; no writer, account, migration or wiring.
-- Trusted unconditional effective RLS visibility is required on all six tables.
create function terra_private.read_operator_held_decisions(p_run uuid,
  p_before_decided timestamptz default null,p_before_decision uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $held$
declare
  observed timestamptz := statement_timestamp();
  floor_time constant timestamptz := '0001-01-01T00:00:00Z';
  ceiling_time constant timestamptz := '10000-01-01T00:00:00Z';
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  reason_allow constant text[] := array['source_version_not_current','evidence_locator_unverified','identity_unresolved','fields_dates_units_unverified','semantics_unqualified','material_conflict','snapshot_inconsistent','predecessor_changed','sensitive_data_present','decision_identity_missing','mode_unsupported','policy_not_active','source_not_approved','source_fetch_disabled','qualification_not_active','qualification_policy_mismatch','change_class_not_automatable','change_class_mismatch','parser_version_mismatch','parser_version_invalid','public_use_not_allowed','public_citation_invalid','qualification_expired_or_invalid','qualification_samples_invalid','semantic_contract_mismatch','evidence_receipt_invalid','decision_time_invalid','source_endpoint_mismatch','source_identity_mismatch','shadow_mode','qualified_checks_passed'];
  check_allow constant text[] := array['source_version_current','evidence_locator_verified','identity_resolved','fields_dates_units_verified','semantics_qualified','no_material_conflict','public_snapshot_consistent','expected_predecessor_current','no_sensitive_data'];
  table_name text; table_oid oid; policy_ok boolean;
  run_row record; row_value record;
  requested jsonb; decisions jsonb := '[]'::jsonb; next_cursor jsonb := null;
  row_count integer := 0; response jsonb;
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception 'Operator held decisions requires read-only transaction' using errcode = '25006';
  end if;
  if current_user <> 'terra_reviewer' or not exists (
    select 1 from pg_catalog.pg_roles where rolname = current_user
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls) then
    raise exception 'Operator held decisions reviewer unavailable' using errcode = '42501';
  end if;
  foreach table_name in array array['jurisdictions','update_runs','machine_candidate_decisions','automatic_route_qualifications','source_versions','source_registrations'] loop
    table_oid := pg_catalog.to_regclass('terra_private.' || table_name);
    if table_oid is null or not pg_catalog.has_table_privilege(current_user,table_oid,'SELECT')
      or not exists (select 1 from pg_catalog.pg_class where oid=table_oid and relkind='r' and relrowsecurity) then
      raise exception 'Operator held decisions read configuration unavailable' using errcode = '42501';
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
      raise exception 'Operator held decisions visibility unavailable' using errcode = '42501';
    end if;
  end loop;
  if not isfinite(observed) or observed<floor_time or observed>=ceiling_time
    or p_run is null or p_run::text !~ uuid_pattern
    or (p_before_decided is null)<>(p_before_decision is null)
    or (p_before_decision is not null and p_before_decision::text !~ uuid_pattern)
    or (p_before_decided is not null and (not isfinite(p_before_decided)
      or p_before_decided<floor_time or p_before_decided>=ceiling_time)) then
    raise exception 'Operator held decisions request invalid' using errcode='23514';
  end if;
  requested := jsonb_build_object('runId',p_run,'cursor',case when p_before_decided is null then null
    else jsonb_build_object('decidedAt',to_char(p_before_decided at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'decisionId',p_before_decision) end);
  select id,jurisdiction_id,created_at into run_row from terra_private.update_runs where id=p_run;
  if not found then
    return jsonb_build_object('schemaVersion',1,'status','not_found','requested',requested);
  end if;
  if run_row.id::text !~ uuid_pattern or run_row.jurisdiction_id !~ '^[a-z0-9][a-z0-9:-]{0,79}$'
    or not exists(select 1 from terra_private.jurisdictions where id=run_row.jurisdiction_id)
    or not isfinite(run_row.created_at) or run_row.created_at<floor_time
    or run_row.created_at>=ceiling_time or run_row.created_at>observed then
    raise exception 'Operator held decisions run dependency invalid' using errcode='23514';
  end if;
  if p_before_decided is not null and not exists(select 1 from terra_private.machine_candidate_decisions
      where id=p_before_decision and decided_at=p_before_decided and run_id=p_run and disposition='held') then
    return jsonb_build_object('schemaVersion',1,'status','changed','requested',requested);
  end if;
  -- Project at most the anchor plus 21 page rows. Anchor and sentinel receive
  -- the same dependency checks as displayed rows; neither can attest to "more"
  -- under missing/corrupt references. STABLE queries share the statement snapshot.
  for row_value in
    with page as materialized (
      select id from terra_private.machine_candidate_decisions
      where run_id=p_run and disposition='held'
        and (p_before_decided is null or (decided_at,id)<(p_before_decided,p_before_decision))
      order by decided_at desc,id desc limit 21
    ), picked as (
      select p_before_decision as id,false as page_item where p_before_decided is not null
      union all select id,true from page
    )
    select picked.page_item,d.id,d.run_id,d.disposition,d.decided_at,
      d.source_version_id,d.qualification_id,q.registration_id,q.revision,q.decision as qualification_decision,
      q.decided_at as qualified_at,q.change_class,v.registration_id as version_registration,s.id as source_id,s.source_key,
      v.retrieved_at,(v.content_sha256=d.content_sha256) as source_hash_matches,
      (v.source_url=q.exact_endpoint) as recorded_endpoint_matches,
      cardinality(d.reason_codes) as reason_count,array_ndims(d.reason_codes) as reason_dimensions,
      array(select reason from unnest(d.reason_codes) with ordinality as r(reason,ordinal)
        where reason=any(reason_allow) order by ordinal) as known_reasons,
      (select count(*) from unnest(d.reason_codes) as r(reason)
        where (reason=any(reason_allow)) is distinct from true) as unknown_reasons,
      (jsonb_typeof(d.check_trace)='object' and octet_length(d.check_trace::text)<=4096) as trace_bounded,
      case when jsonb_typeof(d.check_trace)='object' and octet_length(d.check_trace::text)<=4096 then
        exists(select 1 from unnest(check_allow) as k(name) where d.check_trace ? name
          and jsonb_typeof(d.check_trace->name) is distinct from 'boolean') else true end as invalid_known_check,
      case when jsonb_typeof(d.check_trace)='object' and octet_length(d.check_trace::text)<=4096 then
        (select jsonb_object_agg(name,coalesce(d.check_trace->name,'null'::jsonb)) from unnest(check_allow) as k(name))
        else null end as checks,
      case when jsonb_typeof(d.check_trace)='object' and octet_length(d.check_trace::text)<=4096 then
        (select count(*) from jsonb_object_keys(d.check_trace) as k(name) where not name=any(check_allow))
        else null end as unknown_checks
    from picked left join terra_private.machine_candidate_decisions d on d.id=picked.id
      left join terra_private.automatic_route_qualifications q on q.id=d.qualification_id
      left join terra_private.source_versions v on v.id=d.source_version_id
      left join terra_private.source_registrations s on s.id=q.registration_id
    order by picked.page_item,d.decided_at desc,d.id desc
  loop
    if row_value.id is null or row_value.id::text !~ uuid_pattern
      or row_value.run_id is distinct from p_run or row_value.disposition is distinct from 'held'
      or row_value.qualification_id is null or row_value.qualification_id::text !~ uuid_pattern
      or row_value.source_version_id is null or row_value.source_version_id::text !~ uuid_pattern
      or row_value.registration_id is null or row_value.registration_id::text !~ uuid_pattern
      or row_value.source_id is distinct from row_value.registration_id
      or row_value.version_registration is distinct from row_value.registration_id
      or row_value.source_key is null or row_value.source_key !~ '^[a-z0-9][a-z0-9:-]{0,119}$'
      or row_value.revision is null or row_value.revision<1
      or row_value.qualification_decision is null or row_value.qualification_decision not in('qualified','suspended')
      or row_value.change_class is distinct from 'structured_observation'
      or row_value.source_hash_matches is distinct from true or row_value.recorded_endpoint_matches is distinct from true
      or row_value.decided_at is null or not isfinite(row_value.decided_at)
      or row_value.decided_at<run_row.created_at or row_value.decided_at>=ceiling_time or row_value.decided_at>observed
      or row_value.qualified_at is null or not isfinite(row_value.qualified_at)
      or row_value.qualified_at<floor_time or row_value.qualified_at>row_value.decided_at
      or row_value.retrieved_at is null or not isfinite(row_value.retrieved_at)
      or row_value.retrieved_at<floor_time or row_value.retrieved_at>row_value.decided_at
      or row_value.reason_dimensions is distinct from 1 or row_value.reason_count is null
      or row_value.reason_count not between 1 and 24 or row_value.trace_bounded is distinct from true
      or row_value.invalid_known_check or row_value.unknown_checks is null or row_value.unknown_checks>4096 then
      raise exception 'Operator held decisions record dependency invalid' using errcode='23514';
    end if;
    if row_value.page_item then
      row_count := row_count+1;
      if row_count<=20 then
        decisions := decisions || jsonb_build_array(jsonb_build_object(
          'decisionId',row_value.id,'decidedAt',to_char(row_value.decided_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'registrationId',row_value.registration_id,'sourceKey',row_value.source_key,
          'sourceVersionId',row_value.source_version_id,'qualificationId',row_value.qualification_id,
          'qualificationRevision',row_value.revision,'qualificationDecision',row_value.qualification_decision,
          'reasonCodes',row_value.known_reasons,'undisclosedReasonCount',row_value.unknown_reasons,
          'checks',row_value.checks,'undisclosedCheckCount',row_value.unknown_checks));
        if row_count=20 then next_cursor := jsonb_build_object('decidedAt',
          to_char(row_value.decided_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'decisionId',row_value.id);end if;
      end if;
    end if;
  end loop;
  if row_count<=20 then next_cursor:=null;end if;
  response:=jsonb_build_object('schemaVersion',1,'status','ok','requested',requested,
    'observedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'run',jsonb_build_object('runId',run_row.id,'jurisdictionId',run_row.jurisdiction_id,
      'createdAt',to_char(run_row.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
    'decisions',decisions,'more',row_count>20,'nextCursor',next_cursor);
  if octet_length(response::text)>65536 then
    raise exception 'Operator held decisions output bound exceeded' using errcode='23514';
  end if;
  return response;
end;
$held$;
revoke all on function terra_private.read_operator_held_decisions(uuid,timestamptz,uuid)
  from public,anon,authenticated,service_role,terra_collector,terra_operator;
grant execute on function terra_private.read_operator_held_decisions(uuid,timestamptz,uuid) to terra_reviewer;
