"""New fixed PDF process, derived-text and independent receipt contracts."""
from dataclasses import replace
from datetime import datetime,timezone,timedelta
from hashlib import sha256
import json
import socket
import unittest
from unittest.mock import patch

from tests.helpers.pdf_fixture import pdf_bytes
from workers.pdf_text_inspection import PdfDocumentReceipt,PdfInspectionError,inspect_pdf_bytes,LIMITS,PARSER_IDENTITY

NOW=datetime(2026,10,17,9,tzinfo=timezone.utc)
def receipt(raw,**changes):
    value=PdfDocumentReceipt('fictional-pdf','invented-report','10000000-0000-4000-8000-000000000001','https://example.org/invented.pdf',sha256(raw).hexdigest(),NOW-timedelta(minutes=1))
    return replace(value,**changes)
def inspect(raw,**changes):return inspect_pdf_bytes(raw,receipt(raw,**changes),observed_at=NOW)


class PdfTextInspectionTests(unittest.TestCase):
    def test_actual_fixed_child_keeps_original_and_derived_hashes_separate(self):
        raw=pdf_bytes()
        with patch.object(socket,'create_connection',side_effect=AssertionError('No parent network')):result=inspect(raw)
        self.assertEqual(result['state'],'inspected');self.assertEqual(result['page_count'],2)
        self.assertEqual(result['document']['content_sha256'],sha256(raw).hexdigest());self.assertEqual(result['original_bytes'],len(raw))
        self.assertEqual(result['parser_identity'],PARSER_IDENTITY);self.assertEqual(result['limits'],LIMITS)
        self.assertEqual(result['document']['retrieved_at'],'2026-10-17T08:59:00.000000Z');self.assertEqual(result['observed_at'],'2026-10-17T09:00:00.000000Z')
        page=result['pages'][0];self.assertEqual(page['text'],'Invented native paragraph.');self.assertEqual(page['page_number'],1)
        self.assertEqual(page['text_sha256'],sha256(page['text'].encode()).hexdigest());self.assertNotEqual(page['text_sha256'],result['document']['content_sha256'])
        self.assertEqual(result['pages'][1],dict(page_number=2,state='no_native_text',text=None,text_sha256=None,reason_code=None))
        self.assertNotIn('PRIVATE_PDF_METADATA_CANARY',json.dumps(result));self.assertNotIn('password',json.dumps(result))

    def test_physical_page_indices_ignore_untrusted_pdf_labels(self):
        result=inspect(pdf_bytes(('Page one.','Page two.'),page_labels=True))
        self.assertEqual([r['page_number']for r in result['pages']],[1,2]);self.assertNotIn('Untrusted label',json.dumps(result))

    def test_empty_native_page_is_not_classified_as_scanned_or_content_free(self):
        result=inspect(pdf_bytes((None,)))
        self.assertEqual(result['pages'][0]['state'],'no_native_text');self.assertNotIn('scanned',json.dumps(result));self.assertNotIn('complete_history',json.dumps(result))

    def test_actual_to_unicode_cmap_preserves_supplementary_scalar_text(self):
        page=inspect(pdf_bytes(('unused',),unicode_text=True))['pages'][0]
        self.assertEqual(page['text'],'\U00010400');self.assertEqual(page['text_sha256'],sha256('\U00010400'.encode()).hexdigest())

    def test_malformed_and_encrypted_inputs_are_whole_holds_without_diagnostics(self):
        for raw,reason in[(b'%PDF-1.7\nPRIVATE_BROKEN','pdf_parse_unavailable'),(pdf_bytes(encrypted=True),'pdf_encrypted')]:
            with self.subTest(reason=reason):
                result=inspect(raw);self.assertEqual(result['state'],'held');self.assertEqual(result['reason_code'],reason)
                self.assertIsNone(result['page_count']);self.assertEqual(result['pages'],[]);self.assertNotIn('PRIVATE_BROKEN',json.dumps(result))

    def test_nine_pages_are_not_silently_truncated_to_eight(self):
        result=inspect(pdf_bytes((None,)*9))
        self.assertEqual(result['state'],'held');self.assertEqual(result['reason_code'],'pdf_page_limit');self.assertEqual(result['pages'],[])

    def test_compressed_expansion_is_held_before_text_extraction(self):
        raw=pdf_bytes(('unused',),compressed=True,content=b' '*(LIMITS['max_main_content_bytes']+1))
        self.assertLess(len(raw),65536)
        page=inspect(raw)['pages'][0];self.assertEqual(page['state'],'held');self.assertEqual(page['reason_code'],'page_content_limit');self.assertIsNone(page['text'])

    def test_oversized_text_is_not_truncated_and_independent_peer_is_retained(self):
        result=inspect(pdf_bytes(('x'*8193,'Independent page.'),compressed=True))
        first,second=result['pages'];self.assertEqual(first['state'],'held');self.assertEqual(first['reason_code'],'page_text_limit')
        self.assertIsNone(first['text']);self.assertEqual(second['text'],'Independent page.')

    def test_exact_page_text_boundary_and_all_eight_pages_remain_admitted(self):
        result=inspect(pdf_bytes(('x'*8192,)*8,compressed=True))
        self.assertEqual(result['page_count'],8);self.assertEqual([len(p['text'])for p in result['pages']],[8192]*8)

    def test_invalid_source_receipts_refuse_before_any_child(self):
        raw=pdf_bytes()
        variants=[dict(content_sha256='f'*64),dict(source_url='http://127.0.0.1/private'),dict(media_type='text/plain'),
                  dict(source_key=' bad '),dict(item_key='bad\0item'),dict(source_version_id='not-a-version'),
                  dict(retrieved_at=NOW+timedelta(seconds=1)),dict(retrieved_at=NOW.replace(tzinfo=None))]
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as opened:
            for change in variants:
                with self.subTest(change=list(change)):
                    with self.assertRaisesRegex(PdfInspectionError,'^pdf_inspection_unavailable$'):inspect(raw,**change)
            for data in[b'',b'x'*65537,bytearray(raw)]:
                with self.assertRaises(PdfInspectionError):inspect_pdf_bytes(data,receipt(raw),observed_at=NOW)
            opened.assert_not_called()

    def test_metadata_is_captured_before_the_process_boundary(self):
        import workers.pdf_text_inspection as module
        raw=pdf_bytes();doc=receipt(raw);original=module.subprocess.Popen
        def changed(*args,**kwargs):
            self.assertEqual(kwargs['env'],{});self.assertTrue(kwargs['close_fds'])
            self.assertIn('native_parent_guard.py',' '.join(args[0]));self.assertIn('_pdf_text_worker.py',' '.join(args[0]))
            object.__setattr__(doc,'item_key','LATER_PRIVATE_ITEM')
            return original(*args,**kwargs)
        with patch.object(module.subprocess,'Popen',side_effect=changed):result=inspect_pdf_bytes(raw,doc,observed_at=NOW)
        self.assertEqual(result['document']['item_key'],'invented-report');self.assertNotIn('LATER_PRIVATE_ITEM',json.dumps(result))

    def test_os_limits_are_physically_observed_on_this_new_owned_worker(self):
        import workers.pdf_text_inspection as module
        import time
        from pathlib import Path
        original=module.subprocess.Popen;observed=[];owned=[]
        def launch(*args,**kwargs):
            child=original(*args,**kwargs);owned.append(child);deadline=time.monotonic()+1
            try:
                while time.monotonic()<deadline:
                    text=(Path('/proc')/str(child.pid)/'limits').read_text()
                    expected={'Max cpu time':('2','2'),'Max address space':('268435456','268435456'),
                              'Max file size':('0','0'),'Max core file size':('0','0')}
                    rows={name:next((line[len(name):].split()[:2]for line in text.splitlines()if line.startswith(name)),[])for name in expected}
                    if all(tuple(rows[name])==values for name,values in expected.items()):observed.append(rows);return child
                    time.sleep(.005)
                raise AssertionError('Required limits not observed')
            except BaseException:
                child.kill();child.wait(timeout=1)
                for name in('stdin','stdout','stderr'):getattr(child,name).close()
                raise
        with patch.object(module.subprocess,'Popen',side_effect=launch):result=inspect(pdf_bytes())
        self.assertEqual(result['state'],'inspected');self.assertEqual(len(observed),1)
        self.assertEqual(len(owned),1);self.assertIsNotNone(owned[0].poll())
        self.assertTrue(all(getattr(owned[0],name).closed for name in('stdin','stdout','stderr')))

    def test_actual_control_escaping_limit_withholds_whole_report(self):
        raw=pdf_bytes(('x'+'\t'*8191,)*8,compressed=True)
        result=inspect(raw)
        self.assertEqual(result['state'],'held');self.assertEqual(result['reason_code'],'pdf_output_limit')
        self.assertEqual(result['pages'],[])
