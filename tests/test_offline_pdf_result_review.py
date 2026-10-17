"""Fixed private result-review stdin; no input path/provider/backend selector."""
import base64
from dataclasses import asdict
from datetime import timedelta
from io import BytesIO, StringIO
import json
import unittest
from unittest.mock import patch

from tests.test_pdf_result_packet import supplied, output, OPERATION
from workers.pdf_result_packet import prepare_pdf_result_packet, MAX_RESULT_PACKET_BYTES
from workers.pdf_extraction_review_report import PdfExtractionReviewReportError, MAX_PDF_EXTRACTION_REVIEW_BYTES
from workers.passage_extraction_request import MAX_REQUEST_BYTES
from workers.pdf_passage_binding import _stamp
import scripts.offline_pdf_result_review as m


def encoded(value): return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def wire_expected(e):
    value = asdict(e)
    value['document']['retrieved_at'] = _stamp(e.document.retrieved_at)
    value['binding']['retrieved_at'] = _stamp(e.binding.retrieved_at)
    value['recorded_observed_at'] = _stamp(e.recorded_observed_at)
    return value


def wire_request(request):
    return dict(item_key=request.item_key, body_base64=base64.b64encode(request.body).decode(),
        request_sha256=request.request_sha256, selected_payload_sha256=request.selected_payload_sha256,
        maximum_output_tokens=request.maximum_output_tokens)


def invoke(raw=b'', *, args=None, stdin=None, stdout=None):
    out = BytesIO() if stdout is None else stdout; err = StringIO()
    code = m.main(args=[] if args is None else args, stdin=BytesIO(raw) if stdin is None else stdin,
                  stdout=out, stderr=err)
    return code, out.getvalue() if isinstance(out, BytesIO) else b'', err.getvalue()


class OfflinePdfResultReviewTests(unittest.TestCase):
    success_input = None
    success_stdout = None

    @classmethod
    def setUpClass(cls):
        now, before, request = supplied()
        prepared = now.expected.recorded_observed_at + timedelta(seconds=1)
        packet = prepare_pdf_result_packet(now, before, request=request, output_raw=output(now),
            operation_id=OPERATION, prepared_at=prepared)
        cls.input = dict(schema_version=1, kind='private_pdf_result_review_input',
            result_packet_base64=base64.b64encode(packet.raw).decode(), expected=dict(
                current=wire_expected(now.expected), previous=wire_expected(before.expected),
                request=wire_request(request), output_sha256=packet.output_sha256,
                packet_sha256=packet.packet_sha256, operation_id=OPERATION, prepared_at=_stamp(prepared)),
            reopened_at=_stamp(prepared+timedelta(days=1)))
        cls.packet_sha256 = packet.packet_sha256
        cls.request_sha256 = request.request_sha256

    def fresh(self): return json.loads(encoded(self.input))

    def test_actual_stdin_once_two_originals_reaped_and_only_selected_private_review(self):
        import workers.pdf_text_inspection as inspector
        launch = inspector.subprocess.Popen; children = []
        def start(*args, **kwargs):
            child = launch(*args, **kwargs); children.append(child); return child
        raw = encoded(self.fresh())
        with patch.object(inspector.subprocess, 'Popen', side_effect=start), \
                patch.object(m, 'pdf_extraction_review_report', wraps=m.pdf_extraction_review_report) as core:
            code, out, err = invoke(raw)
        self.assertEqual((code, err), (0, '')); self.assertEqual(core.call_count, 1); self.assertEqual(len(children), 2)
        self.assertTrue(all(p.poll() is not None and all(getattr(p, n).closed for n in ('stdin', 'stdout', 'stderr')) for p in children))
        value = json.loads(out)
        self.assertEqual(value['kind'], 'private_pdf_extraction_review_report')
        self.assertEqual(value['review_state'], 'unverified'); self.assertEqual(value['proposal']['review_state'], 'unverified')
        self.assertEqual(value['artifact']['packet_sha256'], self.packet_sha256)
        self.assertEqual(value['request']['request_sha256'], self.request_sha256)
        self.assertEqual(value['prepared_at'], self.input['expected']['prepared_at'])
        self.assertEqual(value['reopened_at'], self.input['reopened_at'])
        self.assertEqual(value['selected_passages'][0]['text'], 'CLI_CURRENT_SELECTED')
        self.assertEqual(value['selected_passages'][0]['earlier'][0]['text'], 'CLI_PRIOR_SELECTED')
        self.assertEqual(value['context']['publication'], 'not_authorized')
        for hidden in (b'%PDF-', b'base64', b'PRIVATE_PDF_METADATA_CANARY', b'"instructions"', b'"output_body"'):
            self.assertNotIn(hidden, out)
        self.assertTrue(out.endswith(b'\n')); self.assertLessEqual(len(out), m.MAX_OUTPUT_BYTES)
        # The fixed author runner retains these exact operands from THIS run;
        # ordinary tests do not choose or write an evidence destination.
        type(self).success_input = raw; type(self).success_stdout = out

    def test_closed_json_nested_fields_duplicate_nonfinite_bool_and_unknown_kinds(self):
        invalid = [b'{}', b'[]', b'{"schema_version":1,"schema_version":1}', b'{"x":NaN}', b'\xff']
        changes = [lambda v:v.update(schema_version=True), lambda v:v.update(kind='public_result'),
            lambda v:v.update(filename='PRIVATE_PATH'), lambda v:v['expected'].update(authenticated=True),
            lambda v:v['expected']['current'].update(packet_base64='PRIVATE_BODY'),
            lambda v:v['expected']['current']['document'].update(password='PRIVATE_SECRET'),
            lambda v:v['expected']['current']['mapping']['selections'][0].update(page_number=True),
            lambda v:v['expected']['request'].update(evidence_state='verified'),
            lambda v:v['expected']['request'].update(maximum_output_tokens=True),
            lambda v:v['expected'].update(output_sha256=True), lambda v:v.pop('reopened_at'),
            lambda v:v['expected'].pop('previous')]
        for change in changes:
            value=self.fresh(); change(value); invalid.append(encoded(value))
        with patch.object(m, 'pdf_extraction_review_report', side_effect=AssertionError('No core')) as core:
            for raw in invalid:
                self.assertEqual(invoke(raw), (2, b'', 'offline_pdf_result_review_unavailable\n'))
            core.assert_not_called()

    def test_canonical_binary_exact_utc_and_component_capacities_refuse_before_core(self):
        changes = [lambda v:v.update(reopened_at='2026-02-30T00:00:00.000000Z'),
            lambda v:v.update(reopened_at='2026-10-18T09:00:00Z'),
            lambda v:v['expected'].update(prepared_at='2026-10-17T09:00:00.000000+00:00'),
            lambda v:v['expected']['previous']['binding'].update(retrieved_at='0000-01-01T00:00:00.000000Z'),
            lambda v:v.update(result_packet_base64=v['result_packet_base64']+'\n'),
            lambda v:v.update(result_packet_base64=base64.b64encode(b'x'*(MAX_RESULT_PACKET_BYTES+1)).decode()),
            lambda v:v['expected']['request'].update(body_base64=base64.b64encode(b'x'*(MAX_REQUEST_BYTES+1)).decode()),
            lambda v:v['expected']['request'].update(body_base64='YQ==\n'),
            lambda v:v['expected']['request'].update(request_sha256='f'*64)]
        with patch.object(m, 'pdf_extraction_review_report', side_effect=AssertionError('No core')) as core:
            for change in changes:
                value=self.fresh(); change(value)
                self.assertEqual(invoke(encoded(value)), (2, b'', 'offline_pdf_result_review_unavailable\n'))
            core.assert_not_called()

    def test_bad_prior_independent_request_hash_or_times_never_fall_back_before_child(self):
        changes = [lambda v:v['expected'].update(previous={}), lambda v:v['expected'].update(previous=None),
            lambda v:v['expected'].update(packet_sha256='f'*64), lambda v:v['expected'].update(output_sha256='e'*64),
            lambda v:v['expected'].update(operation_id='PRIVATE_OP'),
            lambda v:v['expected']['previous']['document'].update(content_sha256='f'*64),
            lambda v:v['expected']['previous'].update(recorded_observed_at='2026-10-17T09:00:00.000001Z'),
            lambda v:v['expected']['request'].update(body_base64=base64.b64encode(b'PRIVATE_REQUEST').decode()),
            lambda v:v.update(reopened_at='2026-10-17T09:00:00.000000Z')]
        with patch('workers.pdf_text_inspection.subprocess.Popen', side_effect=AssertionError('No child')) as child:
            for change in changes:
                value=self.fresh(); change(value)
                self.assertEqual(invoke(encoded(value)), (2, b'', 'offline_pdf_result_review_unavailable\n'))
            child.assert_not_called()

    def test_input_read_is_once_bounded_new_cap_and_old_context_cap_unchanged(self):
        import scripts.offline_pdf_request_context as old
        class Read:
            def __init__(self, value): self.value=value; self.requests=[]
            def read(self, size): self.requests.append(size); return self.value
        with patch.object(m, 'pdf_extraction_review_report', side_effect=AssertionError('No core')) as core:
            for raw in (b'', 'PRIVATE_STRING', b'x'*(m.MAX_INPUT_BYTES+1)):
                stream=Read(raw); self.assertEqual(invoke(stdin=stream), (2, b'', 'offline_pdf_result_review_unavailable\n'))
                self.assertEqual(stream.requests, [m.MAX_INPUT_BYTES+1])
            core.assert_not_called()
        self.assertEqual(m.MAX_INPUT_BYTES, 3*1024*1024); self.assertEqual(old.MAX_INPUT_BYTES, 2*1024*1024)
        self.assertEqual(m.MAX_OUTPUT_BYTES, 384*1024+1)

    def test_help_and_forbidden_path_url_arguments_do_not_read_or_echo_private_input(self):
        class NoRead:
            def read(self, *_): raise AssertionError('No input')
        for args, expected_code in ((['--help'], 0), (['PRIVATE_PATH'], 2), (['--url', 'https://private.invalid'], 2),
                                    (['--output', '/home/private/result'], 2), (['--password', 'PRIVATE_SECRET'], 2)):
            code, out, err=invoke(args=args, stdin=NoRead())
            self.assertEqual((code, out), (expected_code, b'')); self.assertNotIn('PRIVATE', err)
            if code==0:
                self.assertIn('selected current/earlier text', err); self.assertIn('not a source-quality verdict', err)

    def test_curated_context_unavailable_is_two_unexpected_core_error_is_one(self):
        raw=encoded(self.fresh())
        with patch.object(m, 'pdf_extraction_review_report', side_effect=PdfExtractionReviewReportError('PRIVATE_SOURCE')), \
                patch('workers.error_diagnostics.record_worker_error') as diagnostic:
            self.assertEqual(invoke(raw), (2, b'', 'offline_pdf_result_review_unavailable\n')); diagnostic.assert_not_called()
        with patch.object(m, 'pdf_extraction_review_report', side_effect=RuntimeError('PRIVATE_SOURCE /home/private')), \
                patch('workers.error_diagnostics.record_worker_error') as diagnostic:
            self.assertEqual(invoke(raw), (1, b'', 'offline_pdf_result_review_unavailable\n'))
            diagnostic.assert_called_once_with('collector_worker', directory=None)
            with self.assertRaises(m.OfflinePdfResultReviewTechnicalError) as caught: m.report_from_envelope(raw)
            self.assertEqual(str(caught.exception), 'pdf_result_review_unavailable'); self.assertIsNone(caught.exception.__cause__)

    def test_output_capacity_and_exact_bytes_type_before_single_private_write(self):
        # Framing-only fake core replies exercise the adapter cap, not report
        # schema qualification or an actual large selected-text extraction.
        raw=encoded(self.fresh())
        with patch.object(m, 'pdf_extraction_review_report', return_value=b'x'*MAX_PDF_EXTRACTION_REVIEW_BYTES):
            code,out,err=invoke(raw); self.assertEqual((code,err),(0,''));self.assertEqual(len(out),m.MAX_OUTPUT_BYTES)
        for value in (b'', b'x'*(MAX_PDF_EXTRACTION_REVIEW_BYTES+1), 'PRIVATE_STRING', bytearray(b'{}')):
            with patch.object(m, 'pdf_extraction_review_report', return_value=value), patch('workers.error_diagnostics.record_worker_error'):
                self.assertEqual(invoke(raw), (1,b'','offline_pdf_result_review_unavailable\n'))

    def test_short_write_flush_or_read_failure_is_static_without_retry(self):
        class Short:
            def write(self, value): return len(value)-1
            def flush(self): raise AssertionError('No flush after short write')
        class Flush:
            def write(self, value): return len(value)
            def flush(self): raise OSError('PRIVATE_FLUSH')
        class Input:
            def read(self, size): raise OSError('PRIVATE_INPUT')
        for sink in (Short(), Flush()):
            with patch.object(m, 'report_from_envelope', return_value=b'{"unverified":true}\n') as report, \
                    patch('workers.error_diagnostics.record_worker_error') as diagnostic:
                self.assertEqual(invoke(stdout=sink), (1,b'','offline_pdf_result_review_unavailable\n'))
                self.assertEqual(report.call_count,1);diagnostic.assert_called_once_with('collector_worker', directory=None)
        with patch('workers.error_diagnostics.record_worker_error') as diagnostic:
            self.assertEqual(invoke(stdin=Input()), (1,b'','offline_pdf_result_review_unavailable\n'))
            diagnostic.assert_called_once_with('collector_worker', directory=None)


class OfflinePdfResultReviewDecoderTests(unittest.TestCase):
    def test_decoder_unexpected_exception_is_technical_and_expected_input_is_two(self):
        with patch.object(m, '_decode', side_effect=RuntimeError('PRIVATE_DECODER /home/private')), \
                patch('workers.error_diagnostics.record_worker_error') as diagnostic:
            self.assertEqual(invoke(b'{}'), (1,b'','offline_pdf_result_review_unavailable\n'))
            diagnostic.assert_called_once_with('collector_worker', directory=None)
        with patch.object(m, '_decode', side_effect=ValueError('PRIVATE_INPUT')), \
                patch('workers.error_diagnostics.record_worker_error') as diagnostic:
            self.assertEqual(invoke(b'{}'), (2,b'','offline_pdf_result_review_unavailable\n'));diagnostic.assert_not_called()


if __name__ == '__main__': unittest.main()
