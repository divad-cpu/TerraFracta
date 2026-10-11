"""Complete the retained native check after its missing template harness error.

Uses the already-created isolated DB without replaying migrations or old tests.
"""
from datetime import datetime,timezone
from hashlib import sha256
import json
import re
import sys
from scripts.check_response_native_compatibility import DB,execute,ROOT,TRIAL
from scripts.fictional_response_backend import verify_target,query
from scripts.fictional_run_admission_cases import fictional_request
from scripts.check_run_admission_concurrency import quote
from workers.update_request_identity import canonical_update_request


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed retained completion accepts no arguments')
    verify_target(migration_count=33)
    assert query("select count(*) from pg_database where datname='"+DB+"';")=='1'
    evidence=TRIAL/'NATIVE_COMPATIBILITY_COMPLETED.json';assert not evidence.exists()
    results=[]
    for p in sorted((ROOT/'supabase/tests').glob('*.sql')):
        tap=(TRIAL/('NATIVE_'+p.name+'.log')).read_text()
        plan=re.search(r'^1\.\.(\d+)$',tap,re.M);passed=len(re.findall(r'^ok \d+\b',tap,re.M))
        assert plan and int(plan.group(1))==passed and not re.search(r'^not ok|^# (?:Looks like|Failed)',tap,re.M)
        results.append({'fixture':p.name,'passed':passed,'sha256':sha256(p.read_bytes()).hexdigest()})
    fixture=(ROOT/'research/pending/TF009_response_reservations.test.sql').read_text().replace('-- TF_RESPONSE_RESERVATION_OVERLAY','').replace('-- TF_RESPONSE_REQUEST_CANONICAL',
      'create temporary table response_template(canonical text);insert into response_template values('+quote(canonical_update_request(fictional_request()))+');')
    tap=execute(fixture);log=TRIAL/'NATIVE_RESPONSE_DRAFT_COMPLETED.log';log.write_text(tap);log.chmod(0o600)
    passed=len(re.findall(r'^ok \d+\b',tap,re.M));assert passed==25 and not re.search(r'^not ok|^# (?:Looks like|Failed)',tap,re.M)
    assert execute('select count(*) from terra_private.update_runs;').strip()=='0'
    evidence.write_text(json.dumps({'evidenceKind':'fresh_isolated_native_compatibility_completed','observedAt':datetime.now(timezone.utc).isoformat(),
      'database':DB,'fixtures':results,'nativeControls':sum(p['passed'] for p in results),'responseControls':passed,
      'priorHarnessFailurePreserved':True,'primaryChanged':False,'previousTrialRowsUntouched':True},indent=2)+'\n');evidence.chmod(0o600)
    print('PASS '+str(sum(p['passed'] for p in results))+' native controls + 25 response controls. New DB remains empty; original trial evidence retained.')
    return 0

if __name__=='__main__':raise SystemExit(main())
