"""Actual whole-attempt/retry/arrival races in retained synthetic native DB."""
from datetime import datetime,timezone,timedelta
from hashlib import sha256
import json
import sys
import time
from scripts.check_response_native_compatibility import DB,execute,ARGS,TRIAL
from scripts.fictional_response_backend import verify_target
from scripts.check_synthetic_visibility_draft import inputs,attempt
from scripts.check_machine_activation_concurrency import Session
from scripts.check_run_admission_concurrency import quote
from workers.visibility_attempts import canonical_visibility_attempt,latest_visibility_attempt


def sql(data,key,row):
    return 'select terra_private.record_synthetic_visibility_attempt('+','.join(map(quote,(data['runId'],data['fingerprint'],data['publicationId'],data['publicationHash'],key,canonical_visibility_attempt(row))))+');'


def race(first,second,*,conflict=False):
    a,b=Session(ARGS),Session(ARGS)
    try:
        for s in (a,b):s.execute("set statement_timeout='15s';set lock_timeout='10s';",'READY')
        apid=int(a.execute('select pg_backend_pid();','APID')[0]);bpid=int(b.execute('select pg_backend_pid();','BPID')[0])
        left=json.loads(a.execute('begin;'+first,'FIRST')[0]);b.send('begin;'+second,'SECOND')
        until=time.monotonic()+3
        while execute(f'select {apid}=any(pg_blocking_pids({bpid}));').strip()!='t':
            assert time.monotonic()<until;time.sleep(.05)
        a.execute('commit;','COMMITTED')
        if conflict:
            try:b.until('SECOND')
            except RuntimeError:assert any('attempt key conflicts' in line for line in b.errors)
            else:raise AssertionError('Changed evidence accepted on same key')
            return left,None
        right=json.loads(b.until('SECOND')[0]);b.execute('commit;','SECONDEND')
        return left,right
    finally:b.close();a.close()


def latest(data):return json.loads(execute('select terra_private.read_latest_synthetic_visibility('+quote(data['runId'])+','+quote(data['publicationId'])+');'))


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed synthetic races accept no arguments')
    verify_target(migration_count=34);assert execute('select current_database();').strip()==DB
    assert execute('select count(*) from terra_private.synthetic_visibility_attempts;').strip()=='0'
    evidence=TRIAL/'SYNTHETIC_VISIBILITY_CONCURRENCY.json';assert not evidence.exists()
    data=inputs();results=[]
    whole=attempt(data)
    left,right=race(sql(data,'fictional:visibility:same-key',whole),sql(data,'fictional:visibility:same-key',whole))
    assert left['status']=='stored' and right['status']=='existing' and left['attemptId']==right['attemptId']
    assert left['summary']['state']=='matched' and left['summary']['runtimeVerified'] is False
    results.append({'case':'same-key','actualLockWait':True,'receipt':left,'secondStatus':right['status']})
    whole=attempt(data);partial=attempt(data,at=whole.finished_at,observations=False)
    left,_=race(sql(data,'fictional:visibility:changed-key',partial),sql(data,'fictional:visibility:changed-key',whole),conflict=True)
    assert left['summary']['state']=='partial'
    results.append({'case':'changed-same-key','actualLockWait':True,'receipt':left,'secondDenied':True})
    new=attempt(data,observations=False);old=attempt(data,at=datetime.fromisoformat(data['finishedAt'])+timedelta(microseconds=2))
    left,right=race(sql(data,'fictional:visibility:newer-partial',new),sql(data,'fictional:visibility:delayed-old',old))
    chosen=latest(data);assert chosen['attemptId']==left['attemptId'] and chosen['summary']['state']=='partial'
    assert right['summary']['state']=='matched' and latest_visibility_attempt((new,old))==new
    results.append({'case':'old-arrives-after-new','actualLockWait':True,'newReceipt':left,'oldReceipt':right,'latestState':'partial'})
    whole=attempt(data);partial=attempt(data,at=whole.finished_at,observations=False)
    left,right=race(sql(data,'fictional:visibility:same-time-full',whole),sql(data,'fictional:visibility:same-time-partial',partial))
    chosen=latest(data);assert chosen=={'schemaVersion':1,'state':'ambiguous','scope':'synthetic','runtimeVerified':False}
    try:latest_visibility_attempt((whole,partial))
    except ValueError:pass
    else:raise AssertionError('Conflicting latest timestamps selected silently')
    results.append({'case':'conflicting-same-time','actualLockWait':True,'receipts':[left,right],'latest':chosen})
    assert execute('select count(*) from terra_private.synthetic_visibility_attempts;').strip()=='6'
    assert inputs()['summary']==data['summary']
    evidence.write_text(json.dumps({'evidenceKind':'actual_synthetic_visibility_lock_races','observedAt':datetime.now(timezone.utc).isoformat(),
      'database':DB,'results':results,'retainedAttempts':6,'originalCloseoutUnchanged':True,'runtimeVerified':False,
      'actualSourceFetches':0,'primaryChanged':False},indent=2)+'\n');evidence.chmod(0o600)
    print('PASS four actual synthetic visibility races: one exact retry, changed-key denial, newer whole-attempt selection and ambiguous same-time hold. Six rows retained; original closeout unchanged.')
    return 0

if __name__=='__main__':raise SystemExit(main())
