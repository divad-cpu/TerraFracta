"""One-shot fictional commit on the fixed, empty controls rehearsal only.

Checks the private candidate before COMMIT, observes an actual competing lock
wait and reads the committed projection. Refuses reuse; preserves test volume.
No primary, real source, application writer, credentials or public deployment.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time

from scripts.check_machine_activation_concurrency import Session
from scripts.check_machine_activation_draft import validate_result
from scripts.fictional_staged_machine_publication import staged_machine_publication_sql, ACTIVATE_SQL
from scripts.check_run_admission_concurrency import quote


CONTAINER = "supabase_db_terrafracta-controls28-20260930"
NETWORK = "terrafracta-controls28-loopback-20260930"
PORT = "64432"
ARGS = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]
STATE = """select jsonb_build_object(
 'migrations',(select count(*) from supabase_migrations.schema_migrations),
 'runs',(select count(*) from terra_private.update_runs),
 'versions',(select count(*) from terra_private.source_versions),
 'publications',(select count(*) from terra_private.issue_publications),
 'bindings',(select count(*) from terra_private.issue_publication_machine_bindings),
 'activations',(select count(*) from terra_private.machine_publication_activations),
 'activeHeads',(select count(*) from terra_private.issue_heads where current_publication_id is not null));"""


def query(sql: str) -> str:
    response = subprocess.run(ARGS, input=sql, text=True, capture_output=True, timeout=15)
    if response.returncode or len(response.stdout) > 256 * 1024:
        raise RuntimeError("Fixed fictional commit check failed; preserve test evidence")
    return response.stdout.strip()


def main() -> int:
    if sys.argv[1:]:
        raise RuntimeError("Fixed one-shot fictional commit accepts no arguments")
    metadata = json.loads(subprocess.run(["docker", "inspect", "--format",
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',
        CONTAINER], check=True, text=True, capture_output=True, timeout=10).stdout)
    assert metadata["ports"]["5432/tcp"] == [{"HostIp": "127.0.0.1", "HostPort": PORT}]
    assert set(metadata["networks"]) == {NETWORK}
    before = json.loads(query(STATE))
    assert before == {"migrations": 29, "runs": 0, "versions": 0, "publications": 0,
                      "bindings": 0, "activations": 0, "activeHeads": 0}, \
        "Requires the empty preserved controls rehearsal; never reset for reruns"
    a, b = Session(ARGS), Session(ARGS)
    try:
        settings = "set statement_timeout='15s';set lock_timeout='10s';"
        a.execute(settings + "begin;" + staged_machine_publication_sql() + "commit;", "STAGED")
        b.execute(settings, "READY")
        meta = json.loads(a.execute("""select jsonb_build_object(
          'expected',jsonb_build_object('publicationId',payload #>> '{draft,publication,id}',
          'decisionId','88888888-8888-4888-8888-888888888888','runId',payload->>'runId',
          'requestFingerprint',payload->>'requestFingerprint','publicationSha256',publication_sha256),
          'leaseId',response->>'leaseId')
          from activation_input,expected_activation_identity,owned_work_claim;""", "META")[0])
        first = json.loads(a.execute("begin;" + ACTIVATE_SQL, "ACTIVATED")[0])
        checked = validate_result(first, meta["expected"])
        assert checked["kind"] == "candidate" and checked["visibilityState"] == "pending"
        assert checked["issue"]["claims"][0]["assertion"] == "In 2025, the fictional share was 27.4%."
        assert checked["issue"]["claims"][0]["evidence"][0]["url"] == "https://example.org/fictional-table"
        outside = json.loads(query(STATE))
        assert outside["activations"] == outside["bindings"] == outside["activeHeads"] == 0
        print("PASS pre-commit materialization: checked fictional fact and citation; other session sees no activation.", flush=True)
        expected = meta["expected"]
        call = "select terra_private.activate_machine_publication(" + ",".join([
            quote(expected["publicationId"]), quote(expected["decisionId"]), "null",
            quote(expected["requestFingerprint"]), quote(meta["leaseId"]),
            quote(expected["publicationSha256"])]) + ");"
        a_pid = int(a.execute("select pg_backend_pid();", "APID")[0])
        b_pid = int(b.execute("select pg_backend_pid();", "BPID")[0])
        b.send("begin;" + call, "SECOND")
        deadline = time.monotonic() + 3
        while query(f"select {a_pid}=any(pg_blocking_pids({b_pid}));") != "t":
            assert time.monotonic() < deadline, "Actual competing activation lock wait not observed"
            time.sleep(0.05)
        a.execute("commit;", "COMMITTED")
        second = json.loads(b.until("SECOND")[0])
        replay = validate_result(second, expected)
        assert replay == {"kind": "receipt", "status": "already_activated",
                          "visibilityState": "pending", "currentHeadMatches": True}
        b.execute("commit;", "REPLAYED")
        print("PASS competing activation: waits for actual commit, returns original receipt, adds no second activation.", flush=True)
        candidate = json.loads(query("select terra_private.read_issue_candidate('fictional-country','fictional-share');"))
        after = dict(first, candidate=candidate)
        assert validate_result(after, expected) == checked
        print("PASS committed read: exact checked projection, invented 27.4% fact, distinct display citation.", flush=True)
        # Same receipt remains a history acknowledgement after work has expired.
        expiry = datetime.fromisoformat(json.loads(a.execute(
            "select response from owned_work_claim;", "WORK")[0])["leaseExpiresAt"])
        remaining = (expiry - datetime.now(timezone.utc)).total_seconds()
        if remaining > 0:
            print("Checking retained receipt after its original 30-second work lease expires.", flush=True)
            time.sleep(min(remaining + 0.05, 31))
        history = json.loads(b.execute(call, "HISTORY")[0])
        assert validate_result(history, expected) == replay
        assert json.loads(query(STATE)) == {"migrations": 29, "runs": 1, "versions": 1,
            "publications": 1, "bindings": 1, "activations": 1, "activeHeads": 1}
        print("PASS expired-work replay: acknowledges immutable history without renewing work or claiming visibility.", flush=True)
    finally:
        a.close()
        b.close()
    print("Retained one fictional publication in isolated test volume. Primary and application remain unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
