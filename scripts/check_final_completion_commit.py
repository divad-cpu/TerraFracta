"""One-shot corrected capture/activation/closeout on the fixed final replay.

Complements the preserved early commit and races with one complete corrected
path. No primary, real source, credential, arbitrary target or reset.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

from scripts.check_machine_activation_concurrency import Session
from scripts.check_machine_activation_draft import validate_result
from scripts.check_run_admission_draft import query as owner_query
from scripts.fictional_run_completion import CLOSE_SQL, fictional_completion_manifest, staged_completion_sql
from scripts.fictional_staged_machine_publication import ACTIVATE_SQL
from workers.update_run_closeout import parse_run_closeout
from workers.update_run_completion import ActivationReceipt, DecisionReceipt, reconcile_run_completion


CONTAINER = "supabase_db_terrafracta-completion-final-20260930"
NETWORK = "terrafracta-completion-final-loopback-20260930"
ARGS = ["docker","exec","-i",CONTAINER,"psql","-U","postgres","-d","postgres","-X","-qAt","-v","ON_ERROR_STOP=1"]
STATE = """select jsonb_build_object('migrations',(select count(*) from supabase_migrations.schema_migrations),
 'runs',(select count(*) from terra_private.update_runs),'versions',(select count(*) from terra_private.source_versions),
 'checks',(select count(*) from terra_private.update_run_source_checks),
 'manifests',(select count(*) from terra_private.update_run_manifests),
 'activations',(select count(*) from terra_private.machine_publication_activations),
 'closeouts',(select count(*) from terra_private.update_run_closeouts),
 'heads',(select count(*) from terra_private.issue_heads where current_publication_id is not null));"""


def main() -> int:
    if sys.argv[1:]:
        raise RuntimeError("Fixed final commit accepts no arguments")
    meta = json.loads(subprocess.run(["docker","inspect","--format",
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',CONTAINER],
        text=True,capture_output=True,check=True,timeout=10).stdout)
    assert meta["ports"]["5432/tcp"] == [{"HostIp":"127.0.0.1","HostPort":"64832"}]
    assert set(meta["networks"]) == {NETWORK}
    before = json.loads(owner_query(CONTAINER,STATE))
    assert before == {"migrations":29,"runs":0,"versions":0,"checks":0,"manifests":0,"activations":0,"closeouts":0,"heads":0}, \
        "Requires the empty final replay; never reset or replace existing evidence"
    evidence = Path("/tmp/terrafracta-completion-final-committed-evidence-20260930.json")
    assert not evidence.exists()
    a = Session(ARGS)
    try:
        a.execute("set statement_timeout='15s';set lock_timeout='10s';begin;" + staged_completion_sql() + "commit;", "CAPTURED")
        expected = json.loads(a.execute("""select jsonb_build_object('activation',jsonb_build_object(
          'publicationId',payload #>> '{draft,publication,id}','decisionId','88888888-8888-4888-8888-888888888888',
          'runId',payload->>'runId','requestFingerprint',payload->>'requestFingerprint','publicationSha256',publication_sha256),
          'workClaimId',response->>'leaseId','startedAt',(select started_at from terra_private.update_run_work_state))
          from activation_input,owned_work_claim,expected_activation_identity;""","EXPECTED")[0])
        result = json.loads(a.execute("begin;" + ACTIVATE_SQL,"ACTIVATED")[0])
        checked = validate_result(result,expected["activation"])
        assert json.loads(owner_query(CONTAINER,STATE))["activations"] == 0
        a.execute("commit;","ACTIVATIONCOMMITTED")
        assert json.loads(owner_query(CONTAINER,STATE))["activations"] == 1
        receipt = json.loads(a.execute("begin;" + CLOSE_SQL,"CLOSED")[0])
        manifest = fictional_completion_manifest()
        trusted = reconcile_run_completion(manifest,(DecisionReceipt(expected["activation"]["decisionId"],
            manifest.items[0].item_key,manifest.items[0].source_version_id,"eligible"),),
            (ActivationReceipt(expected["activation"]["publicationId"],expected["activation"]["decisionId"],
             expected["activation"]["publicationSha256"],datetime.fromisoformat(result["activatedAt"])),),(),now=datetime.now(timezone.utc))
        parsed = parse_run_closeout(json.dumps(receipt).encode(),manifest,expected["workClaimId"],trusted,
            started_at=datetime.fromisoformat(expected["startedAt"]),now=datetime.now(timezone.utc))
        assert parsed.summary.visibility_state == "pending" and parsed.summary.commit_state == "committed"
        assert json.loads(owner_query(CONTAINER,STATE))["closeouts"] == 0
        a.execute("commit;","CLOSEOUTCOMMITTED")
        after = json.loads(owner_query(CONTAINER,STATE))
        assert after == {"migrations":29,"runs":1,"versions":1,"checks":1,"manifests":1,"activations":1,"closeouts":1,"heads":1}
        candidate = json.loads(owner_query(CONTAINER,"select terra_private.read_issue_candidate('fictional-country','fictional-share');"))
        assert validate_result({**result,"candidate":candidate},expected["activation"]) == checked
        with evidence.open("x") as handle:
            evidence.chmod(0o600)
            json.dump({"evidenceKind":"corrected_isolated_fictional_completion","state":after,"closeout":receipt,
                       "checkedDatabaseProjection":checked},handle,indent=2)
        print("PASS corrected full path: one fresh check, one fixed manifest, one separately committed activation and one committed processing closeout.")
        print("PASS independent post-commit database read and strict expectations; four website views remain explicitly pending.")
        print("Corrected fictional evidence retained privately. Primary and application permissions unchanged.")
    finally:
        a.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
