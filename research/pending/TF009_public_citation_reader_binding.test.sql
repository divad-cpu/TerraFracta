-- Requires only the fixed rollback fixture; not an active Supabase test file.
create extension if not exists pgtap with schema extensions;
select plan(27);
select lives_ok($$select pg_temp.try_fictional_activation(payload) from activation_input$$,
  'fixed parsed fictional observation activates under the draft binding');
select is((select count(*)::int from terra_private.issue_publication_machine_bindings),1,
  'one exact decision-to-publication binding exists only inside the test');
select is(terra_private.read_issue_candidate('fictional-country','fictional-share')
  #>> '{citations,0,machine_binding,publicCitationUrl}', 'https://example.org/fictional-table',
  'reader returns the separately qualified public target');
select is(terra_private.read_issue_candidate('fictional-country','fictional-share')
  #>> '{sources,0,version,source_url}', 'https://example.org/fictional-table/data?format=json',
  'reader preserves the exact retrieval URL in its private candidate');
select ok(terra_private.read_issue_candidate('fictional-country','fictional-share')::text
  not like '%fictional-template-only%', 'private qualification and review references are absent');
select is((select count(*)::int from jsonb_object_keys(
  terra_private.read_issue_candidate('fictional-country','fictional-share')
    #> '{citations,0,machine_binding}')),11,'binding has only the eleven selected consistency fields');
select throws_ok($$update terra_private.issue_publication_machine_bindings
  set linked_at=linked_at+interval '1 second'$$,'23514','Automatic decision records are append-only',
  'binding cannot be rewritten');
select throws_ok($$delete from terra_private.issue_publication_machine_bindings$$,
  '23514','Automatic decision records are append-only','binding cannot be deleted');
select ok(not has_table_privilege('anon','terra_private.issue_publication_machine_bindings','SELECT'),
  'anonymous callers cannot read bindings');
select ok(not has_table_privilege('service_role','terra_private.issue_publication_machine_bindings','SELECT'),
  'service role gains no direct binding access');
select ok(not has_table_privilege('terra_operator','terra_private.issue_publication_machine_bindings','INSERT'),
  'operator has no binding writer');
select ok(not has_table_privilege('terra_collector','terra_private.issue_publication_machine_bindings','INSERT'),
  'collector cannot activate its own observation');
select ok(has_function_privilege('terra_issue_reader','terra_private.read_issue_candidate(text,text)','EXECUTE'),
  'NOLOGIN reader retains only the outer entry point');
select ok(not has_function_privilege('terra_issue_reader','terra_private.read_issue_candidate_without_machine_bindings(text,text)','EXECUTE'),
  'renamed wrapper cannot bypass the selected binding');
select ok(not has_function_privilege('terra_reviewer','terra_private.read_issue_candidate_without_machine_bindings(text,text)','EXECUTE'),
  'reviewer cannot call the retained wrapper');
select ok((select relrowsecurity from pg_catalog.pg_class
  where oid='terra_private.issue_publication_machine_bindings'::regclass),'binding table has RLS');
select ok(not has_function_privilege('anon','terra_private.check_publication_machine_binding_insert()','EXECUTE'),
  'anonymous caller cannot execute the insert guard');
select ok(not has_function_privilege('terra_issue_reader','terra_private.check_publication_machine_binding_insert()','EXECUTE'),
  'reader cannot execute the insert guard');

-- Restore a fictional running state only to isolate the insert guard below.
-- This is owner-only test setup, not a replay or live writer operation.
update terra_private.update_runs set run_state='running',commit_state='none',
  visibility_state='not_required',finished_at=null where requested_by='runner:fictional';
select lives_ok($$insert into terra_private.machine_candidate_decisions
 (id,run_id,qualification_id,source_version_id,candidate_key,disposition,content_sha256,
  evidence_locator,check_trace,reason_codes,machine_actor,decided_at)
 select '99999999-9999-4999-8999-999999999999',run_id,qualification_id,source_version_id,
  'fictional-held', 'held',content_sha256,evidence_locator,'{}'::jsonb,array['fictional-held'],
  'runner:fictional',decided_at from terra_private.machine_candidate_decisions
 where id='88888888-8888-4888-8888-888888888888'$$,'held decisions remain recordable');
select throws_ok($$insert into terra_private.issue_publication_machine_bindings
 (publication_id,claim_id,decision_id)
 select publication_id,claim_id,'99999999-9999-4999-8999-999999999999'
 from terra_private.issue_publication_machine_bindings$$,
 '23514','Publication machine authority is not current','held decision cannot bind a public claim');

savepoint rights_case;
update terra_private.source_registrations set allow_public_derived=false where source_key='fictional-source';
select throws_ok($$insert into terra_private.issue_publication_machine_bindings
 select publication_id,claim_id,decision_id,linked_at from terra_private.issue_publication_machine_bindings$$,
 '23514','Publication machine authority is not current','rights loss is rechecked before binding');
rollback to rights_case;
release savepoint rights_case;

savepoint target_case;
update terra_private.issue_publications set snapshot=jsonb_set(snapshot,
 '{claims,0,evidence,0,url}','"https://example.org/substituted"');
select throws_ok($$insert into terra_private.issue_publication_machine_bindings
 select publication_id,claim_id,decision_id,linked_at from terra_private.issue_publication_machine_bindings$$,
 '23514','Publication machine evidence is not selected','substituted snapshot URL is refused');
rollback to target_case;
release savepoint target_case;

savepoint hash_case;
update terra_private.source_versions set content_sha256=repeat('f',64) where item_key='fictional-period-2025';
select throws_ok($$insert into terra_private.issue_publication_machine_bindings
 select publication_id,claim_id,decision_id,linked_at from terra_private.issue_publication_machine_bindings$$,
 '23514','Publication machine authority is not current','changed receipt hash is refused');
rollback to hash_case;
release savepoint hash_case;

savepoint rights_time_case;
update terra_private.source_registrations set reviewed_at=transaction_timestamp()+interval '1 day'
 where source_key='fictional-source';
select throws_ok($$insert into terra_private.issue_publication_machine_bindings
 select publication_id,claim_id,decision_id,linked_at from terra_private.issue_publication_machine_bindings$$,
 '23514','Publication machine authority is not current','future rights review cannot authorize current activation');
rollback to rights_time_case;
release savepoint rights_time_case;

savepoint infinite_window_case;
insert into terra_private.automatic_route_qualifications
 (id,registration_id,change_class,revision,decision,exact_endpoint,policy_version,parser_version,
  decision_reference,decided_by,decided_at,qualification_expires_at,reviewed_sample_count,
  unresolved_sample_errors,semantic_contract_sha256,public_citation_url)
select '66666666-6666-4666-8666-666666666666',registration_id,change_class,2,'qualified',
 exact_endpoint,policy_version,parser_version,'fictional-infinite','fictional-test-owner',
 '2026-09-28T06:00:30Z','infinity'::timestamptz,3,0,semantic_contract_sha256,public_citation_url
from terra_private.automatic_route_qualifications where revision=1;
insert into terra_private.machine_candidate_decisions
 (id,run_id,qualification_id,source_version_id,candidate_key,disposition,content_sha256,
  evidence_locator,semantic_contract_sha256,check_trace,reason_codes,machine_actor,
  decided_at,public_citation_url)
select '55555555-5555-4555-8555-555555555555',run_id,
 '66666666-6666-4666-8666-666666666666',source_version_id,'fictional-infinite',
 'eligible',content_sha256,evidence_locator,semantic_contract_sha256,check_trace,reason_codes,
 machine_actor,'2026-09-28T06:01:10Z',public_citation_url
from terra_private.machine_candidate_decisions where id='88888888-8888-4888-8888-888888888888';
select throws_ok($$insert into terra_private.issue_publication_machine_bindings
 (publication_id,claim_id,decision_id)
 select publication_id,claim_id,'55555555-5555-4555-8555-555555555555'
 from terra_private.issue_publication_machine_bindings$$,
 '23514','Publication machine authority is not current','infinite qualification window is refused');
rollback to infinite_window_case;
release savepoint infinite_window_case;

savepoint expiry_case;
insert into terra_private.automatic_route_qualifications
 (id,registration_id,change_class,revision,decision,exact_endpoint,policy_version,parser_version,
  decision_reference,decided_by,decided_at,qualification_expires_at,reviewed_sample_count,
  unresolved_sample_errors,semantic_contract_sha256,public_citation_url)
select '66666666-6666-4666-8666-666666666666',registration_id,change_class,2,'qualified',
 exact_endpoint,policy_version,parser_version,'fictional-expired','fictional-test-owner',
 '2026-09-28T06:00:30Z','2026-09-29T00:00:00Z',3,0,semantic_contract_sha256,public_citation_url
from terra_private.automatic_route_qualifications where revision=1;
insert into terra_private.machine_candidate_decisions
 (id,run_id,qualification_id,source_version_id,candidate_key,disposition,content_sha256,
  evidence_locator,semantic_contract_sha256,check_trace,reason_codes,machine_actor,
  decided_at,public_citation_url)
select '55555555-5555-4555-8555-555555555555',run_id,
 '66666666-6666-4666-8666-666666666666',source_version_id,'fictional-backdated',
 'eligible',content_sha256,evidence_locator,semantic_contract_sha256,check_trace,reason_codes,
 machine_actor,'2026-09-28T06:01:10Z',public_citation_url
from terra_private.machine_candidate_decisions where id='88888888-8888-4888-8888-888888888888';
select throws_ok($$insert into terra_private.issue_publication_machine_bindings
 (publication_id,claim_id,decision_id,linked_at)
 select publication_id,claim_id,'55555555-5555-4555-8555-555555555555','2026-09-28T06:02:00Z'
 from terra_private.issue_publication_machine_bindings$$,
 '23514','Publication machine authority is not current','backdated link cannot bypass expiry at transaction time');
rollback to expiry_case;
release savepoint expiry_case;
select is((select count(*)::int from terra_private.issue_publication_machine_bindings),1,
 'failed attempts preserve the original selected binding');
select * from finish();
