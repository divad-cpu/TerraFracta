"""New supplied native-shaped receipt contract; no database is exercised.

Actual PDF child counts apply only to the explicitly measured call; fixture and
first-observation preparation are separate. All receipt rows are invented JSON.
"""
import base64
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.test_pdf_proposal_custody import inputs, OPERATION
from tests.test_pdf_extraction_held_proposal import context, ARTIFACT, UID
from tests.test_pdf_result_packet import supplied, capture, output, expected as packet_expected, CallbackUtc
from workers.detached_proposal_custody import part_bytes
from workers.pdf_extraction_request import compile_pdf_extraction_request
from workers.pdf_result_packet import prepare_pdf_result_packet
from workers.pdf_result_custody import _intent
from workers.pdf_proposal_custody import prepare_pdf_proposal_custody, PdfPreparationIntent
from workers.pdf_preparation_packet import prepare_pdf_preparation_packet, MAX_PACKET_BYTES
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import _json
import workers.pdf_preparation_postgres as m

PREPARATION_ARTIFACT = 'b2000000-0000-4000-8000-000000000002'
FOREIGN = 'b2000000-0000-4000-8000-000000000099'


def receipt(request, *, stored_at, artifact_id=PREPARATION_ARTIFACT):
    intent = request.prepared.intent.canonical_metadata
    metadata = json.loads(intent)
    packet = request.packet_raw
    # Independent receipt construction, not the production template/builder.
    return _json(dict(schema_version=1, kind='invented_pdf_preparation_stored',
        operation_id=metadata['operation_id'], artifact_id=artifact_id,
        result_operation_id=metadata['extraction_operation_id'], stored_at=_stamp(stored_at),
        intent_base64=base64.b64encode(intent).decode('ascii'),
        packet_base64=base64.b64encode(packet).decode('ascii'),
        intent_sha256=sha256(intent).hexdigest(), packet_sha256=sha256(packet).hexdigest(),
        intent_bytes=len(intent), packet_bytes=len(packet)))


class PdfPreparationPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = inputs()
        cls.prepared = prepare_pdf_proposal_custody(**cls.data)
        cls.request = m.prepare_pdf_preparation_store(cls.prepared)
        cls.stored_at = cls.prepared.observed_at + timedelta(seconds=1)
        cls.later = cls.stored_at + timedelta(days=2)
        cls.raw = receipt(cls.request, stored_at=cls.stored_at)
        cls.expected = m.prepare_pdf_preparation_reopen(intent=cls.prepared.intent,
            artifact_id=PREPARATION_ARTIFACT, stored_at=cls.stored_at, observed_at=cls.stored_at)

    @contextmanager
    def actual(self, seam):
        import workers.pdf_text_inspection as inspector
        launch = inspector.subprocess.Popen
        children = []
        def start(*args, **kwargs):
            child = launch(*args, **kwargs)
            children.append(child)
            return child
        with patch.object(inspector.subprocess, 'Popen', side_effect=start), patch.object(m, seam, wraps=getattr(m, seam)) as core:
            try:
                yield children, core
            finally:
                for child in children:
                    self.assertIsNotNone(child.poll())
                    self.assertTrue(all(getattr(child, name).closed for name in ('stdin', 'stdout', 'stderr')))

    def cold(self, raw=None, expected=None, **changes):
        kwargs = dict(receipt=self.prepared.receipt, extraction_expected=self.prepared.extraction_expected,
                      intent_raw=self.prepared.intent_raw, observed_at=self.later)
        kwargs.update(changes)
        return m.reopen_stored_pdf_preparation(self.raw if raw is None else raw,
            self.expected if expected is None else expected, **kwargs)

    def refuse(self, call, code):
        with self.assertRaisesRegex(m.PdfPreparationPostgresError, '^' + code + '$') as caught:
            call()
        self.assertIsNone(caught.exception.__cause__)
        self.assertNotIn('PRIVATE', str(caught.exception))

    def refuse_receipt_before_engine(self, raw):
        with patch.object(m, 'prepare_pdf_preparation_packet', side_effect=AssertionError('No serializer')) as warm, \
                patch.object(m, 'reopen_pdf_preparation_packet', side_effect=AssertionError('No opener')) as cold:
            self.refuse(lambda: m.parse_stored_pdf_preparation(raw, self.request, observed_at=self.later),
                        'pdf_preparation_stored_result_unavailable')
            self.refuse(lambda: self.cold(raw), 'pdf_preparation_reopened_result_unavailable')
            warm.assert_not_called()
            cold.assert_not_called()

    def test_actual_store_preparation_rechecks_two_originals_once_and_statement_has_no_child(self):
        with self.actual('prepare_pdf_preparation_packet') as (children, core):
            request = m.prepare_pdf_preparation_store(self.prepared)
        self.assertEqual((len(children), core.call_count), (2, 1))
        self.assertEqual(request.packet_raw, self.request.packet_raw)
        self.assertEqual(part_bytes(request.prepared.parts), part_bytes(self.prepared.parts))
        with patch('workers.pdf_text_inspection.subprocess.Popen', side_effect=AssertionError('No child')) as child:
            sql = request.statement()
        child.assert_not_called()
        self.assertIn('begin isolation level read committed read write;', sql)
        self.assertIn('select tf_pdf_result_rehearsal.store_preparation(', sql)
        self.assertEqual(sql.count('decode('), 2)
        self.assertIn(base64.b64encode(self.prepared.intent.canonical_metadata).decode(), sql)
        self.assertTrue(sql.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))
        self.assertLessEqual(len(sql.encode()), 294912)
        self.assertEqual(repr(request), 'PdfPreparationStoreRequest()')

    def test_actual_warm_ack_rechecks_once_and_returns_separate_preparation_and_result_ids(self):
        with self.actual('prepare_pdf_preparation_packet') as (children, core):
            stored = m.parse_stored_pdf_preparation(self.raw, self.request, observed_at=self.later)
        self.assertEqual((len(children), core.call_count), (2, 1))
        self.assertEqual((stored.operation_id, stored.artifact_id, stored.result_operation_id, stored.stored_at),
            (OPERATION, PREPARATION_ARTIFACT, self.prepared.extraction_expected.operation_id, self.stored_at))
        self.assertIn('not_authenticated', stored.evidence_state)

    def test_actual_cold_opens_two_originals_once_preserving_historical_bytes_and_independent_selector(self):
        with patch('workers.pdf_text_inspection.subprocess.Popen', side_effect=AssertionError('No child')) as child:
            read_sql = self.expected.statement()
        child.assert_not_called()
        self.assertIn('begin isolation level repeatable read read only;', read_sql)
        self.assertIn('tf_pdf_result_rehearsal.preparation_receipt(', read_sql)
        self.assertNotIn('latest', read_sql)
        with self.actual('reopen_pdf_preparation_packet') as (children, core):
            opened = self.cold()
        self.assertEqual((len(children), core.call_count), (2, 1))
        self.assertEqual((opened.full_receipt, opened.packet_raw), (self.raw, self.request.packet_raw))
        self.assertEqual(part_bytes(opened.result.parts), part_bytes(self.prepared.parts))
        self.assertEqual(opened.result.intent, self.prepared.intent)
        self.assertEqual((opened.result.prepared_at, opened.result.historical_artifact_observed_at,
            opened.result.stored_at, opened.observed_at),
            (self.prepared.observed_at, self.prepared.observed_at, self.stored_at, self.later))
        self.assertEqual(opened.stored.artifact_id, PREPARATION_ARTIFACT)
        for private in (self.prepared.parts.context_raw.decode(), self.prepared.parts.payload_raw.decode(), self.raw.decode()):
            self.assertNotIn(private, repr(opened))

    def test_actual_explicit_first_observation_uses_one_original_not_invalid_prior_fallback(self):
        now, _, _ = supplied()
        current = capture(now)
        request = compile_pdf_extraction_request(current, observed_at=now.expected.recorded_observed_at, maximum_output_tokens=100)
        raw_output = output(now)
        result_packet = prepare_pdf_result_packet(now, None, request=request, output_raw=raw_output,
            operation_id='30000000-0000-4000-8000-000000000001',
            prepared_at=now.expected.recorded_observed_at + timedelta(minutes=1))
        independent = packet_expected(result_packet, now, None, request)
        intent = _intent(result_packet.raw, independent)
        row = _json(dict(schema_version=1, kind='invented_pdf_result_stored', operation_id=independent.operation_id,
            artifact_id=ARTIFACT, stored_at=_stamp(independent.prepared_at + timedelta(seconds=1)),
            intent_base64=base64.b64encode(intent).decode(), packet_base64=base64.b64encode(result_packet.raw).decode(),
            intent_sha256=sha256(intent).hexdigest(), packet_sha256=independent.packet_sha256,
            intent_bytes=len(intent), packet_bytes=len(result_packet.raw)))
        at = independent.prepared_at + timedelta(days=2)
        prepared = prepare_pdf_proposal_custody(row, independent, _json(context(independent, json.loads(raw_output))),
            intent_raw=intent, operation_id=OPERATION, observed_at=at)
        with self.actual('prepare_pdf_preparation_packet') as (children, core):
            store = m.prepare_pdf_preparation_store(prepared)
        self.assertEqual((len(children), core.call_count), (1, 1))
        expected = m.prepare_pdf_preparation_reopen(intent=prepared.intent, artifact_id=PREPARATION_ARTIFACT,
            stored_at=at, observed_at=at)
        with self.actual('reopen_pdf_preparation_packet') as (children, core):
            opened = m.reopen_stored_pdf_preparation(receipt(store, stored_at=at), expected,
                receipt=row, extraction_expected=independent, intent_raw=intent, observed_at=at + timedelta(days=1))
        self.assertEqual((len(children), core.call_count), (1, 1))
        self.assertIsNone(json.loads(opened.result.parts.provenance_raw)['previous'])
        with patch('workers.pdf_text_inspection.subprocess.Popen', side_effect=AssertionError('No child')) as child:
            self.refuse(lambda: self.cold(extraction_expected=replace(self.prepared.extraction_expected, previous=None)),
                'pdf_preparation_reopened_result_unavailable')
        child.assert_not_called()

    def test_receipt_closed_keys_schema_uuid_kind_result_link_and_json_grammar(self):
        value = json.loads(self.raw)
        changes = [dict(kind='invented_html_preparation_stored'), dict(schema_version=True), dict(schema_version=2),
            dict(operation_id=FOREIGN), dict(result_operation_id=FOREIGN), dict(artifact_id='PRIVATE'), dict(foreign='PRIVATE')]
        for change in changes:
            self.refuse_receipt_before_engine(_json(value | change))
        for key in value:
            altered = dict(value)
            del altered[key]
            self.refuse_receipt_before_engine(_json(altered))
        for raw in (b'', b'{}', b'[]', b'\xff', b'{"schema_version":1,"schema_version":1}', b'{"x":NaN}', bytearray(self.raw)):
            self.refuse_receipt_before_engine(raw)

    def test_receipt_canonical_base64_exact_hash_length_and_integer_boolean_distinction(self):
        value = json.loads(self.raw)
        for name in ('intent', 'packet'):
            for text in ('', '!', value[name + '_base64'] + '=', ' ' + value[name + '_base64']):
                self.refuse_receipt_before_engine(_json(value | {name + '_base64': text}))
            for bad in (True, False, value[name + '_bytes'] - 1, value[name + '_bytes'] + 1):
                self.refuse_receipt_before_engine(_json(value | {name + '_bytes': bad}))
            for bad in ('F' * 64, 'f' * 64, True, None):
                self.refuse_receipt_before_engine(_json(value | {name + '_sha256': bad}))

    def test_independent_artifact_time_intent_and_full_result_assertions_cannot_be_adopted(self):
        for expected in (replace(self.expected, artifact_id=FOREIGN),
                replace(self.expected, stored_at=self.stored_at + timedelta(microseconds=1)),
                replace(self.expected, intent=PdfPreparationIntent(b'{}'))):
            with patch.object(m, 'reopen_pdf_preparation_packet', side_effect=AssertionError('No opener')) as core:
                self.refuse(lambda: self.cold(expected=expected), 'pdf_preparation_reopened_result_unavailable')
            core.assert_not_called()
        for change in (dict(receipt=b'{}'), dict(intent_raw=b'{}'), dict(extraction_expected=None),
                       dict(extraction_expected=replace(self.prepared.extraction_expected, operation_id=FOREIGN))):
            with patch('workers.pdf_text_inspection.subprocess.Popen', side_effect=AssertionError('No child')) as child:
                self.refuse(lambda: self.cold(**change), 'pdf_preparation_reopened_result_unavailable')
            child.assert_not_called()

    def test_store_request_is_not_a_trusted_parser_and_statement_never_reopens(self):
        for request in (replace(self.request, packet_raw=self.request.packet_raw + b' '),
                replace(self.request, packet_raw=bytearray(self.request.packet_raw)),
                replace(self.request, prepared=replace(self.prepared, evidence_state='PRIVATE')),
                replace(self.request, prepared=replace(self.prepared, parts=replace(self.prepared.parts, context_raw=b'PRIVATE')))):
            with patch.object(m, 'prepare_pdf_preparation_packet', side_effect=AssertionError('No serializer')) as core:
                self.refuse(request.statement, 'pdf_preparation_store_unavailable')
            core.assert_not_called()

    def test_actual_valid_portable_packet_above_native_limit_refuses_before_serializer(self):
        data = dict(self.data)
        value = json.loads(data['context_raw'])
        for key, limit in (('title', 240), ('summary', 1600), ('period_label', 160), ('publisher', 160), ('source_title', 240)):
            value['content'][key] = '\U0001f642' * limit
        context_raw = _json(value)
        self.assertLess(len(context_raw), 32768)
        data['context_raw'] = context_raw + b' ' * (32768 - len(context_raw))
        prepared = prepare_pdf_proposal_custody(**data)
        portable = prepare_pdf_preparation_packet(prepared)
        self.assertGreater(len(portable), 65536)
        self.assertLessEqual(len(portable), MAX_PACKET_BYTES)
        self.assertEqual(MAX_PACKET_BYTES, 196608)
        with patch.object(m, 'prepare_pdf_preparation_packet', side_effect=AssertionError('No serializer')) as core:
            self.refuse(lambda: m.prepare_pdf_preparation_store(prepared), 'pdf_preparation_store_unavailable')
        core.assert_not_called()
        value = json.loads(self.raw)
        value.update(packet_base64=base64.b64encode(portable).decode(), packet_bytes=len(portable), packet_sha256=sha256(portable).hexdigest())
        self.refuse_receipt_before_engine(_json(value))

    def test_fixed_statement_and_receipt_budget_bounds_refuse_without_engine(self):
        with patch.object(m, 'MAX_CAPTURE_OUTPUT', 4096), patch.object(m, 'prepare_pdf_preparation_packet', side_effect=AssertionError('No serializer')) as core:
            self.refuse(lambda: m.prepare_pdf_preparation_store(self.prepared), 'pdf_preparation_store_unavailable')
        core.assert_not_called()
        with patch.object(m, 'MAX_CAPTURE_STATEMENT', 32), patch('workers.pdf_text_inspection.subprocess.Popen', side_effect=AssertionError('No child')) as child:
            self.refuse(self.request.statement, 'pdf_preparation_store_unavailable')
        child.assert_not_called()
        self.refuse_receipt_before_engine(b'x' * 131073)

    def test_whole_cold_envelope_captured_before_first_expected_clock_damage(self):
        expected = deepcopy(self.expected)
        independent = deepcopy(self.prepared.extraction_expected)
        raw_intent = expected.intent.canonical_metadata
        def damage():
            vars(expected.intent)['canonical_metadata'] = b'PRIVATE'
            vars(expected)['artifact_id'] = FOREIGN
            vars(independent.previous.document)['content_sha256'] = 'f' * 64
            vars(independent.request)['body'] = b'{}'
        clock = CallbackUtc(damage)
        vars(expected)['stored_at'] = self.stored_at.replace(tzinfo=clock)
        with self.actual('reopen_pdf_preparation_packet') as (children, core):
            opened = self.cold(expected=expected, extraction_expected=independent)
        self.assertEqual((len(children), core.call_count), (2, 1))
        self.assertEqual(part_bytes(opened.result.parts), part_bytes(self.prepared.parts))
        self.assertEqual(opened.result.intent.canonical_metadata, raw_intent)
        self.assertEqual(opened.stored.artifact_id, PREPARATION_ARTIFACT)
        self.assertEqual((expected.intent.canonical_metadata, independent.request.body), (b'PRIVATE', b'{}'))

    def test_initially_invalid_independent_original_cannot_be_repaired_by_clock(self):
        independent = deepcopy(self.prepared.extraction_expected)
        document = independent.current.document
        correct = document.content_sha256
        vars(document)['content_sha256'] = 'f' * 64
        clock = CallbackUtc(lambda: vars(document).update(content_sha256=correct))
        with patch('workers.pdf_text_inspection.subprocess.Popen', side_effect=AssertionError('No child')) as child:
            self.refuse(lambda: self.cold(extraction_expected=independent, observed_at=self.later.replace(tzinfo=clock)),
                'pdf_preparation_reopened_result_unavailable')
        child.assert_not_called()
        self.assertEqual(document.content_sha256, correct)
        self.assertGreater(clock.calls, 0)

    def test_earliest_nested_warm_clock_copies_later_request_parts_and_packet(self):
        request = deepcopy(self.request)
        original_packet = request.packet_raw
        def damage():
            vars(request)['packet_raw'] = b'PRIVATE'
            vars(request.prepared.intent)['canonical_metadata'] = b'{}'
            vars(request.prepared.extraction_expected.previous)['packet_sha256'] = 'f' * 64
        document = request.prepared.extraction_expected.current.document
        clock = CallbackUtc(damage)
        vars(document)['retrieved_at'] = document.retrieved_at.replace(tzinfo=clock)
        with self.actual('prepare_pdf_preparation_packet') as (children, core):
            stored = m.parse_stored_pdf_preparation(self.raw, request, observed_at=self.later)
        self.assertEqual((len(children), core.call_count), (2, 1))
        self.assertEqual(stored.operation_id, OPERATION)
        self.assertEqual(request.packet_raw, b'PRIVATE')
        self.assertEqual(core.call_args.args[0].parts, self.prepared.parts)
        self.assertNotEqual(original_packet, request.packet_raw)

    def test_new_and_deep_namespaces_refuse_without_key_clock_or_engine_hooks(self):
        for target in ('request', 'expected', 'intent', 'previous'):
            request = deepcopy(self.request)
            expected = deepcopy(self.expected)
            independent = deepcopy(self.prepared.extraction_expected)
            object_ = dict(request=request, expected=expected, intent=expected.intent, previous=independent.previous)[target]
            vars(object_)['foreign'] = 'PRIVATE'
            clock = CallbackUtc(lambda: None)
            with patch.object(m, 'prepare_pdf_preparation_packet', side_effect=AssertionError('No serializer')) as warm, \
                    patch.object(m, 'reopen_pdf_preparation_packet', side_effect=AssertionError('No opener')) as cold:
                if target == 'request':
                    self.refuse(lambda: m.parse_stored_pdf_preparation(self.raw, request, observed_at=self.later.replace(tzinfo=clock)), 'pdf_preparation_stored_result_unavailable')
                else:
                    self.refuse(lambda: self.cold(expected=expected, extraction_expected=independent, observed_at=self.later.replace(tzinfo=clock)), 'pdf_preparation_reopened_result_unavailable')
                warm.assert_not_called()
                cold.assert_not_called()
            self.assertEqual(clock.calls, 0)
        events = []
        class Key:
            def __hash__(self):
                events.append('hash')
                return 3
            def __eq__(self, other):
                events.append('equality')
                return False
        expected = deepcopy(self.expected)
        vars(expected)[Key()] = 'PRIVATE'
        events.clear()
        self.refuse(lambda: self.cold(expected=expected), 'pdf_preparation_reopened_result_unavailable')
        self.assertEqual(events, [])

    def test_native_start_callback_cannot_retarget_expected_artifact_prior_or_context(self):
        import workers.pdf_text_inspection as inspector
        launch = inspector.subprocess.Popen
        expected = deepcopy(self.expected)
        independent = deepcopy(self.prepared.extraction_expected)
        children = []
        def start(*args, **kwargs):
            vars(expected)['artifact_id'] = FOREIGN
            vars(expected.intent)['canonical_metadata'] = b'PRIVATE'
            vars(independent.previous.binding)['item_key'] = 'PRIVATE'
            vars(independent.request)['body'] = b'{}'
            child = launch(*args, **kwargs)
            children.append(child)
            return child
        with patch.object(inspector.subprocess, 'Popen', side_effect=start):
            opened = self.cold(expected=expected, extraction_expected=independent)
        self.assertEqual(len(children), 2)
        self.assertEqual(opened.stored.artifact_id, PREPARATION_ARTIFACT)
        self.assertEqual(part_bytes(opened.result.parts), part_bytes(self.prepared.parts))
        self.assertTrue(all(child.poll() is not None and all(getattr(child, name).closed for name in ('stdin', 'stdout', 'stderr')) for child in children))

    def test_chronology_and_exact_receipt_timestamp_grammar_remain_separate(self):
        value = json.loads(self.raw)
        for time in (_stamp(self.prepared.observed_at - timedelta(microseconds=1)),
                _stamp(self.later + timedelta(microseconds=1)), '2026-01-01T00:00:00Z',
                value['stored_at'].replace('Z', '+00:00'), '2026-02-30T00:00:00.000000Z', True):
            self.refuse_receipt_before_engine(_json(value | dict(stored_at=time)))
        for changes in (dict(stored_at=self.prepared.observed_at - timedelta(microseconds=1)),
                dict(observed_at=self.prepared.observed_at - timedelta(microseconds=1)), dict(artifact_id='PRIVATE'), dict(observed_at=None)):
            kwargs = dict(intent=self.prepared.intent, artifact_id=PREPARATION_ARTIFACT, stored_at=self.stored_at, observed_at=self.later)
            kwargs.update(changes)
            self.refuse(lambda: m.prepare_pdf_preparation_reopen(**kwargs), 'pdf_preparation_read_unavailable')
        with patch.object(m, 'prepare_pdf_preparation_packet', return_value=self.request.packet_raw) as core:
            equality = receipt(self.request, stored_at=self.prepared.observed_at)
            stored = m.parse_stored_pdf_preparation(equality, self.request, observed_at=self.prepared.observed_at)
        self.assertEqual(stored.stored_at, self.prepared.observed_at)
        self.assertEqual(core.call_count, 1)  # Explicit mocked chronology seam, not a native proof.

    def test_all_fixed_private_runtime_boundaries_and_invalid_root_types(self):
        for bad in (None, {}, self.prepared.intent, replace(self.prepared, observed_at=None)):
            self.refuse(lambda: m.prepare_pdf_preparation_store(bad), 'pdf_preparation_store_unavailable')
        for bad in (None, {}, self.prepared):
            self.refuse(lambda: m.parse_stored_pdf_preparation(self.raw, bad, observed_at=self.later), 'pdf_preparation_stored_result_unavailable')
            self.refuse(lambda: m.reopen_stored_pdf_preparation(self.raw, bad,
                receipt=self.prepared.receipt, extraction_expected=self.prepared.extraction_expected,
                intent_raw=self.prepared.intent_raw, observed_at=self.later), 'pdf_preparation_reopened_result_unavailable')
        with patch.object(m, 'prepare_pdf_preparation_packet', side_effect=RuntimeError('PRIVATE_SERIALIZER')):
            self.refuse(lambda: m.prepare_pdf_preparation_store(self.prepared), 'pdf_preparation_store_unavailable')
            self.refuse(lambda: m.parse_stored_pdf_preparation(self.raw, self.request, observed_at=self.later), 'pdf_preparation_stored_result_unavailable')
        with patch.object(m, 'reopen_pdf_preparation_packet', side_effect=RuntimeError('PRIVATE_OPENER')):
            self.refuse(lambda: self.cold(), 'pdf_preparation_reopened_result_unavailable')


if __name__ == '__main__':
    unittest.main()
