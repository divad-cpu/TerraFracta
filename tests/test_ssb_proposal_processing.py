"""Fixed inactive traversal, correspondence and stop boundaries; no I/O."""
from dataclasses import replace
from datetime import timedelta
from copy import deepcopy
from uuid import UUID
import json
import unittest
from unittest.mock import patch

from tests.helpers.ssb_private_proposal_fixture import fixture, ident
from workers.ssb_14059_proposal_processing import (
    PrivateSSBProposalStage, AnnualScope, AnnualRead, AnnualWrite, UnpreparedAnnual)
from workers.captured_update_pipeline import PipelineResumeRequired
from workers.update_run_completion import RunManifest, PlannedItem, PlannedSource
from workers.update_run_work import WorkClaim

NOW=fixture()['now']
STAMP=NOW.isoformat(timespec='microseconds').replace('+00:00','Z')


class Backend:
    """Trusted seam double; full wire validation is exercised in native tests."""
    def __init__(self):
        sample=fixture();self.elapsed=0;self.offset=0;self.events=[]
        self.work=WorkClaim('claimed',UUID(ident(1)),UUID(ident(2)),1,
            NOW+timedelta(seconds=30),NOW+timedelta(seconds=120),NOW)
        self.scopes=tuple(AnnualScope(ident(1),f'ssb-14059-year-{year}',ident(year),ident(5),ident(7)) for year in (2024,2025))
        self.manifest=RunManifest(ident(1),'a'*64,'shadow',
            tuple(PlannedSource(s.source_key,ident(14+i),s.source_version_id,s.content_sha256) for i,s in enumerate(sample['sources'])),
            (PlannedItem('ssb-14059-year-2024','ssb-14059-data',ident(5)),
             PlannedItem('ssb-14059-year-2025','ssb-14059-data',ident(5)),
             PlannedItem('ssb-14059-metadata-review','ssb-14059-metadata',ident(4))))
        self.reports={};self.read_change=lambda r:r;self.context_change=lambda c:c
        self.write_change=lambda r:r;self.processing_change=lambda p:p;self.delay=None

    def clock(self):return NOW+timedelta(seconds=self.offset)
    def event(self,operation,scope=None):
        self.events.append((operation,None if scope is None else scope.item_key))
        if self.delay==operation:self.elapsed=self.offset=31
    def load(self,scope,work):
        self.event('load',scope);inputs=fixture(int(scope.item_key[-4:]));inputs.pop('now')
        return self.context_change(UnpreparedAnnual(scope,ident(int(scope.item_key[-4:])+200),inputs,True))
    def read_annual(self,scope,work):
        self.event('read',scope);report=deepcopy(self.reports.get(scope.item_key))
        return self.read_change(AnnualRead(scope,'capture_missing' if report is None else 'ok',report))
    def report(self,scope,selection):
        return {'requested':{'runId':scope.run_id,'decisionId':scope.decision_id},
            'decision':{'decisionId':scope.decision_id,'sourceVersionId':scope.source_version_id,
                'sourceSha256':next(s.content_sha256 for s in self.manifest.sources if s.source_key=='ssb-14059-data')},
            'target':{'issueId':scope.issue_id,'jurisdictionSlug':'norway','issueSlug':'housing-cost-burden'},
            'sourceReceipts':[{'sourceVersionId':s.source_version_id,'contentSha256':s.content_sha256} for s in self.manifest.sources],
            'capture':{'captureId':selection['captureId'],'basePublicationId':selection['basePublicationId'],
                'proposalSha256':'b'*64,'capturedAt':STAMP}}
    def result(self,scope,work,selection,status):
        receipt={'schemaVersion':1,'status':status,**selection,'proposalSha256':'b'*64,'capturedAt':STAMP,'observedAt':STAMP}
        return self.write_change(AnnualWrite(scope,self.manifest.request_fingerprint,str(work.lease_id),'confirmed',receipt))
    def capture(self,scope,work,selection,payload):
        self.event('capture',scope)
        assert payload['kind']=='review_only' and payload['snapshot']['claims'][0]['periodLabel']==f'Survey year {scope.item_key[-4:]}'
        self.reports[scope.item_key]=self.report(scope,selection)
        return self.result(scope,work,selection,'stored')
    def recover(self,scope,work,report):
        self.event('recover',scope)
        selection={'runId':scope.run_id,'decisionId':scope.decision_id,'issueId':scope.issue_id,
            'captureId':report['capture']['captureId'],'basePublicationId':report['capture']['basePublicationId']}
        return self.result(scope,work,selection,'replayed')
    def read_processing(self,manifest,work):
        self.event('processing')
        p={'decisions':[{'decisionId':s.decision_id,'itemKey':s.item_key,'sourceVersionId':s.source_version_id,'disposition':'held'} for s in self.scopes],
            'activations':[],'invalidSourceKeys':[]}
        return json.dumps(self.processing_change(p)).encode()
    def seed(self,year):
        scope=self.scopes[year-2024]
        self.reports[scope.item_key]=self.report(scope,{'captureId':ident(year+200),'basePublicationId':None})
    def stage(self,prepare=True):
        return PrivateSSBProposalStage(self.scopes,self,load_unprepared=self.load if prepare else None,
            utc_now=self.clock,monotonic=lambda:self.elapsed)


class PrivateSSBProcessingTests(unittest.TestCase):
    def run_stage(self,b,prepare=True):return b.stage(prepare).process(b.manifest,b.work)
    def operations(self,b):return [name for name,_ in b.events]
    def test_initial_preparation_owns_both_years_and_leaves_metadata_pending(self):
        b=Backend();p=self.run_stage(b)
        self.assertEqual(self.operations(b),['read','load','capture','read','load','capture','processing'])
        self.assertEqual(len(p.decisions),2);self.assertEqual(p.activations,())
        with self.assertRaises(ValueError):b.stage().close(b.manifest,b.work)

    def test_partial_replay_precedes_only_missing_annual_preparation(self):
        b=Backend();b.seed(2024);before=deepcopy(b.reports['ssb-14059-year-2024']);self.run_stage(b)
        self.assertEqual(self.operations(b),['read','recover','read','load','capture','processing'])
        self.assertEqual(b.reports['ssb-14059-year-2024'],before)

    def test_full_stored_recovery_never_loads_or_prepares(self):
        b=Backend();b.seed(2024);b.seed(2025);before=deepcopy(b.reports);self.run_stage(b,False)
        self.assertEqual(self.operations(b),['read','recover','read','recover','processing'])
        self.assertEqual(b.reports,before)

    def test_unknown_or_not_dispatched_stops_before_next_read_or_preparation(self):
        for stored in (False,True):
            for kind in ('outcome_unknown','not_dispatched'):
                with self.subTest(stored=stored,kind=kind):
                    b=Backend()
                    if stored:b.seed(2024)
                    b.write_change=lambda r:replace(r,kind=kind,receipt=None)
                    with self.assertRaises(PipelineResumeRequired):self.run_stage(b)
                    self.assertTrue(all(item=='ssb-14059-year-2024' for _,item in b.events))
                    self.assertNotIn('processing',self.operations(b))

    def test_stored_only_missing_never_invokes_a_producer_or_writer(self):
        b=Backend()
        with self.assertRaises(PipelineResumeRequired):self.run_stage(b,False)
        self.assertEqual(self.operations(b),['read'])

    def test_all_withheld_reads_stop_without_context_report_or_write(self):
        for kind in ('changed','unavailable','unconfigured','not_found','invalid_scope'):
            with self.subTest(kind=kind):
                b=Backend();b.read_change=lambda r:replace(r,kind=kind)
                with self.assertRaises(PipelineResumeRequired):self.run_stage(b)
                self.assertEqual(self.operations(b),['read'])

    def test_read_scope_kind_or_exposed_withheld_report_is_refused(self):
        changes=(lambda r:replace(r,scope=replace(r.scope,decision_id=ident(9))),
            lambda r:replace(r,kind='confirmed'),lambda r:replace(r,report={}))
        for change in changes:
            b=Backend();b.read_change=change
            with self.assertRaises(ValueError):self.run_stage(b)
            self.assertEqual(self.operations(b),['read'])

    def test_missing_is_not_automatic_authority_after_an_ambiguous_write(self):
        b=Backend();b.context_change=lambda c:replace(c,never_dispatched=False)
        with self.assertRaises(ValueError):self.run_stage(b)
        self.assertEqual(self.operations(b),['read','load'])

    def test_context_scope_identity_or_input_set_stops_before_capture(self):
        changes=(lambda c:replace(c,scope=replace(c.scope,issue_id=ident(9))),
            lambda c:replace(c,capture_id='unavailable'),
            lambda c:replace(c,inputs={**c.inputs,'extra':True}),
            lambda c:replace(c,inputs={**c.inputs,'decision':replace(c.inputs['decision'],item_key='ssb-14059-year-2025')}),
            lambda c:replace(c,inputs={**c.inputs,'sources':tuple(replace(s,content_sha256='c'*64) for s in c.inputs['sources'])}))
        for change in changes:
            b=Backend();b.context_change=change
            with self.assertRaises(ValueError):self.run_stage(b)
            self.assertEqual(self.operations(b),['read','load'])

    def test_fixed_manifest_scopes_and_work_are_checked_before_reads(self):
        for change in ('mode','items','source','run','lease','scopes','decision','version','issue','observed'):
            with self.subTest(change=change):
                b=Backend()
                if change=='mode':b.manifest=replace(b.manifest,mode='automatic')
                elif change=='items':b.manifest=replace(b.manifest,items=b.manifest.items[:-1])
                elif change=='source':b.manifest=replace(b.manifest,sources=b.manifest.sources[:-1])
                elif change=='run':b.work=replace(b.work,run_id=UUID(ident(9)))
                elif change=='lease':b.work=replace(b.work,lease_id=None)
                elif change=='scopes':b.scopes=b.scopes[::-1]
                elif change=='decision':b.scopes=(b.scopes[0],replace(b.scopes[1],decision_id=b.scopes[0].decision_id))
                elif change=='version':b.scopes=(replace(b.scopes[0],source_version_id=ident(9)),b.scopes[1])
                elif change=='issue':b.scopes=(replace(b.scopes[0],issue_id=ident(9)),b.scopes[1])
                else:b.work=replace(b.work,observed_at=NOW+timedelta(seconds=1))
                with self.assertRaises(ValueError):self.run_stage(b)
                self.assertEqual(b.events,[])

    def test_confirmed_receipt_identity_hash_time_or_shape_mismatch_stops_next_annual(self):
        values={'runId':ident(9),'decisionId':ident(9),'issueId':ident(9),'captureId':ident(9),
            'basePublicationId':ident(9),'proposalSha256':'invalid','status':'confirmed',
            'schemaVersion':True,'capturedAt':'invalid','observedAt':'2026-10-08T00:00:00.000000Z','extra':True}
        for key,value in values.items():
            with self.subTest(key=key):
                b=Backend();b.write_change=lambda r:replace(r,receipt={**r.receipt,key:value})
                with self.assertRaises(ValueError):self.run_stage(b)
                self.assertEqual(self.operations(b),['read','load','capture'])

    def test_current_fence_and_fingerprint_cannot_be_substituted(self):
        for change in (lambda r:replace(r,work_claim_id=ident(9)),lambda r:replace(r,request_fingerprint='c'*64),
                lambda r:replace(r,scope=replace(r.scope,decision_id=ident(9)))):
            b=Backend();b.write_change=change
            with self.assertRaises(ValueError):self.run_stage(b)
            self.assertEqual(self.operations(b),['read','load','capture'])

    def test_stored_hash_time_status_and_base_must_replay_exactly(self):
        for key,value in {'proposalSha256':'c'*64,'capturedAt':'2026-10-06T10:00:01.000000Z',
                'basePublicationId':ident(9),'status':'stored'}.items():
            b=Backend();b.seed(2024);b.write_change=lambda r:replace(r,receipt={**r.receipt,key:value})
            with self.assertRaises(ValueError):self.run_stage(b)
            self.assertEqual(self.operations(b),['read','recover'])

    def test_report_must_match_current_source_scope_and_fixed_target(self):
        for section,key,value in (('requested','runId',ident(9)),('decision','decisionId',ident(9)),
                ('decision','sourceVersionId',ident(9)),('decision','sourceSha256','c'*64),
                ('target','issueId',ident(9)),('target','issueSlug','other'),('capture','proposalSha256','invalid')):
            b=Backend();b.seed(2024);b.reports['ssb-14059-year-2024'][section][key]=value
            with self.assertRaises(ValueError):self.run_stage(b)
            self.assertEqual(self.operations(b),['read'])

    def test_stored_metadata_and_data_receipts_must_match_both_manifest_sources(self):
        for change in ('metadata_id','metadata_hash','data_hash','duplicate','missing','extra'):
            with self.subTest(change=change):
                b=Backend();b.seed(2024);p=b.reports['ssb-14059-year-2024']['sourceReceipts']
                if change=='metadata_id':p[0]['sourceVersionId']=ident(9)
                elif change=='metadata_hash':p[0]['contentSha256']='c'*64
                elif change=='data_hash':p[1]['contentSha256']='c'*64
                elif change=='duplicate':p[1]=deepcopy(p[0])
                elif change=='missing':p.pop()
                else:p.append(deepcopy(p[0]))
                with self.assertRaises(ValueError):self.run_stage(b)
                self.assertEqual(self.operations(b),['read'])

    def test_unconfirmed_result_with_receipt_cannot_advance(self):
        b=Backend();b.write_change=lambda r:replace(r,kind='outcome_unknown')
        with self.assertRaises(ValueError):self.run_stage(b)
        self.assertEqual(self.operations(b),['read','load','capture'])

    def test_final_processing_cannot_claim_metadata_completion_or_other_decisions(self):
        for change in ('metadata','missing','foreign','disposition','invalid'):
            b=Backend()
            def alter(p):
                if change=='metadata':p['decisions'].append({'decisionId':ident(9),'itemKey':'ssb-14059-metadata-review','sourceVersionId':ident(4),'disposition':'held'})
                elif change=='missing':p['decisions'].pop()
                elif change=='foreign':p['decisions'][0]['decisionId']=ident(9)
                elif change=='disposition':p['decisions'][0]['disposition']='rejected'
                else:p['invalidSourceKeys']=['ssb-14059-data']
                return p
            b.processing_change=alter
            with self.assertRaises(ValueError):self.run_stage(b)
            self.assertEqual(self.operations(b)[-1],'processing')

    def test_callback_expiry_stops_before_next_boundary_for_utc_and_monotonic(self):
        for operation in ('read','load','capture','recover','processing'):
            for clock in ('utc','monotonic'):
                with self.subTest(operation=operation,clock=clock):
                    b=Backend()
                    if operation=='recover':b.seed(2024)
                    event=b.event
                    def delayed(name,scope=None):
                        event(name,scope)
                        if name==operation:
                            if clock=='utc':b.offset=31
                            else:b.elapsed=31
                    b.event=delayed
                    with self.assertRaises(ValueError):self.run_stage(b)
                    self.assertEqual(self.operations(b)[-1],operation)

    def test_producer_expiry_does_not_invoke_capture(self):
        from workers.ssb_14059_private_proposal import prepare_private_ssb_proposal
        b=Backend()
        def delayed(**inputs):
            payload=prepare_private_ssb_proposal(**inputs);b.elapsed=31;return payload
        with patch('workers.ssb_14059_private_proposal.prepare_private_ssb_proposal',side_effect=delayed):
            with self.assertRaises(ValueError):self.run_stage(b)
        self.assertEqual(self.operations(b),['read','load'])


if __name__=='__main__':unittest.main()
