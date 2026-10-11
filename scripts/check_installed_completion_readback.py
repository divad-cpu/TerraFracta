"""Read-only fixed primary reconciliation of approved migration-29 objects.

No connection arguments, credentials, role changes or writes. Administrative
postgres membership is existing bootstrap metadata, not an app identity.
"""

from hashlib import sha256
import json
import re
import sys

from scripts.check_run_admission_draft import BASELINE,PRIMARY,query
from scripts.check_run_completion_copy import ROOT,SOURCE,check_artifacts
from scripts.check_local_db_target import main as check_target


def main():
    if sys.argv[1:]: raise RuntimeError('Fixed installed readback accepts no arguments')
    assert check_target([])==0
    check_artifacts(ROOT)
    source=(ROOT/SOURCE).read_text()
    functions=re.findall(r'create function terra_private\.(\w+)\([^;]*?\bas\s+(\$[A-Za-z_0-9]*\$)(.*?)\2;',source,re.S)
    expected={name:sha256(body.encode()).hexdigest() for name,tag,body in functions}
    assert len(functions)==len(expected)==8
    names=','.join("'"+name+"'" for name in expected)
    actual=json.loads(query(PRIMARY[0],"select jsonb_object_agg(proname,jsonb_build_object('bodySha256',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),'definer',prosecdef,'config',proconfig,'volatility',provolatile)) from pg_proc where pronamespace='terra_private'::regnamespace and proname in("+names+");"))
    assert set(actual)==set(expected)
    for name,digest in expected.items():
        row=actual[name]
        assert row['bodySha256']==digest and not row['definer'] and row['config']==['search_path=pg_catalog, pg_temp']
        assert row['volatility']==('s' if name in ('validate_run_manifest','summarize_run_processing') else 'v')
    triggers=re.findall(r'create (?:constraint )?trigger (\w+)',source); assert len(triggers)==9
    names=','.join("'"+name+"'" for name in triggers)
    checked=json.loads(query(PRIMARY[0],"select jsonb_object_agg(tgname,jsonb_build_object('enabled',tgenabled,'deferrable',tgdeferrable,'initiallyDeferred',tginitdeferred)) from pg_trigger where tgrelid in(select oid from pg_class where relnamespace='terra_private'::regnamespace) and tgname in("+names+");"))
    assert set(checked)==set(triggers)
    for name,row in checked.items():
        assert row['enabled']=='O'
        assert row['deferrable']==row['initiallyDeferred']==(name=='run_closeout_commit_guard')
    state=json.loads(query(PRIMARY[0],BASELINE))
    assert state['migrations']==30 and all(state[k]==0 for k in ('runs','versions','decisions','bindings','publications','heads'))
    rows=json.loads(query(PRIMARY[0],"select jsonb_object_agg(rolname,rolcanlogin) from pg_roles where rolname in('terra_collector','terra_operator','terra_reviewer','terra_issue_reader');"))
    assert len(rows)==4 and not any(rows.values())
    memberships=json.loads(query(PRIMARY[0],"select jsonb_agg(jsonb_build_object('role',r.rolname,'member',u.rolname,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) order by r.rolname) from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where r.rolname in('terra_collector','terra_operator','terra_reviewer','terra_issue_reader');"))
    assert len(memberships)==4 and {row['role'] for row in memberships}==set(rows)
    assert all(row['member']=='postgres' and row['admin'] and not row['inherit'] and not row['set'] for row in memberships)
    print('PASS eight exact reviewed function bodies/flags, nine enabled trigger timings, 30 migrations and zero trial rows.')
    print('PASS four NOLOGIN application roles; only existing postgres ADMIN membership, without INHERIT or SET. No runtime member.')
    return 0


if __name__=='__main__': raise SystemExit(main())
