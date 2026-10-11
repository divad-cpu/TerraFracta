"""Fresh native compatibility and access gate for the pinned paired candidate.

Uses the exact owned stopped network-none clone and a new empty database.
Native pgTAP cases roll back; historical databases and all failures remain.
No LOGIN, source context, raw artifact, primary migration or public grant.
"""
from datetime import datetime,timezone
from hashlib import sha256
import json
import secrets
import re
import sys
import time
from scripts.build_fictional_ssb_pair_api import build_fictional_ssb_pair_api,SCHEMA
from scripts.check_authenticated_capture_pipeline import TARGET,command
from scripts.check_archived_completion_restore import IMAGE,BIN
from scripts.captured_fictional_pipeline import ROOT,private_file
from scripts.run_authenticated_ssb_pair_capture import PRIVATE
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_run_admission_cases import fictional_request
from workers.update_request_identity import canonical_update_request

def main():
    if sys.argv[1:]:raise RuntimeError('Fixed paired native gate accepts no arguments')
    with fixed_trial_guard():
        meta=json.loads(command(['docker','inspect','--format',
          '{"image":{{json .Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}}}',TARGET]).stdout)
        assert meta=={'image':IMAGE,'labels':{'terrafracta.capture-auth':'20261001'},'running':False,'network':'none','ports':{}}
        suffix=datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')+'_'+secrets.token_hex(3)
        db='terra_pair_native_'+suffix;proof=PRIVATE/('authenticated-pair-native-'+suffix);proof.mkdir(mode=0o700)
        candidate=build_fictional_ssb_pair_api()
        assert candidate==(ROOT/'research/pending/TF009_fictional_ssb_pair_api_v2.sql').read_text()
        private_file(proof/'EXACT_CANDIDATE.sql',candidate)
        counter=0;started=False
        def query(sql,label,*,database=db):
            nonlocal counter
            counter+=1
            p=command(['docker','exec','-i',TARGET,BIN+'psql','-h','/tmp','-U','postgres','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'],data=sql)
            private_file(proof/(str(counter).zfill(3)+'-'+label+'.log'),p.stdout+'\n'+p.stderr)
            if p.returncode:raise RuntimeError('Fixed paired native gate failed: '+label)
            return p.stdout.strip()
        def tap(sql,label):
            text=query(sql,label);plan=re.search(r'^1\.\.(\d+)$',text,re.M)
            passed=len(re.findall(r'^ok \d+\b',text,re.M))
            assert plan and int(plan[1])==passed and not re.search(r'^not ok|^# (?:Looks like|Failed)',text,re.M),label
            return passed
        try:
            assert command(['docker','start',TARGET],timeout=15).returncode==0;started=True
            for _ in range(20):
                if command(['docker','exec',TARGET,BIN+'pg_isready','-h','/tmp','-U','postgres'],timeout=5).returncode==0:break
                time.sleep(.2)
            query('create database '+db+';','new_database',database='postgres')
            for index,path in enumerate(sorted((ROOT/'supabase/migrations').glob('*.sql'))):query(path.read_text(),'baseline_'+str(index))
            query('begin;'+candidate+'commit;','paired_candidate')
            query('create schema extensions;create extension pgtap with schema extensions;','pgtap')
            native=sum(tap(path.read_text(),'native_'+path.name) for path in sorted((ROOT/'supabase/tests').glob('*.sql')))
            assert native==634
            response=(ROOT/'research/pending/TF009_response_reservations.test.sql').read_text().replace('-- TF_RESPONSE_RESERVATION_OVERLAY','').replace('-- TF_RESPONSE_REQUEST_CANONICAL',
                'create temporary table response_template(canonical text);insert into response_template values('+quote(canonical_update_request(fictional_request()))+');')
            assert tap(response,'response_regressions')==25
            permissions=f"""begin;set local search_path=extensions,pg_catalog;select plan(10);
select is((select count(*) from pg_proc where pronamespace='{SCHEMA}'::regnamespace),17::bigint,'Closed pair has exactly seventeen functions');
select is((select count(*) from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.pronamespace='{SCHEMA}'::regnamespace and a.grantee=0 and a.privilege_type='EXECUTE'),0::bigint,'No PUBLIC function execution');
select is((select count(*) from pg_proc where pronamespace='{SCHEMA}'::regnamespace and proconfig @> array['search_path=pg_catalog, pg_temp']),17::bigint,'Every function pins search path');
select ok((select relrowsecurity from pg_class where oid='{SCHEMA}.principal_scopes'::regclass),'Private scopes have RLS');
select ok(not has_schema_privilege('authenticated','{SCHEMA}','USAGE'),'Ordinary authenticated users have no API access');
select ok(not has_table_privilege('service_role','{SCHEMA}.principal_scopes','SELECT'),'Service role has no template read');
select is((select count(*) from {SCHEMA}.principal_scopes),0::bigint,'Candidate grants no runtime scope');
select is((select count(*) from terra_private.source_response_pairs),0::bigint,'Native controls retain no pair');
select ok((select (tgtype::integer & 16)=16 and tgdeferrable and tginitdeferred from pg_trigger where tgname='response_pair_context_binding_commit'),'Native UPDATE COMMIT event is preserved');
select is((select count(*) from terra_private.machine_publication_activations),0::bigint,'Candidate creates no activation');select * from finish();rollback;
"""
            assert tap(permissions,'closed_pair_permissions')==10
            result={'evidenceKind':'fresh_paired_candidate_native_compatibility','observedAt':datetime.now(timezone.utc).isoformat(),
                'nativeControls':native,'responseControls':25,'permissionControls':10,'candidateSha256':sha256(candidate.encode()).hexdigest(),
                'applicationAccountsCreated':0,'primaryChanged':False,'sourceContextsCreated':0,'actualSourceRequests':0,
                'publicWriterEnabled':False,'generalSqlTimingAccepted':False,'privateEvidenceDirectory':str(proof)}
            private_file(proof/'PAIRED_NATIVE_RESULT.json',json.dumps(result,indent=2)+'\n')
        except BaseException as error:
            private_file(proof/'PAIRED_NATIVE_FAILURE.json',json.dumps({'exceptionType':type(error).__name__,'historyRetained':True,'primaryChanged':False})+'\n');raise
        finally:
            if started:assert command(['docker','stop','--timeout','10',TARGET],timeout=20).returncode==0
    print(json.dumps({**result,'ownedCloneStopped':True},indent=2));return 0

if __name__=='__main__':raise SystemExit(main())
