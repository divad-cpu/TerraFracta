"""One retained real-time run at the supported 3600-second technical ceiling.

The 30-second work lease is renewed under actual server time. Never changes
its original total deadline or sends source traffic. All progress is journaled
privately and the final dispatch/settlement/renewal refusals are retained.
"""
from dataclasses import replace
from datetime import datetime,timezone
import json
import os
import sys
import time
from scripts.fictional_response_backend import verify_target,query,STATE
from scripts.check_response_reservation_concurrency import REG,reserve_sql,dispatch_sql,refused
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_run_admission_cases import fictional_request
from scripts.prepare_response_reservation_trial import TRIAL
from workers.update_request_identity import canonical_update_request,identify_update_request


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed maximum-lifetime trial accepts no arguments')
    verify_target(migration_count=33);before=json.loads(query(STATE));assert before['runs']==24
    journal=TRIAL/'MAXIMUM_LIFETIME_PROGRESS.jsonl';final=TRIAL/'MAXIMUM_LIFETIME.json'
    assert not journal.exists() and not final.exists()
    fd=os.open(journal,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    def record(entry):
        os.write(fd,(json.dumps({'observedAt':datetime.now(timezone.utc).isoformat(),**entry})+'\n').encode());os.fsync(fd)
    try:
        req=replace(fictional_request(),request_key='fictional:response:maximum-lifetime',
          limits=replace(fictional_request().limits,max_response_bytes=101,max_duration_seconds=3600))
        admission=json.loads(query('select terra_private.admit_update_run('+quote(req.request_key)+','+quote(canonical_update_request(req))+');'));assert admission['status']=='admitted'
        fp=identify_update_request(req).request_fingerprint
        work=json.loads(query('select terra_private.claim_update_run_work('+quote(admission['runId'])+','+quote(fp)+',gen_random_uuid());'));assert work['status']=='claimed'
        deadline=datetime.fromisoformat(work['deadlineAt']);run=admission['runId'];lease=work['leaseId']
        reservation=json.loads(query(reserve_sql(req,admission,work,'fictional:maximum-lifetime')))['reservationId']
        dispatch=json.loads(query(dispatch_sql(req,admission,work,reservation)));assert dispatch['status']=='dispatched'
        started=time.monotonic();renewals=0
        record({'phase':'started','runId':run,'leaseId':lease,'reservationId':reservation,'originalDeadlineAt':deadline.isoformat(),
          'dispatchCommitted':True,'actualSourceFetches':0})
        print('Real 3600-second lifetime check started; progress retained privately, no transport.',flush=True)
        while True:
            remaining=(deadline-datetime.now(timezone.utc)).total_seconds()
            if remaining<=1:break
            time.sleep(min(15,max(.01,remaining-1)))
            if (deadline-datetime.now(timezone.utc)).total_seconds()<=1:break
            renewed=json.loads(query('select terra_private.renew_update_run_work('+quote(run)+','+quote(fp)+','+quote(lease)+');'))
            assert renewed['status']=='renewed' and renewed['leaseId']==lease and datetime.fromisoformat(renewed['deadlineAt'])==deadline
            assert datetime.fromisoformat(renewed['leaseExpiresAt'])<=deadline
            renewals+=1;record({'phase':'renewed','number':renewals,'receipt':renewed})
            if renewals%4==0:print('Lifetime check: '+str(renewals)+' renewals, original deadline unchanged.',flush=True)
        while datetime.now(timezone.utc)<deadline:time.sleep(.05)
        # Real expiry, no test-clock rewrite or fabricated future timestamp.
        refused('select terra_private.renew_update_run_work('+quote(run)+','+quote(fp)+','+quote(lease)+');','Work lease is not current')
        refused(dispatch_sql(req,admission,work,reservation),'Work lease is not current')
        args=','.join(map(quote,(run,fp,lease,reservation)))
        refused('select terra_private.settle_source_response('+args+",'measured',0,repeat('a',64));",'Work lease is not current')
        observed=json.loads(query("select jsonb_build_object('chargedBytes',terra_private.response_reserved_charge("+quote(run)+"),"+
          "'settlements',(select count(*) from terra_private.source_response_settlements where reservation_id="+quote(reservation)+"),"+
          "'workClaims',(select count(*) from terra_private.update_run_work_claims where run_id="+quote(run)+"));"))
        assert observed=={'chargedBytes':101,'settlements':0,'workClaims':1}
        result={'evidenceKind':'actual_maximum_supported_lifetime','observedAt':datetime.now(timezone.utc).isoformat(),
          'runId':run,'originalDeadlineAt':deadline.isoformat(),'actualElapsedSeconds':time.monotonic()-started,'renewals':renewals,
          'lateRenewalDenied':True,'lateDispatchReplayDenied':True,'lateRefundDenied':True,'ledger':observed,
          'actualSourceFetches':0,'primaryChanged':False,'state':json.loads(query(STATE))}
        final.write_text(json.dumps(result,indent=2)+'\n');final.chmod(0o600);record({'phase':'completed','renewals':renewals})
        print('PASS real maximum lifetime: original deadline survived renewals; expired work cannot renew, resend or refund.',flush=True)
    except BaseException as exc:
        record({'phase':'failed','exceptionType':type(exc).__name__});raise
    finally:os.close(fd)
    return 0

if __name__=='__main__':raise SystemExit(main())
