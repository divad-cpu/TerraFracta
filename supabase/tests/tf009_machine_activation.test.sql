\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

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
insert into terra_private.machine_candidate_decisions
  (id, run_id, qualification_id, source_version_id, candidate_key, disposition,
   content_sha256, evidence_locator, semantic_contract_sha256, check_trace,
   reason_codes, machine_actor, decided_at, public_citation_url)
select '88888888-8888-4888-8888-888888888888', (payload->>'runId')::uuid,
  '77777777-7777-4777-8777-777777777777',
  (payload #>> '{draft,decision,sourceVersionId}')::uuid,
  payload #>> '{draft,itemKey}', 'eligible',
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

create temporary table checked_activation(response jsonb not null);
insert into checked_activation select terra_private.activate_machine_publication(
 (payload #>> '{draft,publication,id}')::uuid,'88888888-8888-4888-8888-888888888888',
 null,payload->>'requestFingerprint',(response->>'leaseId')::uuid,publication_sha256)
 from activation_input,owned_work_claim,expected_activation_identity;


select ok(relrowsecurity,'Activation receipts have RLS') from pg_class
 where oid='terra_private.machine_publication_activations'::regclass;
select ok(not prosecdef,'Activation preserves invoker privileges') from pg_proc
 where oid='terra_private.activate_machine_publication(uuid,uuid,uuid,text,uuid,text)'::regprocedure;
select ok(not has_function_privilege(role_name,
 'terra_private.activate_machine_publication(uuid,uuid,uuid,text,uuid,text)','EXECUTE'),
 role_name||' has no activation authority')
 from unnest(array['anon','authenticated','service_role','terra_collector','terra_operator',
                   'terra_reviewer','terra_issue_reader']) roles(role_name);
select ok(not has_table_privilege(role_name,'terra_private.machine_publication_activations','INSERT'),
 role_name||' cannot insert activation receipts')
 from unnest(array['anon','authenticated','service_role','terra_collector','terra_operator',
                   'terra_reviewer','terra_issue_reader']) roles(role_name);
select ok(not exists(select 1 from pg_proc p,lateral aclexplode(p.proacl) a
 where p.oid='terra_private.activate_machine_publication(uuid,uuid,uuid,text,uuid,text)'::regprocedure
 and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC execute is revoked');
select ok(tgdeferrable and tginitdeferred and tgenabled='O','Commit guard is enabled and initially deferred')
 from pg_trigger where tgrelid='terra_private.machine_publication_activations'::regclass
 and tgname='machine_publication_activation_commit_guard';
select is(response->>'status','activated','One selected condition can activate fictionally') from checked_activation;
select is(response->>'visibilityState','pending','Activation does not claim public visibility') from checked_activation;
select is((select run_state from terra_private.update_runs limit 1),'running','One issue does not finish entire run');
select is((select commit_state from terra_private.update_runs limit 1),'partial','Group commit remains partial until run finalization');
select is((select count(*) from terra_private.machine_publication_activations),1::bigint,'One durable-style receipt is inserted');
select is((select count(*) from terra_private.issue_publication_machine_bindings),1::bigint,'One exact selected decision is bound');
select is((select count(*) from terra_private.issue_heads where current_publication_id is not null),1::bigint,'One head advances');
select throws_ok($$update terra_private.machine_publication_activations set request_fingerprint=repeat('a',64)$$,
 '23514','Automatic decision records are append-only','Activation receipt cannot be rewritten');
select throws_ok($$delete from terra_private.machine_publication_activations$$,
 '23514','Automatic decision records are append-only','Activation receipt cannot be removed');
select throws_ok($$update terra_private.issue_publications set snapshot=jsonb_set(snapshot,'{summary}','"Fictional replacement"')$$,
 '23514','Activated publication is immutable','Activated bytes require a new publication, not a rewrite');
set local time zone 'Europe/Oslo';
select is(terra_private.machine_publication_hash(p),expected.publication_sha256,
 'Publication fingerprint is independent of session time zone')
 from terra_private.issue_publications p,expected_activation_identity expected;
set local time zone 'UTC';
set constraints terra_private.machine_publication_activation_commit_guard immediate;
select pass('Final activation authority/time guard runs before rollback');
select * from finish();
rollback;
