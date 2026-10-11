"""Fixed owner-only work lease casebook with all draft objects rolled back."""

from dataclasses import replace
from datetime import datetime,timezone
import json
from pathlib import Path
import re
import sys

from scripts.check_run_admission_draft import BASELINE, PRIMARY, query
from scripts.fictional_run_admission_cases import fictional_request
from workers.update_request_identity import canonical_update_request
from workers.update_request_identity import identify_update_request
from workers.update_run_admission import RunAdmission
from workers.update_run_work import parse_work_claim
from uuid import UUID
from scripts.check_local_db_target import main as inspect_fixed_local_target


ROOT=Path(__file__).resolve().parents[1]
WORK_BASELINE="""select jsonb_build_object(
 'claims',to_regclass('terra_private.update_run_work_claims'),
 'state',to_regclass('terra_private.update_run_work_state'),
 'claim_function',to_regprocedure('terra_private.claim_update_run_work(uuid,text,uuid)'));
"""


def main() -> int:
    installed=sys.argv[1:]==["--installed"]
    if sys.argv[1:] and not installed:
        raise RuntimeError("Only the fixed installed rollback mode is supported.")
    assert inspect_fixed_local_target([])==0
    container=PRIMARY[0]
    before=(json.loads(query(container,BASELINE)),json.loads(query(container,WORK_BASELINE)))
    assert before[0]["migrations"]==(28 if installed else 27)
    assert (before[0]["requests"] is not None)==installed
    assert all(before[0][key]==0 for key in ("runs","versions","decisions","bindings","publications","heads"))
    assert all((value is not None)==installed for value in before[1].values())
    overlay="" if installed else "\n".join((ROOT/"research/pending"/name).read_text() for name in
                      ("TF009_run_admission.sql","TF009_run_work_lease.sql"))
    outside=re.sub(r"--[^\n]*","",overlay)
    outside=re.sub(r"(\$[A-Za-z_0-9]*\$)[\s\S]*?\1","''",outside)
    assert not re.search(r"(?:^|;)\s*(?:begin|commit|rollback|abort|end|prepare\s+transaction)\b",outside,re.I|re.M)
    assert not re.search(r"^\s*\\",outside,re.M)
    request=replace(fictional_request(),scope="fictional-lease-country")
    templates=[]
    for name,duration in (("standard",300),("short",1)):
        canonical=canonical_update_request(replace(request,limits=replace(request.limits,
                                                    max_duration_seconds=duration)))
        templates.append("('"+name+"','"+canonical.replace("'","''")+"')")
    fixture=(ROOT/"research/pending/TF009_run_work_lease.test.sql").read_text()
    assert fixture.count("-- TF_WORK_LEASE_OVERLAY")==1
    assert fixture.count("-- TF_WORK_LEASE_TEMPLATES")==1
    fixture=fixture.replace("-- TF_WORK_LEASE_OVERLAY",overlay)
    fixture=fixture.replace("-- TF_WORK_LEASE_TEMPLATES",
                            "insert into lease_templates values "+",".join(templates)+";")
    try:
        tap=query(container,fixture)
        passed=len(re.findall(r"^ok \d+\b",tap,re.M))
        plan=re.search(r"^1\.\.(\d+)$",tap,re.M)
        assert plan and int(plan.group(1))==passed and passed>=50,tap
        assert not re.search(r"^not ok|^# (?:Looks like|Failed)",tap,re.M),tap
        receipts=re.findall(r"^TF_WORK_CLAIM:(.+)$",tap,re.M)
        assert len(receipts)==1
        raw=json.loads(receipts[0])
        expected=replace(request,request_key="fictional:lease:normal")
        identity=identify_update_request(expected)
        admitted=RunAdmission("admitted",UUID(raw["runId"]),identity.request_key,
                              identity.request_fingerprint,"queued","none","not_required")
        observed=parse_work_claim(receipts[0].encode(),expected,admitted,datetime.now(timezone.utc))
        assert observed.status=="claimed" and observed.attempt==1
        print(f"PASS {passed} pgTAP lease acquisition/replay, renewal, expiry, takeover, fencing, deadline, retry and denial checks.")
    finally:
        after=(json.loads(query(container,BASELINE)),json.loads(query(container,WORK_BASELINE)))
        assert before==after,"Every draft object, row and reader permission must return to baseline."
    print("No authenticated writer, external calls, schedule or publication enabled.")
    print(f"Primary remains at {before[0]['migrations']} migrations; fictional claims and test objects rolled back.")
    return 0


if __name__=="__main__":
    raise SystemExit(main())
