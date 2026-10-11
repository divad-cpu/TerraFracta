"""Fixed isolated post-COMMIT scope checks with actual SCRAM identities.

Only invented streams; no source transport. Credentials memory-only and roles
NOLOGIN in finally. Expired committed attempts remain fully charged/retained.
"""
from dataclasses import replace
from datetime import datetime,timezone
import io
import json
import secrets
import sys
import time
from scripts.check_fictional_response_identity import client,sensitive_admin_sql,TRIAL
from scripts.check_fictional_response_identity_timeline import long_client,ledger
from scripts.fictional_response_backend import verify_target,query,STATE
from scripts.check_response_reservation_concurrency import make_run,REG
from scripts.check_run_admission_concurrency import quote
from workers.update_run_admission import parse_run_admission
from workers.update_run_work import parse_work_claim
from workers.source_response_receipts import ResponseRequest
from workers.confirmed_response_backend import ConfirmedResponseBackend
from workers.reserved_response_capture import capture_reserved_response,ReservedCaptureError

class FixedAuthenticatedBackend:
    def __init__(self,principal,password):self.principal=principal;self.password=password
    def call(self,sql):
        p=client(self.principal,self.password,sql)
        if p.returncode or not 2<=len(p.stdout.strip().encode())<=4096:
            raise ValueError('Fixed authenticated response operation refused')
        return p.stdout.strip().encode()
    def reserve(self,expected):return self.call('select terra_response_test_api.reserve_response('+quote(expected.request_key)+','+str(expected.max_body_bytes)+');')
    def dispatch(self,expected,reservation):return self.call('select terra_response_test_api.dispatch_response('+quote(reservation.reservation_id)+');')
    def settle(self,expected,reservation,*,outcome,body_bytes,content_sha256):
        h='null' if content_sha256 is None else quote(content_sha256)
        return self.call('select terra_response_test_api.settle_response('+quote(reservation.reservation_id)+','+quote(outcome)+','+str(body_bytes)+','+h+');')
    def confirm(self,phase,receipt):
        return self.call('select terra_response_test_api.confirm_response('+quote(phase)+','+quote(receipt.decode())+');')


def prepare(label,role,password,*,seconds=180):
    req,admission,work=make_run('confirmed:'+label)
    admitted=parse_run_admission(json.dumps(admission).encode(),req)
    claim=parse_work_claim(json.dumps(work).encode(),req,admitted,datetime.now(timezone.utc))
    expected=ResponseRequest(req,claim,REG,'fictional:confirmed:body','https://example.org/fictional-response',100)
    query('insert into terra_response_test_api.principal_scopes values('+','.join((quote(role),quote(admission['runId']),quote(REG),quote(req.actor_id),quote(req.scope),'100',
      'clock_timestamp()+interval \''+str(seconds)+' seconds\'','true'))+');grant usage on schema terra_response_test_api to '+role+';'+
      'grant execute on function terra_response_test_api.reserve_response(text,integer),terra_response_test_api.dispatch_response(uuid),terra_response_test_api.settle_response(uuid,text,integer,text),terra_response_test_api.confirm_response(text,text) to '+role+';')
    fixed=FixedAuthenticatedBackend(role,password)
    return expected,admission,work,fixed,ConfirmedResponseBackend(expected,role,fixed,fixed)


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed confirmed identity trial accepts no arguments')
    verify_target(migration_count=34);before=json.loads(query(STATE));assert before['runs']==25
    roles=['terra_response_confirm_'+str(i)+'_20261001' for i in range(4)]
    assert query('select count(*) from pg_roles where rolname in('+','.join(map(quote,roles))+');')=='0'
    evidence=TRIAL/'CONFIRMED_RESPONSE_IDENTITY.json';assert not evidence.exists()
    created=[];results=[]
    try:
        passwords={role:secrets.token_urlsafe(48) for role in roles}
        for role in roles:
            sensitive_admin_sql('create role '+role+' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password '+quote(passwords[role])+';');created.append(role)
        expected,admission,work,fixed,backend=prepare('measured',roles[0],passwords[roles[0]])
        opened=[]
        result=capture_reserved_response(expected,backend,backend.authorized_opener(lambda endpoint,seconds:(opened.append(seconds) or io.BytesIO(b'abc'))))
        assert result.body==b'abc' and result.settlement.charged_bytes==3 and len(opened)==1
        assert capture_reserved_response(expected,backend,backend.authorized_opener(lambda *args:(_ for _ in()).throw(AssertionError('No replay opener')))) is None
        for phase,receipt in [('dispatch',fixed.reserve(expected)),('reserve',b'{"reservationId":"'+result.reservation.reservation_id.encode()+b'","status":"reserved"}')]:
            try:fixed.confirm(phase,receipt)
            except ValueError:pass
            else:raise AssertionError('Forged phase/receipt confirmation accepted')
        uncommitted="begin;with r as(select terra_response_test_api.reserve_response('fictional:uncommitted',1)::text as receipt) select terra_response_test_api.confirm_response('reserve',receipt) from r;commit;"
        p=client(roles[0],passwords[roles[0]],uncommitted);assert p.returncode!=0 and 'requires prior COMMIT' in p.stderr
        results.append({'case':'fixed-committed-driver-replay','runId':admission['runId'],'streamOpens':1,'phaseAndReceiptSubstitutionDenied':True,
          'sameTransactionConfirmationDenied':True,'ledger':ledger(admission['runId'])})
        for index,label in ((1,'principal-expired-commit'),(2,'work-expired-commit')):
            expected,admission,work,fixed,backend=prepare(label,roles[index],passwords[roles[index]],seconds=2 if index==1 else 180)
            wait='select pg_sleep(3);' if index==1 else 'select pg_sleep(6);'*6
            print('Checking post-COMMIT refusal: '+label,flush=True)
            p=long_client(roles[index],passwords[roles[index]],"begin;select terra_response_test_api.reserve_response('fictional:confirmed:body',100);set constraints all immediate;"+wait+'commit;')
            assert p.returncode==0
            receipt=p.stdout.splitlines()[0].encode()
            # This is the exact saved early-fired receipt; current authority read
            # must refuse it even though its earlier COMMIT succeeded.
            try:fixed.confirm('reserve',receipt)
            except ValueError:pass
            else:raise AssertionError('Expired committed receipt gained confirmation')
            observed=ledger(admission['runId']);assert observed=={'reservations':1,'dispatches':0,'settlements':0,'chargedBytes':101}
            results.append({'case':label,'runId':admission['runId'],'expiredCommitRetained':True,'confirmationDenied':True,'streamOpens':0,'ledger':observed})
        expected,admission,work,fixed,backend=prepare('scope-expires-in-read',roles[3],passwords[roles[3]],seconds=5)
        opened=[]
        class SlowInventedStream(io.BytesIO):
            def read(self,n):time.sleep(opened[0]+.2);return super().read(n)
        stream=SlowInventedStream(b'abc')
        def opener(endpoint,seconds):opened.append(seconds);return stream
        try:capture_reserved_response(expected,backend,backend.authorized_opener(opener))
        except ReservedCaptureError:pass
        else:raise AssertionError('Scope-expired response body returned')
        observed=ledger(admission['runId']);assert stream.closed and len(opened)==1 and observed['chargedBytes']==101 and observed['settlements'] in (0,1)
        results.append({'case':'authority-expires-during-read','runId':admission['runId'],'bodyWithheld':True,'streamClosed':True,'streamOpens':1,'ledger':observed})
        after=json.loads(query(STATE));assert after=={**before,'runs':29}
        evidence.write_text(json.dumps({'evidenceKind':'actual_scram_postcommit_confirmed_driver','observedAt':datetime.now(timezone.utc).isoformat(),
          'results':results,'state':after,'actualSourceFetches':0,'primaryChanged':False,'directArbitrarySqlRuntimeAccepted':False},indent=2)+'\n');evidence.chmod(0o600)
    except BaseException as exc:
        failure=TRIAL/'CONFIRMED_RESPONSE_IDENTITY_FAILURE.json'
        if not failure.exists():failure.write_text(json.dumps({'observedAt':datetime.now(timezone.utc).isoformat(),'completedResults':results,'exceptionType':type(exc).__name__,'createdRoles':created},indent=2)+'\n');failure.chmod(0o600)
        raise
    finally:
        for role in created:sensitive_admin_sql('alter role '+role+' nologin;')
        assert query('select count(*) from pg_roles where rolname in('+','.join(map(quote,created))+') and rolcanlogin;')=='0'
    print('PASS fixed post-COMMIT authority: expired commits denied before transport, replay suppressed, expired-read body withheld. Test roles NOLOGIN.')
    return 0

if __name__=='__main__':raise SystemExit(main())
