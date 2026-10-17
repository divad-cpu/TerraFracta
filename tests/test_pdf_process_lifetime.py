"""Actual owned fault children at the new PDF parent's stable process seam."""
import subprocess
import sys
import unittest
from unittest.mock import patch

import workers.pdf_text_inspection as module
from workers.bounded_worker_process import BoundedWorkerError
from tests.helpers.pdf_fixture import pdf_bytes
from tests.test_pdf_text_inspection import NOW,receipt


class PdfProcessLifetimeTests(unittest.TestCase):
    def faulty(self,code,*,clock=None,communicator=None):
        original=subprocess.Popen;owned=[];raw=pdf_bytes()
        def launch(*args,**kwargs):
            p=original((sys.executable,'-I','-B','-c',code),**kwargs);owned.append(p);return p
        from contextlib import ExitStack
        with ExitStack()as stack:
            stack.enter_context(patch.object(module.subprocess,'Popen',side_effect=launch))
            if clock is not None:stack.enter_context(patch.object(module.time,'monotonic',side_effect=clock))
            if communicator is not None:stack.enter_context(patch.object(module,'communicate_bounded',side_effect=communicator))
            with self.assertRaisesRegex(module.PdfInspectionError,'^pdf_inspection_unavailable$'):module.inspect_pdf_bytes(raw,receipt(raw),observed_at=NOW)
        self.assertEqual(len(owned),1)
        p=owned[0];self.assertIsNotNone(p.poll());self.assertTrue(all(getattr(p,n).closed for n in('stdin','stdout','stderr')))
        return p

    def test_nonzero_child_is_reaped_with_no_diagnostic_echo(self):
        self.faulty("import sys;sys.stderr.write('PRIVATE_PDF_ERROR');sys.exit(4)")

    def test_actual_stdout_overflow_kills_and_reaps_owned_child(self):
        self.faulty("import os,time;os.write(1,b'x'*131073);time.sleep(10)")

    def test_late_spawn_uses_original_interval_and_retires_unread_child(self):
        ticks=iter([0,0,4]);self.faulty('import time;time.sleep(10)',clock=lambda:next(ticks,4))

    def test_precommunication_configuration_failure_still_retires_owned_child(self):
        self.faulty('import time;time.sleep(10)',communicator=lambda *a,**k:(_ for _ in()).throw(BoundedWorkerError('PRIVATE_CONFIG')))

    def test_malformed_zero_exit_output_cannot_become_an_inspection(self):
        self.faulty("import sys;sys.stdout.write('{\\\"private\\\":\\\"PRIVATE_CHILD\\\"}')")

    def test_wall_interval_includes_final_owned_cleanup(self):
        raw=pdf_bytes();tick=[0];original=module._cleanup
        def cleanup(p):original(p);tick[0]=4
        with patch.object(module.time,'monotonic',side_effect=lambda:tick[0]),patch.object(module,'_cleanup',side_effect=cleanup):
            with self.assertRaisesRegex(module.PdfInspectionError,'^pdf_inspection_unavailable$'):module.inspect_pdf_bytes(raw,receipt(raw),observed_at=NOW)

    def test_actual_wall_timeout_closes_and_reaps_the_held_fault_child(self):
        self.faulty('import time;time.sleep(10)')
