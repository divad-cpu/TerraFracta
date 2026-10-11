-- UNINSTALLED stable invoker read draft; no credential or default binding.
create function terra_private.read_operator_proposal(p_run uuid,p_decision uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $read$
declare
 observed timestamptz:=statement_timestamp(); requested jsonb;
 d record; c terra_private.proposal_captures; i record; h record; b terra_private.issue_publications;
 table_name text; table_oid oid; policy_ok boolean;
 base_json text; base_hash text; payload jsonb; receipts jsonb; response jsonb;
 reason_allow constant text[]:=array['source_version_not_current','evidence_locator_unverified','identity_unresolved','fields_dates_units_unverified','semantics_unqualified','material_conflict','snapshot_inconsistent','predecessor_changed','sensitive_data_present','decision_identity_missing','mode_unsupported','policy_not_active','source_not_approved','source_fetch_disabled','qualification_not_active','qualification_policy_mismatch','change_class_not_automatable','change_class_mismatch','parser_version_mismatch','parser_version_invalid','public_use_not_allowed','public_citation_invalid','qualification_expired_or_invalid','qualification_samples_invalid','semantic_contract_mismatch','evidence_receipt_invalid','decision_time_invalid','source_endpoint_mismatch','source_identity_mismatch','shadow_mode','qualified_checks_passed'];
begin
 if current_setting('transaction_read_only')<>'on' or current_user<>'terra_reviewer'
  or not exists(select 1 from pg_catalog.pg_roles where rolname=current_user
   and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls)
  then raise exception 'Proposal reviewer unavailable' using errcode='42501';end if;
 foreach table_name in array array['proposal_captures','machine_candidate_decisions','update_runs','automatic_route_qualifications','source_versions','jurisdictions','issue_dossiers','issue_heads','issue_publications'] loop
  table_oid:=pg_catalog.to_regclass('terra_private.'||table_name);
  if table_oid is null or not pg_catalog.has_table_privilege(current_user,table_oid,'SELECT')
   or not exists(select 1 from pg_catalog.pg_class where oid=table_oid and relkind='r' and relrowsecurity)
   then raise exception 'Proposal visibility unavailable' using errcode='42501';end if;
  select exists(select 1 from pg_catalog.pg_policy p where p.polrelid=table_oid and p.polcmd in('r','*')
    and p.polpermissive and pg_catalog.pg_get_expr(p.polqual,p.polrelid)='true'
    and exists(select 1 from unnest(p.polroles) role_id where case when role_id=0 then true else pg_catalog.pg_has_role(current_user,role_id,'USAGE') end))
   and not exists(select 1 from pg_catalog.pg_policy p where p.polrelid=table_oid and p.polcmd in('r','*')
    and not p.polpermissive and pg_catalog.pg_get_expr(p.polqual,p.polrelid) is distinct from 'true'
    and exists(select 1 from unnest(p.polroles) role_id where case when role_id=0 then true else pg_catalog.pg_has_role(current_user,role_id,'USAGE') end)) into policy_ok;
  if not policy_ok then raise exception 'Proposal visibility unavailable' using errcode='42501';end if;
 end loop;
 if p_run is null or p_decision is null or p_run::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or p_decision::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then raise exception 'Proposal request invalid' using errcode='23514';end if;
 requested:=jsonb_build_object('runId',p_run,'decisionId',p_decision);
 select md.*,r.jurisdiction_id,r.created_at as run_created,q.registration_id,q.decided_at as qualified_at,
  sv.registration_id as source_registration,sv.content_sha256 as source_hash,sv.retrieved_at
 into d from terra_private.machine_candidate_decisions md
 join terra_private.update_runs r on r.id=md.run_id
 join terra_private.automatic_route_qualifications q on q.id=md.qualification_id
 join terra_private.source_versions sv on sv.id=md.source_version_id
 where md.id=p_decision and md.run_id=p_run and md.disposition='held';
 if not found then return jsonb_build_object('schemaVersion',1,'status','not_found','requested',requested);end if;
 if d.source_registration<>d.registration_id or d.source_hash<>d.content_sha256
  or not isfinite(d.decided_at) or d.decided_at<d.run_created or d.decided_at<d.retrieved_at
  or d.decided_at<d.qualified_at or d.decided_at>observed or d.decided_at<'0001-01-01Z'::timestamptz
  or array_ndims(d.reason_codes) is distinct from 1 or cardinality(d.reason_codes) not between 1 and 24
  then raise exception 'Proposal decision dependency invalid' using errcode='23514';end if;
 select * into c from terra_private.proposal_captures where decision_id=p_decision;
 if not found then return jsonb_build_object('schemaVersion',1,'status','capture_missing','requested',requested);end if;
 select dossier.*,j.public_slug as jurisdiction_slug into i from terra_private.issue_dossiers dossier
  join terra_private.jurisdictions j on j.id=dossier.jurisdiction_id where dossier.id=c.issue_id;
 if not found or i.jurisdiction_id<>d.jurisdiction_id or i.public_slug is null or i.jurisdiction_slug is null
  then raise exception 'Proposal issue dependency invalid' using errcode='23514';end if;
 select * into h from terra_private.issue_heads where issue_id=c.issue_id;
 if not found then raise exception 'Proposal head unavailable' using errcode='23514';end if;
 if h.current_publication_id is distinct from c.base_publication_id or h.changed_at is distinct from c.base_head_changed_at
  then return jsonb_build_object('schemaVersion',1,'status','changed','requested',requested);end if;
 if (h.current_publication_id is null) is distinct from (h.changed_at is null)
  or (h.changed_at is not null and (not isfinite(h.changed_at) or h.changed_at>c.captured_at))
  then raise exception 'Proposal head chronology invalid' using errcode='23514';end if;
 base_json:=null;base_hash:=null;
 if c.base_publication_id is not null then
  select * into b from terra_private.issue_publications where id=c.base_publication_id and issue_id=c.issue_id;
  if not found or b.publication_kind not in('accepted','correction') or not isfinite(b.created_at)
   or b.created_at>h.changed_at then raise exception 'Proposal base unavailable' using errcode='23514';end if;
  base_json:=terra_private.proposal_base_json(b);base_hash:=encode(sha256(convert_to(base_json,'UTF8')),'hex');
  if base_hash is distinct from c.base_content_sha256 then return jsonb_build_object('schemaVersion',1,'status','changed','requested',requested);end if;
 end if;
 if not isfinite(c.captured_at) or c.captured_at<d.decided_at or c.captured_at>observed
  or encode(sha256(convert_to(c.proposal_json,'UTF8')),'hex')<>c.proposal_sha256
  then raise exception 'Proposal capture invalid' using errcode='23514';end if;
 payload:=c.proposal_json::jsonb;
 select coalesce(jsonb_agg(jsonb_build_object('sourceVersionId',v.id,'contentSha256',v.content_sha256,
  'retrievedAt',to_char(v.retrieved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'languageCode',v.language_code) order by v.id),'[]'::jsonb)
  into receipts from terra_private.source_versions v where v.id in
  (select value::uuid from jsonb_array_elements_text(payload->'dependencyManifest'->'sourceVersionIds'));
 if receipts is distinct from c.source_receipts then return jsonb_build_object('schemaVersion',1,'status','changed','requested',requested);end if;
 response:=jsonb_build_object('schemaVersion',1,'status','ok','requested',requested,
  'observedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'decision',jsonb_build_object('decisionId',d.id,'decidedAt',to_char(d.decided_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'sourceVersionId',d.source_version_id,'sourceSha256',d.content_sha256,'evidenceLocator',d.evidence_locator,
   'reasonCodes',(select coalesce(jsonb_agg(reason order by ordinal),'[]'::jsonb) from unnest(d.reason_codes) with ordinality r(reason,ordinal) where reason=any(reason_allow)),
   'undisclosedReasonCount',(select count(*) from unnest(d.reason_codes) r(reason) where (reason=any(reason_allow)) is distinct from true)),
  'target',jsonb_build_object('issueId',c.issue_id,'jurisdictionId',i.jurisdiction_id,'jurisdictionSlug',i.jurisdiction_slug,'issueSlug',i.public_slug),
  'capture',jsonb_build_object('captureId',c.id,'capturedAt',to_char(c.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'proposalJson',c.proposal_json,'proposalSha256',c.proposal_sha256,'basePublicationId',c.base_publication_id,
   'baseHeadChangedAt',case when c.base_head_changed_at is null then null else to_char(c.base_head_changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
   'baseContentSha256',c.base_content_sha256),
  'sourceReceipts',c.source_receipts,'base',case when base_json is null then null else jsonb_build_object('publicationJson',base_json,'publicationSha256',base_hash) end);
 if octet_length(response::text)>65536 then raise exception 'Proposal output bound exceeded' using errcode='23514';end if;
 return response;
end;
$read$;
revoke all on function terra_private.read_operator_proposal(uuid,uuid) from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_issue_reader;
grant execute on function terra_private.read_operator_proposal(uuid,uuid) to terra_reviewer;
