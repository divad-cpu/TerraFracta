"""Portable private preparation handoff; no storage or source authority."""
import base64
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json, unittest
from unittest.mock import patch
from tests.test_pdf_proposal_custody import inputs
from tests.test_pdf_result_packet import CallbackUtc
from workers.closed_pair_channel import _json as strict_json
from workers.detached_proposal_custody import PART_LIMITS, part_bytes
from workers.pdf_proposal_custody import prepare_pdf_proposal_custody, PdfPreparationIntent
from workers.private_extraction_held_proposal import _json
import workers.pdf_preparation_packet as m


class PdfPreparationPacketTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=inputs();cls.prepared=prepare_pdf_proposal_custody(**cls.data)
        cls.packet=m.prepare_pdf_preparation_packet(cls.prepared)
        cls.stored=cls.prepared.observed_at+timedelta(seconds=1)
        cls.later=cls.stored+timedelta(days=2)

    def open(self,raw=None,intent=None,**changes):
        p=self.prepared
        kw=dict(receipt=p.receipt,extraction_expected=p.extraction_expected,intent_raw=p.intent_raw,stored_at=self.stored,observed_at=self.later);kw.update(changes)
        return m.reopen_pdf_preparation_packet(self.packet if raw is None else raw,p.intent if intent is None else intent,**kw)

    def refuse_before_core(self,raw=None,intent=None,**kw):
        with patch.object(m,'reobserve_pdf_proposal',side_effect=AssertionError('No core')) as core:
            with self.assertRaisesRegex(m.PdfPreparationPacketError,'^pdf_preparation_packet_unavailable$') as error:self.open(raw,intent,**kw)
            core.assert_not_called();self.assertIsNone(error.exception.__cause__)

    def test_actual_cold_roundtrip_preserves_exact_historical_four_parts_and_times(self):
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kw):
            child=launch(*args,**kw);children.append(child);return child
        with patch.object(inspector.subprocess,'Popen',side_effect=start):result=self.open()
        self.assertEqual(len(children),2)
        self.assertTrue(all(c.poll() is not None and c.stdout.closed and c.stderr.closed for c in children))
        self.assertEqual(part_bytes(result.parts),part_bytes(self.prepared.parts));self.assertEqual(result.intent,self.prepared.intent)
        self.assertEqual(result.prepared_at,self.prepared.observed_at);self.assertEqual(result.historical_artifact_observed_at,self.prepared.observed_at)
        self.assertEqual((result.stored_at,result.observed_at),(self.stored,self.later));self.assertIn('not_current_qualification_or_capture',result.evidence_state)

    def test_portable_frame_contains_only_exact_intent_and_four_parts(self):
        value=strict_json(self.packet)
        self.assertEqual(set(value),{'schema_version','kind','intent_base64','payload_base64','selection_base64','provenance_base64','context_base64'})
        self.assertEqual((value['schema_version'],value['kind']),(1,'invented_portable_pdf_preparation'))
        self.assertEqual(base64.b64decode(value['intent_base64']),self.prepared.intent.canonical_metadata)
        for key,raw in zip(m.PART_KEYS,part_bytes(self.prepared.parts)):self.assertEqual(base64.b64decode(value[key]),raw)
        self.assertEqual(self.packet,_json(value));self.assertNotIn(b'artifact_id',self.packet);self.assertNotIn(b'stored_at',self.packet)
        self.assertLess(len(self.packet),m.MAX_PACKET_BYTES)

    def test_foreign_missing_extra_duplicate_or_noncanonical_frames_refuse_before_core(self):
        original=json.loads(self.packet)
        for mutate in [lambda v:v.update(kind='invented_html_preparation_stored'),lambda v:v.update(schema_version=True),lambda v:v.update(foreign='PRIVATE'),lambda v:v.pop('context_base64')]:
            value=deepcopy(original);mutate(value);self.refuse_before_core(_json(value))
        for raw in [b' '+self.packet,self.packet+b'\n',b'{"kind":"a","kind":"b"}',b'\xff',b'[]']:
            self.refuse_before_core(raw)

    def test_byte_type_and_total_boundaries_refuse_without_hooks(self):
        calls=[]
        class Hostile(bytes):
            def __len__(self):calls.append('length');raise AssertionError('PRIVATE')
            def decode(self,*a,**kw):calls.append('decode');raise AssertionError('PRIVATE')
        for raw in [b'',b'x'*(m.MAX_PACKET_BYTES+1),bytearray(self.packet),memoryview(self.packet),Hostile(self.packet)]:self.refuse_before_core(raw)
        self.assertEqual(calls,[])

    def test_each_part_and_intent_base64_and_exact_part_limits_remain_closed(self):
        value=json.loads(self.packet)
        for key,limit in zip(('intent_base64',*m.PART_KEYS),(4096,*PART_LIMITS)):
            for bad in ['', '!',value[key]+'=',base64.b64encode(b'x'*(limit+1)).decode()]:
                changed={**value,key:bad};self.refuse_before_core(_json(changed))

    def test_altered_part_or_independent_prewrite_intent_never_adopts_packet_values(self):
        value=json.loads(self.packet)
        for key in m.PART_KEYS:
            changed={**value,key:base64.b64encode(base64.b64decode(value[key])+b' ').decode()};self.refuse_before_core(_json(changed))
        for raw in [b'{}',self.prepared.intent.canonical_metadata+b' ']:self.refuse_before_core(intent=PdfPreparationIntent(raw))

    def test_external_full_result_context_remains_mandatory_and_is_not_in_packet(self):
        for kw in [dict(receipt=b'{}'),dict(extraction_expected=None),dict(intent_raw=b'{}'),dict(stored_at=self.prepared.observed_at-timedelta(seconds=1))]:
            with self.assertRaisesRegex(m.PdfPreparationPacketError,'^pdf_preparation_packet_unavailable$'):self.open(**kw)

    def test_invalid_preparation_serialization_has_generic_private_refusal(self):
        for prepared in [None,{},replace(self.prepared,receipt=b'PRIVATE_CANARY')]:
            with self.assertRaisesRegex(m.PdfPreparationPacketError,'^pdf_preparation_packet_unavailable$') as error:m.prepare_pdf_preparation_packet(prepared)
            self.assertIsNone(error.exception.__cause__)

    def test_bad_external_intent_cannot_be_repaired_by_accepted_clock(self):
        intent=PdfPreparationIntent(b'{}')
        clock=CallbackUtc(lambda:vars(intent).update(canonical_metadata=self.prepared.intent.canonical_metadata))
        self.refuse_before_core(intent=intent,stored_at=self.stored.replace(tzinfo=clock))
        self.assertEqual(intent.canonical_metadata,self.prepared.intent.canonical_metadata)

    def test_valid_external_assertions_are_copied_before_clock_damage(self):
        intent=PdfPreparationIntent(self.prepared.intent.canonical_metadata);expected=deepcopy(self.prepared.extraction_expected)
        def damage():vars(intent).update(canonical_metadata=b'PRIVATE');vars(expected).update(operation_id='PRIVATE')
        clock=CallbackUtc(damage);seen=[]
        def core(receipt,independent,parts,prewrite,**kw):
            seen.append((receipt,independent.operation_id,part_bytes(parts),prewrite.canonical_metadata,kw['intent_raw'],kw['stored_at'],kw['observed_at']));return 'copied assertion probe only'
        with patch.object(m,'reobserve_pdf_proposal',side_effect=core):result=self.open(intent=intent,extraction_expected=expected,stored_at=self.stored.replace(tzinfo=clock))
        self.assertEqual(result,'copied assertion probe only');self.assertEqual(len(seen),1)
        self.assertEqual(seen[0],(self.prepared.receipt,self.prepared.extraction_expected.operation_id,part_bytes(self.prepared.parts),self.prepared.intent.canonical_metadata,self.prepared.intent_raw,self.stored,self.later))
        self.assertEqual((intent.canonical_metadata,expected.operation_id),(b'PRIVATE','PRIVATE'))

    def test_unknown_deep_record_namespace_refuses_before_any_clock_or_core(self):
        expected=deepcopy(self.prepared.extraction_expected);vars(expected.request)['foreign']='PRIVATE';calls=[]
        clock=CallbackUtc(lambda:calls.append('clock'));self.refuse_before_core(extraction_expected=expected,stored_at=self.stored.replace(tzinfo=clock));self.assertEqual(calls,[])

if __name__=='__main__':unittest.main()
