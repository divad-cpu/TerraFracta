"""Closed single-fixture publication experiment; not primary/runtime SQL.

Reuses the exact shadow identity/capture guards with an explicit separate scope
and owner-selected publication template. No LOGIN, grant or credential creation.
"""
from pathlib import Path
import re
from scripts.build_fictional_capture_api import build_capture_api
from scripts.captured_fictional_pipeline import parts
from scripts.fictional_activation_payload import fictional_activation_payload
ROOT=Path(__file__).resolve().parents[1]


def build_publication_api():
    payload=fictional_activation_payload(distinct_public_target=True)
    result=build_capture_api().replace('terra_capture_test_api','terra_publication_test_api')
    result=result.replace("scope='fictional-country'","scope='fictional-activation-country'")
    result=result.replace("r.mode<>'shadow'","r.mode<>'publish_eligible'")
    result=result.replace("m->>'mode' is distinct from 'shadow'","m->>'mode' is distinct from 'publish_eligible'")
    result=result.replace("item_key='fictional-share:2025'","item_key='"+payload['draft']['itemKey']+"'")
    result=result.replace("'fictional-response'", "'"+payload['sourceKey']+"'")
    marker=' body_bytes integer not null check(body_bytes between 1 and 65536)\n'
    assert result.count(marker)==1
    result=result.replace(marker," body_bytes integer not null check(body_bytes between 1 and 65536),\n trusted_fixture jsonb not null check(jsonb_typeof(trusted_fixture)='object')\n")
    marker=' return p;\nend;\n$scope$;'
    assert result.count(marker)==1
    result=result.replace(marker,""" if p.trusted_fixture->>'fixtureKind' is distinct from 'rollback_only_machine_activation'
  or p.trusted_fixture->>'runId' is distinct from p.run_id::text
  or p.trusted_fixture->>'requestFingerprint' is distinct from r.request_fingerprint
  or p.trusted_fixture->>'sourceKey' is distinct from s.source_key
  or p.trusted_fixture->>'retrievalUrl' is distinct from s.exact_endpoint
  or p.trusted_fixture #>> '{draft,itemKey}' is distinct from p.item_key
  or p.trusted_fixture #>> '{draft,decision,sourceVersionId}' is distinct from p.source_version_id::text
  or p.trusted_fixture #>> '{draft,decision,contentSha256}' is distinct from p.body_sha256 then
  raise exception 'Publication fixture does not match authenticated scope' using errcode='42501';
 end if;
 return p;
end;
$scope$;""")
    marker="  result:=jsonb_build_object('decisions','[]'::jsonb,'activations','[]'::jsonb,'invalidSourceKeys',terra_private.summarize_run_processing(p.run_id)->'invalidSourceKeys');"
    assert result.count(marker)==1
    result=result.replace(marker,"""  result:=jsonb_build_object('decisions',coalesce((select jsonb_agg(jsonb_build_object('decisionId',id,'itemKey',candidate_key,'sourceVersionId',source_version_id,'disposition',disposition)) from terra_private.machine_candidate_decisions where run_id=p.run_id),'[]'::jsonb),
   'activations',coalesce((select jsonb_agg(jsonb_build_object('publicationId',publication_id,'decisionId',decision_id,'publicationSha256',publication_sha256,'activatedAt',activated_at)) from terra_private.machine_publication_activations where run_id=p.run_id),'[]'::jsonb),
   'invalidSourceKeys',terra_private.summarize_run_processing(p.run_id)->'invalidSourceKeys');""")
    fixture=parts()
    # Decision uses only the stored owner template and actual source timestamps.
    decision=fixture['decision'].replace("payload #>> '{draft,itemKey}', 'eligible',","payload #>> '{draft,itemKey}', case when public_use_allowed then 'eligible' else 'held' end,").replace("array['qualified_checks_passed']","case when public_use_allowed then array['qualified_checks_passed'] else array['public_use_not_allowed'] end")
    stage=fixture['publication']
    start=stage.index('declare\n');end=stage.index('\n$stage$;')
    stage=stage[start:end].replace("at_time timestamptz:='2026-09-28T06:02:00Z';",'at_time timestamptz:=clock_timestamp();')
    stage=stage.removesuffix('end;')+'end;'
    extra=(ROOT/'research/pending/TF009_fictional_publication_api_operations.sql').read_text()
    assert extra.count('-- TF_AUTHENTICATED_DECISION_FIXTURE')==1 and extra.count('-- TF_AUTHENTICATED_PUBLICATION_FIXTURE')==1
    extra=extra.replace('-- TF_AUTHENTICATED_DECISION_FIXTURE',decision).replace('-- TF_AUTHENTICATED_PUBLICATION_FIXTURE',stage)
    original=(ROOT/'supabase/migrations/20260930151028_tf009_owner_runner_controls.sql').read_text()
    match=re.search(r'create function terra_private.check_machine_publication_activation\(\).*?\$guard\$;',original,re.S)
    assert match
    guard=match.group().replace('terra_private.check_machine_publication_activation()','terra_publication_test_api.check_activation_commit()').replace('security invoker','security definer',1)
    guard=guard.replace('begin\n',"""begin
 if session_user not in ('postgres','supabase_admin') then
  declare authority terra_publication_test_api.principal_scopes%rowtype;
  begin
   authority:=terra_publication_test_api.current_scope();
   if authority.run_id is distinct from new.run_id or authority.work_claim_id is distinct from new.work_claim_id
    or authority.trusted_fixture #>> '{draft,publication,id}' is distinct from new.publication_id::text then
    raise exception 'Publication COMMIT is outside authenticated fixture scope' using errcode='42501';
   end if;
  end;
 end if;
""",1)
    result+='\n'+extra+'\n'+guard+"""
drop trigger machine_publication_activation_commit_guard on terra_private.machine_publication_activations;
create constraint trigger machine_publication_activation_commit_guard after insert on terra_private.machine_publication_activations
 deferrable initially deferred for each row execute function terra_publication_test_api.check_activation_commit();
revoke all on all functions in schema terra_publication_test_api
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
"""
    return '-- CLOSED QUALIFIED FICTIONAL TEMPLATE ONLY. No primary/runtime authorization.\n'+result

if __name__=='__main__':print(build_publication_api(),end='')
