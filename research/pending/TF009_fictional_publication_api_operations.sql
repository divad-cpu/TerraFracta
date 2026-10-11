-- One separately provisioned owner fixture. No caller-controlled decision,
-- qualification, claim, publication, source URL, actor, rule or SQL input.
create function terra_publication_test_api.stage_decision()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $decision$
declare authority terra_publication_test_api.principal_scopes%rowtype;
 fixture jsonb; v terra_private.source_versions%rowtype; stamp text; public_use_allowed boolean;
begin
 authority:=terra_publication_test_api.current_scope();
 perform terra_private.assert_update_run_work(authority.run_id,
  (select request_fingerprint from terra_private.update_runs where id=authority.run_id),authority.work_claim_id);
 if exists(select 1 from terra_private.machine_candidate_decisions where run_id=authority.run_id) then
  return jsonb_build_object('stored',true);
 end if;
 select * into v from terra_private.source_versions where id=authority.source_version_id;
 if v.id is null or v.content_sha256 is distinct from authority.body_sha256
  or not exists(select 1 from terra_private.update_run_manifests where run_id=authority.run_id) then
  raise exception 'Qualified fixture has no captured work manifest' using errcode='23514';
 end if;
 select allow_public_derived into public_use_allowed from terra_private.source_registrations where id=authority.registration_id;
 fixture:=authority.trusted_fixture;
 stamp:=to_char(v.retrieved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 fixture:=jsonb_set(fixture,'{draft,publication,snapshot,claims,0,evidence,0,retrievedAt}',to_jsonb(stamp));
 -- A deliberate inconsistent display is owner fixture data for the refusal
 -- trial only. The ordinary fixture follows the actual capture date.
 if fixture->>'inconsistentDisplayTrial' is distinct from 'true' then
  fixture:=jsonb_set(fixture,'{draft,publication,snapshot,lastEvidenceReviewOn}',to_jsonb(to_char(v.retrieved_at at time zone 'UTC','YYYY-MM-DD')));
 end if;
 fixture:=jsonb_set(fixture,'{decidedAt}',to_jsonb(to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 update terra_publication_test_api.principal_scopes set trusted_fixture=fixture where principal=authority.principal;
 insert into terra_private.source_display_reviews(source_version_id,revision,decision,display_title,title_language,reviewed_at,review_reference)
 values(v.id,1,'accepted',fixture #>> '{draft,publication,snapshot,claims,0,evidence,0,title}','en',v.retrieved_at,'fixed-qualified-fictional-template');
 create temporary table activation_input(payload jsonb);
 insert into activation_input values(fixture);
 -- TF_AUTHENTICATED_DECISION_FIXTURE
 return jsonb_build_object('stored',true);
end;
$decision$;

create function terra_publication_test_api.stage_publication()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $publication$
declare authority terra_publication_test_api.principal_scopes%rowtype;
 fixture jsonb;
begin
 authority:=terra_publication_test_api.current_scope();
 perform terra_private.assert_update_run_work(authority.run_id,
  (select request_fingerprint from terra_private.update_runs where id=authority.run_id),authority.work_claim_id);
 fixture:=authority.trusted_fixture;
 if not exists(select 1 from terra_private.machine_candidate_decisions where run_id=authority.run_id and disposition='eligible') then
  raise exception 'Publication fixture has no eligible stored decision' using errcode='23514';
 end if;
 if not exists(select 1 from terra_private.issue_publications where id=(fixture #>> '{draft,publication,id}')::uuid) then
  create temporary table activation_input(payload jsonb);
  insert into activation_input values(fixture);
  -- TF_AUTHENTICATED_PUBLICATION_FIXTURE
 end if;
 return jsonb_build_object('publicationId',fixture #>> '{draft,publication,id}','decisionId','88888888-8888-4888-8888-888888888888',
  'runId',authority.run_id,'requestFingerprint',fixture->>'requestFingerprint',
  'publicationSha256',(select terra_private.machine_publication_hash(p) from terra_private.issue_publications p where id=(fixture #>> '{draft,publication,id}')::uuid));
end;
$publication$;

create function terra_publication_test_api.activate_fact()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $activate$
declare authority terra_publication_test_api.principal_scopes%rowtype;
 fixture jsonb; hash text;
begin
 authority:=terra_publication_test_api.current_scope();
 fixture:=authority.trusted_fixture;
 select terra_private.machine_publication_hash(p) into hash from terra_private.issue_publications p where id=(fixture #>> '{draft,publication,id}')::uuid;
 return terra_private.activate_machine_publication((fixture #>> '{draft,publication,id}')::uuid,
  '88888888-8888-4888-8888-888888888888',null,fixture->>'requestFingerprint',authority.work_claim_id,hash);
end;
$activate$;

create function terra_publication_test_api.read_fact()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $read$
begin
 perform terra_publication_test_api.current_scope();
 return terra_private.read_issue_candidate('fictional-country','fictional-share');
end;
$read$;
