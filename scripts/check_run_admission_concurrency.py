"""One-shot admission races on a fixed, newly isolated fictional database.

Commits only this test's owner-only draft and invented run identities to the
retained test volume. Refuses existing data; never resets or targets primary.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import time

from scripts.check_machine_activation_concurrency import Session
from scripts.check_run_admission_draft import ISOLATED
from scripts.fictional_run_admission_cases import fictional_request
from workers.update_request_identity import canonical_update_request


ROOT = Path(__file__).resolve().parents[1]
CONTAINER,NETWORK,PORT = ISOLATED
ARGS = ["docker","exec","-i",CONTAINER,"psql","-U","postgres","-d","postgres",
        "-X","-qAt","-v","ON_ERROR_STOP=1"]


def query(sql: str) -> str:
    result=subprocess.run(ARGS,input=sql,capture_output=True,text=True,timeout=15)
    if result.returncode or len(result.stdout)>256*1024:
        raise RuntimeError("Fixed isolated admission query failed; preserve test evidence.")
    return result.stdout.strip()


def quote(text: str) -> str:
    return "'"+text.replace("'","''")+"'"


def wait_for_block(waiter: int,blocker: int) -> None:
    deadline=time.monotonic()+3
    while time.monotonic()<deadline:
        if query(f"select {blocker}=any(pg_blocking_pids({waiter}));")=="t":
            return
        time.sleep(0.05)
    raise RuntimeError("The expected database lock wait was not observed.")


def main() -> int:
    if sys.argv[1:]:
        raise RuntimeError("The fixed one-shot admission rehearsal accepts no arguments.")
    inspected=subprocess.run(["docker","inspect","--format",
       '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',
       CONTAINER],capture_output=True,text=True,check=True,timeout=10)
    metadata=json.loads(inspected.stdout)
    assert metadata["ports"]["5432/tcp"]==[{"HostIp":"127.0.0.1","HostPort":PORT}]
    assert set(metadata["networks"])=={NETWORK}
    baseline=json.loads(query("""select jsonb_build_object(
      'migrations',(select count(*) from supabase_migrations.schema_migrations),
      'jurisdictions',(select count(*) from terra_private.jurisdictions),
      'runs',(select count(*) from terra_private.update_runs),
      'requests',to_regclass('terra_private.update_run_requests'),
      'publications',(select count(*) from terra_private.issue_publications));"""))
    assert baseline=={"migrations":27,"jurisdictions":0,"runs":0,"requests":None,"publications":0}, \
       "One-shot test requires the fresh empty replay; never reset to rerun."
    overlay=(ROOT/"research/pending/TF009_run_admission.sql").read_text()
    canonical=canonical_update_request(fictional_request())
    wrapped="""create function pg_temp.try_admission(k text,p text) returns jsonb
      language plpgsql as $test$ begin
        return terra_private.admit_update_run(k,p);
      exception when check_violation then
        return jsonb_build_object('status','conflict','sqlstate',sqlstate);
      when serialization_failure then
        return jsonb_build_object('status','retry_required','sqlstate',sqlstate);
      end; $test$;
      set statement_timeout='15s'; set lock_timeout='10s';
    """
    a,b=Session(ARGS),Session(ARGS)
    try:
        a.execute("begin;\n"+overlay+"\ninsert into terra_private.jurisdictions(id,display_name)"
                  " values('fictional-country','Fictional admission races');\ncommit;\n"+wrapped,"SEEDED")
        b.execute(wrapped,"READY")
        a_pid=int(a.execute("select pg_backend_pid();","APID")[0])
        b_pid=int(b.execute("select pg_backend_pid();","BPID")[0])
        assert a.execute("show transaction_isolation;","ISOLATION")==["read committed"]
        cases=[
           ("same-request-commit","commit;",canonical,"existing"),
           ("changed-request-commit","commit;",canonical.replace("fictional-policy-v1","fictional-policy-v2"),"conflict"),
           ("first-attempt-rollback","rollback;",canonical,"admitted"),
        ]
        for label,release,second_payload,expected in cases:
            key="fictional:race:"+label
            first=json.loads(a.execute("begin; select pg_temp.try_admission("+
                quote(key)+","+quote(canonical)+");","FIRST")[0])
            assert first["status"]=="admitted",label
            b.send("begin; select pg_temp.try_admission("+quote(key)+","+
                quote(second_payload)+");","SECOND")
            wait_for_block(b_pid,a_pid)
            a.execute(release,"RELEASED")
            second=json.loads(b.until("SECOND")[0])
            assert second["status"]==expected,label
            if expected=="existing":
                assert second["runId"]==first["runId"]
            if expected=="conflict":
                assert second["sqlstate"]=="23514"
            if expected=="admitted":
                assert second["runId"]!=first["runId"]
            b.execute("rollback;","CLOSED")
            print(f"PASS {label}: actual unique-key lock wait, {expected}.")

        key="fictional:race:same-request-commit"
        a.execute("begin; update terra_private.update_runs set run_state='completed',"
                  "finished_at=clock_timestamp() where request_key="+quote(key)+";","STATELOCK")
        b.send("begin; select pg_temp.try_admission("+quote(key)+","+quote(canonical)+");","STATE")
        wait_for_block(b_pid,a_pid)
        a.execute("commit;","STATECOMMIT")
        progressed=json.loads(b.until("STATE")[0])
        assert progressed["status"]=="existing" and progressed["runState"]=="completed"
        b.execute("rollback;","STATEEND")
        print("PASS completed-state-retry: waits for run row and never restarts completed work.")

        a.execute("begin; select pg_temp.try_admission('fictional:race:independent-a',"+
                  quote(canonical)+");","INDEPENDENTA")
        independent=json.loads(b.execute("begin; select pg_temp.try_admission("
                   "'fictional:race:independent-b',"+quote(canonical)+");","INDEPENDENTB")[0])
        assert independent["status"]=="admitted"
        a.execute("rollback;","INDEPENDENTAEND")
        b.execute("rollback;","INDEPENDENTBEND")
        print("PASS independent-keys: one uncommitted request does not serialize every scope request.")

        for isolation in ("repeatable read","serializable"):
            key="fictional:race:"+isolation.replace(" ","-")
            a.execute("begin; select pg_temp.try_admission("+quote(key)+","+quote(canonical)+");","HIGHFIRST")
            b.execute("begin isolation level "+isolation+"; select count(*) from terra_private.update_runs;","HIGHSNAPSHOT")
            b.send("select pg_temp.try_admission("+quote(key)+","+quote(canonical)+");","HIGHSECOND")
            wait_for_block(b_pid,a_pid)
            a.execute("commit;","HIGHCOMMIT")
            retried=json.loads(b.until("HIGHSECOND")[0])
            assert retried=={"status":"retry_required","sqlstate":"40001"},isolation
            b.execute("rollback;","HIGHEND")
            print(f"PASS {isolation}: stale snapshot produces bounded-retry signal, no new run.")
    finally:
        a.close()
        b.close()
    final=json.loads(query("""select jsonb_build_object(
      'migrations',(select count(*) from supabase_migrations.schema_migrations),
      'runs',(select count(*) from terra_private.update_runs),
      'requests',(select count(*) from terra_private.update_run_requests),
      'publications',(select count(*) from terra_private.issue_publications),
      'bindings',(select count(*) from terra_private.issue_publication_machine_bindings),
      'heads',(select count(*) from terra_private.issue_heads));"""))
    assert final=={"migrations":27,"runs":4,"requests":4,"publications":0,"bindings":0,"heads":0},final
    print("Retained isolated test evidence: draft objects and four fictional admissions; zero publications or heads.")
    print("Primary database was not addressed; do not reset or rerun this one-shot test.")
    return 0


if __name__=="__main__":
    raise SystemExit(main())
