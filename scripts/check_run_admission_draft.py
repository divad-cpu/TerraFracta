"""Fixed rollback-only owner admission tests; no arbitrary connection or commit."""

from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys

from scripts.fictional_run_admission_cases import admission_cases, sql_fixture_values
from scripts.fictional_run_admission_cases import fictional_request
from workers.update_run_admission import parse_run_admission


ROOT = Path(__file__).resolve().parents[1]
PRIMARY = ("supabase_db_terrafracta-local", "terrafracta-local-loopback", "65432")
ISOLATED = ("supabase_db_terrafracta-runner27-20260930",
            "terrafracta-runner27-loopback-20260930", "64232")
BASELINE = """select jsonb_build_object(
 'migrations',(select count(*) from supabase_migrations.schema_migrations),
 'runs',(select count(*) from terra_private.update_runs),
 'requests',to_regclass('terra_private.update_run_requests'),
 'admission',to_regprocedure('terra_private.admit_update_run(text,text)'),
 'versions',(select count(*) from terra_private.source_versions),
 'decisions',(select count(*) from terra_private.machine_candidate_decisions),
 'bindings',(select count(*) from terra_private.issue_publication_machine_bindings),
 'publications',(select count(*) from terra_private.issue_publications),
 'heads',(select count(*) from terra_private.issue_heads),
 'reader_oid','terra_private.read_issue_candidate(text,text)'::regprocedure::oid,
 'reader_member',pg_has_role('postgres','terra_issue_reader','MEMBER'));
"""


def query(container: str, sql: str) -> str:
    args = ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres",
            "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]
    result = subprocess.run(args, input=sql, capture_output=True, text=True, timeout=40)
    if result.returncode or len(result.stdout) > 512 * 1024:
        errors = [line for line in result.stderr.splitlines() if line.startswith("ERROR:")]
        raise RuntimeError("Rollback admission check failed: " + "; ".join(errors)[-500:])
    return result.stdout.strip()


def main() -> int:
    isolated = sys.argv[1:] == ["--isolated"]
    installed = sys.argv[1:] == ["--installed"]
    if sys.argv[1:] and not (isolated or installed):
        raise RuntimeError("Only fixed isolated or installed rollback modes are supported.")
    container, network, port = ISOLATED if isolated else PRIMARY
    inspected = subprocess.run(["docker", "inspect", "--format",
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',
        container], capture_output=True, text=True, check=True, timeout=10)
    metadata = json.loads(inspected.stdout)
    assert metadata["ports"]["5432/tcp"] == [{"HostIp":"127.0.0.1","HostPort":port}]
    assert set(metadata["networks"]) == {network}
    before = json.loads(query(container,BASELINE))
    assert before["migrations"] == (28 if installed else 27)
    assert (before["requests"] is not None) == installed
    assert (before["admission"] is not None) == installed
    assert all(before[key] == 0 for key in ("runs","versions","decisions","bindings","publications","heads")), \
        "Fixed rehearsal requires an empty data baseline; never reset an existing volume."
    overlay = "" if installed else (ROOT/"research/pending/TF009_run_admission.sql").read_text()
    outside = re.sub(r"--[^\n]*", "", overlay)
    outside = re.sub(r"(\$[A-Za-z_0-9]*\$)[\s\S]*?\1", "''", outside)
    assert not re.search(r"(?:^|;)\s*(?:begin|commit|rollback|abort|end|prepare\s+transaction)\b",outside,re.I|re.M)
    assert not re.search(r"^\s*\\",outside,re.M)
    fixture = (ROOT/"research/pending/TF009_run_admission.test.sql").read_text()
    assert fixture.count("-- TF_RUN_ADMISSION_OVERLAY") == 1
    assert fixture.count("-- TF_RUN_ADMISSION_CASES") == 1
    fixture=fixture.replace("-- TF_RUN_ADMISSION_OVERLAY",overlay)
    fixture=fixture.replace("-- TF_RUN_ADMISSION_CASES",sql_fixture_values())
    try:
        tap=query(container,fixture)
        passed=len(re.findall(r"^ok \d+\b",tap,re.M))
        plan=re.search(r"^1\.\.(\d+)$",tap,re.M)
        assert plan and int(plan.group(1)) == passed, tap
        assert passed >= len(admission_cases())+30, tap
        assert not re.search(r"^not ok|^# (?:Looks like|Failed)",tap,re.M),tap
        receipts=re.findall(r"^TF_ADMISSION_RECEIPT:(.+)$",tap,re.M)
        assert len(receipts)==1
        observed=parse_run_admission(receipts[0].encode("utf-8"),fictional_request())
        assert observed.status=="admitted" and observed.commit_state=="none"
        print(f"PASS {passed} pgTAP checks, including {len(admission_cases())} cross-language request cases.")
    finally:
        assert json.loads(query(container,BASELINE)) == before, \
            "Migration count, rows, function presence and reader authority must be restored."
    print("Queued-run identity, retry, denial, immutable bounds and late-failure rollback verified.")
    print(f"All test objects and rows rolled back; {before['migrations']}-migration baseline unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
