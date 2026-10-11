"""One-shot additive linking correction on the new fictional trial only."""

from datetime import datetime,timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import sys

from scripts.fictional_response_backend import verify_target,query,STATE
from scripts.prepare_response_reservation_trial import ROOT,TRIAL,CLI


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed additive trial accepts no arguments')
    verify_target(migration_count=30)
    before=json.loads(query(STATE));assert before['runs']==12 and before['checks']==0
    evidence=TRIAL/'SOURCE_CHECK_LINK_AMENDMENT.json';assert not evidence.exists()
    full=(ROOT/'research/pending/TF009_response_reservations.sql').read_text()
    m=re.search(r'create function terra_private.assert_response_capture\([\s\S]+?\$assert\$;',full)
    assert m
    assert_fn=m.group().replace('create function','create or replace function',1)
    start=full.index('-- Link opted-in response accounting')
    end=full.index('revoke all on function terra_private.response_reserved_charge',start)
    new=full[start:end]
    amendment=assert_fn+'\n\n'+new+"revoke all on function terra_private.check_response_source_check() from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;\n"
    prior=set((TRIAL/'supabase/migrations').glob('*.sql'))
    p=subprocess.run([str(CLI),'migration','new','tf009_response_source_check_link'],cwd=TRIAL,
                     capture_output=True,text=True,timeout=20);assert p.returncode==0
    added=set((TRIAL/'supabase/migrations').glob('*.sql'))-prior;assert len(added)==1
    migration=added.pop();version=migration.name.split('_',1)[0];assert re.fullmatch(r'\d{14}',version)
    migration.write_text('-- Additive fictional trial only; original migration 30/history retained.\nbegin;\n'+amendment+'\ncommit;\n')
    query('begin;'+amendment+"insert into supabase_migrations.schema_migrations(version,name,statements) values('"+
      version+"','tf009_response_source_check_link',array['Additive fictional source-check linking; exact file retained.']);commit;")
    after=json.loads(query(STATE));assert after=={**before,'migrations':31}
    evidence.write_text(json.dumps({'evidenceKind':'additive_fictional_response_source_check_link',
      'observedAt':datetime.now(timezone.utc).isoformat(),'candidateSha256':sha256(full.encode()).hexdigest(),
      'amendmentSha256':sha256(amendment.encode()).hexdigest(),'migrationPath':str(migration),
      'migrationSha256':sha256(migration.read_bytes()).hexdigest(),'before':before,'after':after,
      'primaryChanged':False,'originalTrialHistoryRetained':True},indent=2)+'\n');evidence.chmod(0o600)
    print('PASS additive source-check link installed as isolated migration 31; original trial migration/history preserved.')
    return 0


if __name__=='__main__':raise SystemExit(main())
