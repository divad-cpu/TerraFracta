"""One-shot fresh checks and decision/closeout races on the fixed replay.

Uses the retained first publication and its unchanged source version. Creates
two new invented runs and observes both real lock orderings. No new fact,
reset, primary mutation, credential, connection argument or real collection.
"""

from dataclasses import replace
from datetime import datetime, timezone
import json
import subprocess
import sys

from scripts.check_machine_activation_concurrency import Session
from scripts.check_run_admission_concurrency import quote
from scripts.check_run_completion_commit import ARGS, CONTAINER, NETWORK, PORT, STATE, query, wait_for_block
from scripts.fictional_run_admission_cases import fictional_request
from scripts.fictional_run_completion import fictional_completion_manifest
from workers.update_request_identity import canonical_update_request, identify_update_request
from workers.update_run_completion import DecisionReceipt, canonical_run_manifest, reconcile_run_completion
from workers.update_run_closeout import parse_run_closeout


def make_run(session: Session, name: str):
    request = replace(fictional_request(), request_key="fictional:completion:" + name,
                      scope="fictional-activation-country", mode="publish_eligible")
    identity = identify_update_request(request)
    admitted = json.loads(session.execute("select terra_private.admit_update_run(" + quote(request.request_key) + "," +
        quote(canonical_update_request(request)) + ");", "ADMITTED")[0])
    assert admitted["status"] == "admitted" and admitted["requestFingerprint"] == identity.request_fingerprint
    run_id = admitted["runId"]
    work = json.loads(session.execute("select terra_private.claim_update_run_work(" + quote(run_id) + "," +
        quote(identity.request_fingerprint) + ",gen_random_uuid());", "CLAIMED")[0])
    assert work["status"] == "claimed"
    plan = replace(fictional_completion_manifest(), run_id=run_id, request_fingerprint=identity.request_fingerprint)
    source = plan.sources[0]
    capture = """insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,
       source_version_id,content_sha256,outcome,total_response_bytes,work_claim_id)
       values(%RUN%,%REG%,%KEY%,%VERSION%,%HASH%,'unchanged',512,%LEASE%);
       insert into terra_private.update_run_manifests(run_id,canonical_manifest,manifest_sha256,work_claim_id)
       values(%RUN%,%MANIFEST%,encode(sha256(convert_to(%MANIFEST%,'UTF8')),'hex'),%LEASE%);
    """
    for key, value in {"RUN": run_id, "REG": source.registration_id, "KEY": source.source_key,
                       "VERSION": source.source_version_id, "HASH": source.content_sha256,
                       "LEASE": work["leaseId"], "MANIFEST": canonical_run_manifest(plan)}.items():
        capture = capture.replace("%" + key + "%", quote(value))
    session.execute("begin;" + capture + "commit;", "CAPTURED")
    assert query("select count(*) from terra_private.source_versions;") == "1"
    return plan, work


def held_decision_sql(plan):
    return """insert into terra_private.machine_candidate_decisions(run_id,qualification_id,source_version_id,
        candidate_key,disposition,content_sha256,evidence_locator,check_trace,reason_codes,machine_actor,
        decided_at,semantic_contract_sha256,public_citation_url)
        select %RUN%,qualification_id,source_version_id,candidate_key,'held',content_sha256,evidence_locator,
         check_trace,array['fictional-completion-race'],machine_actor,clock_timestamp(),semantic_contract_sha256,
         public_citation_url from terra_private.machine_candidate_decisions
        where id='88888888-8888-4888-8888-888888888888';
    """.replace("%RUN%", quote(plan.run_id))


def main() -> int:
    if sys.argv[1:]:
        raise RuntimeError("Fixed one-shot completion races accept no arguments")
    metadata = json.loads(subprocess.run(["docker", "inspect", "--format",
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',
        CONTAINER], text=True, capture_output=True, check=True, timeout=10).stdout)
    assert metadata["ports"]["5432/tcp"] == [{"HostIp": "127.0.0.1", "HostPort": PORT}]
    assert set(metadata["networks"]) == {NETWORK}
    assert json.loads(query(STATE)) == {"migrations": 30, "runs": 1, "versions": 1, "decisions": 1,
        "manifests": 1, "closeouts": 1, "activations": 1, "heads": 1}
    assert query("select count(*) from terra_private.update_run_source_checks;") == "0", \
        "Requires the preserved first checkpoint; never erase evidence to repeat races"
    a, b = Session(ARGS), Session(ARGS)
    try:
        settings = "set statement_timeout='15s';set lock_timeout='10s';"
        a.execute(settings, "AREADY"); b.execute(settings, "BREADY")
        a_pid = int(a.execute("select pg_backend_pid();", "APID")[0])
        b_pid = int(b.execute("select pg_backend_pid();", "BPID")[0])
        for name, writer_first in (("decision-first", True), ("closeout-first", False)):
            plan, work = make_run(a, name)
            call = "select terra_private.close_update_run_processing(" + ",".join(map(quote, (
                plan.run_id, plan.request_fingerprint, work["leaseId"],
                reconcile_run_completion(plan, (), (), (), now=datetime.now(timezone.utc)).manifest_sha256))) + ");"
            insertion = held_decision_sql(plan)
            if writer_first:
                a.execute("begin;" + insertion, "DECISIONLOCKED")
                b.send("begin;" + call, "WAITINGCLOSEOUT")
                wait_for_block(b_pid, a_pid)
                a.execute("commit;", "DECISIONCOMMITTED")
                receipt = json.loads(b.until("WAITINGCLOSEOUT")[0])
                decision_id = query("select id from terra_private.machine_candidate_decisions where run_id=" + quote(plan.run_id) + ";")
                pure = reconcile_run_completion(plan, (DecisionReceipt(decision_id, plan.items[0].item_key,
                    plan.items[0].source_version_id, "held"),), (), (), now=datetime.now(timezone.utc))
                parsed = parse_run_closeout(json.dumps(receipt).encode(), plan, work["leaseId"], pure,
                    started_at=datetime.fromisoformat(work["observedAt"]), now=datetime.now(timezone.utc))
                assert parsed.summary.run_state == "completed" and parsed.summary.held_items == 1
                b.execute("commit;", "CLOSEOUTCOMMITTED")
                print("PASS decision first: closeout waits for the actual decision commit and includes its resolved hold.", flush=True)
            else:
                receipt = json.loads(a.execute("begin;" + call, "CLOSEOUTLOCKED")[0])
                b.execute("""create function pg_temp.try_late_decision() returns text language plpgsql as $test$
                   begin %INSERT% return 'unexpected_success'; exception when check_violation then return 'held'; end;
                   $test$;""".replace("%INSERT%", insertion), "DENIALREADY")
                b.send("select pg_temp.try_late_decision();", "WAITINGDECISION")
                wait_for_block(b_pid, a_pid)
                a.execute("commit;", "CLOSEOUTCOMMITTED")
                assert b.until("WAITINGDECISION") == ["held"]
                pure = reconcile_run_completion(plan, (), (), (), now=datetime.now(timezone.utc))
                parsed = parse_run_closeout(json.dumps(receipt).encode(), plan, work["leaseId"], pure,
                    started_at=datetime.fromisoformat(work["observedAt"]), now=datetime.now(timezone.utc))
                assert parsed.summary.run_state == "partial" and parsed.summary.pending_item_keys == (plan.items[0].item_key,)
                assert query("select count(*) from terra_private.machine_candidate_decisions where run_id=" + quote(plan.run_id) + ";") == "0"
                print("PASS closeout first: late decision waits, then is held; missing work and original receipt remain intact.", flush=True)
            assert query("select count(*) from terra_private.source_versions;") == "1"
        assert json.loads(query(STATE)) == {"migrations": 30, "runs": 3, "versions": 1, "decisions": 2,
            "manifests": 3, "closeouts": 3, "activations": 1, "heads": 1}
        assert query("select count(*) from terra_private.update_run_source_checks;") == "2"
        print("Two actual lock-order races and fresh unchanged checks passed; two new fictional run receipts retained, original fact preserved.", flush=True)
    finally:
        b.close(); a.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
