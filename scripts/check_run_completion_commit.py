"""One-shot invented commit and concurrent closeout on one fixed test volume.

Refuses an already-used baseline. Preserves committed fictional records and
earlier failures; never resets, targets the primary or accepts connection args.
The checked read is a database projection, not four website visibility checks.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time

from scripts.check_machine_activation_concurrency import Session
from scripts.check_machine_activation_draft import validate_result
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_run_completion import CLOSE_SQL, fictional_completion_manifest, staged_completion_sql
from scripts.fictional_staged_machine_publication import ACTIVATE_SQL
from workers.update_run_closeout import parse_run_closeout
from workers.update_run_completion import ActivationReceipt, DecisionReceipt, reconcile_run_completion


CONTAINER = "supabase_db_terrafracta-completion29-20260930"
NETWORK = "terrafracta-completion29-loopback-20260930"
PORT = "64632"
ARGS = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]
STATE = """select jsonb_build_object('migrations',(select count(*) from supabase_migrations.schema_migrations),
 'runs',(select count(*) from terra_private.update_runs),'versions',(select count(*) from terra_private.source_versions),
 'decisions',(select count(*) from terra_private.machine_candidate_decisions),
 'manifests',(select count(*) from terra_private.update_run_manifests),
 'closeouts',(select count(*) from terra_private.update_run_closeouts),
 'activations',(select count(*) from terra_private.machine_publication_activations),
 'heads',(select count(*) from terra_private.issue_heads where current_publication_id is not null));"""


def query(sql: str) -> str:
    result = subprocess.run(ARGS, input=sql, text=True, capture_output=True, timeout=15)
    if result.returncode or len(result.stdout) > 256 * 1024:
        raise RuntimeError("Fixed completion commit failed; preserve its isolated test evidence")
    return result.stdout.strip()


def wait_for_block(blocked: int, blocker: int) -> None:
    deadline = time.monotonic() + 3
    while query(f"select {blocker}=any(pg_blocking_pids({blocked}));") != "t":
        assert time.monotonic() < deadline, "A real closeout lock wait was not observed"
        time.sleep(0.05)


def main() -> int:
    if sys.argv[1:]:
        raise RuntimeError("Fixed one-shot completion commit accepts no arguments")
    metadata = json.loads(subprocess.run(["docker", "inspect", "--format",
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',
        CONTAINER], text=True, capture_output=True, check=True, timeout=10).stdout)
    assert metadata["ports"]["5432/tcp"] == [{"HostIp": "127.0.0.1", "HostPort": PORT}]
    assert set(metadata["networks"]) == {NETWORK}
    assert json.loads(query(STATE)) == {"migrations": 29, "runs": 0, "versions": 0, "decisions": 0,
        "manifests": 0, "closeouts": 0, "activations": 0, "heads": 0}, \
        "One-shot test requires the fresh empty replay; never erase data to repeat it"
    evidence = Path("/tmp/terrafracta-completion29-committed-evidence-20260930.json")
    assert not evidence.exists(), "Preserve existing completion evidence"
    a, b = Session(ARGS), Session(ARGS)
    try:
        settings = "set statement_timeout='15s';set lock_timeout='10s';"
        a.execute(settings + "begin;" + staged_completion_sql() + "commit;", "STAGED")
        b.execute(settings, "READY")
        expected = json.loads(a.execute("""select jsonb_build_object(
          'activation',jsonb_build_object('publicationId',payload #>> '{draft,publication,id}',
          'decisionId','88888888-8888-4888-8888-888888888888','runId',payload->>'runId',
          'requestFingerprint',payload->>'requestFingerprint','publicationSha256',publication_sha256),
          'workClaimId',response->>'leaseId','startedAt',(select started_at from terra_private.update_run_work_state),
          'leaseExpiresAt',response->>'leaseExpiresAt')
          from activation_input,owned_work_claim,expected_activation_identity;""", "EXPECTED")[0])
        activation = json.loads(a.execute("begin;" + ACTIVATE_SQL, "ACTIVATED")[0])
        checked = validate_result(activation, expected["activation"])
        assert checked["issue"]["claims"][0]["assertion"] == "In 2025, the fictional share was 27.4%."
        assert json.loads(query(STATE))["activations"] == 0
        a.execute("commit;", "ACTIVATIONCOMMITTED")
        assert json.loads(query(STATE))["activations"] == 1
        print("PASS activation commits separately; a second session sees exactly one stored fact and its source.", flush=True)
        manifest = fictional_completion_manifest()
        result_summary = reconcile_run_completion(manifest, (DecisionReceipt(expected["activation"]["decisionId"],
            manifest.items[0].item_key, manifest.items[0].source_version_id, "eligible"),),
            (ActivationReceipt(expected["activation"]["publicationId"], expected["activation"]["decisionId"],
             expected["activation"]["publicationSha256"], datetime.fromisoformat(activation["activatedAt"])),), (),
            now=datetime.now(timezone.utc))
        closeout = json.loads(a.execute("begin;" + CLOSE_SQL, "CLOSED")[0])
        parsed = parse_run_closeout(json.dumps(closeout).encode(), manifest, expected["workClaimId"], result_summary,
            started_at=datetime.fromisoformat(expected["startedAt"]), now=datetime.now(timezone.utc))
        assert (parsed.summary.run_state, parsed.summary.commit_state, parsed.summary.visibility_state) == (
            "partial", "committed", "pending")
        assert json.loads(query(STATE))["closeouts"] == 0
        assert query("select run_state from terra_private.update_runs;") == "running"
        a_pid = int(a.execute("select pg_backend_pid();", "APID")[0])
        b_pid = int(b.execute("select pg_backend_pid();", "BPID")[0])
        call = "select terra_private.close_update_run_processing(" + ",".join(map(quote, (
            manifest.run_id, manifest.request_fingerprint, expected["workClaimId"], result_summary.manifest_sha256))) + ");"
        b.send("begin;" + call, "COMPETING")
        wait_for_block(b_pid, a_pid)
        a.execute("commit;", "CLOSEOUTCOMMITTED")
        replay = json.loads(b.until("COMPETING")[0])
        assert replay == {**closeout, "status": "existing_closeout"}
        b.execute("commit;", "REPLAYCOMMITTED")
        after = json.loads(query(STATE))
        assert after == {"migrations": 29, "runs": 1, "versions": 1, "decisions": 1,
            "manifests": 1, "closeouts": 1, "activations": 1, "heads": 1}
        assert query("select run_state||','||commit_state||','||visibility_state from terra_private.update_runs;") == "partial,committed,pending"
        print("PASS concurrent closeout waits for the real commit and acknowledges one immutable original receipt.", flush=True)
        candidate = json.loads(query("select terra_private.read_issue_candidate('fictional-country','fictional-share');"))
        assert validate_result({**activation, "candidate": candidate}, expected["activation"]) == checked
        print("PASS committed database read matches the checked source-derived projection; website visibility remains pending.", flush=True)
        remaining = (datetime.fromisoformat(expected["leaseExpiresAt"]) - datetime.now(timezone.utc)).total_seconds()
        if remaining > 0:
            print("Checking historical closeout after its original work lease expires.", flush=True)
            time.sleep(min(remaining + 0.05, 31))
        historic = json.loads(b.execute(call, "EXPIREDREPLAY")[0])
        assert historic == replay and json.loads(query(STATE)) == after
        parsed_replay = parse_run_closeout(json.dumps(historic).encode(), manifest, expected["workClaimId"], result_summary,
            started_at=datetime.fromisoformat(expected["startedAt"]), now=datetime.now(timezone.utc))
        assert parsed_replay.finished_at == parsed.finished_at
        print("PASS expired-work replay preserves original time, stages and counts; no new work or visibility claim.", flush=True)
        # Private, exact local evidence. This is not an application credential
        # or a public fixture; the web prototype never reads this file.
        with evidence.open("x", encoding="utf-8") as handle:
            evidence.chmod(0o600)
            json.dump({"evidenceKind": "isolated_fictional_processing_closeout", "state": after,
                "activationExpected": expected["activation"], "closeout": closeout,
                "checkedDatabaseProjection": checked}, handle, indent=2)
        print("Committed fictional evidence retained privately on the separate test volume.", flush=True)
    finally:
        b.close(); a.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
