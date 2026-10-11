"""Stage one existing parsed fictional fact for owner-only activation tests.

Reuses the old transaction fixture's seed and staging statements; does not
invoke its temporary activation writer. No connection, real bytes or commit.
"""

from dataclasses import replace
from pathlib import Path
import json

from scripts.fictional_activation_payload import fictional_activation_payload
from scripts.fictional_run_admission_cases import fictional_request
from workers.update_request_identity import canonical_update_request,identify_update_request


ROOT=Path(__file__).resolve().parents[1]


def staged_machine_publication_sql(*,duration: int=300,expiry_sql: str|None=None,
                                   scenario: str="standard") -> str:
    payload=fictional_activation_payload(distinct_public_target=True,scenario=scenario)
    request=replace(fictional_request(),request_key=payload["requestKey"],
        scope="fictional-activation-country",mode="publish_eligible",
        limits=replace(fictional_request().limits,max_duration_seconds=duration))
    canonical=canonical_update_request(request)
    identity=identify_update_request(request)
    payload["requestFingerprint"]=identity.request_fingerprint
    original=(ROOT/"tests/fixtures/tf009_machine_activation_bridge.sql").read_text()
    prefix=original[:original.index("-- This receipt demonstrates transaction membership only.")]
    assert prefix.startswith("--") and prefix.count("begin;")==1
    prefix=prefix.replace("begin;","",1).replace("grant terra_issue_reader to postgres;","")
    prefix=prefix.replace("TF-ACTIVATION-FICTIONAL","fictional-activation-country")
    prefix=prefix.replace("-- TF_ACTIVATION_INPUT","insert into activation_input values ('"+
        json.dumps(payload).replace("'","''")+"'::jsonb);")
    start=prefix.index("insert into terra_private.update_runs")
    end=prefix.index("insert into terra_private.machine_candidate_decisions",start)
    replacement="""insert into terra_private.update_runs
 (id,request_key,request_fingerprint,jurisdiction_id,requested_by,mode,run_state,
  code_version,policy_version,limits,created_at)
 select (payload->>'runId')::uuid,payload->>'requestKey',payload->>'requestFingerprint',
 'fictional-activation-country','runner:fictional','publish_eligible','queued',
 'local-rehearsal-v1',payload #>> '{draft,decision,policyId}',
 %CANONICAL%::jsonb->'limits','2026-09-28T06:00:00Z'::timestamptz from activation_input;
insert into terra_private.update_run_requests(run_id,canonical_request,admitted_at)
 select (payload->>'runId')::uuid,%CANONICAL%,'2026-09-28T06:00:00Z'::timestamptz from activation_input;
create temporary table owned_work_claim(response jsonb not null);
insert into owned_work_claim select terra_private.claim_update_run_work(
 (payload->>'runId')::uuid,payload->>'requestFingerprint','99999999-9999-4999-8999-999999999999')
 from activation_input;
""".replace("%CANONICAL%","'"+canonical.replace("'","''")+"'")
    prefix=prefix[:start]+replacement+prefix[end:]
    if expiry_sql is not None:
        # Private fixture-building parameter, never CLI or source-controlled SQL.
        assert expiry_sql in {"clock_timestamp()+interval '1 second'",
                              "'2026-09-30T12:00:00Z'::timestamptz"}
        marker="(payload->>'qualificationExpiresAt')::timestamptz"
        assert prefix.count(marker)==1
        prefix=prefix.replace(marker,expiry_sql)
    body=original[original.index("  insert into terra_private.claims\n"):original.index("  -- TF_MACHINE_BINDING_INSERT")]
    staging="""do $stage$
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
%BODY%
end;
$stage$;
""".replace("%BODY%",body)
    return prefix+staging+"""
create temporary table expected_activation_identity(publication_sha256 text not null);
insert into expected_activation_identity select terra_private.machine_publication_hash(p)
 from terra_private.issue_publications p where id=(select (payload #>> '{draft,publication,id}')::uuid from activation_input);
"""


ACTIVATE_SQL="""select terra_private.activate_machine_publication(
 (payload #>> '{draft,publication,id}')::uuid,'88888888-8888-4888-8888-888888888888',
 null,payload->>'requestFingerprint',(response->>'leaseId')::uuid,publication_sha256)
 from activation_input,owned_work_claim,expected_activation_identity;
"""
