"""Install the closed fictional identity experiment on the fixed trial only."""
from datetime import datetime,timezone
from hashlib import sha256
import json
import re
import subprocess
import sys
from scripts.fictional_response_backend import verify_target,query,STATE
from scripts.prepare_response_reservation_trial import ROOT,TRIAL,CLI


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed identity preparation accepts no arguments')
    verify_target(migration_count=33);before=json.loads(query(STATE));assert before['runs']==25
    assert query("select count(*) from pg_roles where rolname like 'terra_response_fixture_%' and rolcanlogin;")=='0'
    evidence=TRIAL/'FICTIONAL_CONFIRMATION_INSTALL.json';assert not evidence.exists()
    sql=(ROOT/'research/pending/TF009_fictional_response_confirmation.sql').read_text()
    prior=set((TRIAL/'supabase/migrations').glob('*.sql'))
    p=subprocess.run([str(CLI),'migration','new','tf009_fictional_response_confirmation'],cwd=TRIAL,capture_output=True,text=True,timeout=20)
    assert p.returncode==0
    added=set((TRIAL/'supabase/migrations').glob('*.sql'))-prior;assert len(added)==1
    migration=added.pop();version=migration.name.split('_',1)[0];assert re.fullmatch(r'\d{14}',version)
    migration.write_text('-- Isolated fictional identity experiment only.\nbegin;\n'+sql+'\ncommit;\n')
    query('begin;'+sql+"insert into supabase_migrations.schema_migrations(version,name,statements) values('"+
      version+"','tf009_fictional_response_confirmation',array['Closed deferred authentication scope; original invoker BEFORE checks retained.']);commit;")
    after=json.loads(query(STATE));assert after=={**before,'migrations':34}
    evidence.write_text(json.dumps({'evidenceKind':'fictional_confirmation_experiment_install','observedAt':datetime.now(timezone.utc).isoformat(),
       'candidateSha256':sha256(sql.encode()).hexdigest(),'migrationSha256':sha256(migration.read_bytes()).hexdigest(),
       'migrationPath':str(migration),'state':after,'runtimeLoginCreated':False,'primaryChanged':False},indent=2)+'\n');evidence.chmod(0o600)
    print('PASS closed fictional API installed as isolated migration 34; no LOGIN or client grant created yet.')
    return 0


if __name__=='__main__':raise SystemExit(main())
