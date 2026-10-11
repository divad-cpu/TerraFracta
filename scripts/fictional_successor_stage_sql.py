"""Fixed revised-observation fixture for the retained committed rehearsal.

No connection or commit. Reuses inspected staging statements, excluding the
already-existing source/issue/qualification. Never accepts external SQL input.
"""

import json
from uuid import UUID,uuid5
from dataclasses import replace

from scripts.fictional_activation_payload import fictional_activation_payload
from scripts.fictional_staged_machine_publication import staged_machine_publication_sql
from scripts.fictional_run_admission_cases import fictional_request
from workers.update_request_identity import canonical_update_request,identify_update_request


FIRST_PUBLICATION="92bb9213-05e0-550a-8b99-cbf65e786609"
SECOND_RUN="66666666-6666-4666-8666-666666666666"
SECOND_DECISION="99999999-9999-4999-8999-999999999999"


def successor_stage_sql() -> str:
    payload=fictional_activation_payload(distinct_public_target=True,scenario="revised_value")
    request=replace(fictional_request(),request_key="fictional:revision:2026w40",
                    scope="fictional-activation-country",mode="publish_eligible")
    canonical=canonical_update_request(request)
    payload.update(runId=SECOND_RUN,requestKey=request.request_key,
                   requestFingerprint=identify_update_request(request).request_fingerprint)
    publication=payload["draft"]["publication"]
    publication.update(revision=2,kind="correction",previousPublicationId=FIRST_PUBLICATION)
    old_claim_id=publication["snapshot"]["claims"][0]["id"]
    publication["snapshot"]["claims"][0]["id"]=str(uuid5(UUID(old_claim_id),"fictional-revised-2025"))
    sql=staged_machine_publication_sql(scenario="revised_value")
    # Exact fixed sections of the inspected generator, not source-controlled SQL.
    beginning=sql[:sql.index("insert into terra_private.jurisdictions")]
    beginning=beginning[:beginning.index("insert into activation_input")]
    beginning+="insert into activation_input values ('"+json.dumps(payload).replace("'","''")+"'::jsonb);\n"
    source=sql[sql.index("insert into terra_private.source_versions"):
               sql.index("insert into terra_private.automatic_route_qualifications")]
    source=source.replace("2026-09-28T06:00:10Z","2026-09-28T06:02:10Z")
    admission="""insert into terra_private.update_runs
      (id,request_key,request_fingerprint,jurisdiction_id,requested_by,mode,run_state,
       code_version,policy_version,limits,created_at)
      select (payload->>'runId')::uuid,payload->>'requestKey',payload->>'requestFingerprint',
       'fictional-activation-country','runner:fictional','publish_eligible','queued',
       'local-rehearsal-v1',payload #>> '{draft,decision,policyId}',
       %CANONICAL%::jsonb->'limits','2026-09-28T06:02:00Z'::timestamptz from activation_input;
      insert into terra_private.update_run_requests(run_id,canonical_request,admitted_at)
       select (payload->>'runId')::uuid,%CANONICAL%,'2026-09-28T06:02:00Z'::timestamptz from activation_input;
      create temporary table owned_work_claim(response jsonb not null);
      insert into owned_work_claim select terra_private.claim_update_run_work(
       (payload->>'runId')::uuid,payload->>'requestFingerprint','99999999-9999-4999-8999-999999999999')
       from activation_input;
    """.replace("%CANONICAL%","'"+canonical.replace("'","''")+"'")
    decision=sql[sql.index("insert into terra_private.machine_candidate_decisions"):
                 sql.index("insert into terra_private.issue_heads")]
    decision=decision.replace("88888888-8888-4888-8888-888888888888",SECOND_DECISION)
    staging=sql[sql.index("do $stage$"):]
    staging=staging.replace("88888888-8888-4888-8888-888888888888",SECOND_DECISION)
    staging=staging.replace("2026-09-28T06:02:00Z","2026-09-28T06:04:00Z")
    old="(id, issue_id, revision, publication_kind, snapshot, dependency_manifest, created_at)"
    assert staging.count(old)==1
    staging=staging.replace(old,"(id, issue_id, revision, publication_kind, snapshot, dependency_manifest, created_at, predecessor_id)")
    old="values (pub_id, fixture_issue_id, 1, 'accepted', snap, manifest, at_time);"
    assert staging.count(old)==1
    staging=staging.replace(old,"values (pub_id, fixture_issue_id, 2, 'correction', snap, manifest, at_time, '"+FIRST_PUBLICATION+"');")
    return beginning+source+admission+decision+staging
