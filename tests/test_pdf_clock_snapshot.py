"""Entry snapshots precede accepted custom-UTC callbacks, not only PDF children.

Reuse fixed wholly invented retained originals/packets/request. No producer or
old suite is run. Only the valid paired-context case starts two owned children.
"""
import base64
from dataclasses import replace
from datetime import timedelta, timezone, tzinfo
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts.offline_pdf_request_context import _decode
from workers.pdf_text_inspection import inspect_pdf_bytes, PdfInspectionError, PdfInspectionInputError
from workers.pdf_passage_binding import capture_pdf_passage_inputs, PdfPassageError
from workers.pdf_passage_comparison import PdfPassageCapture, PdfComparisonError, compare_pdf_passages
from workers.pdf_derivation_packet import PdfDerivationPacketError, capture_pdf_derivation_packet_inputs
from workers.pdf_request_packet_context import PdfRequestPacketContextError, reopen_pdf_request_packet_context

FIXTURES = Path(__file__).resolve().parents[1] / 'fixtures'


def inputs():
    # Independent invented expectations are explicit wire operands, not inferred
    # from the packet. Decode fresh objects so mutations never cross test cases.
    return _decode((FIXTURES / 'fictional-pdf-request-context-input.json').read_bytes())


def original(reference):
    return base64.b64decode(json.loads(reference.raw)['original_base64'], validate=True)


def capture(reference):
    e = reference.expected
    return PdfPassageCapture(original(reference), e.document, e.binding, e.mapping)


class CallbackUtc(tzinfo):
    """Actually accepted exact datetime timezone; no library/process monkeypatch."""
    def __init__(self, callback):
        self.callback = callback
        self.calls = 0

    def utcoffset(self, value):
        self.calls += 1
        if self.calls == 1:
            self.callback()
        return timedelta(0)

    def dst(self, value):
        return timedelta(0)

    def tzname(self, value):
        return 'UTC'


def callback_time(at, callback):
    clock = CallbackUtc(callback)
    return at.replace(tzinfo=clock), clock


class PdfClockSnapshotTests(unittest.TestCase):
    def test_pure_capture_invalid_binding_cannot_be_repaired_by_initial_clock(self):
        now, _, _, _, _ = inputs(); e = now.expected
        binding = replace(e.binding, source_key='foreign-original-binding')
        def run(at):
            return capture_pdf_passage_inputs(original(now), e.document, binding=binding,
                mapping=e.mapping, observed_at=at)
        with self.assertRaisesRegex(PdfPassageError, '^pdf_passage_binding_unavailable$'):
            run(e.recorded_observed_at)
        at, clock = callback_time(e.recorded_observed_at,
            lambda: binding.__dict__.update(source_key=e.document.source_key))
        with self.assertRaisesRegex(PdfPassageError, '^pdf_passage_binding_unavailable$'):
            run(at)

    def test_pure_capture_valid_binding_survives_clock_mutation_and_copies_utc(self):
        now, _, _, _, _ = inputs(); e = now.expected
        wanted_source = e.binding.source_key
        at, clock = callback_time(e.recorded_observed_at,
            lambda: e.binding.__dict__.update(source_key='foreign-after-entry'))
        try:
            frozen = capture_pdf_passage_inputs(original(now), e.document, binding=e.binding,
                mapping=e.mapping, observed_at=at)
        except PdfPassageError:
            self.fail('A callback changed the original valid binding before its entry snapshot')
        self.assertEqual(frozen.binding.source_key, wanted_source)
        self.assertEqual(e.binding.source_key, 'foreign-after-entry')
        self.assertEqual(clock.calls, 1)
        self.assertIs(frozen.observed_at.tzinfo, timezone.utc)
        self.assertEqual(frozen.observed_at, e.recorded_observed_at)

    def test_native_inspector_invalid_receipt_refuses_before_popen_despite_clock_repair(self):
        now, _, _, _, _ = inputs(); e = now.expected
        receipt = replace(e.document, source_key='INVALID_SOURCE_KEY')
        at, clock = callback_time(e.recorded_observed_at,
            lambda: receipt.__dict__.update(source_key=e.document.source_key))
        with patch('workers.pdf_text_inspection.subprocess.Popen', side_effect=AssertionError('No child')) as child:
            with self.assertRaises(PdfInspectionError) as caught:
                inspect_pdf_bytes(original(now), receipt, observed_at=at)
            child.assert_not_called()
        self.assertIs(type(caught.exception), PdfInspectionInputError)
        self.assertEqual(str(caught.exception), 'pdf_inspection_unavailable')

    def test_pair_current_clock_cannot_repair_original_invalid_previous_before_bind(self):
        now, before, _, _, _ = inputs()
        good_source = before.expected.document.source_key
        before.expected.binding.__dict__['source_key'] = 'foreign-prior-binding'
        current, previous = capture(now), capture(before)
        at, clock = callback_time(now.expected.recorded_observed_at,
            lambda: before.expected.binding.__dict__.update(source_key=good_source))
        # A curated downstream error alone is not evidence of pre-bind refusal.
        with patch('workers.pdf_passage_comparison.bind_pdf_passages', return_value=None) as bind:
            with self.assertRaisesRegex(PdfComparisonError, '^pdf_comparison_unavailable$'):
                compare_pdf_passages(current, previous, observed_at=at)
            bind.assert_not_called()

    def test_packet_nested_invalid_binding_cannot_be_repaired_by_reopening_clock(self):
        now, _, _, reopened, _ = inputs(); e = now.expected
        good_source = e.document.source_key
        e.binding.__dict__['source_key'] = 'foreign-packet-binding'
        with self.assertRaisesRegex(PdfDerivationPacketError, '^pdf_derivation_packet_unavailable$'):
            capture_pdf_derivation_packet_inputs(now.raw, e, reopened_at=reopened)
        at, clock = callback_time(reopened, lambda: e.binding.__dict__.update(source_key=good_source))
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes', side_effect=AssertionError('No child')) as inspect:
            with self.assertRaisesRegex(PdfDerivationPacketError, '^pdf_derivation_packet_unavailable$'):
                capture_pdf_derivation_packet_inputs(now.raw, e, reopened_at=at)
            inspect.assert_not_called()

    def test_context_current_clock_cannot_repair_invalid_prior_before_compile(self):
        now, before, request, reopened, maximum = inputs()
        good_source = before.expected.document.source_key
        before.expected.binding.__dict__['source_key'] = 'foreign-context-prior'
        at, clock = callback_time(reopened,
            lambda: before.expected.binding.__dict__.update(source_key=good_source))
        with patch('workers.pdf_request_packet_context._compile', return_value=(None, None)) as compile:
            with self.assertRaisesRegex(PdfRequestPacketContextError, '^pdf_request_packet_context_unavailable$'):
                reopen_pdf_request_packet_context(now, before, request=request,
                    reopened_at=at, maximum_output_tokens=maximum)
            compile.assert_not_called()

    def test_valid_paired_context_preserves_original_prior_before_clock_and_reaps_two_children(self):
        import workers.pdf_text_inspection as inspector
        now, before, request, reopened, maximum = inputs()
        expected = json.loads((FIXTURES / 'fictional-pdf-request-context-report.json').read_bytes())
        wanted_source = before.expected.document.source_key
        at, clock = callback_time(reopened,
            lambda: before.expected.binding.__dict__.update(source_key='foreign-after-context-entry'))
        launch = inspector.subprocess.Popen; children = []
        def start(*args, **kwargs):
            process = launch(*args, **kwargs); children.append(process); return process
        try:
            with patch.object(inspector.subprocess, 'Popen', side_effect=start):
                try:
                    result = reopen_pdf_request_packet_context(now, before, request=request,
                        reopened_at=at, maximum_output_tokens=maximum)
                except PdfRequestPacketContextError:
                    self.fail('Valid prior expectations were lost before the first native inspection')
            self.assertEqual(len(children), 2)
            self.assertEqual(result.request, request)
            self.assertEqual(result.request.request_sha256, expected['request']['request_sha256'])
            self.assertEqual(result.current_packet_sha256, expected['current']['packet_sha256'])
            self.assertEqual(result.previous_packet_sha256, expected['previous']['packet_sha256'])
            self.assertEqual(result.previous.document.source_key, wanted_source)
            self.assertEqual(result.previous.document.content_sha256, expected['previous']['original_sha256'])
            self.assertEqual(result.recorded_observed_at, now.expected.recorded_observed_at)
            self.assertEqual(result.reopened_at, reopened)
            self.assertIs(result.reopened_at.tzinfo, timezone.utc)
            self.assertEqual(clock.calls, 1)
            self.assertEqual(before.expected.binding.source_key, 'foreign-after-context-entry')
        finally:
            for process in children:
                self.assertIsNotNone(process.poll())
                self.assertTrue(all(getattr(process, name).closed for name in ('stdin', 'stdout', 'stderr')))

    def test_unknown_expected_attribute_refuses_at_packet_and_context_without_child(self):
        for scope in ('packet', 'context'):
            with self.subTest(scope=scope):
                now, before, request, reopened, maximum = inputs()
                target = now.expected if scope == 'packet' else before.expected
                target.__dict__['unknown_private_attribute'] = 'PRIVATE_EXTRA_EXPECTATION'
                with patch('workers.pdf_passage_binding.inspect_pdf_bytes', side_effect=AssertionError('No child')) as inspect, \
                        patch('workers.pdf_request_packet_context._compile', return_value=(None, None)) as compile:
                    if scope == 'packet':
                        with self.assertRaisesRegex(PdfDerivationPacketError, '^pdf_derivation_packet_unavailable$'):
                            capture_pdf_derivation_packet_inputs(now.raw, target, reopened_at=reopened)
                    else:
                        with self.assertRaisesRegex(PdfRequestPacketContextError, '^pdf_request_packet_context_unavailable$'):
                            reopen_pdf_request_packet_context(now, before, request=request,
                                reopened_at=reopened, maximum_output_tokens=maximum)
                    inspect.assert_not_called(); compile.assert_not_called()


class SnapshotNamespaceTests(unittest.TestCase):
    def test_foreign_keys_are_refused_before_equality_in_graph_and_policy_copy(self):
        from workers.dispatch_input_snapshot import freeze_input, scalar_record, DispatchSnapshotError
        from workers.passage_model_plan import PassageSourceBinding
        for mode in ('graph', 'scalar'):
            with self.subTest(mode=mode):
                calls = []
                class Key:
                    def __hash__(self): return hash('source_key')
                    def __eq__(self, other): calls.append('equality'); return other == 'source_key'
                value = PassageSourceBinding('item', 'source')
                del value.__dict__['source_key']
                value.__dict__[Key()] = 'source'
                calls.clear()
                with self.assertRaises(DispatchSnapshotError):
                    if mode == 'graph': freeze_input(value, (PassageSourceBinding,))
                    else: scalar_record(value, PassageSourceBinding)
                self.assertEqual(calls, [])

    def test_dict_subclass_namespace_is_refused_without_iteration(self):
        from workers.dispatch_input_snapshot import freeze_input, scalar_record, DispatchSnapshotError
        from workers.passage_model_plan import PassageSourceBinding
        for mode in ('graph', 'scalar'):
            with self.subTest(mode=mode):
                calls = []
                class Namespace(dict):
                    def __iter__(self): calls.append('iteration'); return super().__iter__()
                value = PassageSourceBinding('item', 'source')
                object.__setattr__(value, '__dict__', Namespace(vars(value)))
                with self.assertRaises(DispatchSnapshotError):
                    if mode == 'graph': freeze_input(value, (PassageSourceBinding,))
                    else: scalar_record(value, PassageSourceBinding)
                self.assertEqual(calls, [])

if __name__ == '__main__':
    unittest.main()

