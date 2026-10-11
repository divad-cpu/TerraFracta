-- Prepared standalone fictional test candidate; requires specific timeline migration consent.
-- This is an owner-driven, fictional transaction fixture, never a migration.
-- Its temporary activation function and every row/role change roll back.
begin;
set local statement_timeout = '20s';
set local lock_timeout = '3s';
grant terra_issue_reader to postgres;
create temporary table activation_input (payload jsonb not null);
-- The runner inserts exactly one fixed, Python-derived payload here.
insert into activation_input values ('{"fixtureKind": "rollback_only_machine_activation", "draft": {"schemaVersion": 1, "candidateKind": "fictional_structured_draft", "itemKey": "fictional-period-2025", "observation": {"seriesId": "fictional-share", "geography": "fictional-country", "period": "2025", "unit": "percent", "value": "27.4", "semanticContractSha256": "384873de62112650e70258bfb0053b778e576d0b6d9f7ffc11de7ea8ebccb806"}, "decision": {"disposition": "shadow_only", "policyId": "fictional-policy-v1", "qualificationId": "fictional-qualification-v1", "sourceVersionId": "22222222-2222-4222-8222-222222222222", "contentSha256": "cf4513639b2c0f00712bf13de660126a9f5bded178db205ce728e83e4c910a93", "semanticContractSha256": "384873de62112650e70258bfb0053b778e576d0b6d9f7ffc11de7ea8ebccb806", "publicCitationUrl": "https://example.org/fictional-table", "locator": "series=fictional-share;geography=fictional-country;period=2025"}, "publication": {"id": "92bb9213-05e0-550a-8b99-cbf65e786609", "issueId": "718863b9-75b8-572b-9184-3bc18a13658a", "revision": 1, "kind": "draft", "previousPublicationId": null, "snapshot": {"schemaVersion": 1, "jurisdictionSlug": "fictional-country", "issueSlug": "fictional-share", "title": "Fictional share observation", "summary": "A page draft calculated from invented source bytes. No fact about a real country is stated.", "lastEvidenceReviewOn": "2026-09-28", "claims": [{"id": "b1f330c7-1fb0-5d43-ac78-efa58fd46800", "type": "condition", "assertion": "In 2025, the fictional share was 27.4%.", "periodLabel": "2025", "evidence": [{"sourceVersionId": "22222222-2222-4222-8222-222222222222", "publisher": "Fictional statistics office", "title": "Fictional housing table", "url": "https://example.org/fictional-table", "locator": "series=fictional-share;geography=fictional-country;period=2025", "relation": "supports", "sourcePublishedOn": null, "retrievedAt": "2026-09-28T06:00:00Z"}]}]}, "dependencyManifest": {"sourceVersionIds": ["22222222-2222-4222-8222-222222222222"]}}}, "requestFingerprint": "581338fb6ac1d8bcc89509843cce91f92cb8b86903dd02c78fcf9c28485c180b", "runId": "11111111-1111-4111-8111-111111111111", "requestKey": "fictional:manual:2026w40", "sourceKey": "fictional-source", "retrievalUrl": "https://example.org/fictional-table/data?format=json", "parserVersion": "fictional-parser-v1", "qualificationExpiresAt": "2027-01-01T00:00:00+00:00", "decidedAt": "2026-09-28T06:01:00+00:00", "checkTrace": {"source_version_current": true, "evidence_locator_verified": true, "identity_resolved": true, "fields_dates_units_verified": true, "semantics_qualified": true, "no_material_conflict": true, "public_snapshot_consistent": true, "expected_predecessor_current": true, "no_sensitive_data": true}, "reasonCodes": ["qualified_checks_passed"]}'::jsonb);

insert into terra_private.jurisdictions
  (id, display_name, coverage_state, public_slug)
values ('TF-ACTIVATION-FICTIONAL', 'Fictional country', 'published', 'fictional-country');
insert into terra_private.issue_dossiers
  (id, jurisdiction_id, issue_key, title, affected_population,
   selection_rationale, editorial_state, public_slug)
select (payload #>> '{draft,publication,issueId}')::uuid,
  'TF-ACTIVATION-FICTIONAL', 'fictional-share', 'Fictional share observation',
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
  (id, request_key, request_fingerprint, jurisdiction_id, requested_by,
   mode, run_state, policy_version, created_at)
select (payload->>'runId')::uuid, payload->>'requestKey',
  payload->>'requestFingerprint', 'TF-ACTIVATION-FICTIONAL', 'runner:fictional',
  'publish_eligible', 'running', payload #>> '{draft,decision,policyId}',
  '2026-09-28T06:00:00Z'::timestamptz from activation_input;
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

-- This receipt demonstrates transaction membership only. It is temporary,
-- owner-written and has no durable audit or authenticated writer authority.
create temporary table activation_receipts (
  decision_id uuid primary key,
  publication_id uuid not null,
  input_payload jsonb not null,
  activated_at timestamptz not null
);

create function pg_temp.activate_fictional(
  p jsonb, expected_head uuid, at_time timestamptz, fail_after_write boolean default false
) returns jsonb
language plpgsql
set search_path = pg_catalog, pg_temp
as $fixture$
declare
  d terra_private.machine_candidate_decisions%rowtype;
  q terra_private.automatic_route_qualifications%rowtype;
  s terra_private.source_registrations%rowtype;
  v terra_private.source_versions%rowtype;
  r terra_private.update_runs%rowtype;
  h terra_private.issue_heads%rowtype;
  display_review terra_private.source_display_reviews%rowtype;
  prior activation_receipts%rowtype;
  publication jsonb := p #> '{draft,publication}';
  snap jsonb := publication->'snapshot';
  manifest jsonb := publication->'dependencyManifest';
  claim jsonb := snap #> '{claims,0}';
  evidence jsonb := claim #> '{evidence,0}';
  pub_id uuid := (publication->>'id')::uuid;
  fixture_issue_id uuid := (publication->>'issueId')::uuid;
  fixture_claim_id uuid := (claim->>'id')::uuid;
  latest_version uuid;
begin
  if p is null or expected_head is not null and at_time is null
     or at_time is null or fail_after_write is null then
    raise exception 'activation_input_held' using errcode='23514';
  end if;
  -- Follow the source -> run lock order of existing qualification/decision
  -- guards. Real writers need the same discipline; this fixture is not one.
  select * into d from terra_private.machine_candidate_decisions
    where id='88888888-8888-4888-8888-888888888888';
  select * into q from terra_private.automatic_route_qualifications
    where id=d.qualification_id;
  select * into s from terra_private.source_registrations
    where id=q.registration_id for update;
  select * into v from terra_private.source_versions
    where id=d.source_version_id for update;
  select * into r from terra_private.update_runs where id=d.run_id for update;
  perform 1 from terra_private.jurisdictions
    where id=r.jurisdiction_id and coverage_state='published'
      and public_slug=snap->>'jurisdictionSlug' for update;
  if not found then raise exception 'route_held' using errcode='23514'; end if;
  perform 1 from terra_private.issue_dossiers
    where id=fixture_issue_id and jurisdiction_id=r.jurisdiction_id
      and editorial_state='accepted' and public_slug=snap->>'issueSlug' for update;
  if not found then raise exception 'route_held' using errcode='23514'; end if;
  select * into h from terra_private.issue_heads
    where issue_heads.issue_id=fixture_issue_id for update;
  select id into latest_version from terra_private.source_versions
    where registration_id=s.id and item_key=v.item_key
    order by retrieved_at desc, id desc limit 1;
  select * into display_review from terra_private.source_display_reviews
    where source_version_id=v.id order by revision desc limit 1;
  if d.id is null or q.id is null or s.id is null or v.id is null or r.id is null
     or h.issue_id is null or d.disposition<>'eligible'
     or s.registration_state<>'approved' or not s.allow_fetch
     or not s.fetch_enabled or not s.allow_public_derived
     or s.reviewed_at is null or s.exact_endpoint<>q.exact_endpoint
     or v.source_url<>q.exact_endpoint or v.registration_id<>s.id
     or latest_version is distinct from v.id or v.content_sha256<>d.content_sha256
     or q.decision<>'qualified' or q.revision<>(select max(revision)
       from terra_private.automatic_route_qualifications
       where registration_id=s.id and change_class=q.change_class)
     or q.qualification_expires_at is null or at_time>=q.qualification_expires_at
     or at_time<d.decided_at or q.reviewed_sample_count is null or q.reviewed_sample_count<3
     or q.unresolved_sample_errors is distinct from 0
     or q.semantic_contract_sha256 is distinct from d.semantic_contract_sha256
     or q.public_citation_url is distinct from d.public_citation_url
     or r.mode<>'publish_eligible' or r.policy_version is distinct from q.policy_version
     or r.request_fingerprint is distinct from p->>'requestFingerprint'
     or r.request_key is distinct from p->>'requestKey'
     or r.id is distinct from (p->>'runId')::uuid then
    raise exception 'current_authority_held' using errcode='23514';
  end if;
  if display_review.source_version_id is null or display_review.decision<>'accepted'
     or display_review.display_title is distinct from evidence->>'title'
     or display_review.title_language<>'en' or display_review.reviewed_at>at_time then
    raise exception 'source_display_held' using errcode='23514';
  end if;
  if p->>'fixtureKind'<>'rollback_only_machine_activation'
     or publication->>'kind'<>'draft' or publication->>'revision'<>'1'
     or publication->'previousPublicationId'<>'null'::jsonb
     or not terra_private.is_closed_public_issue_payload(snap, manifest)
     or jsonb_array_length(snap->'claims')<>1
     or jsonb_array_length(claim->'evidence')<>1
     or manifest<>jsonb_build_object('sourceVersionIds', jsonb_build_array(v.id))
     or claim->>'type'<>'condition' or evidence->>'relation'<>'supports'
     or (evidence->>'sourceVersionId')::uuid<>v.id
     or evidence->>'locator' is distinct from d.evidence_locator
     or evidence->>'url' is distinct from d.public_citation_url
     
     or evidence->>'publisher' is distinct from s.publisher
     or (evidence->>'retrievedAt')::timestamptz<>v.retrieved_at
     or claim->>'periodLabel' is distinct from p #>> '{draft,observation,period}'
     or claim->>'assertion' is distinct from format(
       'In %s, the fictional share was %s%%.',
       p #>> '{draft,observation,period}', p #>> '{draft,observation,value}')
     or p #>> '{draft,decision,contentSha256}' is distinct from d.content_sha256
     or p #>> '{draft,decision,sourceVersionId}' is distinct from d.source_version_id::text
     or p #>> '{draft,decision,locator}' is distinct from d.evidence_locator
     or p #>> '{draft,decision,publicCitationUrl}' is distinct from d.public_citation_url
     or p #>> '{draft,itemKey}' is distinct from d.candidate_key
     or p->>'sourceKey' is distinct from s.source_key
     or p->>'retrievalUrl' is distinct from q.exact_endpoint
     or p->>'parserVersion' is distinct from q.parser_version
     or p #>> '{draft,decision,policyId}' is distinct from q.policy_version
     or p #>> '{draft,observation,seriesId}' is distinct from 'fictional-share'
     or p #>> '{draft,observation,geography}' is distinct from 'fictional-country'
     or p #>> '{draft,observation,unit}' is distinct from 'percent'
     or p #>> '{draft,observation,semanticContractSha256}' is distinct from d.semantic_contract_sha256 then
    raise exception 'selected_evidence_held' using errcode='23514';
  end if;
  select * into prior from activation_receipts where decision_id=d.id;
  if found then
    if prior.input_payload is distinct from p or prior.publication_id<>pub_id
       or h.current_publication_id is distinct from pub_id
       or r.run_state<>'completed' or r.commit_state<>'committed' then
      raise exception 'replay_mismatch_held' using errcode='23514';
    end if;
    return jsonb_build_object('status','already_activated','publicationId',pub_id);
  end if;
  if h.current_publication_id is distinct from expected_head
     or expected_head is not null or r.run_state<>'running'
     or r.commit_state<>'none' then
    raise exception 'head_or_run_held' using errcode='23514';
  end if;

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
  insert into terra_private.issue_publication_machine_bindings (publication_id,claim_id,decision_id) values(pub_id,fixture_claim_id,d.id);
  update terra_private.issue_heads set current_publication_id=pub_id, changed_at=at_time
    where issue_heads.issue_id=fixture_issue_id;
  update terra_private.update_runs set run_state='completed', commit_state='committed',
    visibility_state='pending', finished_at=at_time where id=r.id;
  insert into activation_receipts values (d.id, pub_id, p, at_time);
  if fail_after_write then
    raise exception 'injected_late_failure' using errcode='23514';
  end if;
  return jsonb_build_object('status','activated','publicationId',pub_id);
end;
$fixture$;
revoke all on function pg_temp.activate_fictional(jsonb, uuid, timestamptz, boolean) from public;

create function pg_temp.try_fictional_activation(
  p jsonb, expected_head uuid default null,
  at_time timestamptz default '2026-09-28T06:02:00Z', fail_after_write boolean default false
) returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp
as $fixture$
begin
  return pg_temp.activate_fictional(p, expected_head, at_time, fail_after_write);
exception when check_violation then
  -- The exception block rolls back all writes made by the activation call.
  return jsonb_build_object('status','held','reason',sqlerrm);
end;
$fixture$;
revoke all on function pg_temp.try_fictional_activation(jsonb, uuid, timestamptz, boolean) from public;

create extension if not exists pgtap with schema extensions;
select plan(5);
savepoint positive;
select is((select pg_temp.try_fictional_activation(payload)->>'status' from activation_input),'activated','ordered qualification can still activate fictionally');
rollback to positive;
release savepoint positive;
select throws_ok($test$insert into terra_private.machine_candidate_decisions
 (run_id,qualification_id,source_version_id,candidate_key,disposition,content_sha256,
  evidence_locator,semantic_contract_sha256,check_trace,reason_codes,machine_actor,
  decided_at,public_citation_url)
 select run_id,qualification_id,source_version_id,'future-decision','eligible',content_sha256,
  evidence_locator,semantic_contract_sha256,check_trace,reason_codes,machine_actor,
  transaction_timestamp()+interval '1 day',public_citation_url
 from terra_private.machine_candidate_decisions$test$,
 '23514','Machine qualification timeline is invalid','future eligible decision is refused');
select ok(not has_function_privilege('terra_issue_reader',
 'terra_private.check_machine_qualification_timeline_insert()','EXECUTE'),'reader cannot invoke decision helper');
select ok(not has_function_privilege('terra_issue_reader',
 'terra_private.check_publication_qualification_timeline_insert()','EXECUTE'),'reader cannot invoke binding helper');
select ok(not has_function_privilege('anon',
 'terra_private.check_publication_qualification_timeline_insert()','EXECUTE'),'anonymous helper access refused');
select * from finish();
rollback;
