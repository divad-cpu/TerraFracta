"""Retained isolated authentication expiry probes, including caller-controlled constraints.

No source transport. Fresh identities, fixed trial, no reset. Every account is
retired to NOLOGIN. A known bypass is recorded as an acceptance gap, never PASS.
"""
from datetime import datetime,timezone
import json
import os
import secrets
import subprocess
import sys
from scripts.check_fictional_response_identity import client,sensitive_admin_sql,TRIAL
from scripts.fictional_response_backend import verify_target,query,STATE,PORT
from scripts.check_response_reservation_concurrency import make_run,REG,reserve_sql,dispatch_sql
from scripts.check_run_admission_concurrency import quote


def long_client(role,password,sql):
    env={**os.environ,'PGPASSWORD':password,'PGCONNECT_TIMEOUT':'3','PGSSLMODE':'disable',
      'PGPASSFILE':'/dev/null','PGOPTIONS':'-c statement_timeout=10000 -c lock_timeout=5000'}
    return subprocess.run(['psql','-h','127.0.0.1','-p',PORT,'-U',role,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],
      input=sql,capture_output=True,text=True,env=env,timeout=55)


def ledger(run):
    return json.loads(query("select jsonb_build_object('reservations',(select count(*) from terra_private.source_response_reservations where run_id="+quote(run)+"),"+
      "'dispatches',(select count(*) from terra_private.source_response_dispatches d join terra_private.source_response_reservations r on r.id=d.reservation_id where r.run_id="+quote(run)+"),"+
      "'settlements',(select count(*) from terra_private.source_response_settlements s join terra_private.source_response_reservations r on r.id=s.reservation_id where r.run_id="+quote(run)+"),"+
      "'chargedBytes',terra_private.response_reserved_charge("+quote(run)+"));"))


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed timeline trial accepts no arguments')
    verify_target(migration_count=33);before=json.loads(query(STATE));assert before['runs']==19
    evidence=TRIAL/'AUTHENTICATED_TIMELINE_V2.json';assert not evidence.exists()
    labels=('principal-expiry','reservation-work-expiry','dispatch-work-expiry','settlement-work-expiry','forced-early-constraint')
    roles=['terra_response_timeline_'+str(i)+'_20261001_v2' for i in range(len(labels))]
    assert query('select count(*) from pg_roles where rolname in('+','.join(map(quote,roles))+');')=='0'
    created=[];results=[]
    try:
        for label,role in zip(labels,roles):
            password=secrets.token_urlsafe(48)
            sensitive_admin_sql('create role '+role+' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password '+quote(password)+';')
            created.append(role)
            req,admission,work=make_run('auth-timeline-v2-'+label);run=admission['runId']
            query('insert into terra_response_test_api.principal_scopes values('+','.join((quote(role),quote(run),quote(REG),quote(req.actor_id),quote(req.scope),'100',"clock_timestamp()+interval '3 minutes'",'true'))+');'+
              'grant usage on schema terra_response_test_api to '+role+';grant execute on function terra_response_test_api.reserve_response(text,integer),terra_response_test_api.dispatch_response(uuid),terra_response_test_api.settle_response(uuid,text,integer,text) to '+role+';')
            operation="select terra_response_test_api.reserve_response('fictional:timeline',100);"
            if label in ('dispatch-work-expiry','settlement-work-expiry'):
                reservation=json.loads(query(reserve_sql(req,admission,work,'fictional:timeline')))['reservationId']
                operation='select terra_response_test_api.dispatch_response('+quote(reservation)+');'
                if label=='settlement-work-expiry':
                    query(dispatch_sql(req,admission,work,reservation))
                    operation='select terra_response_test_api.settle_response('+quote(reservation)+",'measured',0,"+quote(__import__('hashlib').sha256(b'').hexdigest())+');'
            if label in ('principal-expiry','forced-early-constraint'):
                query('update terra_response_test_api.principal_scopes set expires_at=clock_timestamp()+interval \'2 seconds\' where principal='+quote(role)+';')
                wait='select pg_sleep(3);'
            else:wait='select pg_sleep(6);'*6
            early='set constraints all immediate;' if label=='forced-early-constraint' else ''
            print('Checking '+label+' with actual elapsed time; no transport.',flush=True)
            p=long_client(role,password,'begin;'+operation+early+wait+'commit;')
            observed=ledger(run)
            if label=='forced-early-constraint':
                assert p.returncode==0 and observed=={'reservations':1,'dispatches':0,'settlements':0,'chargedBytes':101}
                results.append({'case':label,'runId':run,'acceptanceGap':True,'earlyConstraintAllowedExpiredScopeCommit':True,
                  'ledger':observed,'disposition':'Closed fixed-autocommit adapter and post-COMMIT receipt checks required; direct arbitrary-SQL client not runtime accepted'})
                print('HELD: caller can force deferred checks early; retained as an acceptance gap.',flush=True)
            else:
                assert p.returncode!=0 and ('no active scope' in p.stderr or 'Work lease is not current' in p.stderr or 'expired' in p.stderr),[label,p.stderr[:1000]]
                expected={'reservations':0,'dispatches':0,'settlements':0,'chargedBytes':0}
                if label=='dispatch-work-expiry':expected={'reservations':1,'dispatches':0,'settlements':0,'chargedBytes':101}
                if label=='settlement-work-expiry':expected={'reservations':1,'dispatches':1,'settlements':0,'chargedBytes':101}
                assert observed==expected,[label,observed]
                results.append({'case':label,'runId':run,'lateCommitDenied':True,'ledger':observed})
                print('PASS late COMMIT denied: '+label,flush=True)
            sensitive_admin_sql('alter role '+role+' nologin;')
        after=json.loads(query(STATE));assert after=={**before,'runs':24}
        evidence.write_text(json.dumps({'evidenceKind':'actual_fictional_authenticated_timeline','observedAt':datetime.now(timezone.utc).isoformat(),
          'results':results,'state':after,'actualSourceFetches':0,'runtimeAcceptanceHeld':True,'primaryChanged':False},indent=2)+'\n');evidence.chmod(0o600)
    except Exception:
        failed=TRIAL/'AUTHENTICATED_TIMELINE_V2_FAILURE.json'
        if not failed.exists():failed.write_text(json.dumps({'observedAt':datetime.now(timezone.utc).isoformat(),'completedResults':results,'createdRoles':created},indent=2)+'\n');failed.chmod(0o600)
        raise
    finally:
        for role in created:sensitive_admin_sql('alter role '+role+' nologin;')
        assert query('select count(*) from pg_roles where rolname in('+','.join(map(quote,created))+') and rolcanlogin;')=='0'
    print('Four real expiry denials verified; one early-constraint gap retained. All test roles NOLOGIN.')
    return 0

if __name__=='__main__':raise SystemExit(main())
