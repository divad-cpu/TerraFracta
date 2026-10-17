"""Private stored PDF opening; supplied fixtures are not observed native stores."""
import base64
from dataclasses import replace
from datetime import timedelta
from io import BytesIO, StringIO
import json
import unittest
from unittest.mock import patch

from tests.test_pdf_proposal_custody import inputs
from tests.test_offline_pdf_held_preparation import envelope as held_envelope
from tests.test_pdf_preparation_postgres import receipt, PREPARATION_ARTIFACT
from workers.pdf_proposal_custody import prepare_pdf_proposal_custody
from workers.pdf_preparation_postgres import prepare_pdf_preparation_store, PdfPreparationPostgresError
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import _json
import scripts.offline_stored_pdf_preparation as m


def invoke(raw=b'', *, args=None, stdin=None, stdout=None):
    out = BytesIO() if stdout is None else stdout
    err = StringIO()
    code = m.main(args=[] if args is None else args, stdin=BytesIO(raw) if stdin is None else stdin,
        stdout=out, stderr=err)
    return code, out.getvalue() if isinstance(out, BytesIO) else b'', err.getvalue()


class OfflineStoredPdfPreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prepared = prepare_pdf_proposal_custody(**inputs())
        cls.request = prepare_pdf_preparation_store(cls.prepared)
        cls.stored_at = cls.prepared.observed_at + timedelta(seconds=1)
        native = receipt(cls.request, stored_at=cls.stored_at)
        value = held_envelope()
        value.pop('context_base64')
        value.update(kind='private_stored_pdf_preparation_input',
            preparation_receipt_base64=base64.b64encode(native).decode(),
            preparation_intent_base64=base64.b64encode(cls.prepared.intent.canonical_metadata).decode(),
            preparation_artifact_id=PREPARATION_ARTIFACT,
            preparation_stored_at=_stamp(cls.stored_at),
            observed_at=_stamp(cls.stored_at + timedelta(days=2)))
        cls.value = value
        cls.raw = _json(value)

    def test_actual_opening_inspects_originals_once_and_preserves_historical_output(self):
        import workers.pdf_text_inspection as inspection
        launch = inspection.subprocess.Popen
        children = []
        def start(*args, **kwargs):
            child = launch(*args, **kwargs)
            children.append(child)
            return child
        with patch.object(inspection.subprocess, 'Popen', side_effect=start), \
                patch.object(m, 'reopen_stored_pdf_preparation', wraps=m.reopen_stored_pdf_preparation) as core:
            code, out, err = invoke(self.raw)
        self.assertEqual((code, err), (0, ''))
        self.assertEqual((core.call_count, len(children)), (1, 2))
        self.assertTrue(all(c.poll() is not None and c.stdin.closed and c.stdout.closed and c.stderr.closed for c in children))
        p = self.prepared.parts
        self.assertEqual(json.loads(out), dict(payloadJson=p.payload_raw.decode(), selectionJson=p.selection_raw.decode(),
            provenanceJson=p.provenance_raw.decode(), contextJson=p.context_raw.decode()))
        self.assertLessEqual(len(out), m.MAX_OUTPUT_BYTES)
        self.assertTrue(out.endswith(b'\n'))
        self.assertNotIn(b'base64', out)
        self.assertNotIn(b'%PDF-', out)

    def test_closed_frame_and_missing_external_assertions_refuse_before_opener(self):
        cases = [b'{}', b'[]', b'\xff', b'{"kind":"x","kind":"y"}', b'x'*(m.MAX_INPUT_BYTES+1)]
        for key, value in [('kind', 'private_pdf_preparation_reopen_input'), ('schema_version', True),
                ('preparation_receipt_base64', '!'), ('preparation_intent_base64', '!'),
                ('preparation_artifact_id', 'PRIVATE'), ('preparation_stored_at', 'PRIVATE'),
                ('path', '/PRIVATE')]:
            cases.append(_json({**self.value, key: value}))
        for key in self.value:
            value = dict(self.value)
            value.pop(key)
            cases.append(_json(value))
        with patch.object(m, 'reopen_stored_pdf_preparation', side_effect=AssertionError('No opener')) as core:
            for raw in cases:
                self.assertEqual(invoke(raw), (2, b'', 'offline_stored_pdf_preparation_unavailable\n'))
            core.assert_not_called()

    def test_foreign_valid_uuid_time_and_resealed_receipt_refuse_before_any_pdf_child(self):
        native = json.loads(base64.b64decode(self.value['preparation_receipt_base64']))
        foreign = {**native, 'artifact_id': 'b2000000-0000-4000-8000-000000000099'}
        cases = [dict(self.value, preparation_artifact_id=foreign['artifact_id']),
            dict(self.value, preparation_stored_at=_stamp(self.stored_at + timedelta(seconds=1))),
            dict(self.value, preparation_receipt_base64=base64.b64encode(_json(foreign)).decode())]
        with patch('workers.pdf_text_inspection.subprocess.Popen', side_effect=AssertionError('No child')) as child:
            for value in cases:
                self.assertEqual(invoke(_json(value)), (2, b'', 'offline_stored_pdf_preparation_unavailable\n'))
            child.assert_not_called()

    def test_refused_context_and_unexpected_failure_have_private_distinct_codes(self):
        with patch.object(m, 'reopen_stored_pdf_preparation', side_effect=PdfPreparationPostgresError('PRIVATE')):
            self.assertEqual(invoke(self.raw), (2, b'', 'offline_stored_pdf_preparation_unavailable\n'))
        with patch.object(m, 'reopen_stored_pdf_preparation', side_effect=RuntimeError('PRIVATE')), \
                patch('workers.error_diagnostics.record_worker_error') as diag:
            self.assertEqual(invoke(self.raw), (1, b'', 'offline_stored_pdf_preparation_unavailable\n'))
            self.assertTrue(diag.called)

    def test_help_and_arguments_never_read_or_open(self):
        class Never:
            def read(self, *args): raise AssertionError('No stdin')
        with patch.object(m, 'reopen_stored_pdf_preparation') as core:
            self.assertEqual(invoke(args=['--help'], stdin=Never()), (0, b'', m.HELP))
            self.assertEqual(invoke(args=['/PRIVATE'], stdin=Never()),
                (2, b'', 'offline_stored_pdf_preparation_arguments_refused\n'))
            core.assert_not_called()

    def test_wrong_return_type_withholds_output(self):
        with patch.object(m, 'reopen_stored_pdf_preparation', return_value=object()), \
                patch('workers.error_diagnostics.record_worker_error'):
            self.assertEqual(invoke(self.raw), (1, b'', 'offline_stored_pdf_preparation_unavailable\n'))

    def test_io_fault_and_partial_output_are_technical_without_retry(self):
        class Fault:
            def read(self, *args): raise OSError('PRIVATE')
        class Sink:
            def __init__(self, short): self.short, self.calls = short, 0
            def write(self, raw): self.calls += 1; return len(raw)-1 if self.short else len(raw)
            def flush(self): raise OSError('PRIVATE')
        with patch('workers.error_diagnostics.record_worker_error'):
            self.assertEqual(invoke(stdin=Fault()), (1, b'', 'offline_stored_pdf_preparation_unavailable\n'))
        for short in (True, False):
            sink = Sink(short)
            with patch.object(m, 'preparation_from_envelope', return_value=b'{}\n') as core, \
                    patch('workers.error_diagnostics.record_worker_error'):
                self.assertEqual(invoke(stdout=sink), (1, b'', 'offline_stored_pdf_preparation_unavailable\n'))
                self.assertEqual((core.call_count, sink.calls), (1, 1))

if __name__ == '__main__': unittest.main()
