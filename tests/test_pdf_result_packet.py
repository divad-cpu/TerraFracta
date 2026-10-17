"""New portable PDF results, actual invented originals and unverified output."""
import base64
from contextlib import contextmanager
from dataclasses import replace
from datetime import timedelta, timezone, tzinfo
from hashlib import sha256
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts.offline_pdf_request_context import _decode
from tests.test_pdf_extraction_request import capture as invented_capture
from workers.pdf_derivation_packet import prepare_pdf_derivation_packet
from workers.pdf_extraction_request import compile_pdf_extraction_request
from workers.pdf_passage_comparison import PdfPassageCapture
from workers.pdf_request_packet_context import PdfPacketReference
from workers.passage_extraction_request import _canonical
from workers.pdf_result_packet import (
    PdfResultPacketExpected, PdfResultPacketError, MAX_RESULT_PACKET_BYTES,
    prepare_pdf_result_packet, reopen_pdf_result_packet,
)

FIXTURES = Path(__file__).resolve().parents[1] / 'fixtures'
OPERATION = '30000000-0000-4000-8000-000000000001'


def supplied():
    # These explicit fictional independent expectations were originally supplied
    # with the retained fixture, never inferred from this new result packet.
    now, before, request, _, _ = _decode((FIXTURES / 'fictional-pdf-request-context-input.json').read_bytes())
    return now, before, request


def output(current, **changes):
    doc = current.expected.document
    return _canonical(dict(schema_version=1, source_version_id=doc.source_version_id,
        source_sha256=doc.content_sha256, language_code=current.expected.binding.language_code,
        locator=current.expected.mapping.selections[0].locator, proposed_claim_type='condition',
        proposed_assertion='An entirely invented condition requires independent editorial verification.',
        source_date_text=None) | changes)


def expected(packet, now, before, request):
    return PdfResultPacketExpected(now.expected, None if before is None else before.expected,
        request, packet.output_sha256, packet.packet_sha256, OPERATION, packet.prepared_at)


def capture(reference):
    body = json.loads(reference.raw)
    raw = base64.b64decode(body['original_base64'], validate=True)
    e = reference.expected
    return PdfPassageCapture(raw, e.document, e.binding, e.mapping)


class CallbackUtc(tzinfo):
    def __init__(self, callback): self.callback = callback; self.calls = 0
    def utcoffset(self, value):
        self.calls += 1
        if self.calls == 1: self.callback()
        return timedelta(0)
    def dst(self, value): return timedelta(0)


class PdfResultPacketTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import workers.pdf_text_inspection as inspector
        import workers.pdf_result_packet as module
        now, before, request = supplied()
        cls.prepared_at = now.expected.recorded_observed_at + timedelta(minutes=1)
        cls.later = cls.prepared_at + timedelta(days=2)
        cls.output_raw = output(now)
        launch = inspector.subprocess.Popen; children = []
        def start(*args, **kwargs):
            child = launch(*args, **kwargs); children.append(child); return child
        with patch.object(inspector.subprocess, 'Popen', side_effect=start), \
                patch.object(module, 'reopen_pdf_request_packet_context', wraps=module.reopen_pdf_request_packet_context) as core:
            cls.packet = prepare_pdf_result_packet(now, before, request=request, output_raw=cls.output_raw,
                operation_id=OPERATION, prepared_at=cls.prepared_at)
        cls.preparation_children = children; cls.preparation_core_calls = core.call_count

    @contextmanager
    def actual(self):
        import workers.pdf_text_inspection as inspector
        import workers.pdf_result_packet as module
        launch = inspector.subprocess.Popen; children = []
        def start(*args, **kwargs):
            child = launch(*args, **kwargs); children.append(child); return child
        with patch.object(inspector.subprocess, 'Popen', side_effect=start), \
                patch.object(module, 'reopen_pdf_request_packet_context', wraps=module.reopen_pdf_request_packet_context) as core:
            try: yield children, core
            finally:
                for child in children:
                    self.assertIsNotNone(child.poll())
                    self.assertTrue(all(getattr(child, n).closed for n in ('stdin', 'stdout', 'stderr')))

    def reopen(self, *, raw=None, assertion=None, at=None):
        now, before, request = supplied()
        return reopen_pdf_result_packet(self.packet.raw if raw is None else raw,
            expected(self.packet, now, before, request) if assertion is None else assertion,
            reopened_at=self.later if at is None else at)

    def assert_preflight_refusal(self, action):
        with patch('workers.pdf_text_inspection.subprocess.Popen', side_effect=AssertionError('No child')) as child:
            with self.assertRaisesRegex(PdfResultPacketError, '^pdf_result_packet_unavailable$') as caught:
                action()
            child.assert_not_called()
        self.assertIsNone(caught.exception.__cause__)

    def resign(self, body):
        raw = _canonical(body); now, before, request = supplied()
        return raw, replace(expected(self.packet, now, before, request), packet_sha256=sha256(raw).hexdigest())

    def test_actual_preparation_once_per_original_keeps_raw_output_not_proposal(self):
        self.assertEqual(self.preparation_core_calls, 1)
        self.assertEqual(len(self.preparation_children), 2)
        for child in self.preparation_children:
            self.assertIsNotNone(child.poll())
            self.assertTrue(all(getattr(child, n).closed for n in ('stdin', 'stdout', 'stderr')))
        body = json.loads(self.packet.raw)
        self.assertEqual(self.packet.raw, _canonical(body))
        self.assertEqual(self.packet.packet_sha256, sha256(self.packet.raw).hexdigest())
        self.assertEqual(base64.b64decode(body['output']['base64']), self.output_raw)
        self.assertEqual(self.packet.proposal.review_state, 'unverified')
        self.assertNotIn('proposal', body)
        for private in ('CLI_CURRENT_SELECTED', 'CLI_PRIOR_SELECTED', 'entirely invented', 'example.invalid'):
            self.assertNotIn(private, repr(self.packet))

    def test_cold_reopen_rederives_two_originals_once_and_parses_output_anew(self):
        with self.actual() as (children, core):
            result = self.reopen()
        self.assertEqual(core.call_count, 1); self.assertEqual(len(children), 2)
        self.assertEqual(result.raw, self.packet.raw)
        self.assertEqual(result.context.request, self.packet.context.request)
        self.assertEqual(result.output_raw, self.output_raw)
        self.assertEqual(result.proposal, self.packet.proposal)
        self.assertIsNot(result.proposal, self.packet.proposal)
        self.assertEqual(result.prepared_at, self.prepared_at)
        self.assertEqual(result.reopened_at, self.later)
        self.assertEqual(result.context.recorded_observed_at, self.packet.context.recorded_observed_at)
        self.assertEqual(result.context.reopened_at, self.later)
        self.assertNotIn('entirely invented', repr(result))

    def test_explicit_first_observation_and_equal_recorded_prepared_time(self):
        now, _, _ = supplied(); observed = now.expected.recorded_observed_at
        # New first-observation request for this case, not an old suite replay.
        request = compile_pdf_extraction_request(capture(now), observed_at=observed, maximum_output_tokens=100)
        with self.actual() as (children, core):
            packet = prepare_pdf_result_packet(now, None, request=request, output_raw=output(now),
                operation_id=OPERATION, prepared_at=observed)
        self.assertEqual(core.call_count, 1); self.assertEqual(len(children), 1)
        self.assertIsNone(json.loads(packet.raw)['previous'])
        with self.actual() as (children, core):
            result = reopen_pdf_result_packet(packet.raw, expected(packet, now, None, request), reopened_at=observed)
        self.assertEqual(core.call_count, 1); self.assertEqual(len(children), 1)
        self.assertIsNone(result.context.previous)

    def test_closed_json_canonical_duplicate_nonfinite_and_extra_fields_refuse(self):
        now, before, request = supplied(); assertion = expected(self.packet, now, before, request)
        malformed = [b'{}', self.packet.raw+b' ', self.packet.raw[:-1]+b',"kind":"duplicate"}',
                     self.packet.raw[:-1]+b',"extra":NaN}', b'\xff', b'[]']
        for raw in malformed:
            with self.subTest(raw_length=len(raw)):
                e = replace(assertion, packet_sha256=sha256(raw).hexdigest())
                self.assert_preflight_refusal(lambda: self.reopen(raw=raw, assertion=e))
        for change in (dict(schema_version=True), dict(kind='private_html_result'), dict(proposal={})):
            body = json.loads(self.packet.raw); body.update(change); raw, e = self.resign(body)
            self.assert_preflight_refusal(lambda: self.reopen(raw=raw, assertion=e))

    def test_binary_parts_exact_types_hash_lengths_and_base64_refuse_before_child(self):
        for part in ('current', 'previous', 'output'):
            for change in (dict(base64='!!!!'), dict(bytes=True), dict(bytes=0), dict(sha256='f'*64), dict(extra=1)):
                body = json.loads(self.packet.raw); body[part].update(change); raw, e = self.resign(body)
                with self.subTest(part=part, keys=list(change)):
                    self.assert_preflight_refusal(lambda: self.reopen(raw=raw, assertion=e))
        body = json.loads(self.packet.raw); body['current']['base64'] += '\n'; raw, e = self.resign(body)
        self.assert_preflight_refusal(lambda: self.reopen(raw=raw, assertion=e))

    def test_independent_expectations_cannot_come_from_self_resigned_body(self):
        now, before, request = supplied(); e = expected(self.packet, now, before, request)
        for bad in (replace(e, packet_sha256='f'*64), replace(e, output_sha256='f'*64),
                    replace(e, operation_id='30000000-0000-4000-8000-000000000002'),
                    replace(e, prepared_at=self.prepared_at+timedelta(seconds=1)),
                    replace(e, current=replace(e.current, inspection_sha256='f'*64)), replace(e, previous=None)):
            self.assert_preflight_refusal(lambda: self.reopen(assertion=bad))
        body = json.loads(self.packet.raw); body['previous'] = None; raw, bad = self.resign(body)
        self.assert_preflight_refusal(lambda: self.reopen(raw=raw, assertion=bad))
        bad = replace(e, request=replace(request, body=b'PRIVATE_INVALID_REQUEST'))
        self.assert_preflight_refusal(lambda: self.reopen(assertion=bad))

    def test_preflight_caps_output_packet_and_unsupported_types(self):
        now, before, request = supplied()
        for raw in (b'', b'x'*(8192+1), bytearray(b'{}'), '{}'):
            self.assert_preflight_refusal(lambda: prepare_pdf_result_packet(now, before, request=request,
                output_raw=raw, operation_id=OPERATION, prepared_at=self.prepared_at))
        for raw in (b'', b'x'*(MAX_RESULT_PACKET_BYTES+1), bytearray(self.packet.raw)):
            self.assert_preflight_refusal(lambda: self.reopen(raw=raw))
        e = expected(self.packet, now, before, request); e.__dict__['PRIVATE_EXTRA']='secret'
        self.assert_preflight_refusal(lambda: self.reopen(assertion=e))
        for operation in (True, '00000000-0000-0000-0000-000000000000', 'AAAAAAAA-0000-4000-8000-000000000001', ''):
            self.assert_preflight_refusal(lambda: prepare_pdf_result_packet(now, before, request=request,
                output_raw=self.output_raw, operation_id=operation, prepared_at=self.prepared_at))

    def test_recorded_prepared_reopened_order_and_utc_refuse_before_child(self):
        now, before, request = supplied(); recorded = now.expected.recorded_observed_at
        for prepared in (recorded-timedelta(microseconds=1), self.prepared_at.replace(tzinfo=None),
                         self.prepared_at.replace(tzinfo=timezone(timedelta(hours=1))), None):
            self.assert_preflight_refusal(lambda: prepare_pdf_result_packet(now, before, request=request,
                output_raw=self.output_raw, operation_id=OPERATION, prepared_at=prepared))
        for reopened in (self.prepared_at-timedelta(microseconds=1), self.later.replace(tzinfo=None), None):
            self.assert_preflight_refusal(lambda: self.reopen(at=reopened) if reopened is not None else
                reopen_pdf_result_packet(self.packet.raw, expected(self.packet, now, before, request), reopened_at=None))

    def test_prepare_captures_both_references_and_full_request_before_clock(self):
        now, before, request = supplied(); wanted = request.body; prior_sha = before.expected.packet_sha256
        def mutate():
            before.expected.binding.__dict__['source_key']='foreign-after-entry'
            before.__dict__['raw']=b'PRIVATE_CHANGED_PRIOR'
            request.__dict__['body']=b'PRIVATE_CHANGED_REQUEST'
        zone = CallbackUtc(mutate)
        with self.actual() as (children, core):
            result = prepare_pdf_result_packet(now, before, request=request, output_raw=self.output_raw,
                operation_id=OPERATION, prepared_at=self.prepared_at.replace(tzinfo=zone))
        self.assertEqual(len(children), 2); self.assertEqual(core.call_count, 1); self.assertEqual(zone.calls, 1)
        self.assertEqual(result.context.request.body, wanted)
        self.assertEqual(result.context.previous_packet_sha256, prior_sha)
        self.assertEqual(result.output_raw, self.output_raw)

    def test_reopen_captures_all_independent_expectations_before_clock(self):
        now, before, request = supplied(); assertion = expected(self.packet, now, before, request)
        def mutate():
            assertion.__dict__.update(packet_sha256='f'*64, output_sha256='e'*64, operation_id='PRIVATE_CHANGED_OP')
            before.expected.mapping.selections[0].__dict__['page_number']=2
            request.__dict__['body']=b'PRIVATE_CHANGED_REQUEST'
        zone = CallbackUtc(mutate)
        with self.actual() as (children, core):
            result = self.reopen(assertion=assertion, at=self.later.replace(tzinfo=zone))
        self.assertEqual(len(children), 2); self.assertEqual(core.call_count, 1); self.assertEqual(zone.calls, 1)
        self.assertEqual(result.packet_sha256, self.packet.packet_sha256)
        self.assertEqual(result.output_sha256, self.packet.output_sha256)
        self.assertEqual(result.operation_id, OPERATION)
        self.assertEqual(result.context.previous.spans[0].page_number, 1)
        self.assertIs(result.reopened_at.tzinfo, timezone.utc)

    def test_invalid_previous_and_resigned_request_never_become_first_observation(self):
        now, before, request = supplied()
        for previous in ({}, replace(before, raw=b'PRIVATE_INVALID_PRIOR')):
            self.assert_preflight_refusal(lambda: prepare_pdf_result_packet(now, previous, request=request,
                output_raw=self.output_raw, operation_id=OPERATION, prepared_at=self.prepared_at))
        body = json.loads(request.body); body['instructions']='PRIVATE_SELF_RESIGNED_INSTRUCTION'
        wire = _canonical(body); bad_request = replace(request, body=wire, request_sha256=sha256(wire).hexdigest())
        with self.actual() as (children, core):
            with self.assertRaisesRegex(PdfResultPacketError, '^pdf_result_packet_unavailable$'):
                prepare_pdf_result_packet(now, before, request=bad_request, output_raw=self.output_raw,
                    operation_id=OPERATION, prepared_at=self.prepared_at)
        self.assertEqual(core.call_count, 1); self.assertEqual(len(children), 2)

    def test_malformed_or_foreign_untrusted_output_is_not_a_stored_proposal(self):
        now, before, request = supplied()
        for raw in (b'{"refusal":true}', output(now, locator='unselected-page'), output(now, source_sha256='f'*64)):
            with self.subTest(output_bytes=len(raw)), self.actual() as (children, core):
                with self.assertRaisesRegex(PdfResultPacketError, '^pdf_result_packet_unavailable$'):
                    prepare_pdf_result_packet(now, before, request=request, output_raw=raw,
                        operation_id=OPERATION, prepared_at=self.prepared_at)
            self.assertEqual(core.call_count, 1); self.assertEqual(len(children), 2)

    def test_actual_unchanged_selected_locator_cannot_acquire_support(self):
        from tests.test_pdf_request_packet_context import reference
        # New invented three-page pair for this regression; selected page two is
        # genuinely unchanged, although it is present in both explicit maps.
        now = invented_capture(two_selected=True)
        before = invented_capture('Invented earlier selected text.', version=1, seconds=0, two_selected=True)
        recorded = now.document.retrieved_at + timedelta(seconds=10)
        now_packet = prepare_pdf_derivation_packet(now, recorded_observed_at=recorded)
        prior_packet = prepare_pdf_derivation_packet(before, recorded_observed_at=recorded)
        request = compile_pdf_extraction_request(now, before, observed_at=recorded, maximum_output_tokens=100)
        n = reference(now_packet, now, recorded=recorded); p = reference(prior_packet, before, recorded=recorded)
        with self.actual() as (children, core):
            with self.assertRaisesRegex(PdfResultPacketError, '^pdf_result_packet_unavailable$'):
                prepare_pdf_result_packet(n, p, request=request, output_raw=output(n, locator='section-two'),
                    operation_id=OPERATION, prepared_at=recorded)
        self.assertEqual(len(children), 2); self.assertEqual(core.call_count, 1)

    def test_private_input_errors_and_expected_repr_omit_raw_material(self):
        now, before, request = supplied(); e = expected(self.packet, now, before, request)
        for value in (self.packet, e):
            for private in ('CLI_CURRENT_SELECTED', 'CLI_PRIOR_SELECTED', 'example.invalid', 'entirely invented'):
                self.assertNotIn(private, repr(value))
        try: reopen_pdf_result_packet(b'PRIVATE_PATH /home/private/file', e, reopened_at=self.later)
        except PdfResultPacketError as error:
            self.assertEqual(str(error), 'pdf_result_packet_unavailable'); self.assertIsNone(error.__cause__)
        else: self.fail('Private invalid bytes admitted')


    def test_self_resigned_unselected_peer_requires_actual_whole_original_rederivation(self):
        from tests.test_pdf_request_packet_context import part
        from workers.pdf_text_inspection import _encode
        from workers.pdf_derivation_packet import capture_pdf_derivation_packet_inputs
        now, before, request = supplied(); body = json.loads(now.raw)
        report = json.loads(base64.b64decode(body['inspection_base64']))
        self.assertEqual(report['pages'][1]['state'], 'no_native_text')
        text = 'Entirely invented forged unselected native page.'
        report['pages'][1] = dict(page_number=2, state='text_extracted', text=text,
            text_sha256=sha256(text.encode()).hexdigest(), reason_code=None)
        inspection = _encode(report); part(body, 'inspection', inspection)
        manifest = json.loads(base64.b64decode(body['derivation_base64']))
        manifest['inspection_report_sha256'] = sha256(inspection).hexdigest()
        derivation = _canonical(manifest); part(body, 'derivation', derivation)
        packet_raw = _canonical(body)
        assertion = replace(now.expected, packet_sha256=sha256(packet_raw).hexdigest(),
            inspection_sha256=sha256(inspection).hexdigest(), derivation_sha256=sha256(derivation).hexdigest())
        # Structurally plausible bytes pass pure admission, so the observed
        # refusal cannot be credited to an unrelated malformed wire profile.
        frozen = capture_pdf_derivation_packet_inputs(packet_raw, assertion, reopened_at=self.prepared_at)
        self.assertEqual(frozen.inspection_raw, inspection)
        forged = PdfPacketReference(packet_raw, assertion)
        with self.actual() as (children, core):
            with self.assertRaisesRegex(PdfResultPacketError, '^pdf_result_packet_unavailable$'):
                prepare_pdf_result_packet(forged, before, request=request, output_raw=self.output_raw,
                    operation_id=OPERATION, prepared_at=self.prepared_at)
        self.assertEqual(core.call_count, 1); self.assertEqual(len(children), 2)

    def test_initially_wrong_output_expectation_cannot_be_repaired_by_clock(self):
        now, before, request = supplied()
        assertion = replace(expected(self.packet, now, before, request), output_sha256='f'*64)
        zone = CallbackUtc(lambda: assertion.__dict__.update(output_sha256=self.packet.output_sha256))
        self.assert_preflight_refusal(lambda: self.reopen(assertion=assertion, at=self.later.replace(tzinfo=zone)))
        self.assertEqual(zone.calls, 1)
        self.assertEqual(assertion.output_sha256, self.packet.output_sha256)

    def test_unexpected_clock_failure_is_curated_without_private_details_before_child(self):
        now, before, request = supplied()
        def failure(): raise RuntimeError('PRIVATE_CLOCK_FAILURE /home/private/original')
        for mode in ('prepare', 'reopen'):
            with self.subTest(mode=mode):
                zone = CallbackUtc(failure)
                if mode == 'prepare':
                    action = lambda: prepare_pdf_result_packet(now, before, request=request, output_raw=self.output_raw,
                        operation_id=OPERATION, prepared_at=self.prepared_at.replace(tzinfo=zone))
                else:
                    action = lambda: self.reopen(at=self.later.replace(tzinfo=zone))
                self.assert_preflight_refusal(action)
                self.assertEqual(zone.calls, 1)

if __name__ == '__main__': unittest.main()
