"""Processing without closeout preserves existing checkpoint/time/receipt guards."""
from datetime import timedelta
import unittest
from unittest.mock import patch

from tests import test_captured_update_pipeline as existing
from tests.test_captured_update_pipeline import plan, NOW, VERSION, DECISION
from workers.captured_update_pipeline import process_captured_manifest, PipelineResumeRequired, StoredProcessing
from workers import captured_update_pipeline as pipeline
from workers.update_run_completion import DecisionReceipt, PlannedSource, PlannedItem, RunManifest
from scripts.ssb_proposal_stage_fixture import SSBProposalStage


class CapturedProcessingTests(unittest.TestCase):
    def captured(self):
        return existing.RecoveryTests().captured()

    def process(self, backend, manifest, checkpoint):
        context = plan().response
        return process_captured_manifest(manifest, context.invocation, context.work,
            checkpoint, str(context.work.lease_id), backend,
            utc_now=backend.clock, monotonic=lambda:backend.elapsed[0])

    def test_checked_receipts_are_returned_without_close_capture_or_manifest_write(self):
        backend, manifest, checkpoint = self.captured()
        result = self.process(backend, manifest, checkpoint)
        self.assertEqual(result, backend.processing)
        self.assertEqual(backend.events, ['process'])

    def test_invalid_checkpoint_stops_before_processing(self):
        backend, manifest, _ = self.captured()
        with self.assertRaises(ValueError):
            self.process(backend, manifest, b'{}')
        self.assertEqual(backend.events, [])

    def test_expired_or_late_processing_does_not_return_a_checked_result(self):
        for before in (True, False):
            backend, manifest, checkpoint = self.captured()
            if before: backend.clock = lambda: NOW + timedelta(seconds=30)
            else: backend.delay_stage = 'process'
            with self.assertRaises(ValueError): self.process(backend, manifest, checkpoint)
            self.assertEqual(backend.events, [] if before else ['process'])

    def test_foreign_processing_receipt_is_refused_without_close(self):
        backend, manifest, checkpoint = self.captured()
        backend.processing = StoredProcessing((DecisionReceipt(DECISION, 'foreign', VERSION, 'held'),), ())
        with self.assertRaises(ValueError): self.process(backend, manifest, checkpoint)
        self.assertEqual(backend.events, ['process'])

    def test_utc_expiry_during_reconciliation_is_refused_before_return(self):
        backend, manifest, checkpoint = self.captured()
        calls = []
        def clock():
            calls.append(1)
            return NOW if len(calls) < 4 else NOW + timedelta(seconds=30)
        backend.clock = clock
        with self.assertRaises(ValueError): self.process(backend, manifest, checkpoint)
        self.assertEqual(backend.events, ['process'])

    def test_monotonic_expiry_during_reconciliation_is_refused_before_return(self):
        backend, manifest, checkpoint = self.captured()
        reconcile = pipeline.reconcile_run_completion
        def delayed(*args, **kwargs):
            backend.elapsed[0] = 31
            return reconcile(*args, **kwargs)
        with patch.object(pipeline, 'reconcile_run_completion', side_effect=delayed):
            with self.assertRaises(ValueError): self.process(backend, manifest, checkpoint)
        self.assertEqual(backend.events, ['process'])

    def test_unconfirmed_first_annual_write_never_prepares_the_next_year(self):
        manifest = RunManifest(VERSION, 'a'*64, 'shadow',
            (PlannedSource('ssb-14059-metadata', VERSION, VERSION, 'b'*64),
             PlannedSource('ssb-14059-data', DECISION, DECISION, 'c'*64)),
            (PlannedItem('ssb-14059-year-2024', 'ssb-14059-data', DECISION),
             PlannedItem('ssb-14059-year-2025', 'ssb-14059-data', DECISION),
             PlannedItem('ssb-14059-metadata-review', 'ssb-14059-metadata', VERSION)))
        for kind in ('outcome_unknown', 'not_dispatched', None):
            calls = []
            stage = SSBProposalStage((2024, 2025),
                lambda year, work: calls.append(year) or kind,
                lambda manifest: self.fail('Unconfirmed write must not produce processing readback'))
            with self.assertRaises(PipelineResumeRequired): stage.process(manifest, plan().response.work)
            self.assertEqual(calls, [2024])


if __name__ == '__main__': unittest.main()
