"""One-shot native SQL compatibility in a fresh retained DB on fixed trial cluster.

Never changes or clears existing primary/trial records. Replays literal project
migrations; all native fixtures roll back. Failed output remains private.
"""
from datetime import datetime,timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import sys
from scripts.fictional_response_backend import verify_target,query,CONTAINER
from scripts.prepare_response_reservation_trial import ROOT,TRIAL
DB='terra_response_native_20261001'
ARGS=['docker','exec','-i',CONTAINER,'psql','-U','postgres','-d',DB,'-X','-qAt','-v','ON_ERROR_STOP=1']


def execute(sql):
    p=subprocess.run(ARGS,input=sql,text=True,capture_output=True,timeout=45)
    if p.returncode:raise RuntimeError('Isolated native compatibility operation failed: '+';'.join(line for line in p.stderr.splitlines() if line.startswith('ERROR:'))[-500:])
    return p.stdout


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed native compatibility accepts no arguments')
    verify_target(migration_count=33)
    assert query('select count(*) from pg_database where datname=\''+DB+'\';')=='0'
    query('create database '+DB+';')
    execute('create schema extensions;create extension pgtap with schema extensions;')
    records=[]
    for p in sorted((ROOT/'supabase/migrations').glob('*.sql')):
        execute(p.read_text());records.append({'path':str(p.relative_to(ROOT)),'sha256':sha256(p.read_bytes()).hexdigest()})
    assert len(records)==29
    execute('begin;'+(ROOT/'research/pending/TF009_response_reservations.sql').read_text()+'commit;')
    controls=0;results=[]
    for p in sorted((ROOT/'supabase/tests').glob('*.sql')):
        tap=execute(p.read_text())
        plan=re.search(r'^1\.\.(\d+)$',tap,re.M);passed=len(re.findall(r'^ok \d+\b',tap,re.M))
        target=TRIAL/('NATIVE_'+p.name+'.log');target.write_text(tap);target.chmod(0o600)
        assert plan and int(plan.group(1))==passed and not re.search(r'^not ok|^# (?:Looks like|Failed)',tap,re.M),p.name
        controls+=passed;results.append({'fixture':p.name,'passed':passed,'sha256':sha256(p.read_bytes()).hexdigest()})
        print('PASS native fixture '+p.name+': '+str(passed),flush=True)
    fixture=(ROOT/'research/pending/TF009_response_reservations.test.sql').read_text().replace('-- TF_RESPONSE_RESERVATION_OVERLAY','')
    tap=execute(fixture);(TRIAL/'NATIVE_RESPONSE_DRAFT.log').write_text(tap);(TRIAL/'NATIVE_RESPONSE_DRAFT.log').chmod(0o600)
    passed=len(re.findall(r'^ok \d+\b',tap,re.M));assert passed==25 and not re.search(r'^not ok|^# (?:Looks like|Failed)',tap,re.M)
    result={'evidenceKind':'fresh_isolated_native_compatibility','observedAt':datetime.now(timezone.utc).isoformat(),
      'database':DB,'projectMigrations':records,'fixtures':results,'nativeControls':controls,'responseControls':passed,
      'primaryChanged':False,'previousTrialRowsUntouched':True}
    evidence=TRIAL/'NATIVE_COMPATIBILITY.json';evidence.write_text(json.dumps(result,indent=2)+'\n');evidence.chmod(0o600)
    print('PASS '+str(controls)+' native controls + 25 response controls; new database retained, original records untouched.')
    return 0

if __name__=='__main__':raise SystemExit(main())
