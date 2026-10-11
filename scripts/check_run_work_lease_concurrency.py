"""One-shot work-lease races on the retained admission-only fictional replay.

Commits this test's owner-only work draft and invented run/claim evidence only
on the fixed isolated instance. No primary connection, reset, or arbitrary args.
"""

from dataclasses import replace
from datetime import datetime,timezone
import json
from pathlib import Path
import subprocess
import sys
import time

from scripts.check_machine_activation_concurrency import Session
from scripts.check_run_admission_concurrency import ARGS,CONTAINER,NETWORK,PORT,quote,query,wait_for_block
from scripts.fictional_run_admission_cases import fictional_request
from workers.update_request_identity import canonical_update_request


ROOT=Path(__file__).resolve().parents[1]
FIRST="11111111-1111-4111-8111-111111111111"
SECOND="22222222-2222-4222-8222-222222222222"


def call(run_id,fingerprint,attempt):
    return "select terra_private.claim_update_run_work("+",".join(map(quote,[run_id,fingerprint,attempt]))+");"


def main() -> int:
    if sys.argv[1:]:
        raise RuntimeError("The fixed one-shot lease race test accepts no arguments.")
    inspected=subprocess.run(["docker","inspect","--format",
       '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',
       CONTAINER],capture_output=True,text=True,check=True,timeout=10)
    metadata=json.loads(inspected.stdout)
    assert metadata["ports"]["5432/tcp"]==[{"HostIp":"127.0.0.1","HostPort":PORT}]
    assert set(metadata["networks"])=={NETWORK}
    baseline=json.loads(query("""select jsonb_build_object(
      'migrations',(select count(*) from supabase_migrations.schema_migrations),
      'runs',(select count(*) from terra_private.update_runs),
      'requests',(select count(*) from terra_private.update_run_requests),
      'work',to_regclass('terra_private.update_run_work_state'),
      'publications',(select count(*) from terra_private.issue_publications));"""))
    assert baseline=={"migrations":27,"runs":4,"requests":4,"work":None,"publications":0}, \
       "Requires the preserved admission-race checkpoint exactly; never reset to rerun."
    overlay=(ROOT/"research/pending/TF009_run_work_lease.sql").read_text()
    seed=(ROOT/"research/pending/TF009_run_work_lease.test.sql").read_text()
    seed=seed[seed.index("create temporary table lease_templates"):seed.index("select ok(c.relrowsecurity")]
    request=replace(fictional_request(),scope="fictional-lease-country")
    values=[]
    for name,duration in (("standard",300),("short",1)):
        canonical=canonical_update_request(replace(request,limits=replace(request.limits,max_duration_seconds=duration)))
        values.append("("+quote(name)+","+quote(canonical)+")")
    seed=seed.replace("-- TF_WORK_LEASE_TEMPLATES","insert into lease_templates values "+",".join(values)+";")
    settings="set statement_timeout='45s';set lock_timeout='40s';"
    a,b=Session(ARGS),Session(ARGS)
    try:
        a.execute("begin;"+overlay+seed+"commit;"+settings,"SEEDED")
        b.execute(settings+"""create function pg_temp.try_work(r uuid,f text,l uuid) returns text
          language plpgsql as $test$ begin perform terra_private.assert_update_run_work(r,f,l);
          return 'current'; exception when check_violation then return 'fenced'; end; $test$;""","READY")
        a_pid=int(a.execute("select pg_backend_pid();","APID")[0])
        b_pid=int(b.execute("select pg_backend_pid();","BPID")[0])
        for label,attempt,expected in [("same-attempt",FIRST,"existing_claim"),
                                      ("different-worker",SECOND,"busy")]:
            run_id=a.execute("select pg_temp.seed_work_run("+quote("fictional:work-race:"+label)+");","RUN")[0]
            fingerprint=query("select request_fingerprint from terra_private.update_runs where id="+quote(run_id)+";")
            first=json.loads(a.execute("begin;"+call(run_id,fingerprint,FIRST),"FIRST")[0])
            assert first["status"]=="claimed"
            b.send("begin;"+call(run_id,fingerprint,attempt),"SECOND")
            wait_for_block(b_pid,a_pid)
            a.execute("commit;","RELEASED")
            second=json.loads(b.until("SECOND")[0])
            assert second["status"]==expected
            if expected=="existing_claim":
                assert second["leaseId"]==first["leaseId"]
            else:
                assert "leaseId" not in second
            b.execute("rollback;","CLOSED")
            print(f"PASS {label}: real run-lock wait, {expected}; no second holder.",flush=True)

        run_id=a.execute("select pg_temp.seed_work_run('fictional:work-race:takeover',40,1);","EXPIRED")[0]
        fingerprint=query("select request_fingerprint from terra_private.update_runs where id="+quote(run_id)+";")
        old_lease=query("select claim_id from terra_private.update_run_work_state where run_id="+quote(run_id)+";")
        replacement=json.loads(a.execute("begin;"+call(run_id,fingerprint,SECOND),"TAKEOVER")[0])
        assert replacement["status"]=="claimed" and replacement["attempt"]==2
        b.send("begin;select pg_temp.try_work("+",".join(map(quote,[run_id,fingerprint,old_lease]))+");","FENCED")
        wait_for_block(b_pid,a_pid)
        a.execute("commit;","TAKEOVERCOMMIT")
        assert b.until("FENCED")==["fenced"]
        b.execute("rollback;","FENCEDEND")
        print("PASS takeover-versus-old-writer: stale holder waits, then fails fencing check.",flush=True)

        run_id=a.execute("select pg_temp.seed_work_run('fictional:work-race:late-commit');","LATERUN")[0]
        fingerprint=query("select request_fingerprint from terra_private.update_runs where id="+quote(run_id)+";")
        first=json.loads(a.execute("begin;"+call(run_id,fingerprint,FIRST),"LATEFIRST")[0])
        b.send("begin;"+call(run_id,fingerprint,SECOND),"LATESECOND")
        wait_for_block(b_pid,a_pid)
        expiry=datetime.fromisoformat(first["leaseExpiresAt"]).astimezone(timezone.utc)
        print("Checking one actual 30-second lease expiry while the first transaction still holds its run lock.",flush=True)
        until=time.monotonic()+33
        while datetime.now(timezone.utc)<=expiry:
            assert time.monotonic()<until
            time.sleep(0.1)
        a.execute("commit;","LATECOMMIT")
        second=json.loads(b.until("LATESECOND")[0])
        assert second["status"]=="claimed" and second["attempt"]==2 and second["leaseId"]!=first["leaseId"]
        assert datetime.fromisoformat(second["deadlineAt"])==datetime.fromisoformat(first["deadlineAt"])
        b.execute("commit;","LATEEND")
        assert b.execute("select pg_temp.try_work("+",".join(map(quote,[run_id,fingerprint,first["leaseId"]]))+");","OLDFINAL")==["fenced"]
        print("PASS actual-expiry-late-commit: waiting worker gets bounded retry; old holder cannot write.",flush=True)
    finally:
        a.close()
        b.close()
    final=json.loads(query("""select jsonb_build_object(
       'migrations',(select count(*) from supabase_migrations.schema_migrations),
       'runs',(select count(*) from terra_private.update_runs),
       'requests',(select count(*) from terra_private.update_run_requests),
       'claims',(select count(*) from terra_private.update_run_work_claims),
       'states',(select count(*) from terra_private.update_run_work_state),
       'publications',(select count(*) from terra_private.issue_publications));"""))
    assert final=={"migrations":27,"runs":8,"requests":8,"claims":6,"states":4,"publications":0},final
    print("Retained isolated test checkpoint: eight fictional admissions, six claims, four work states; zero publications.")
    print("Primary untouched; one-shot evidence must be preserved, not reset for reruns.")
    return 0


if __name__=="__main__":
    raise SystemExit(main())
