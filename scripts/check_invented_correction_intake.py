"""Actual ordinary fixed correction writer across an invented successor.

Reuse the existing exact first/successor publication driver in a new isolated
database. Install only an experimental private function/scope table there;
provision a separate short-lived SCRAM writer with no private table access.
All submitted details are literals invented by this harness. No real intake,
contact, network, qualification, primary migration or reviewer workflow.
"""
from copy import deepcopy
from datetime import datetime,timezone
from hashlib import sha256
import json
import secrets
import sys
import re
from pathlib import Path

from scripts.captured_fictional_pipeline import ROOT,REG,private_file
from scripts.check_authenticated_capture_pipeline import sensitive_admin,TARGET,command
from scripts.check_archived_completion_restore import BIN
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_successor_pipeline import trial

CANDIDATE=ROOT/'research/pending/TF007_invented_correction_intake.sql'
FIELDS={'kind':'missing_context','details':'Invented explanation for a private technical correction test.',
    'sourceUrl':'https://example.org/fictional-correction-evidence'}


def client_args(role,database):
    match=re.fullmatch(r'terra_correction_(first|successor)_([0-9]{14}_[0-9a-f]{6})',role)
    if match is None or database!='terra_successor_'+match[2]:raise ValueError('Invalid fixed correction client')
    shell='IFS= read -r PGPASSWORD; export PGPASSWORD; export PGPASSFILE=/dev/null PGSSLMODE=disable PGCONNECT_TIMEOUT=3; exec '+BIN+'psql -h 127.0.0.1 -U '+role+' -d '+database+' -X -qAt -v ON_ERROR_STOP=1'
    return ['docker','exec','-i',TARGET,'sh','-c',shell]


def client(role,password,database,sql):
    return command(client_args(role,database),data=password+'\n'+sql,timeout=15)


def main():
    if sys.argv[1:]:raise ValueError('Fixed invented correction trial accepts no arguments')
    candidate=CANDIDATE.read_bytes();pin=sha256(candidate).hexdigest()
    phases=[];prior=None;retained=[]
    def observe(phase,projection,database,proof,owner):
        nonlocal prior
        if CANDIDATE.read_bytes()!=candidate:raise ValueError('Correction candidate changed during trial')
        if phase=='first':
            private_file(proof/'EXACT_INVENTED_CORRECTION_CANDIDATE.sql',candidate.decode())
            owner('begin;'+candidate.decode()+'commit;','correction_candidate')
        suffix=proof.name.removeprefix('authenticated-successor-')
        role='terra_correction_'+phase+'_'+suffix
        password=secrets.token_urlsafe(48);created=False;checks=[];successful=[]
        target={k:projection[k] for k in ('issueId','publicationId','revision','jurisdictionSlug','issueSlug')}
        target['claimId']=projection['claims'][0]['id']
        def call(selected,fields):
            sql='select terra_correction_test_api.submit_report('+quote(json.dumps(selected))+'::jsonb,'+quote(json.dumps(fields))+'::jsonb);'
            return client(role,password,database,sql)
        def deny(label,selected,fields):
            before=owner('select count(*) from terra_private.correction_reports;',phase+'_before_'+label)
            result=call(selected,fields)
            # Invented inputs may be preserved, never actual report text or a
            # credential. Return only the generic diagnostic category.
            private_file(proof/(phase+'-CORRECTION_DENIED_'+label+'.json'),json.dumps({
                'returncode':result.returncode,'accepted':False,'sourceRequests':0})+'\n')
            if not result.returncode or owner('select count(*) from terra_private.correction_reports;',phase+'_after_'+label)!=before:
                raise ValueError('Invented correction rejection failed: '+label)
            checks.append(label)
        try:
            sensitive_admin('create role '+role+' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password '+quote(password)+';')
            created=True
            # The existing driver independently materialized this fixture's
            # public projection. Pin its exact current native candidate too;
            # changes to reader reviews/bindings cannot reuse this scope.
            owner('insert into terra_correction_test_api.principal_scopes values('+quote(role)+','+quote(target['issueId'])+
                ",clock_timestamp()+interval '3 minutes',true,encode(sha256(convert_to(terra_private.read_issue_candidate('fictional-country','fictional-share')::text,'UTF8')),'hex'));grant usage on schema terra_correction_test_api to "+role+
                ';grant execute on function terra_correction_test_api.submit_report(jsonb,jsonb) to '+role+';',phase+'_correction_scope')
            for sql,label in (
                ('select * from terra_private.correction_reports;','private_read'),
                ('select * from terra_correction_test_api.principal_scopes;','scope_read'),
                ("update terra_correction_test_api.principal_scopes set enabled=true;",'scope_update'),
                ('delete from terra_private.correction_reports;','report_delete'),
                ("update terra_private.correction_reports set review_state='closed';",'review_update'),
                ('select terra_private.activate_machine_publication(null,null,null,null,null,null);','public_activation')):
                result=client(role,password,database,sql)
                if not result.returncode:raise ValueError('Correction account gained unexpected permission')
                checks.append(label)
            # Neither SET ROLE nor an anonymous session can acquire this API.
            for denied_role in ('anon','authenticated','service_role','terra_reviewer','terra_issue_reader'):
                output=owner('select has_function_privilege('+quote(denied_role)+
                    ",'terra_correction_test_api.submit_report(jsonb,jsonb)','execute');",phase+'_grant_'+denied_role)
                if output!='f':raise ValueError('Correction function grant leaked')
                checks.append('no_grant_'+denied_role)
            invalid_targets=[]
            for key in target:
                changed=deepcopy(target);changed.pop(key);invalid_targets.append(('missing_'+key,changed))
            for key,value in (('issueId','11111111-1111-4111-8111-111111111111'),('publicationId',None),
                ('revision',str(target['revision'])),('revision',None),('revision',3),
                ('jurisdictionSlug','norway'),('issueSlug','housing-costs'),
                ('claimId','11111111-1111-4111-8111-111111111111'),('claimId','not-a-uuid')):
                changed={**target,key:value};invalid_targets.append((key+'_'+str(value),changed))
            invalid_targets.append(('extra_target',{**target,'reviewState':'closed'}))
            for label,changed in invalid_targets:deny(label,changed,FIELDS)
            for label,changed in (
                ('extra_review',{**FIELDS,'reviewState':'closed'}),('timestamp',{**FIELDS,'reportedAt':'2026-10-02T00:00:00Z'}),
                ('short_text',{**FIELDS,'details':'short'}),('long_text',{**FIELDS,'details':'x'*1001}),
                ('wrong_kind',{**FIELDS,'kind':'publish'}),('null_text',{**FIELDS,'details':None}),
                ('control_text',{**FIELDS,'details':'unsafe\x01 invented text'}),
                ('unapproved_url',{**FIELDS,'sourceUrl':'https://example.net/other'}),
                ('credential_url',{**FIELDS,'sourceUrl':'https://user:pass@example.org/'}),
                ('missing_url',{k:v for k,v in FIELDS.items() if k!='sourceUrl'})):
                deny(label,target,changed)
            if prior is not None:
                deny('stale_first_publication',prior,FIELDS)
                deny('old_claim_on_successor',{**target,'claimId':prior['claimId']},FIELDS)
            expected_pin=owner('select expected_candidate_sha256 from terra_correction_test_api.principal_scopes where principal='+quote(role)+';',phase+'_candidate_pin')
            owner('update terra_correction_test_api.principal_scopes set expected_candidate_sha256='+quote('0'*64)+' where principal='+quote(role)+';',phase+'_wrong_candidate_pin')
            deny('wrong_current_candidate_pin',target,FIELDS)
            owner('update terra_correction_test_api.principal_scopes set expected_candidate_sha256='+quote(expected_pin)+' where principal='+quote(role)+';',phase+'_restore_candidate_pin')
            for selected in (target,{**target,'claimId':None}):
                reply=call(selected,FIELDS)
                if reply.returncode:raise ValueError('Current invented correction was refused')
                value=json.loads(reply.stdout)
                if value.get('status')!='recorded_private' or value.get('publicationId')!=target['publicationId'] \
                        or value.get('revision')!=target['revision']:raise ValueError('Invented correction receipt differs')
                successful.append(value['reportId']);retained.append(value['reportId'])
            owner('update terra_private.source_registrations set allow_public_derived=false where id='+quote(REG)+';',phase+'_withdraw_source')
            deny('current_source_withdrawn',target,FIELDS)
            # Even a bad owner-provided baseline cannot override the explicit
            # current rights check. This mutation is invented setup only.
            owner("update terra_correction_test_api.principal_scopes set expected_candidate_sha256=encode(sha256(convert_to(terra_private.read_issue_candidate('fictional-country','fictional-share')::text,'UTF8')),'hex') where principal="+quote(role)+';',phase+'_pin_withdrawn_candidate')
            deny('withdrawn_source_with_matching_pin',target,FIELDS)
            # This owner-only fixture restoration is part of the declared test
            # setup, not a request to restore rights in a live registration.
            owner('update terra_private.source_registrations set allow_public_derived=true where id='+quote(REG)+';',phase+'_restore_fixture_source')
            owner('update terra_correction_test_api.principal_scopes set expected_candidate_sha256='+quote(expected_pin)+' where principal='+quote(role)+';',phase+'_restore_qualified_pin')
            owner('update terra_correction_test_api.principal_scopes set enabled=false where principal='+quote(role)+';',phase+'_disable_correction_scope')
            deny('disabled_scope',target,FIELDS)
            owner('update terra_correction_test_api.principal_scopes set enabled=true,expires_at=clock_timestamp()-interval \'1 second\' where principal='+quote(role)+';',phase+'_expire_correction_scope')
            deny('expired_scope',target,FIELDS)
            count=owner("select jsonb_build_object('reports',count(*),'allNew',bool_and(review_state='new' and reviewed_at is null and resolution_note is null)) from terra_private.correction_reports;",phase+'_reports_readback')
            checked=json.loads(count)
            if checked!={'reports':len(retained),'allNew':True}:raise ValueError('Private reports changed review state')
            phases.append({'phase':phase,'revision':target['revision'],'reportsAdded':2,'denials':checks,
                'ordinaryWriterUsesOwnerSql':False,'publicContentChangedByReports':False})
            prior=target
        finally:
            if created:
                sensitive_admin('alter role '+role+' nologin;')
                if owner('select rolcanlogin from pg_roles where rolname='+quote(role)+';',phase+'_retired_correction_account',database='postgres')!='f':
                    raise ValueError('Temporary correction account was not retired')
            password=''
    with fixed_trial_guard():result=trial(projection_observer=observe)
    proof=Path(result['privateEvidenceDirectory'])
    closed={'evidenceKind':'actual_invented_correction_intake_first_successor',
        'observedAt':datetime.now(timezone.utc).isoformat(),'candidateSha256':pin,'phases':phases,
        'privateReports':len(retained),'realReports':0,'actualSourceRequests':0,'primaryChanged':False,
        'browserVerified':False,'liveIntakeEnabled':False,'contactCollected':False,
        'privacyPolicySelected':False,'temporaryAccountsRetired':True,'ownedCloneStopped':True,
        'privateEvidenceDirectory':str(proof)}
    private_file(proof/'INVENTED_CORRECTION_RESULT.json',json.dumps(closed,indent=2)+'\n')
    print(json.dumps(closed,indent=2));return 0


if __name__=='__main__':raise SystemExit(main())
