"""PDF parent failure cleanup through the public seam; no child is launched."""
import json
import subprocess
import unittest
from contextlib import ExitStack
from hashlib import sha256
from datetime import datetime,timezone
from unittest.mock import patch
import workers.pdf_text_inspection as module
from workers.bounded_worker_process import WorkerOutput

NOW=datetime(2026,10,20,tzinfo=timezone.utc)
RAW=b'%PDF-invented-cleanup-only'
DOC=module.PdfDocumentReceipt('fictional-pdf','invented-cleanup','10000000-0000-4000-8000-000000000001','https://example.org/invented.pdf',sha256(RAW).hexdigest(),NOW)

class Stream:
    def __init__(self,name,attempts,fault=None,silent=False):
        self.name=name;self.attempts=attempts;self.fault=fault;self.silent=silent;self.closed=False
    def close(self):
        self.attempts.append(self.name)
        if self.fault is not None:raise self.fault
        if not self.silent:self.closed=True

class Process:
    def __init__(self,*,close_fault=None,silent=False,wait_fault=None,poll_fault=None):
        self.attempts=[];self.returncode=0;self.waits=[];self.kills=0
        self.wait_fault=wait_fault;self.poll_fault=poll_fault
        for name in ('stdin','stdout','stderr'):
            setattr(self,name,Stream(name,self.attempts,close_fault if name=='stdin' else None,silent and name=='stdin'))
    def poll(self):
        if self.poll_fault is not None:raise self.poll_fault
        return self.returncode
    def kill(self):self.kills+=1
    def wait(self,timeout):
        self.waits.append(timeout)
        if self.wait_fault is not None:raise self.wait_fault
        return self.returncode

def reply():
    value=dict(schema_version=1,kind='bounded_native_pdf_text',original_sha256=sha256(RAW).hexdigest(),original_bytes=len(RAW),parser_identity=module.PARSER_IDENTITY,limits=dict(module.LIMITS),state='held',reason_code='pdf_parse_unavailable',page_count=None,pages=[])
    return WorkerOutput(json.dumps(value).encode(),b'',0)

class PdfParentCleanupFaultTests(unittest.TestCase):
    def invoke(self,process,fault=None):
        with ExitStack()as stack:
            stack.enter_context(patch.object(module.time,'monotonic',return_value=0))
            opened=stack.enter_context(patch.object(module.subprocess,'Popen',return_value=process))
            stack.enter_context(patch.object(module,'communicate_bounded',**({'side_effect':fault}if fault is not None else {'return_value':reply()})))
            try:return module.inspect_pdf_bytes(RAW,DOC,observed_at=NOW)
            finally:opened.assert_called_once()
    def assert_other_streams_closed(self,process):
        self.assertEqual(process.attempts,['stdin','stdout','stderr'])
        self.assertTrue(process.stdout.closed and process.stderr.closed)
    def test_first_close_failure_cannot_skip_other_streams(self):
        process=Process(close_fault=OSError('invented-private-close'))
        with self.assertRaisesRegex(module.PdfInspectionError,'^pdf_inspection_unavailable$'):
            self.invoke(process,ValueError('invented-communication-failure'))
        self.assert_other_streams_closed(process)
    def test_silent_unconfirmed_close_cannot_return_a_report(self):
        process=Process(silent=True)
        with self.assertRaisesRegex(module.PdfInspectionError,'^pdf_inspection_unavailable$'):self.invoke(process)
        self.assert_other_streams_closed(process);self.assertFalse(process.stdin.closed)
    def test_operation_cancellation_wins_cleanup_error(self):
        for cancellation in (KeyboardInterrupt('invented-operation'),SystemExit(7)):
            with self.subTest(kind=type(cancellation).__name__):
                process=Process(wait_fault=subprocess.TimeoutExpired('invented',1))
                with self.assertRaises(type(cancellation))as caught:self.invoke(process,cancellation)
                self.assertIs(caught.exception,cancellation);self.assert_other_streams_closed(process)
    def test_operation_cancellation_wins_secondary_cleanup_cancellation(self):
        cancellation=KeyboardInterrupt('invented-original')
        process=Process(close_fault=SystemExit(9))
        with self.assertRaises(KeyboardInterrupt)as caught:self.invoke(process,cancellation)
        self.assertIs(caught.exception,cancellation);self.assert_other_streams_closed(process)
    def test_cleanup_cancellation_still_attempts_later_closes(self):
        cancellation=KeyboardInterrupt('invented-cleanup')
        process=Process(close_fault=cancellation)
        with self.assertRaises(KeyboardInterrupt)as caught:self.invoke(process)
        self.assertIs(caught.exception,cancellation);self.assert_other_streams_closed(process)
    def test_handled_outer_cancellation_cannot_hide_new_cleanup_failure(self):
        for outer in (KeyboardInterrupt(),SystemExit(3)):
            with self.subTest(kind=type(outer).__name__):
                try:raise outer
                except BaseException:
                    process=Process(close_fault=OSError('invented-close'))
                    with self.assertRaises(module.PdfInspectionError):self.invoke(process)
                    self.assert_other_streams_closed(process)
    def test_wait_and_poll_failures_close_all_without_raw_diagnostics(self):
        for faults in ({'wait_fault':subprocess.TimeoutExpired('invented-sensitive-command',1)},{'poll_fault':OSError('invented-sensitive-poll')}):
            with self.subTest(kind=list(faults)):
                process=Process(**faults)
                with self.assertRaisesRegex(module.PdfInspectionError,'^pdf_inspection_unavailable$'):self.invoke(process)
                self.assert_other_streams_closed(process)
    def test_clean_owned_process_preserves_report_and_existing_wait_bound(self):
        process=Process();result=self.invoke(process)
        self.assertEqual(result['state'],'held');self.assertEqual(result['reason_code'],'pdf_parse_unavailable')
        self.assertEqual(process.waits,[1]);self.assert_other_streams_closed(process)

if __name__=='__main__':unittest.main()
