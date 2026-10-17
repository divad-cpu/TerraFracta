"""Actual supplied packets preserve old request identity without new source trust."""
import base64
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.test_pdf_passage_comparison import capture, NOW
from workers.pdf_derivation_packet import (
    PdfDerivationPacketExpected, prepare_pdf_derivation_packet,
    capture_pdf_derivation_packet_inputs,
)
from workers.pdf_extraction_request import compile_pdf_extraction_request
from workers.pdf_request_packet_context import (
    PdfPacketReference, PdfRequestPacketContextError, reopen_pdf_request_packet_context,
)
from workers.pdf_text_inspection import _encode
from workers.passage_extraction_request import _canonical

LATER = NOW + timedelta(days=1)


def reference(packet, value, *, recorded=NOW):
    # Independent invented assertions from known fixture intent, never decoded
    # source metadata or an actual authenticated storage lookup.
    expected = PdfDerivationPacketExpected(replace(value.document), replace(value.binding),
        replace(value.mapping, selections=tuple(replace(s) for s in value.mapping.selections)),
        recorded, packet.packet_sha256, packet.inspection_sha256, packet.derivation_sha256)
    return PdfPacketReference(packet.raw, expected)


def part(body, name, data):
    body[name + '_base64'] = base64.b64encode(data).decode('ascii')
    body[name + '_bytes'] = len(data)
    body[name + '_sha256'] = sha256(data).hexdigest()


class PdfRequestPacketContextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.now = capture(('New selected text.', None), version=2)
        cls.before = capture(('Old selected text.', None), version=1, age=2)
        cls.now_packet = prepare_pdf_derivation_packet(cls.now, recorded_observed_at=NOW)
        cls.before_packet = prepare_pdf_derivation_packet(cls.before, recorded_observed_at=NOW)
        cls.request = compile_pdf_extraction_request(cls.now, cls.before, observed_at=NOW, maximum_output_tokens=100)
        cls.initial_request = compile_pdf_extraction_request(cls.now, observed_at=NOW, maximum_output_tokens=100)

    def refs(self):
        return reference(self.now_packet, self.now), reference(self.before_packet, self.before)

    def reopen(self, now, before, *, request=None, at=LATER, tokens=100):
        return reopen_pdf_request_packet_context(now, before,
            request=self.request if request is None else request, reopened_at=at, maximum_output_tokens=tokens)

    def test_original_request_survives_later_reopen_with_one_actual_inspection_per_original(self):
        import workers.pdf_text_inspection as inspector
        now, before = self.refs(); launch = inspector.subprocess.Popen; children = []
        def start(*args, **kwargs):
            process = launch(*args, **kwargs); children.append(process); return process
        with patch.object(inspector.subprocess, 'Popen', side_effect=start):
            result = self.reopen(now, before)
        self.assertEqual(len(children), 2)
        for process in children:
            self.assertIsNotNone(process.poll())
            self.assertTrue(all(getattr(process, n).closed for n in ('stdin', 'stdout', 'stderr')))
        self.assertEqual(result.request, self.request)
        self.assertEqual(result.request.request_sha256, sha256(self.request.body).hexdigest())
        self.assertEqual(result.current.inspection_report_raw, self.now_packet.result.inspection_report_raw)
        self.assertEqual(result.previous.derivation_manifest_raw, self.before_packet.result.derivation_manifest_raw)
        self.assertEqual(result.recorded_observed_at, NOW)
        self.assertEqual(result.reopened_at, LATER)
        self.assertEqual(result.current_packet_sha256, now.expected.packet_sha256)
        self.assertEqual(result.previous_packet_sha256, before.expected.packet_sha256)
        self.assertNotIn('New selected text.', repr(result))

    def test_explicit_first_observation_has_no_implicit_prior_packet(self):
        now, _ = self.refs()
        result = self.reopen(now, None, request=self.initial_request)
        self.assertIsNone(result.previous)
        self.assertIsNone(result.previous_packet_sha256)
        self.assertEqual(result.request, self.initial_request)

    def test_different_recorded_times_cannot_normalize_into_old_request_before_child(self):
        other_at = NOW + timedelta(microseconds=1)
        packet = prepare_pdf_derivation_packet(self.before, recorded_observed_at=other_at)
        now, _ = self.refs(); before = reference(packet, self.before, recorded=other_at)
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes', side_effect=AssertionError('No child')) as inspect:
            with self.assertRaises(PdfRequestPacketContextError):self.reopen(now, before)
            inspect.assert_not_called()

    def test_invalid_prior_is_not_a_first_observation_and_bad_request_refuses_before_child(self):
        now, before = self.refs()
        invalid_previous = ({}, before.expected, replace(before, raw=b'PRIVATE_INVALID_PACKET'),
                            replace(before, expected=replace(before.expected, packet_sha256='f' * 64)))
        with patch('workers.pdf_passage_binding.inspect_pdf_bytes', side_effect=AssertionError('No child')) as inspect:
            for previous in invalid_previous:
                with self.subTest(kind=type(previous).__name__), self.assertRaises(PdfRequestPacketContextError):
                    self.reopen(now, previous)
            for request in ({}, replace(self.request, item_key='foreign'), replace(self.request, body=b'PRIVATE_REQUEST')):
                with self.assertRaises(PdfRequestPacketContextError):self.reopen(now, before, request=request)
            for tokens in (True, 0, 101):
                with self.assertRaises(PdfRequestPacketContextError):self.reopen(now, before, tokens=tokens)
            inspect.assert_not_called()

    def test_self_resigned_request_body_cannot_replace_full_regeneration(self):
        now, before = self.refs(); body = json.loads(self.request.body)
        body['instructions'] = 'PRIVATE_RESIGNED_INSTRUCTION'
        raw = _canonical(body)
        forged = replace(self.request, body=raw, request_sha256=sha256(raw).hexdigest())
        with self.assertRaisesRegex(PdfRequestPacketContextError, '^pdf_request_packet_context_unavailable$'):
            self.reopen(now, before, request=forged)

    def test_plausible_resigned_unselected_peer_cannot_replace_whole_original_rederivation(self):
        now, before = self.refs(); body = json.loads(now.raw)
        report = json.loads(base64.b64decode(body['inspection_base64']))
        self.assertEqual(_encode(report), base64.b64decode(body['inspection_base64']))
        text = 'Invented forged unselected peer.'
        report['pages'][1] = dict(page_number=2, state='text_extracted', text=text,
            text_sha256=sha256(text.encode()).hexdigest(), reason_code=None)
        inspection = _encode(report); part(body, 'inspection', inspection)
        manifest = json.loads(base64.b64decode(body['derivation_base64']))
        manifest['inspection_report_sha256'] = sha256(inspection).hexdigest()
        derived = _canonical(manifest); part(body, 'derivation', derived); raw = _canonical(body)
        expected = replace(now.expected, packet_sha256=sha256(raw).hexdigest(),
            inspection_sha256=sha256(inspection).hexdigest(), derivation_sha256=sha256(derived).hexdigest())
        frozen = capture_pdf_derivation_packet_inputs(raw, expected, reopened_at=LATER)
        self.assertEqual(frozen.inspection_raw, inspection)
        with self.assertRaises(PdfRequestPacketContextError):self.reopen(PdfPacketReference(raw, expected), before)

    def test_both_packets_expectations_and_request_are_captured_before_first_popen(self):
        import workers.pdf_text_inspection as inspector
        now, before = self.refs(); supplied = replace(self.request); launch = inspector.subprocess.Popen; children = []
        def start(*args, **kwargs):
            if not children:
                object.__setattr__(before.expected, 'packet_sha256', 'f' * 64)
                object.__setattr__(before.expected.document, 'source_url', 'https://example.invalid/PRIVATE_CHANGED')
                object.__setattr__(before.expected.mapping.selections[0], 'page_number', 2)
                object.__setattr__(before, 'raw', b'PRIVATE_REPLACEMENT')
                object.__setattr__(supplied, 'body', b'PRIVATE_REPLACEMENT')
            process = launch(*args, **kwargs); children.append(process); return process
        with patch.object(inspector.subprocess, 'Popen', side_effect=start):
            result = self.reopen(now, before, request=supplied)
        self.assertEqual(result.request, self.request)
        self.assertEqual(result.previous.document.source_url, self.before.document.source_url)
        self.assertEqual(result.previous.spans[0].page_number, 1)
        self.assertEqual(result.previous_packet_sha256, self.before_packet.packet_sha256)
        self.assertEqual(len(children), 2)
        self.assertTrue(all(p.poll() is not None for p in children))

    def test_reopen_time_inversion_or_private_input_has_only_curated_error(self):
        now, before = self.refs()
        for date in (NOW - timedelta(microseconds=1), LATER.replace(tzinfo=None)):
            with self.assertRaisesRegex(PdfRequestPacketContextError, '^pdf_request_packet_context_unavailable$'):
                self.reopen(now, before, at=date)
        try:self.reopen(replace(now, raw=b'PRIVATE_SOURCE_CANARY'), before)
        except PdfRequestPacketContextError as error:
            self.assertEqual(str(error), 'pdf_request_packet_context_unavailable')
            self.assertIsNone(error.__cause__)
        else:self.fail('Invalid packet must refuse')
