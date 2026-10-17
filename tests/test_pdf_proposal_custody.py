"""New typed PDF historical-preparation contract; invented originals only.

Actual-child counts are measured only around each explicitly named invocation;
class/first-observation setup is separate. Synthetic receipt/context and mocked
stable-field matrices do not qualify a database, storage actor or source fact.
"""
import base64
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta, timezone
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.test_pdf_extraction_held_proposal import inputs as supplied_inputs, context, ARTIFACT, UID
from tests.test_pdf_result_packet import supplied, capture, output, expected as packet_expected, CallbackUtc
from workers.detached_proposal_custody import DetachedProposalParts, PART_LIMITS, part_bytes
from workers.pdf_extraction_held_proposal import DetachedPdfExtractionProposal
from workers.pdf_extraction_request import compile_pdf_extraction_request
from workers.pdf_result_packet import prepare_pdf_result_packet
from workers.pdf_result_custody import _intent
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import _json
import workers.pdf_proposal_custody as m

OPERATION='b1000000-0000-4000-8000-000000000001'


def inputs():
    receipt,expected,intent,at,ctx=supplied_inputs()
    return dict(receipt=receipt,extraction_expected=expected,
        context_raw=json.dumps(ctx,indent=2).encode()+b'\n',intent_raw=intent,
        operation_id=OPERATION,observed_at=at)


def reseal(parts, intent, **changes):
    # Independent test calculation of the supplied metadata, not the production
    # intent builder. Matching supplied hashes do not establish authenticity.
    value=json.loads(intent.canonical_metadata)
    for key,raw in zip(('payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256'),part_bytes(parts)):
        value[key]=sha256(raw).hexdigest()
    value.update(changes)
    return m.PdfPreparationIntent(_json(value))


def changed_proof(prepared, mutate):
    proof=json.loads(prepared.parts.provenance_raw);mutate(proof)
    parts=replace(prepared.parts,provenance_raw=_json(proof))
    return parts,reseal(parts,prepared.intent)


class PdfProposalCustodyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=inputs()
        cls.prepared=m.prepare_pdf_proposal_custody(**cls.data)
        cls.at=cls.prepared.observed_at;cls.stored=cls.at+timedelta(seconds=1);cls.later=cls.at+timedelta(days=2)
        cls.fresh=m.prepare_pdf_extraction_held_proposal(cls.prepared.receipt,cls.prepared.extraction_expected,
            cls.prepared.parts.context_raw,intent_raw=cls.prepared.intent_raw,observed_at=cls.later)

    @contextmanager
    def actual(self):
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            child=launch(*args,**kwargs);children.append(child);return child
        with patch.object(inspector.subprocess,'Popen',side_effect=start), \
                patch.object(m,'prepare_pdf_extraction_held_proposal',wraps=m.prepare_pdf_extraction_held_proposal)as producer:
            try:yield children,producer
            finally:
                for child in children:
                    self.assertIsNotNone(child.poll())
                    self.assertTrue(all(getattr(child,k).closed for k in ('stdin','stdout','stderr')))

    def reobserve(self, prepared=None, **changes):
        p=self.prepared if prepared is None else prepared
        values=dict(receipt=p.receipt,extraction_expected=p.extraction_expected,parts=p.parts,intent=p.intent,
            intent_raw=p.intent_raw,stored_at=self.stored,observed_at=self.later)
        values.update(changes)
        return m.reobserve_pdf_proposal(**values)

    def refuse(self, call, *, reobservation=True):
        message='pdf_proposal_reobservation_unavailable' if reobservation else 'pdf_proposal_preparation_unavailable'
        with self.assertRaisesRegex(m.PdfProposalCustodyError,'^'+message+'$')as caught:call()
        self.assertIsNone(caught.exception.__cause__)

    def test_actual_prepare_opens_two_originals_once_and_binds_four_exact_private_parts(self):
        data=inputs()
        with self.actual()as(children,producer):p=m.prepare_pdf_proposal_custody(**data)
        self.assertEqual(len(children),2);self.assertEqual(producer.call_count,1)
        meta=m.intent_metadata(p.intent);self.assertEqual(meta['kind'],'invented_detached_pdf_proposal_preparation')
        self.assertEqual(meta['operation_id'],OPERATION);self.assertNotEqual(meta['operation_id'],meta['extraction_operation_id'])
        self.assertEqual(p.parts.context_raw,data['context_raw']);self.assertLessEqual(len(p.intent.canonical_metadata),4096)
        self.assertEqual(meta['prepared_at'],_stamp(data['observed_at']))
        for key,raw in zip(m.PART_HASHES,part_bytes(p.parts)):self.assertEqual(meta[key],sha256(raw).hexdigest())
        self.assertIsNot(p.extraction_expected,data['extraction_expected'])
        self.assertEqual(p.evidence_state,'invented_pdf_preparation_only_not_stored_or_captured')
        self.assertNotIn('CLI_CURRENT',repr(p));self.assertNotIn('Invented PDF',repr(p));self.assertFalse(hasattr(p,'statement'))
        with self.assertRaises(Exception):p.observed_at=self.later

    def test_actual_recheck_rederives_once_at_same_time_with_exact_intent_and_parts(self):
        with self.actual()as(children,producer):fresh=m.recheck_prepared_pdf_proposal(self.prepared)
        self.assertEqual(len(children),2);self.assertEqual(producer.call_count,1)
        self.assertEqual(part_bytes(fresh.parts),part_bytes(self.prepared.parts))
        self.assertEqual(fresh.intent.canonical_metadata,self.prepared.intent.canonical_metadata)
        self.assertEqual(fresh.observed_at,self.at)

    def test_actual_later_reobservation_keeps_old_bytes_and_changes_only_two_regenerated_times(self):
        old=json.loads(self.prepared.parts.provenance_raw);now=json.loads(self.fresh.provenance_raw)
        self.assertEqual({key for key in old if old[key]!=now[key]},{'prepared_at','artifact_observed_at'})
        with self.actual()as(children,producer):value=self.reobserve()
        self.assertEqual(len(children),2);self.assertEqual(producer.call_count,1)
        self.assertIs(type(value),m.ReobservedPdfProposal);self.assertEqual(value.prepared_at,self.at)
        self.assertEqual(value.historical_artifact_observed_at,self.at);self.assertEqual(value.stored_at,self.stored)
        self.assertEqual(value.observed_at,self.later);self.assertEqual(part_bytes(value.parts),part_bytes(self.prepared.parts))
        self.assertEqual(value.intent.canonical_metadata,self.prepared.intent.canonical_metadata)
        self.assertIn('not_current_qualification_or_capture',value.evidence_state);self.assertFalse(hasattr(value,'statement'))

    def test_actual_first_observation_one_original_and_invalid_prior_never_falls_back(self):
        now,_,_=supplied();current=capture(now)
        request=compile_pdf_extraction_request(current,observed_at=now.expected.recorded_observed_at,maximum_output_tokens=100)
        raw_output=output(now);packet=prepare_pdf_result_packet(now,None,request=request,output_raw=raw_output,
            operation_id='30000000-0000-4000-8000-000000000001',prepared_at=now.expected.recorded_observed_at+timedelta(minutes=1))
        expected=packet_expected(packet,now,None,request);intent=_intent(packet.raw,expected)
        receipt=_json(dict(schema_version=1,kind='invented_pdf_result_stored',operation_id=expected.operation_id,
            artifact_id=ARTIFACT,stored_at=_stamp(expected.prepared_at+timedelta(seconds=1)),
            intent_base64=base64.b64encode(intent).decode(),packet_base64=base64.b64encode(packet.raw).decode(),
            intent_sha256=sha256(intent).hexdigest(),packet_sha256=expected.packet_sha256,intent_bytes=len(intent),packet_bytes=len(packet.raw)))
        at=expected.prepared_at+timedelta(days=2);ctx=_json(context(expected,json.loads(raw_output)))
        with self.actual()as(children,producer):p=m.prepare_pdf_proposal_custody(receipt,expected,ctx,
            intent_raw=intent,operation_id=OPERATION,observed_at=at)
        self.assertEqual(len(children),1);self.assertEqual(producer.call_count,1)
        self.assertIsNone(json.loads(p.parts.provenance_raw)['previous'])
        with self.actual()as(children,producer):r=self.reobserve(p,stored_at=at,observed_at=at+timedelta(days=1))
        self.assertEqual(len(children),1);self.assertEqual(producer.call_count,1);self.assertEqual(r.prepared_at,at)
        with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=AssertionError('No producer'))as producer:
            self.refuse(lambda:self.reobserve(extraction_expected=replace(self.prepared.extraction_expected,previous=None)))
            producer.assert_not_called()

    def test_part_hash_types_bounds_and_intent_closed_shapes_refuse_before_producer(self):
        p=self.prepared
        with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=AssertionError('No producer'))as producer:
            for field,limit in zip(('payload_raw','selection_raw','provenance_raw','context_raw'),PART_LIMITS):
                for value in (None,b'',bytearray(b'{}'),b'{}',b'x'*(limit+1)):
                    with self.subTest(field=field,type=type(value).__name__):self.refuse(lambda:self.reobserve(parts=replace(p.parts,**{field:value})))
            for raw in (b'',b'{}',b'x'*4097,b'{"schema_version":1,"schema_version":1}',b'{"x":NaN}'):
                self.refuse(lambda:self.reobserve(intent=m.PdfPreparationIntent(raw)))
            for key,value in (('kind','invented_detached_html_proposal_preparation'),('schema_version',True),('operation_id','PRIVATE'),('context_raw_sha256','f'*64),('foreign','PRIVATE')):
                v=json.loads(p.intent.canonical_metadata);v[key]=value
                self.refuse(lambda:self.reobserve(intent=m.PdfPreparationIntent(_json(v))))
            self.refuse(lambda:self.reobserve(parts={}));producer.assert_not_called()

    def test_canonical_part_framing_refuses_before_producer_even_with_matching_new_intent_hashes(self):
        p=self.prepared
        with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=AssertionError('No producer'))as producer:
            for field in ('payload_raw','selection_raw','provenance_raw'):
                for raw in (b' '+getattr(p.parts,field),b'{"x":NaN}',b'{"x":1,"x":1}',b'\xff'):
                    parts=replace(p.parts,**{field:raw})
                    self.refuse(lambda:self.reobserve(parts=parts,intent=reseal(parts,p.intent)))
            producer.assert_not_called()

    def test_prebuilt_recheck_shadows_cannot_replace_any_full_source_assertion_or_state(self):
        p=self.prepared
        candidates=[None,replace(p,intent=m.PdfPreparationIntent(b'{}')),replace(p,evidence_state='approved'),
            replace(p,observed_at=self.at+timedelta(seconds=1)),replace(p,receipt=b'{}'),replace(p,intent_raw=b'{}'),
            replace(p,extraction_expected=replace(p.extraction_expected,operation_id=UID(99))),
            replace(p,parts=replace(p.parts,context_raw=b'{}'))]
        with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=AssertionError('No producer'))as producer:
            for candidate in candidates:self.refuse(lambda:m.recheck_prepared_pdf_proposal(candidate),reobservation=False)
            producer.assert_not_called()

    def test_every_stable_proof_primitive_type_payload_selection_and_key_must_match(self):
        # Compare to an actual later producer output, supplied only through a
        # mocked private producer seam to isolate canonical historical equality.
        with patch.object(m,'prepare_pdf_extraction_held_proposal',return_value=self.fresh):
            for mutate in (lambda p:p.update(schema_version=True),lambda p:p.update(source_date_text='PRIVATE'),
                lambda p:p.update(selected_payload_sha256='f'*64),lambda p:p.update(evidence_state='approved'),
                lambda p:p['limits'].update(whole_page_selection=1),lambda p:p['current'].update(mapping_sha256='f'*64),
                lambda p:p.update(foreign='PRIVATE')):
                parts,intent=changed_proof(self.prepared,mutate)
                self.refuse(lambda:self.reobserve(parts=parts,intent=intent))
            for field,mutate in (('payload_raw',lambda p:p['snapshot'].update(title='Foreign title')),
                    ('selection_raw',lambda p:p.update(issueId=UID(99)))):
                value=json.loads(getattr(self.prepared.parts,field));mutate(value)
                parts=replace(self.prepared.parts,**{field:_json(value)})
                self.refuse(lambda:self.reobserve(parts=parts,intent=reseal(parts,self.prepared.intent)))

    def test_context_spelling_and_independent_extraction_identity_cannot_be_resealed_away(self):
        p=self.prepared;parts=replace(p.parts,context_raw=_json(json.loads(p.parts.context_raw)))
        with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=AssertionError('No producer'))as producer:
            self.refuse(lambda:self.reobserve(parts=parts,intent=reseal(parts,p.intent)))
            for key,value in (('extraction_operation_id',UID(90)),('extraction_artifact_id',UID(91)),
                    ('extraction_request_sha256','f'*64),('extraction_output_sha256','e'*64)):
                metadata=json.loads(p.intent.canonical_metadata);metadata[key]=value
                self.refuse(lambda:self.reobserve(intent=m.PdfPreparationIntent(_json(metadata))))
            for changes in (dict(receipt=b'{}'),dict(intent_raw=b'{}'),dict(extraction_expected=replace(p.extraction_expected,current=replace(p.extraction_expected.current,packet_sha256='f'*64))),
                    dict(extraction_expected=replace(p.extraction_expected,output_sha256='e'*64))):
                self.refuse(lambda:self.reobserve(**changes))
            producer.assert_not_called()

    def test_historical_equality_storage_fresh_observation_and_utc_chronology_are_required(self):
        with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=AssertionError('No producer'))as producer:
            for value in (None,self.at-timedelta(microseconds=1),self.later+timedelta(microseconds=1),self.stored.replace(tzinfo=None)):
                self.refuse(lambda:self.reobserve(stored_at=value))
            for value in (None,self.stored-timedelta(microseconds=1),self.later.replace(tzinfo=None),self.later.astimezone(timezone(timedelta(hours=1)))):
                self.refuse(lambda:self.reobserve(observed_at=value))
            parts,intent=changed_proof(self.prepared,lambda p:p.update(artifact_observed_at=_stamp(self.at-timedelta(microseconds=1))))
            self.refuse(lambda:self.reobserve(parts=parts,intent=intent));producer.assert_not_called()

    def test_later_time_cannot_launder_original_context_decision_issue_or_review_dates(self):
        p=self.prepared
        with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=AssertionError('No producer'))as producer:
            for group,key in (('held','decided_at'),('issue','observed_at'),('content','last_evidence_review_on')):
                ctx=json.loads(p.parts.context_raw);ctx[group][key]=((self.at+timedelta(days=1)).date().isoformat() if group=='content' else _stamp(self.at+timedelta(seconds=1)))
                raw=_json(ctx);proof=json.loads(p.parts.provenance_raw);proof['independent_context']=ctx
                proof['context_sha256']=sha256(raw).hexdigest();proof['supplied_context_sha256']=sha256(raw).hexdigest()
                parts=replace(p.parts,provenance_raw=_json(proof),context_raw=raw)
                self.refuse(lambda:self.reobserve(parts=parts,intent=reseal(parts,p.intent)))
            producer.assert_not_called()

    def test_first_clock_cannot_repair_initially_invalid_expected_or_part(self):
        for which in ('expected','parts'):
            p=deepcopy(self.prepared)
            if which=='expected':
                original=p.extraction_expected.output_sha256;object.__setattr__(p.extraction_expected,'output_sha256','f'*64)
                callback=lambda:object.__setattr__(p.extraction_expected,'output_sha256',original)
            else:
                original=p.parts.payload_raw;object.__setattr__(p.parts,'payload_raw',b'PRIVATE')
                callback=lambda:object.__setattr__(p.parts,'payload_raw',original)
            clock=CallbackUtc(callback)
            with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=AssertionError('No producer'))as producer:
                self.refuse(lambda:self.reobserve(p,observed_at=self.later.replace(tzinfo=clock)));producer.assert_not_called()
            self.assertGreater(clock.calls,0)

    def test_actual_native_callback_cannot_mutate_captured_parts_expectations_intent_or_receipt(self):
        p=deepcopy(self.prepared);parts=part_bytes(p.parts);intent=p.intent.canonical_metadata
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            object.__setattr__(p.parts,'context_raw',b'PRIVATE');object.__setattr__(p.intent,'canonical_metadata',b'{}')
            object.__setattr__(p.extraction_expected.previous.document,'content_sha256','f'*64)
            object.__setattr__(p,'receipt',b'{}')
            child=launch(*args,**kwargs);children.append(child);return child
        with patch.object(inspector.subprocess,'Popen',side_effect=start):r=self.reobserve(p)
        self.assertEqual(len(children),2);self.assertEqual(part_bytes(r.parts),parts);self.assertEqual(r.intent.canonical_metadata,intent)
        self.assertTrue(all(child.poll()is not None and all(getattr(child,k).closed for k in ('stdin','stdout','stderr'))for child in children))

    def test_recheck_captures_whole_prepared_envelope_before_first_clock(self):
        p=deepcopy(self.prepared);original=part_bytes(p.parts)
        def mutate():
            object.__setattr__(p,'receipt',b'{}');object.__setattr__(p.parts,'payload_raw',b'PRIVATE')
            object.__setattr__(p.extraction_expected.request,'request_sha256','f'*64)
        clock=CallbackUtc(mutate);object.__setattr__(p,'observed_at',self.at.replace(tzinfo=clock))
        candidate=DetachedPdfExtractionProposal(*original)
        with patch.object(m,'prepare_pdf_extraction_held_proposal',return_value=candidate)as producer:
            result=m.recheck_prepared_pdf_proposal(p)
        self.assertEqual(part_bytes(result.parts),original);self.assertEqual(result.receipt,self.prepared.receipt)
        self.assertEqual(producer.call_count,1);self.assertGreater(clock.calls,0)

    def test_closed_new_record_namespaces_do_not_drop_unknown_keys_or_call_hooks(self):
        for which in ('parts','intent','prepared'):
            p=deepcopy(self.prepared);target=getattr(p,which)if which!='prepared'else p
            vars(target)['foreign']='PRIVATE';clock=CallbackUtc(lambda:None)
            with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=AssertionError('No producer'))as producer:
                self.refuse(lambda:self.reobserve(p,observed_at=self.later.replace(tzinfo=clock))if which!='prepared'else m.recheck_prepared_pdf_proposal(p),reobservation=which!='prepared')
                producer.assert_not_called()
            self.assertEqual(clock.calls,0)
        hooks=[]
        class Key:
            def __hash__(self):hooks.append('hash');return 7
            def __eq__(self,other):hooks.append('eq');return False
        p=deepcopy(self.prepared);vars(p.intent)[Key()]='PRIVATE';hooks.clear()
        self.refuse(lambda:self.reobserve(p));self.assertEqual(hooks,[])

    def test_earliest_nested_expected_clock_captures_later_vintage_request_parts_and_intent(self):
        # A broken per-field freezer could thaw current.document.retrieved_at
        # before capturing the previous vintage or detached parts. This probe
        # isolates the public envelope capture; it does not qualify a fake parser.
        p=deepcopy(self.prepared);parts=part_bytes(p.parts);intent=p.intent.canonical_metadata
        prior=p.extraction_expected.previous.packet_sha256;request=p.extraction_expected.request.body
        def mutate():
            object.__setattr__(p.parts,'payload_raw',b'PRIVATE')
            object.__setattr__(p.intent,'canonical_metadata',b'{}')
            object.__setattr__(p.extraction_expected.previous,'packet_sha256','f'*64)
            object.__setattr__(p.extraction_expected.request,'body',b'{}')
            object.__setattr__(p,'receipt',b'{}')
        clock=CallbackUtc(mutate)
        original=p.extraction_expected.current.document.retrieved_at
        object.__setattr__(p.extraction_expected.current.document,'retrieved_at',original.replace(tzinfo=clock))
        with patch.object(m,'prepare_pdf_extraction_held_proposal',return_value=self.fresh)as producer:
            result=self.reobserve(p)
        self.assertEqual(part_bytes(result.parts),parts);self.assertEqual(result.intent.canonical_metadata,intent)
        captured=producer.call_args.args[1]
        self.assertEqual(captured.previous.packet_sha256,prior);self.assertEqual(captured.request.body,request)
        self.assertEqual(producer.call_count,1);self.assertGreater(clock.calls,0)

    def test_invalid_prepare_limits_scope_and_runtime_failures_are_fixed_private_refusals(self):
        data=inputs()
        changes=[dict(receipt=b'x'*131073),dict(extraction_expected=None),dict(intent_raw=b'x'*2049),
            dict(context_raw=b'x'*32769),dict(context_raw=bytearray(b'{}')),dict(operation_id='PRIVATE'),dict(observed_at=None)]
        with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=AssertionError('No producer'))as producer:
            for change in changes:self.refuse(lambda:m.prepare_pdf_proposal_custody(**(data|change)),reobservation=False)
            producer.assert_not_called()
        with patch.object(m,'prepare_pdf_extraction_held_proposal',side_effect=RuntimeError('PRIVATE_CORE_CANARY')):
            self.refuse(lambda:m.prepare_pdf_proposal_custody(**inputs()),reobservation=False)
            self.refuse(lambda:self.reobserve())
        for value in (None,m.PdfPreparationIntent(b'{}'),dict(canonical_metadata=self.prepared.intent.canonical_metadata)):
            self.refuse(lambda:m.intent_metadata(value),reobservation=False)

    def test_actual_explicit_known_head_and_semantic_context_holds_remain_delegated_not_inferred(self):
        data=inputs();ctx=json.loads(data['context_raw']);ctx['issue']['head']=dict(publication_id=UID(22),content_sha256='e'*64,
            changed_at=_stamp(data['extraction_expected'].prepared_at-timedelta(days=1)))
        with self.actual()as(children,producer):known=m.prepare_pdf_proposal_custody(**(data|dict(context_raw=_json(ctx))))
        self.assertEqual(len(children),2);self.assertEqual(producer.call_count,1)
        self.assertEqual(json.loads(known.parts.selection_raw)['basePublicationId'],UID(22))
        for change in ('partial_head','foreign_source'):
            bad=deepcopy(ctx)
            if change=='partial_head':bad['issue']['head']['content_sha256']=None
            else:bad['held']['source_version_id']=UID(88)
            with self.actual()as(children,producer):self.refuse(lambda:m.prepare_pdf_proposal_custody(**(data|dict(context_raw=_json(bad)))),reobservation=False)
            self.assertEqual(len(children),2);self.assertEqual(producer.call_count,1)


if __name__=='__main__':unittest.main()
