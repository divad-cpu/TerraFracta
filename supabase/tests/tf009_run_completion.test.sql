-- Owner-only structural and terminal-state checks. Always roll back.
begin;
create extension if not exists pgtap with schema extensions;
-- Specifically approved completion schema is installed.
select no_plan();
select has_table('terra_private','update_run_manifests','Private captured manifests exist');
select has_table('terra_private','update_run_closeouts','Private processing receipts exist');
select has_table('terra_private','update_run_source_checks','Fresh source checks exist independently from versions');
select is((select count(*)::integer from information_schema.columns where table_schema='terra_private'
 and table_name in('update_run_manifests','update_run_closeouts','update_run_source_checks')),19,'Exactly nineteen new private fields');
select ok(relrowsecurity,'RLS enabled on '||relname) from pg_class
 where oid in('terra_private.update_run_manifests'::regclass,'terra_private.update_run_closeouts'::regclass,'terra_private.update_run_source_checks'::regclass)
 order by relname;
select ok(not p.prosecdef and p.proconfig=array['search_path=pg_catalog, pg_temp'],
 'Invoker function with fixed search path: '||p.proname) from pg_proc p
 where p.pronamespace='terra_private'::regnamespace and p.proname in(
 'validate_run_manifest','check_run_source_check_insert','check_run_manifest_insert','check_planned_machine_decision',
 'summarize_run_processing','check_run_closeout','check_closed_run_change','close_update_run_processing')
 order by p.proname;
select ok(not has_function_privilege(r.role_name,p.oid,'EXECUTE'),r.role_name||' cannot execute '||p.proname)
 from (values('anon'),('authenticated'),('service_role'),('terra_collector'),
 ('terra_operator'),('terra_reviewer'),('terra_issue_reader')) r(role_name) cross join pg_proc p
 where p.pronamespace='terra_private'::regnamespace and p.proname in(
 'validate_run_manifest','check_run_source_check_insert','check_run_manifest_insert','check_planned_machine_decision',
 'summarize_run_processing','check_run_closeout','check_closed_run_change','close_update_run_processing')
 order by r.role_name,p.proname;
select ok(not has_table_privilege(r.role_name,t.table_name,'INSERT') and
 not has_table_privilege(r.role_name,t.table_name,'UPDATE') and not has_table_privilege(r.role_name,t.table_name,'DELETE'),
 r.role_name||' has no DML on '||t.table_name)
 from (values('anon'),('authenticated'),('service_role'),('terra_collector'),
 ('terra_operator'),('terra_reviewer'),('terra_issue_reader')) r(role_name)
 cross join (values('terra_private.update_run_manifests'),('terra_private.update_run_closeouts'),('terra_private.update_run_source_checks')) t(table_name)
 order by r.role_name,t.table_name;
select ok(has_table_privilege(r.role_name,t.table_name,'SELECT'),r.role_name||' can inspect private '||t.table_name)
 from (values('terra_operator'),('terra_reviewer')) r(role_name)
 cross join (values('terra_private.update_run_manifests'),('terra_private.update_run_closeouts'),('terra_private.update_run_source_checks')) t(table_name)
 order by r.role_name,t.table_name;
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
 where p.pronamespace='terra_private'::regnamespace and p.proname in(
 'validate_run_manifest','check_run_source_check_insert','check_run_manifest_insert','check_planned_machine_decision',
 'summarize_run_processing','check_run_closeout','check_closed_run_change','close_update_run_processing')
 and a.grantee=0 and a.privilege_type='EXECUTE'),'No PUBLIC execute grant');

-- This is an owner-driven, fictional transaction fixture, never a migration.
-- Its temporary activation function and every row/role change roll back.

set local statement_timeout = '20s';
set local lock_timeout = '3s';

create temporary table activation_input (payload jsonb not null);
-- The runner inserts exactly one fixed, Python-derived payload here.
insert into activation_input values ('{"fixtureKind": "rollback_only_machine_activation", "draft": {"schemaVersion": 1, "candidateKind": "fictional_structured_draft", "itemKey": "fictional-period-2025", "observation": {"seriesId": "fictional-share", "geography": "fictional-country", "period": "2025", "unit": "percent", "value": "27.4", "semanticContractSha256": "384873de62112650e70258bfb0053b778e576d0b6d9f7ffc11de7ea8ebccb806"}, "decision": {"disposition": "shadow_only", "policyId": "fictional-policy-v1", "qualificationId": "fictional-qualification-v1", "sourceVersionId": "22222222-2222-4222-8222-222222222222", "contentSha256": "cf4513639b2c0f00712bf13de660126a9f5bded178db205ce728e83e4c910a93", "semanticContractSha256": "384873de62112650e70258bfb0053b778e576d0b6d9f7ffc11de7ea8ebccb806", "publicCitationUrl": "https://example.org/fictional-table", "locator": "series=fictional-share;geography=fictional-country;period=2025"}, "publication": {"id": "92bb9213-05e0-550a-8b99-cbf65e786609", "issueId": "718863b9-75b8-572b-9184-3bc18a13658a", "revision": 1, "kind": "draft", "previousPublicationId": null, "snapshot": {"schemaVersion": 1, "jurisdictionSlug": "fictional-country", "issueSlug": "fictional-share", "title": "Fictional share observation", "summary": "A page draft calculated from invented source bytes. No fact about a real country is stated.", "lastEvidenceReviewOn": "2026-09-28", "claims": [{"id": "b1f330c7-1fb0-5d43-ac78-efa58fd46800", "type": "condition", "assertion": "In 2025, the fictional share was 27.4%.", "periodLabel": "2025", "evidence": [{"sourceVersionId": "22222222-2222-4222-8222-222222222222", "publisher": "Fictional statistics office", "title": "Fictional housing table", "url": "https://example.org/fictional-table", "locator": "series=fictional-share;geography=fictional-country;period=2025", "relation": "supports", "sourcePublishedOn": null, "retrievedAt": "2026-09-28T06:00:00Z"}]}]}, "dependencyManifest": {"sourceVersionIds": ["22222222-2222-4222-8222-222222222222"]}}}, "requestFingerprint": "676b3852b486fcd26c7d31118ef0ac0ed7bf3a69d62e208b3d46282a44dc2ebe", "runId": "11111111-1111-4111-8111-111111111111", "requestKey": "fictional:manual:2026w40", "sourceKey": "fictional-source", "retrievalUrl": "https://example.org/fictional-table/data?format=json", "parserVersion": "fictional-parser-v1", "qualificationExpiresAt": "2027-01-01T00:00:00+00:00", "decidedAt": "2026-09-28T06:01:00+00:00", "checkTrace": {"source_version_current": true, "evidence_locator_verified": true, "identity_resolved": true, "fields_dates_units_verified": true, "semantics_qualified": true, "no_material_conflict": true, "public_snapshot_consistent": true, "expected_predecessor_current": true, "no_sensitive_data": true}, "reasonCodes": ["qualified_checks_passed"]}'::jsonb);

insert into terra_private.jurisdictions
  (id, display_name, coverage_state, public_slug)
values ('fictional-activation-country', 'Fictional country', 'published', 'fictional-country');
insert into terra_private.issue_dossiers
  (id, jurisdiction_id, issue_key, title, affected_population,
   selection_rationale, editorial_state, public_slug)
select (payload #>> '{draft,publication,issueId}')::uuid,
  'fictional-activation-country', 'fictional-share', 'Fictional share observation',
  'Invented group', 'Rollback-only structural test', 'accepted', 'fictional-share'
from activation_input;
insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint, registration_state,
   allow_fetch, allow_public_derived, fetch_enabled, reviewed_at)
select '33333333-3333-4333-8333-333333333333', payload->>'sourceKey',
  payload #>> '{draft,publication,snapshot,claims,0,evidence,0,publisher}',
  payload->>'retrievalUrl', 'approved', true, true, true,
  '2026-09-28T05:00:00Z'::timestamptz from activation_input;
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
select (payload #>> '{draft,decision,sourceVersionId}')::uuid,
  '33333333-3333-4333-8333-333333333333', payload #>> '{draft,itemKey}',
  payload->>'retrievalUrl',
  (payload #>> '{draft,publication,snapshot,claims,0,evidence,0,retrievedAt}')::timestamptz,
  payload #>> '{draft,decision,contentSha256}' from activation_input;
insert into terra_private.source_display_reviews
  (source_version_id, revision, decision, display_title, title_language,
   reviewed_at, review_reference)
select (payload #>> '{draft,decision,sourceVersionId}')::uuid, 1, 'accepted',
  payload #>> '{draft,publication,snapshot,claims,0,evidence,0,title}', 'en',
  '2026-09-28T06:00:10Z'::timestamptz, 'fictional-template-only'
from activation_input;
insert into terra_private.automatic_route_qualifications
  (id, registration_id, change_class, revision, decision, exact_endpoint,
   policy_version, parser_version, decision_reference, decided_by, decided_at,
   qualification_expires_at, reviewed_sample_count, unresolved_sample_errors,
   semantic_contract_sha256, public_citation_url)
select '77777777-7777-4777-8777-777777777777',
  '33333333-3333-4333-8333-333333333333', 'structured_observation', 1,
  'qualified', payload->>'retrievalUrl', payload #>> '{draft,decision,policyId}',
  payload->>'parserVersion', 'fictional-template-only', 'fictional-test-owner',
  '2026-09-28T05:30:00Z'::timestamptz,
  (payload->>'qualificationExpiresAt')::timestamptz, 3, 0,
  payload #>> '{draft,decision,semanticContractSha256}',
  payload #>> '{draft,decision,publicCitationUrl}' from activation_input;
insert into terra_private.update_runs
 (id,request_key,request_fingerprint,jurisdiction_id,requested_by,mode,run_state,
  code_version,policy_version,limits,created_at)
 select (payload->>'runId')::uuid,payload->>'requestKey',payload->>'requestFingerprint',
 'fictional-activation-country','runner:fictional','publish_eligible','queued',
 'local-rehearsal-v1',payload #>> '{draft,decision,policyId}',
 '{"actor_id":"runner:fictional","code_version":"local-rehearsal-v1","limits":{"max_duration_seconds":300,"max_items":30,"max_model_calls":0,"max_model_input_tokens":0,"max_model_output_tokens":0,"max_response_bytes":2000000,"max_retries":1,"month_cap_usd":"0","run_cap_usd":"0"},"mode":"publish_eligible","policy_version":"fictional-policy-v1","scheduled_due_at":null,"scope":"fictional-activation-country","strategy":"incremental","trigger":"manual"}'::jsonb->'limits','2026-09-28T06:00:00Z'::timestamptz from activation_input;
insert into terra_private.update_run_requests(run_id,canonical_request,admitted_at)
 select (payload->>'runId')::uuid,'{"actor_id":"runner:fictional","code_version":"local-rehearsal-v1","limits":{"max_duration_seconds":300,"max_items":30,"max_model_calls":0,"max_model_input_tokens":0,"max_model_output_tokens":0,"max_response_bytes":2000000,"max_retries":1,"month_cap_usd":"0","run_cap_usd":"0"},"mode":"publish_eligible","policy_version":"fictional-policy-v1","scheduled_due_at":null,"scope":"fictional-activation-country","strategy":"incremental","trigger":"manual"}','2026-09-28T06:00:00Z'::timestamptz from activation_input;
create temporary table owned_work_claim(response jsonb not null);
insert into owned_work_claim select terra_private.claim_update_run_work(
 (payload->>'runId')::uuid,payload->>'requestFingerprint','99999999-9999-4999-8999-999999999999')
 from activation_input;
insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,
      source_version_id,content_sha256,outcome,total_response_bytes,work_claim_id)
      select (payload->>'runId')::uuid,'33333333-3333-4333-8333-333333333333',payload->>'sourceKey',
        '22222222-2222-4222-8222-222222222222'::uuid,'cf4513639b2c0f00712bf13de660126a9f5bded178db205ce728e83e4c910a93','captured',256,(response->>'leaseId')::uuid
        from activation_input,owned_work_claim;
    insert into terra_private.update_run_manifests(run_id,canonical_manifest,manifest_sha256,work_claim_id)
      select (payload->>'runId')::uuid,'{"items":[{"itemKey":"fictional-period-2025","sourceKey":"fictional-source","sourceVersionId":"22222222-2222-4222-8222-222222222222"}],"mode":"publish_eligible","requestFingerprint":"676b3852b486fcd26c7d31118ef0ac0ed7bf3a69d62e208b3d46282a44dc2ebe","runId":"11111111-1111-4111-8111-111111111111","schemaVersion":1,"sources":[{"contentSha256":"cf4513639b2c0f00712bf13de660126a9f5bded178db205ce728e83e4c910a93","registrationId":"33333333-3333-4333-8333-333333333333","sourceKey":"fictional-source","sourceVersionId":"22222222-2222-4222-8222-222222222222"}]}',encode(sha256(convert_to('{"items":[{"itemKey":"fictional-period-2025","sourceKey":"fictional-source","sourceVersionId":"22222222-2222-4222-8222-222222222222"}],"mode":"publish_eligible","requestFingerprint":"676b3852b486fcd26c7d31118ef0ac0ed7bf3a69d62e208b3d46282a44dc2ebe","runId":"11111111-1111-4111-8111-111111111111","schemaVersion":1,"sources":[{"contentSha256":"cf4513639b2c0f00712bf13de660126a9f5bded178db205ce728e83e4c910a93","registrationId":"33333333-3333-4333-8333-333333333333","sourceKey":"fictional-source","sourceVersionId":"22222222-2222-4222-8222-222222222222"}]}','UTF8')),'hex'),
        (response->>'leaseId')::uuid from activation_input,owned_work_claim;
    insert into terra_private.machine_candidate_decisions
  (id, run_id, qualification_id, source_version_id, candidate_key, disposition,
   content_sha256, evidence_locator, semantic_contract_sha256, check_trace,
   reason_codes, machine_actor, decided_at, public_citation_url)
select '88888888-8888-4888-8888-888888888888', (payload->>'runId')::uuid,
  '77777777-7777-4777-8777-777777777777',
  (payload #>> '{draft,decision,sourceVersionId}')::uuid,
  payload #>> '{draft,itemKey}', 'held',
  payload #>> '{draft,decision,contentSha256}', payload #>> '{draft,decision,locator}',
  payload #>> '{draft,decision,semanticContractSha256}', payload->'checkTrace',
  array['qualified_checks_passed'], 'runner:fictional',
  (payload->>'decidedAt')::timestamptz,
  payload #>> '{draft,decision,publicCitationUrl}' from activation_input;
insert into terra_private.issue_heads (issue_id)
select (payload #>> '{draft,publication,issueId}')::uuid from activation_input;

do $stage$
declare
 p jsonb;
 publication jsonb;
 snap jsonb;
 manifest jsonb;
 claim jsonb;
 pub_id uuid;
 fixture_issue_id uuid;
 fixture_claim_id uuid;
 v terra_private.source_versions%rowtype;
 d terra_private.machine_candidate_decisions%rowtype;
 at_time timestamptz:='2026-09-28T06:02:00Z';
begin
 select payload into p from activation_input;
 publication:=p #> '{draft,publication}';
 snap:=publication->'snapshot'; manifest:=publication->'dependencyManifest';
 claim:=snap #> '{claims,0}'; pub_id:=(publication->>'id')::uuid;
 fixture_issue_id:=(publication->>'issueId')::uuid; fixture_claim_id:=(claim->>'id')::uuid;
 select * into v from terra_private.source_versions where id=(p #>> '{draft,decision,sourceVersionId}')::uuid;
 select * into d from terra_private.machine_candidate_decisions where id='88888888-8888-4888-8888-888888888888';
  insert into terra_private.claims
    (id, issue_id, claim_type, assertion, period_start, period_end,
     period_precision, evidence_state, created_at)
  values (fixture_claim_id, fixture_issue_id, 'condition', claim->>'assertion',
    ((claim->>'periodLabel')||'-01-01')::date,
    ((claim->>'periodLabel')||'-12-31')::date, 'year', 'supported', at_time);
  insert into terra_private.claim_evidence
    (claim_id, source_version_id, locator, relation, origin_group)
  values (fixture_claim_id, v.id, d.evidence_locator, 'supports', 'fictional-original');
  insert into terra_private.issue_publications
    (id, issue_id, revision, publication_kind, snapshot, dependency_manifest, created_at)
  values (pub_id, fixture_issue_id, 1, 'accepted', snap, manifest, at_time);
  insert into terra_private.issue_publication_citations
    (publication_id, issue_id, claim_id, source_version_id, locator, relation)
  values (pub_id, fixture_issue_id, fixture_claim_id, v.id, d.evidence_locator, 'supports');
  -- These accepted-looking records are machine-generated fictional fixture
  -- assertions. They do not establish a trusted real reviewer or writer.
  insert into terra_private.claim_assertion_reviews
    (publication_id, claim_id, revision, decision, claim_type,
     display_assertion, reviewed_at, review_reference)
  values (pub_id, fixture_claim_id, 1, 'accepted', 'condition', claim->>'assertion',
    at_time, 'fictional-template-only');
  insert into terra_private.claim_period_reviews
    (publication_id, claim_id, revision, decision, period_label, reviewed_at, review_reference)
  values (pub_id, fixture_claim_id, 1, 'accepted', claim->>'periodLabel',
    at_time, 'fictional-template-only');
  insert into terra_private.issue_text_reviews
    (publication_id, revision, decision, display_title, display_summary,
     reviewed_at, review_reference)
  values (pub_id, 1, 'accepted', snap->>'title', snap->>'summary',
    at_time, 'fictional-template-only');

end;
$stage$;

create temporary table expected_activation_identity(publication_sha256 text not null);
insert into expected_activation_identity select terra_private.machine_publication_hash(p)
 from terra_private.issue_publications p where id=(select (payload #>> '{draft,publication,id}')::uuid from activation_input);

create temporary table checked_closeout(response jsonb);
insert into checked_closeout select terra_private.close_update_run_processing(
 (payload->>'runId')::uuid,payload->>'requestFingerprint',(response->>'leaseId')::uuid,
 (select manifest_sha256 from terra_private.update_run_manifests where run_id=(payload->>'runId')::uuid))
 from activation_input,owned_work_claim;

select is((select response->>'status' from checked_closeout),'closed','Resolved held case closes');
select is((select response #>> '{summary,runState}' from checked_closeout),'completed','Processing can finish with a resolved hold');
select is((select response #>> '{summary,visibilityState}' from checked_closeout),'not_required','No activation means no visibility claim');
select is((select response #>> '{summary,commitState}' from checked_closeout),'none','Staging is not a committed publication');
select is((select response #>> '{summary,heldItems}' from checked_closeout),'1','Hold counted exactly once');
select is((select response #> '{summary,pendingItemKeys}' from checked_closeout),'[]'::jsonb,'No missing item hidden');
select is((select finished_at from terra_private.update_runs),(select finished_at from terra_private.update_run_closeouts),'Same exact finished time');
select throws_ok('update terra_private.update_run_manifests set canonical_manifest=canonical_manifest',
 '23514','Automatic decision records are append-only','Captured plan cannot change');
select throws_ok('delete from terra_private.update_run_manifests',
 '23514','Automatic decision records are append-only','Captured plan cannot disappear');
select throws_ok('update terra_private.update_run_closeouts set summary=summary',
 '23514','Automatic decision records are append-only','Processing receipt cannot change');
select throws_ok('delete from terra_private.update_run_closeouts',
 '23514','Automatic decision records are append-only','Processing receipt cannot disappear');
select throws_ok('update terra_private.update_run_source_checks set checked_at=checked_at',
 '23514','Automatic decision records are append-only','Source check cannot change');
select throws_ok('delete from terra_private.update_run_source_checks',
 '23514','Automatic decision records are append-only','Fresh source check cannot disappear');
select throws_ok('update terra_private.update_runs set run_state=''running'',finished_at=null',
 '23514','Closed processing run is immutable','Finished work cannot be reopened');
select throws_ok('delete from terra_private.update_runs',
 '23514','Closed processing run is immutable','Finished run cannot disappear');
set constraints terra_private.run_closeout_commit_guard immediate;
select pass('Deferred closeout guard agrees with finished run and current lease');
select * from finish();
rollback;
