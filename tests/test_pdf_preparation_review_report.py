"""New historical stored report; invented supplied/native-shaped rows only."""
from dataclasses import replace
from datetime import timedelta, tzinfo
from hashlib import sha256
import json
import unittest
from unittest.mock import patch
from tests.test_pdf_proposal_custody import inputs
from tests.test_pdf_preparation_postgres import receipt, PREPARATION_ARTIFACT
from workers.pdf_preparation_postgres import prepare_pdf_preparation_store, prepare_pdf_preparation_reopen, reopen_stored_pdf_preparation
from workers.pdf_proposal_custody import prepare_pdf_proposal_custody
from workers.pdf_passage_binding import _stamp
import workers.pdf_preparation_review_report as m


class PdfPreparationReviewReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prepared=prepare_pdf_proposal_custody(**inputs())
        cls.request=prepare_pdf_preparation_store(cls.prepared)
        cls.stored_at=cls.prepared.observed_at+timedelta(seconds=1)
        cls.at=cls.stored_at+timedelta(days=2)
        cls.raw=receipt(cls.request,stored_at=cls.stored_at)
        cls.expected=prepare_pdf_preparation_reopen(intent=cls.prepared.intent,artifact_id=PREPARATION_ARTIFACT,
            stored_at=cls.stored_at,observed_at=cls.at)
        cls.kwargs=dict(receipt=cls.prepared.receipt,extraction_expected=cls.prepared.extraction_expected,
            intent_raw=cls.prepared.intent_raw,observed_at=cls.at)
        cls.opened=reopen_stored_pdf_preparation(cls.raw,cls.expected,**cls.kwargs)

    def refuse(self,call):
        with self.assertRaisesRegex(m.PdfPreparationReviewReportError,'^pdf_preparation_review_report_unavailable$')as error:call()
        self.assertIsNone(error.exception.__cause__)
        self.assertNotIn('PRIVATE',str(error.exception))

    def test_actual_report_opens_both_originals_once_and_keeps_all_time_roles(self):
        import workers.pdf_text_inspection as inspection
        real=inspection.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            child=real(*args,**kwargs);children.append(child);return child
        with patch.object(inspection.subprocess,'Popen',side_effect=start),patch.object(m,'reopen_stored_pdf_preparation',wraps=m.reopen_stored_pdf_preparation)as core:
            raw=m.pdf_preparation_review_report(self.raw,self.expected,**self.kwargs)
        self.assertEqual((core.call_count,len(children)),(1,2))
        self.assertTrue(all(c.poll()is not None and all(getattr(c,k).closed for k in ('stdin','stdout','stderr'))for c in children))
        v=json.loads(raw);p=v['preparation'];self.assertEqual(v['observed_at'],_stamp(self.at))
        self.assertEqual((p['artifact_id'],p['stored_at'],p['prepared_at']),
            (PREPARATION_ARTIFACT,_stamp(self.stored_at),_stamp(self.prepared.observed_at)))
        self.assertEqual(p['receipt_sha256'],sha256(self.raw).hexdigest())
        self.assertEqual(p['packet_sha256'],sha256(self.request.packet_raw).hexdigest())
        self.assertEqual(p['intent_sha256'],sha256(self.prepared.intent.canonical_metadata).hexdigest())
        self.assertEqual(v['intent_json'].encode(),self.prepared.intent.canonical_metadata)
        self.assertEqual(tuple(v['parts'][key].encode()for key in m.PART_KEYS),
            (self.prepared.parts.payload_raw,self.prepared.parts.selection_raw,self.prepared.parts.provenance_raw,self.prepared.parts.context_raw))
        self.assertTrue(all(value is False for value in v['limits'].values()))
        self.assertNotIn(b'base64',raw);self.assertNotIn(b'%PDF-',raw);self.assertLessEqual(len(raw),m.MAX_REPORT_BYTES)
        self.assertEqual(json.loads(v['parts']['provenance_json'])['prepared_at'],_stamp(self.prepared.observed_at))

    def test_invalid_external_identity_is_withheld_before_any_original_child(self):
        foreign=replace(self.expected,artifact_id='b2000000-0000-4000-8000-000000000099')
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:
            self.refuse(lambda:m.pdf_preparation_review_report(self.raw,foreign,**self.kwargs));child.assert_not_called()

    def test_report_uses_only_captured_core_output_after_a_caller_clock_callback(self):
        expected=replace(self.expected)
        class UTC(tzinfo):
            def utcoffset(clock,value):vars(expected).update(artifact_id='b2000000-0000-4000-8000-000000000099');return timedelta(0)
            def dst(clock,value):return timedelta(0)
        kwargs={**self.kwargs,'observed_at':self.at.replace(tzinfo=UTC())}
        raw=m.pdf_preparation_review_report(self.raw,expected,**kwargs)
        self.assertNotEqual(expected.artifact_id,PREPARATION_ARTIFACT)
        self.assertEqual(json.loads(raw)['preparation']['artifact_id'],PREPARATION_ARTIFACT)

    def test_core_unavailability_and_unexpected_details_are_private(self):
        for error in (ValueError('PRIVATE'),RuntimeError('PRIVATE')):
            with patch.object(m,'reopen_stored_pdf_preparation',side_effect=error):
                self.refuse(lambda:m.pdf_preparation_review_report(self.raw,self.expected,**self.kwargs))

    def test_wrong_core_type_invalid_utf8_part_and_report_overflow_withhold(self):
        bad=replace(self.opened,result=replace(self.opened.result,parts=replace(self.opened.result.parts,context_raw=b'\xff')))
        for value in (object(),replace(self.opened,result=object()),bad):
            with patch.object(m,'reopen_stored_pdf_preparation',return_value=value):
                self.refuse(lambda:m.pdf_preparation_review_report(self.raw,self.expected,**self.kwargs))
        with patch.object(m,'reopen_stored_pdf_preparation',return_value=self.opened),patch.object(m,'MAX_REPORT_BYTES',1):
            self.refuse(lambda:m.pdf_preparation_review_report(self.raw,self.expected,**self.kwargs))

if __name__=='__main__':unittest.main()
