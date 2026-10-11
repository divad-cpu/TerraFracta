"""Integrate the existing real driver with a fixed invented producer only.

The parent supplies an already checked fresh network-none owner. No connection,
credential, real-source mapping or runtime selector is constructed here. Existing
worker behavior and historical fixtures are reused without rewriting their proof.
"""
from hashlib import sha256
import json
import re
from uuid import uuid5, NAMESPACE_URL

from scripts.captured_fictional_pipeline import OwnerPipelineBackend, DECISION, ROOT
from scripts.check_run_admission_concurrency import quote
from workers.captured_update_pipeline import execute_captured_update, resume_manifest_processing
from workers.update_run_closeout import completion_summary_payload


def run_proposal_pipeline_trial(owner, node, record):
    results=[]
    migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
    drafts=['TF007_PROPOSAL_CAPTURE.sql','TF007_PROPOSAL_READER.sql','TF007_PROPOSAL_CAPTURE_COMMAND.sql']
    def prepared_sql(command):
        # Execute the shipped fixed prepared statement in the psql-only trial.
        # Replace its six placeholders once using existing safe SQL quoting;
        # source text never supplies SQL or a connection setting.
        slots=re.findall(r'\$([1-6])\b',command['sql'])
        assert sorted(slots)==list('123456') and len(command['values'])==6
        return re.sub(r'\$([1-6])\b',lambda m:'null' if command['values'][int(m[1])-1] is None
            else quote(command['values'][int(m[1])-1]),command['sql'])+';'
    class Backend(OwnerPipelineBackend):
        def __init__(self, database, mode):
            super().__init__('held_finished')
            self.db=database;self.mode=mode;self.bridge=mode!='legacy';self.interrupt=mode=='ambiguous';self.receipts=[]
            self.selection=None;self.proposal=None;self.manifest_checkpoint=None
        def query(self, sql, stage):
            return owner(sql,'pipeline-'+self.mode+'-'+stage,database=self.db)
        def store_manifest(self, manifest, work):
            self.manifest_checkpoint=super().store_manifest(manifest,work)
            return self.manifest_checkpoint
        def process(self, manifest, work):
            processing=super().process(manifest,work)
            if not self.bridge:return processing
            assert len(processing.decisions)==1 and processing.decisions[0].disposition=='held'
            if self.selection is None:
                publication=self.payload['draft']['publication']
                self.selection={'captureId':str(uuid5(NAMESPACE_URL,'terrafracta:fictional:proposal:'+manifest.run_id)),
                    'runId':manifest.run_id,'decisionId':DECISION,'issueId':publication['issueId'],'basePublicationId':None}
                # The existing extractor has checked this fixed wording/value,
                # locator and source digest against the actual reserved body.
                self.proposal={'schemaVersion':1,'kind':'review_only','snapshot':publication['snapshot'],
                    'dependencyManifest':publication['dependencyManifest'],'conflictCoverage':'not_recorded',
                    'translation':{'displayLanguage':'en','status':'unreviewed'}}
            command=node({'mode':'prepare','selection':self.selection,'payload':self.proposal})
            receipt=json.loads(self.query(prepared_sql(command),'proposal-command'))
            self.receipts.append(receipt);self.events.append('proposal_committed')
            if self.interrupt:
                self.interrupt=False
                raise RuntimeError('Synthetic receipt lost after committed capture')
            verified=node({'mode':'verify','selection':self.selection,'payload':self.proposal,'receipt':receipt})
            assert verified==receipt
            self.events.append('proposal_receipt_checked')
            return processing
        def read(self, kind):
            scope={'runId':str(self.work.run_id),'decisionId':DECISION}
            raw=self.query('begin read only;set local role terra_reviewer;select terra_private.read_operator_proposal('
                +quote(scope['runId'])+','+quote(DECISION)+');rollback;','proposal-read')
            report=json.loads(raw)
            checked=node({'mode':'read','scope':scope,'report':report,'expectedKind':kind})
            return {'scope':scope,'report':report,'checked':checked}
        def counts(self):
            return json.loads(self.query("select jsonb_build_object('captures',(select count(*) from terra_private.proposal_captures),"
                "'closeouts',(select count(*) from terra_private.update_run_closeouts),'decisions',(select count(*) from terra_private.machine_candidate_decisions),"
                "'publications',(select count(*) from terra_private.issue_publications),'dispatches',(select count(*) from terra_private.source_response_dispatches));",'counts'))
    for mode in ('legacy','connected','ambiguous'):
        db='terra_proposal_pipeline_'+mode
        assert owner('select count(*) from pg_database where datname='+quote(db),'pipeline-absent-'+mode,database='postgres')=='0'
        owner('create database '+db,'pipeline-create-'+mode,database='postgres')
        for index,path in enumerate(migrations):owner(path.read_text(),'pipeline-'+mode+'-migration-'+str(index),database=db)
        for name in drafts:owner((ROOT/'research/pending'/name).read_text(),'pipeline-'+mode+'-draft-'+name,database=db)
        backend=Backend(db,mode);plan=backend.seed_and_claim()
        if mode=='ambiguous':
            try:execute_captured_update((plan,),backend)
            except RuntimeError as error:assert str(error)=='Synthetic receipt lost after committed capture'
            else:raise AssertionError('Injected ambiguous receipt did not stop the driver')
            before=backend.counts();assert before=={'captures':1,'closeouts':0,'decisions':1,'publications':0,'dispatches':1}
            events_before=list(backend.events)
            closeout=resume_manifest_processing(backend.manifest,backend.request,backend.work,
                backend.manifest_checkpoint,str(backend.work.lease_id),backend)
            assert backend.stream_opens==1 and backend.receipts[0]['status']=='stored' and backend.receipts[1]['status']=='replayed'
            assert backend.receipts[0]['capturedAt']==backend.receipts[1]['capturedAt']
            assert 'fixture_opened' not in backend.events[len(events_before):]
        else:closeout=execute_captured_update((plan,),backend)
        assert backend.stream_opens==1 and closeout.summary.visibility_state=='not_required'
        counts=backend.counts();assert counts=={'captures':0 if mode=='legacy' else 1,'closeouts':1,'decisions':1,'publications':0,'dispatches':1}
        read=backend.read('capture_missing' if mode=='legacy' else 'ok')
        if mode!='legacy':
            assert backend.events.index('proposal_receipt_checked')<backend.events.index('closeout_committed')
            assert read['report']['decision']['sourceSha256']==sha256(backend.capture.body).hexdigest()
            assert read['report']['sourceReceipts'][0]['retrievedAt']==backend.capture.settlement.settled_at.strftime('%Y-%m-%dT%H:%M:%S.%fZ')
            old=json.dumps(backend.proposal,sort_keys=True)
            backend.proposal['snapshot']['summary']='Different replay is refused.'
            conflicting=node({'mode':'prepare','selection':backend.selection,'payload':backend.proposal})
            owner(prepared_sql(conflicting),'pipeline-'+mode+'-conflicting-replay',database=db,expect='23505')
            assert backend.counts()==counts
            backend.proposal=json.loads(old)
            assert backend.read('ok')['report']['capture']==read['report']['capture']
        results.append({'mode':mode,'counts':counts,'events':backend.events,'streamOpens':backend.stream_opens,
            'closeout':completion_summary_payload(closeout.summary),'receipts':backend.receipts,'read':read,
            'actualSourceBodySha256':sha256(backend.capture.body).hexdigest(),'realSourceRequests':0,'runtimeProducerConfigured':False})
    record('PIPELINE_INTEGRATION',{'scenarios':results,'methods':3,'primaryChanged':False,'publicationAuthorized':False})
    return results
