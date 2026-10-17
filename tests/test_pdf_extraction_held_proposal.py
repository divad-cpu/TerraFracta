"""New detached PDF correspondence, not substantive editorial qualification."""
import base64
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.test_pdf_custody_review_report import values, ARTIFACT
from tests.test_pdf_result_packet import supplied, capture, output, expected as packet_expected, CallbackUtc
from workers.pdf_extraction_request import compile_pdf_extraction_request
from workers.pdf_result_packet import prepare_pdf_result_packet
from workers.pdf_result_custody import reopen_pdf_result_custody, _intent
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import _json
import workers.pdf_extraction_held_proposal as m

UID=lambda n:f'70000000-0000-4000-8000-{n:012d}'


def context(expected, proposal, *, artifact=ARTIFACT):
    b=expected.current.binding;stored=expected.prepared_at+timedelta(seconds=1)
    return dict(schema_version=1,kind='invented_detached_extraction_context',snapshot_intent='single_claim_technical_review_not_issue_replacement',
        artifact=dict(operation_id=expected.operation_id,artifact_id=artifact,request_sha256=expected.request.request_sha256,output_sha256=expected.output_sha256),
        held=dict(run_id=UID(1),decision_id=UID(2),item_key=b.item_key,source_version_id=b.source_version_id,content_sha256=b.content_sha256,locator=proposal['locator'],jurisdiction_id='fictional-region',decided_at=_stamp(stored+timedelta(seconds=1)),disposition='held'),
        issue=dict(issue_id=UID(3),jurisdiction_id='fictional-region',jurisdiction_slug='fictional-region',issue_slug='invented-pdf-issue',created_at=_stamp(stored-timedelta(days=5)),observed_at=_stamp(stored+timedelta(seconds=2)),head=dict(publication_id=None,content_sha256=None,changed_at=None)),
        content=dict(capture_id=UID(4),claim_id=UID(5),title='Invented PDF candidate',summary='One private unverified candidate; no replacement issue.',period_label='Separately supplied period',last_evidence_review_on=(stored+timedelta(days=1)).date().isoformat(),review_date_basis='independently_supplied_not_inferred',publisher='Invented publisher',source_title='Invented PDF document',source_published_on=None),
        support=dict(source_version_id=b.source_version_id,content_sha256=b.content_sha256,locator=proposal['locator'],assertion=proposal['proposed_assertion'],claim_type=proposal['proposed_claim_type'],relation='supports',assignment_state='proposed_only'),
        translation=dict(display_language=b.language_code,status='unreviewed'))


def inputs():
    receipt,expected,intent,at,_=values()
    packet=json.loads(base64.b64decode(json.loads(receipt)['packet_base64']))
    proposal=json.loads(base64.b64decode(packet['output']['base64']))
    return receipt,expected,intent,at,context(expected,proposal)


def prepare(data=None, ctx=None, at=None):
    receipt,expected,intent,observed,independent=inputs() if data is None else data
    return m.prepare_pdf_extraction_held_proposal(receipt,expected,_json(independent if ctx is None else ctx),intent_raw=intent,observed_at=observed if at is None else at)


class PdfExtractionHeldProposalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw,e,intent,at,_=inputs()
        cls.reopened=reopen_pdf_result_custody(raw,e,intent_raw=intent,observed_at=at)

    @contextmanager
    def actual(self):
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            p=launch(*args,**kwargs);children.append(p);return p
        with patch.object(inspector.subprocess,'Popen',side_effect=start),patch.object(m,'reopen_pdf_result_custody',wraps=m.reopen_pdf_result_custody)as core:
            try:yield children,core
            finally:
                for p in children:
                    self.assertIsNotNone(p.poll());self.assertTrue(all(getattr(p,k).closed for k in ('stdin','stdout','stderr')))

    def refusal(self, call):
        with self.assertRaisesRegex(m.PdfExtractionHeldProposalError,'^pdf_extraction_held_proposal_unavailable$')as caught:call()
        self.assertIsNone(caught.exception.__cause__)

    def test_actual_prior_originals_once_yield_four_private_exact_parts(self):
        data=inputs()
        with self.actual()as(children,core):result=prepare(data)
        self.assertEqual(len(children),2);self.assertEqual(core.call_count,1)
        payload=json.loads(result.payload_raw);selection=json.loads(result.selection_raw);proof=json.loads(result.provenance_raw)
        self.assertEqual(result.context_raw,_json(data[-1]));self.assertEqual(payload['kind'],'review_only');self.assertEqual(len(payload['snapshot']['claims']),1)
        self.assertEqual(selection['basePublicationId'],None);self.assertEqual(payload['translation']['status'],'unreviewed');self.assertEqual(payload['conflictCoverage'],'not_recorded')
        self.assertEqual(proof['kind'],'detached_pdf_extraction_proposal');self.assertEqual(proof['limits']['page_index_kind'],'physical_1_based');self.assertEqual(proof['limits']['offset_space'],'derived_page_utf8')
        self.assertEqual(proof['current']['content_sha256'],data[1].current.document.content_sha256);self.assertIsNotNone(proof['previous'])
        self.assertEqual(proof['artifact_stored_at'],_stamp(data[1].prepared_at+timedelta(seconds=1)))
        for part,key in [(result.payload_raw,'payload_sha256'),(result.selection_raw,'selection_sha256')]:self.assertEqual(sha256(part).hexdigest(),proof[key])
        self.assertNotIn('CLI_CURRENT_SELECTED',repr(result));self.assertNotIn(b'%PDF-',result.provenance_raw);self.assertNotIn(b'base64',result.provenance_raw)
        self.assertEqual(proof['independent_context']['support']['assignment_state'],'proposed_only')

    def test_explicit_first_observation_is_one_original_not_invalid_previous_fallback(self):
        now,_,_=supplied();current=capture(now);request=compile_pdf_extraction_request(current,observed_at=now.expected.recorded_observed_at,maximum_output_tokens=100)
        raw_output=output(now);packet=prepare_pdf_result_packet(now,None,request=request,output_raw=raw_output,operation_id='30000000-0000-4000-8000-000000000001',prepared_at=now.expected.recorded_observed_at+timedelta(minutes=1))
        expected=packet_expected(packet,now,None,request);intent=_intent(packet.raw,expected)
        receipt=_json(dict(schema_version=1,kind='invented_pdf_result_stored',operation_id=expected.operation_id,artifact_id=ARTIFACT,stored_at=_stamp(expected.prepared_at+timedelta(seconds=1)),intent_base64=base64.b64encode(intent).decode(),packet_base64=base64.b64encode(packet.raw).decode(),intent_sha256=sha256(intent).hexdigest(),packet_sha256=expected.packet_sha256,intent_bytes=len(intent),packet_bytes=len(packet.raw)))
        at=expected.prepared_at+timedelta(days=2);ctx=context(expected,json.loads(raw_output))
        with self.actual()as(children,core):result=prepare((receipt,expected,intent,at,ctx))
        self.assertEqual(len(children),1);self.assertEqual(core.call_count,1);self.assertIsNone(json.loads(result.provenance_raw)['previous'])
        bad=list(inputs());bad[1]=replace(bad[1],previous=None)
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:
            self.refusal(lambda:prepare(tuple(bad)));child.assert_not_called()

    def test_context_identity_held_source_support_and_issue_joins_are_all_required(self):
        _,_,_,_,base=inputs();changes=[('artifact','artifact_id',UID(10)),('artifact','operation_id',UID(11)),('artifact','request_sha256','f'*64),('artifact','output_sha256','f'*64),('held','source_version_id',UID(10)),('held','item_key','foreign'),('held','content_sha256','f'*64),('held','locator','foreign'),('held','disposition','approved'),('issue','jurisdiction_id','foreign'),('support','assertion','An unsupported changed assertion.'),('support','relation','contradicts'),('support','assignment_state','approved')]
        with patch.object(m,'reopen_pdf_result_custody',return_value=self.reopened):
            for group,key,value in changes:
                ctx=deepcopy(base);ctx[group][key]=value
                with self.subTest(group=group,key=key):self.refusal(lambda:prepare(ctx=ctx))

    def test_empty_and_known_heads_stay_explicit_and_partial_absent_heads_refuse(self):
        data=inputs();ctx=deepcopy(data[-1]);ctx['issue']['head']=dict(publication_id=UID(22),content_sha256='e'*64,changed_at=_stamp(data[1].prepared_at-timedelta(days=1)))
        with patch.object(m,'reopen_pdf_result_custody',return_value=self.reopened):
            result=prepare(data,ctx);self.assertEqual(json.loads(result.selection_raw)['basePublicationId'],UID(22))
            for key in ('publication_id','content_sha256','changed_at'):
                broken=deepcopy(ctx);broken['issue']['head'][key]=None;self.refusal(lambda:prepare(data,broken))
            del ctx['issue']['head'];self.refusal(lambda:prepare(data,ctx))

    def test_separate_chronology_source_date_and_review_date_never_inferred(self):
        data=inputs();base=data[-1];e=data[1]
        changes=[('held','decided_at',_stamp(e.prepared_at)),('issue','observed_at',_stamp(e.prepared_at)),('content','last_evidence_review_on','9999-01-01'),('content','source_published_on','9999-01-01'),('content','review_date_basis','model_date'),('translation','status','not_required'),('translation','display_language','nb')]
        with patch.object(m,'reopen_pdf_result_custody',return_value=self.reopened):
            for group,key,value in changes:
                ctx=deepcopy(base);ctx[group][key]=value
                with self.subTest(group=group,key=key):self.refusal(lambda:prepare(data,ctx))

    def test_context_closed_types_duplicates_capacity_and_private_errors(self):
        raw,e,intent,at,ctx=inputs();valid=_json(ctx)
        bad=[b'',b'x'*32769,b'{}',b'{"schema_version":1,"schema_version":1}',b'{"x":NaN}',bytearray(valid)]
        for body in bad:
            with self.subTest(type=type(body).__name__):self.refusal(lambda:m.prepare_pdf_extraction_held_proposal(raw,e,body,intent_raw=intent,observed_at=at))
        with patch.object(m,'reopen_pdf_result_custody',return_value=self.reopened):
            for key in ('unknown','snapshot_intent'):
                value=deepcopy(ctx);value[key]='PRIVATE';self.refusal(lambda:prepare(ctx=value))
            value=deepcopy(ctx);value['schema_version']=True;self.refusal(lambda:prepare(ctx=value))
        with patch.object(m,'reopen_pdf_result_custody',side_effect=RuntimeError('PRIVATE_CORE_CANARY')):self.refusal(lambda:prepare())

    def test_all_caller_expectations_captured_before_first_clock_callback(self):
        data=list(inputs());e=data[1];good=e.output_sha256;object.__setattr__(e,'output_sha256','f'*64)
        clock=CallbackUtc(lambda:object.__setattr__(e,'output_sha256',good))
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:
            self.refusal(lambda:prepare(tuple(data),at=data[3].replace(tzinfo=clock)));child.assert_not_called()
        self.assertGreater(clock.calls,0)

    def test_native_callback_cannot_change_original_context_or_expected(self):
        data=inputs();e=data[1]
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            object.__setattr__(e,'operation_id',UID(99));object.__setattr__(e.current.binding,'item_key','foreign')
            p=launch(*args,**kwargs);children.append(p);return p
        with patch.object(inspector.subprocess,'Popen',side_effect=start):result=prepare(data)
        self.assertEqual(len(children),2);self.assertEqual(json.loads(result.provenance_raw)['artifact']['operation_id'],data[-1]['artifact']['operation_id'])
        self.assertTrue(all(p.poll()is not None and all(getattr(p,k).closed for k in ('stdin','stdout','stderr'))for p in children))

    def test_payload_bound_provenance_bound_and_boundary_text_are_not_silently_normalized(self):
        with patch.object(m,'reopen_pdf_result_custody',return_value=self.reopened):
            for field in ('MAX_PAYLOAD_BYTES','MAX_PROVENANCE_BYTES'):
                with patch.object(m,field,1):self.refusal(lambda:prepare())
            ctx=inputs()[-1];ctx['content']['title']='\ufeffBoundary title';self.refusal(lambda:prepare(ctx=ctx))
            ctx=inputs()[-1];ctx['content']['title']='Interior\ufefftitle';result=prepare(ctx=ctx)
            self.assertEqual(json.loads(result.payload_raw)['snapshot']['title'],ctx['content']['title'])
            raw,e,intent,at,ctx=inputs();pretty=json.dumps(ctx,indent=2).encode()
            result=m.prepare_pdf_extraction_held_proposal(raw,e,pretty,intent_raw=intent,observed_at=at)
            self.assertEqual(result.context_raw,pretty);proof=json.loads(result.provenance_raw);self.assertNotEqual(proof['supplied_context_sha256'],proof['context_sha256'])

if __name__=='__main__':unittest.main()
