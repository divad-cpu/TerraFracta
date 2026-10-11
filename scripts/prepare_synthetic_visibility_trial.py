"""Install synthetic-only evidence in the empty retained native test database.

Preserves existing response/identity runs in postgres. No primary target,
LOGIN, rendered-view observer, reset or schedule.
"""
from datetime import datetime,timezone
from hashlib import sha256
import json
import sys
from scripts.check_response_native_compatibility import DB,execute,ROOT,TRIAL
from scripts.fictional_response_backend import verify_target
from scripts.check_machine_activation_concurrency import Session
from scripts.fictional_run_completion import staged_completion_sql,CLOSE_SQL
from scripts.fictional_staged_machine_publication import ACTIVATE_SQL
from scripts.check_response_native_compatibility import ARGS


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed synthetic visibility preparation accepts no arguments')
    verify_target(migration_count=34)
    evidence=TRIAL/'SYNTHETIC_VISIBILITY_INSTALL.json';assert not evidence.exists()
    assert execute('select current_database();').strip()==DB
    assert execute('select count(*) from terra_private.update_runs;').strip()=='0'
    assert execute("select to_regclass('terra_private.synthetic_visibility_attempts') is null;").strip()=='t'
    candidate=(ROOT/'research/pending/TF009_synthetic_visibility_attempts.sql').read_text()
    execute('begin;'+candidate+'commit;')
    session=Session(ARGS)
    try:
        session.execute('begin;'+staged_completion_sql()+'commit;','CAPTURED')
        activation=json.loads(session.execute('begin;'+ACTIVATE_SQL+'commit;','ACTIVATED')[0])
        closeout=json.loads(session.execute('begin;'+CLOSE_SQL+'commit;','CLOSED')[0])
        assert closeout['summary']['visibilityState']=='pending'
        state=json.loads(execute("select jsonb_build_object('runs',(select count(*) from terra_private.update_runs),"+
          "'activations',(select count(*) from terra_private.machine_publication_activations),'closeouts',(select count(*) from terra_private.update_run_closeouts),"+
          "'visibilityAttempts',(select count(*) from terra_private.synthetic_visibility_attempts));"))
        assert state=={'runs':1,'activations':1,'closeouts':1,'visibilityAttempts':0}
        evidence.write_text(json.dumps({'evidenceKind':'isolated_synthetic_visibility_preparation','observedAt':datetime.now(timezone.utc).isoformat(),
          'database':DB,'candidateSha256':sha256(candidate.encode()).hexdigest(),'activation':activation,'closeout':closeout,'state':state,
          'runtimeVerified':False,'actualSourceFetches':0,'primaryChanged':False},indent=2)+'\n');evidence.chmod(0o600)
        print('PASS synthetic visibility candidate and one committed fictional activation/closeout retained; original closeout stays pending.')
    finally:session.close()
    return 0

if __name__=='__main__':raise SystemExit(main())
