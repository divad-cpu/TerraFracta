"""Actual closed first and successor writers in one isolated invented issue.

Each ordinary SCRAM writer captures its fixed local response, stores a decision
and activates through the same driver. Owner setup supplies exact fixture
templates/qualification; it does not insert a source version, decision or
publication for either writer. No primary, real source, schedule or paid call.
"""
from datetime import datetime,timezone
from copy import deepcopy
from hashlib import sha256
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from uuid import UUID,uuid5
from scripts import check_authenticated_publication_pipeline as publication
from scripts.check_authenticated_capture_pipeline import TARGET,command,sensitive_admin,API
from scripts.check_archived_completion_restore import IMAGE,BIN
from scripts.captured_fictional_pipeline import ROOT,REG,OwnerPipelineBackend,private_file
from scripts.run_authenticated_ssb_pair_capture import PRIVATE
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.fictional_activation_payload import fictional_activation_payload
from scripts.build_fictional_publication_api_v3 import build_publication_api_v3,FIRST_PUBLICATION,SECOND_PUBLICATION
from scripts.check_run_admission_concurrency import quote
from workers.captured_update_pipeline import execute_captured_update
from workers.closed_projection_channel import serve_projection_request

FILES={'first':'fictional_structured_source.json','successor':'fictional_revised_structured_source.json'}

def main():
    if sys.argv[1:]:raise RuntimeError('Fixed authenticated successor rehearsal accepts no arguments')
    with fixed_trial_guard():return trial()

def trial(*,projection_observer=None,trial_cleanup=None,owned_start_observer=None,isolated_reader=False):
    if type(isolated_reader) is not bool:
        raise ValueError("Isolated reader capture must be an exact internal boolean")
    if projection_observer is not None and not callable(projection_observer):
        raise ValueError('Invalid invented projection observer')
    if trial_cleanup is not None and not callable(trial_cleanup):
        raise ValueError('Invalid invented trial cleanup')
    if owned_start_observer is not None and not callable(owned_start_observer):
        raise ValueError('Invalid invented start ownership observer')
    meta=json.loads(command(['docker','inspect','--format',
      '{"image":{{json .Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}}}',TARGET]).stdout)
    assert meta=={'image':IMAGE,'labels':{'terrafracta.capture-auth':'20261001'},'running':False,'network':'none','ports':{}}
    suffix=datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')+'_'+secrets.token_hex(3)
    db='terra_successor_'+suffix;proof=PRIVATE/('authenticated-successor-'+suffix);proof.mkdir(mode=0o700)
    roles={phase:'terra_successor_'+phase+'_'+suffix for phase in FILES}
    publication.CASES={phase:db for phase in FILES};publication.ROLES=roles;publication.PROOF=proof
    passwords={role:secrets.token_urlsafe(48) for role in roles.values()}
    candidate=build_publication_api_v3()
    assert candidate==(ROOT/'research/pending/TF009_fictional_publication_api_v3.sql').read_text()
    private_file(proof/'EXACT_SUCCESSOR_CANDIDATE.sql',candidate)
    started=False;start_attempted=False;created=[];counter=0;phases=[];pipelines={};template_denials=[]
    def owner(sql,label,*,database=db):
        nonlocal counter
        result=command(['docker','exec','-i',TARGET,BIN+'psql','-h','/tmp','-U','postgres','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'],data=sql)
        counter+=1;private_file(proof/(str(counter).zfill(3)+'-'+label+'.log'),result.stdout+'\n'+result.stderr)
        if result.returncode:raise RuntimeError('Private successor fixture setup refused: '+label)
        return result.stdout.strip()
    def export(phase,projection):
        if isolated_reader:
            # This fixed internal mode retains the actual checked projection in
            # this new owned proof only. It does not update the shared web cache
            # or claim four rendered surfaces. Default behavior is unchanged.
            private_file(proof/(phase+'-ISOLATED_PROJECTION.json'),json.dumps(projection,indent=2)+'\n')
            return {'generation':None,'serverSurfacesChecked':0}
        saved=command(['node','--experimental-strip-types','scripts/publish_connected_fictional_reader.mjs'],data=json.dumps(projection),timeout=15)
        private_file(proof/(phase+'-READER_EXPORT.log'),saved.stdout+'\n'+saved.stderr);assert saved.returncode==0
        reader=json.loads(saved.stdout)
        rendered=command(['node','--experimental-strip-types','scripts/check_connected_reader_surfaces.mjs'],timeout=15)
        private_file(proof/(phase+'-READER_SURFACES.json'),rendered.stdout);assert rendered.returncode==0
        checked=json.loads(rendered.stdout);assert checked['generation']==reader['generation']
        assert checked['actualFileBackedStatusVerified'] is True and checked['clientPollingRuntimeVerified'] is False
        assert checked['publicationId']==projection['publicationId'] and len(checked['surfaces'])==4
        return reader
    class RevisionPipeline(publication.PublicationPipeline):
        def opener(self,plan):
            def fixed(endpoint,seconds):
                assert endpoint==plan.response.endpoint and 0<seconds<=30
                self.stream_opens+=1;self.events.append('known_revision_fixture_opened_after_confirmed_dispatch')
                return (ROOT/'fixtures'/FILES[self.case]).open('rb')
            return self.confirmed.authorized_opener(fixed)
    try:
        if owned_start_observer is not None:owned_start_observer(suffix)
        # The daemon may start the owned clone before its acknowledgment is lost.
        # Arm cleanup before I/O, after validating the exact stopped target.
        start_attempted=True
        assert command(['docker','start',TARGET],timeout=15).returncode==0;started=True
        for _ in range(20):
            if command(['docker','exec',TARGET,BIN+'pg_isready','-h','/tmp','-U','postgres'],timeout=5).returncode==0:break
            time.sleep(.2)
        owner('create database '+db+';','new_database',database='postgres')
        for index,path in enumerate(sorted((ROOT/'supabase/migrations').glob('*.sql'))):owner(path.read_text(),'baseline_'+str(index))
        owner('begin;'+candidate+'commit;','closed_successor_candidate')
        for role in roles.values():
            # A lost acknowledgement can follow a successful CREATE. Track the
            # owned attempt before I/O so cleanup checks that account as well.
            created.append(role)
            sensitive_admin('create role '+role+' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password '+quote(passwords[role])+';')
        first_bytes=None
        for phase in FILES:
            setup=OwnerPipelineBackend('stored_fact');setup.case=phase;setup.db=db
            setup.query=lambda sql,label:owner(sql,phase+'_'+label)
            if phase=='successor':
                setup.parts['seed']=''
                setup.payload=fictional_activation_payload(distinct_public_target=True,scenario='revised_value')
                p=setup.payload['draft']['publication'];p.update(revision=2,kind='correction',previousPublicationId=FIRST_PUBLICATION)
                claim=p['snapshot']['claims'][0];claim['id']=str(uuid5(UUID(claim['id']),'fictional-revised-2025'))
            plan=setup.seed_and_claim();role=roles[phase];body=(ROOT/'fixtures'/FILES[phase]).read_bytes()
            assert setup.payload['draft']['decision']['contentSha256']==sha256(body).hexdigest()
            owner('insert into terra_publication_test_api.principal_scopes(principal,run_id,registration_id,actor_id,scope,max_body_bytes,expires_at,enabled,work_claim_id,source_version_id,item_key,body_sha256,body_bytes,trusted_fixture) values('+','.join((
                quote(role),quote(str(setup.work.run_id)),quote(REG),quote(plan.response.invocation.actor_id),quote(plan.response.invocation.scope),'65536',
                "clock_timestamp()+interval '4 minutes'",'true',quote(str(setup.work.lease_id)),quote(plan.source_version_id),quote(plan.expected_item_keys[0]),
                quote(sha256(body).hexdigest()),str(len(body)),quote(json.dumps(setup.payload))+'::jsonb'))+');grant usage on schema terra_publication_test_api to '+role+';grant execute on function '+','.join('terra_publication_test_api.'+signature for signature in (*API,*publication.EXTRA_API))+' to '+role+';','trusted_'+phase+'_scope')
            authenticated=publication.client(role,passwords[role],db,'select system_user;')
            assert authenticated.returncode==0 and authenticated.stdout.strip()=='scram-sha-256:'+role
            for label,sql in (('private_write','update terra_private.issue_heads set current_publication_id=null;'),
                ('qualification_read','select * from terra_private.automatic_route_qualifications;'),
                ('template_write',"update terra_publication_test_api.principal_scopes set trusted_fixture='{}';"),
                ('helper','select terra_publication_test_api.current_scope();'),('owner_role','set role postgres;')):
                denied=publication.client(role,passwords[role],db,sql);assert denied.returncode!=0
                private_file(proof/(phase+'-DENIED-'+label+'.json'),json.dumps({'denied':True})+'\n')
            pipeline=RevisionPipeline(phase,passwords[role],setup,plan);pipelines[phase]=pipeline
            result=execute_captured_update((plan,),pipeline)
            assert pipeline.stream_opens==1 and 'post_commit_reader_verified' in pipeline.events
            projection=pipeline.projection
            assert projection['revision']==(1 if phase=='first' else 2)
            assert projection['publicationId']==(FIRST_PUBLICATION if phase=='first' else SECOND_PUBLICATION)
            assert ('27.4%' if phase=='first' else '28.1%') in projection['claims'][0]['assertion']
            reader=export(phase,projection)
            current=owner("select current_publication_id from terra_private.issue_heads;",phase+'_head')
            assert current==projection['publicationId']
            if phase=='first':first_bytes=owner('select snapshot::text from terra_private.issue_publications where id='+quote(FIRST_PUBLICATION)+';','first_original_snapshot')
            phases.append({'phase':phase,'publicationId':current,'revision':projection['revision'],'readerGeneration':reader['generation'],
                'ordinaryRuntimeUsesOwnerSql':False,'fixtureReads':pipeline.stream_opens,'serverSurfacesChecked':reader.get('serverSurfacesChecked',4),'events':pipeline.events,
                'processingState':result.summary.run_state,'visibilityState':result.summary.visibility_state})
            if isolated_reader:phases[-1]['isolatedProjectionRevision']=projection['revision']
            if projection_observer is not None:
                projection_observer(phase,projection,db,proof,owner)
        replay=publication.client(roles['first'],passwords[roles['first']],db,'select terra_publication_test_api.activate_fact();')
        private_file(proof/'FIRST_ACTIVATION_REPLAY_AFTER_SUCCESSOR.log',replay.stdout+'\n'+replay.stderr)
        assert replay.returncode==0 and json.loads(replay.stdout)['status']=='already_activated'
        assert owner('select current_publication_id from terra_private.issue_heads;','head_after_old_replay')==SECOND_PUBLICATION
        assert owner('select snapshot::text from terra_private.issue_publications where id='+quote(FIRST_PUBLICATION)+';','first_snapshot_after_successor')==first_bytes
        # Exercise the actual SCRAM call, including SQL NULL/missing-field cases.
        # A normal "NOT (...)" guard would silently accept unknown here.
        trusted=deepcopy(setup.payload)
        for label,key,value,remove in (
            ('missing_revision','revision',None,True),('null_revision','revision',None,False),
            ('unknown_revision','revision',3,False),('noncanonical_revision','revision','02',False),
            ('missing_identity','id',None,True),('wrong_identity','id',FIRST_PUBLICATION,False),
            ('missing_predecessor','previousPublicationId',None,True),
            ('null_predecessor','previousPublicationId',None,False),
            ('wrong_predecessor','previousPublicationId',SECOND_PUBLICATION,False)):
            altered=deepcopy(trusted);p=altered['draft']['publication']
            if remove:p.pop(key,None)
            else:p[key]=value
            owner('update terra_publication_test_api.principal_scopes set trusted_fixture='+quote(json.dumps(altered))+'::jsonb where principal='+quote(roles['successor'])+';','invalid_template_'+label)
            denied=publication.client(roles['successor'],passwords[roles['successor']],db,'select terra_publication_test_api.read_fact();')
            assert denied.returncode!=0 and 'Only closed first/successor fixture identities are permitted' in denied.stderr
            private_file(proof/('TEMPLATE_DENIED_'+label+'.log'),denied.stdout+'\n'+denied.stderr)
            template_denials.append(label)
        owner('update terra_publication_test_api.principal_scopes set trusted_fixture='+quote(json.dumps(trusted))+'::jsonb where principal='+quote(roles['successor'])+';','restore_exact_owner_template')
        restored=publication.client(roles['successor'],passwords[roles['successor']],db,'select terra_publication_test_api.read_fact();')
        assert restored.returncode==0
        assert owner('select current_publication_id from terra_private.issue_heads;','head_after_template_denials')==SECOND_PUBLICATION
        # A separate child receives only an inherited read-only packet channel.
        # The credential remains with the custodian and its fixed SQL call.
        parent,child=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
        parent.settimeout(5)
        process=subprocess.Popen([sys.executable,'-m','scripts.read_closed_projection_child',str(child.fileno())],
            cwd=ROOT,env={'PATH':os.environ['PATH'],'PYTHONUNBUFFERED':'1'},
            stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(child.fileno(),))
        child.close();readbacks=0;channel_states=[]
        def materialized_projection():
            nonlocal readbacks
            readbacks+=1
            candidate=pipelines['successor'].call('read_fact')
            projected=subprocess.run(['node','--experimental-strip-types','scripts/check_public_candidate.mjs'],cwd=ROOT,input=candidate,capture_output=True,timeout=15)
            assert projected.returncode==0
            result=json.loads(projected.stdout);assert result['publicationId']==SECOND_PUBLICATION
            return result
        try:
            for _ in range(8):channel_states.append(serve_projection_request(parent,materialized_projection))
        finally:
            parent.close()
            stdout,stderr=process.communicate(timeout=20)
            private_file(proof/'CHILD_READ_CHANNEL.log',stdout.decode()+'\n'+stderr.decode())
        assert process.returncode==0 and readbacks==2 and channel_states==['issue']+['refused']*6+['issue']
        channel=json.loads(stdout);assert channel['protocolDenials']==6 and channel['databaseCredentialProvided'] is False
        private_file(proof/'CHILD_READ_CHANNEL_RESULT.json',json.dumps(channel,indent=2)+'\n')
        counts=json.loads(owner("select jsonb_build_object('versions',(select count(*) from terra_private.source_versions),'decisions',(select count(*) from terra_private.machine_candidate_decisions),'activations',(select count(*) from terra_private.machine_publication_activations),'closeouts',(select count(*) from terra_private.update_run_closeouts),'publications',(select count(*) from terra_private.issue_publications),'heads',(select count(*) from terra_private.issue_heads));",'final_counts'))
        assert counts=={'versions':2,'decisions':2,'activations':2,'closeouts':2,'publications':2,'heads':1}
        result={'evidenceKind':'actual_authenticated_capture_first_and_successor','observedAt':datetime.now(timezone.utc).isoformat(),
            'phases':phases,'counts':counts,'oneSharedFictionalIssue':True,'ownerInsertedCapturedVersionsOrDecisionsOrPublications':False,
            'oldActivationReplayCannotRestoreOldHead':True,'firstSnapshotBytesUnchanged':True,'actualSourceRequests':0,'modelCalls':0,
            'closedTemplateDenials':template_denials,'exactTemplateRestoredAfterDenials':True,
            'credentialFreeChildReader':channel,
            'primaryChanged':False,'generalSqlTimingAccepted':False,'browserVerified':False,'privateEvidenceDirectory':str(proof)}
        if isolated_reader:result['readerArchiveMode']='isolated_owned_projection_only'
        private_file(proof/'AUTHENTICATED_SUCCESSOR_RESULT.json',json.dumps(result,indent=2)+'\n')
    except BaseException as error:
        private_file(proof/'SUCCESSOR_FAILURE.json',json.dumps({'exceptionType':type(error).__name__,'completedPhases':phases,'historyRetained':True,'primaryChanged':False})+'\n');raise
    finally:
        if start_attempted:
            try:
                if started:
                    try:
                        if trial_cleanup is not None:trial_cleanup(owner)
                    finally:
                        retirement_failed=False
                        for index,role in enumerate(created):
                            try:
                                exists=owner('select exists(select 1 from pg_roles where rolname='+quote(role)+');','account_exists_'+str(index),database='postgres')
                                if exists=='t':sensitive_admin('alter role '+role+' nologin;')
                                elif exists!='f':raise RuntimeError('Unrecognized private account state')
                            except BaseException:
                                retirement_failed=True
                        predicate='rolname in('+','.join(map(quote,created))+')' if created else 'false'
                        remaining=owner('select count(*) from pg_roles where '+predicate+' and rolcanlogin;','accounts_retired',database='postgres')
                        if retirement_failed or remaining!='0':
                            raise RuntimeError('Private successor account retirement could not be verified') from None
            finally:assert command(['docker','stop','--timeout','10',TARGET],timeout=20).returncode==0
    receipt={**result,'temporaryAccountsRetired':True,'ownedCloneStopped':True}
    # The trusted invented observer receives one final receipt after cleanup;
    # the existing standalone command retains its stdout and exit-status API.
    if projection_observer is not None:return receipt
    print(json.dumps(receipt,indent=2));return 0

if __name__=='__main__':raise SystemExit(main())
