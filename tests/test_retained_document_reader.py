"""Control-flow tests for the worker composition, using existing real parsers."""
import base64
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import json
import unittest
from tests.test_document_result_reopen import fixture as document_fixture
from tests.test_stored_document_reference import fixture as reference_fixture
from tests.test_feed_capture_reopen import encode
from tests.test_feed_postgres_contract import uid
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import COMMIT_MARKER
from workers.retained_document_reader import read_retained_document, RetainedDocumentReadError


ROUTES = ('tf_feed_runtime.collection_inventory', 'tf_feed_runtime.document_reference',
    'tf_feed_runtime.feed_original', 'tf_feed_runtime.page_receipt', 'tf_feed_runtime.item_history',
    'tf_feed_runtime.document_original', 'tf_feed_runtime.document_result_receipt')


def fixture():
    expected, request, document, stored, _ = document_fixture()
    feed = request.feed
    _, reference, at = reference_fixture()
    # A composed call uses observations from its injected clock. Keep the old
    # parser fixtures' native observation times at or above that same instant.
    for envelope in (document, reference):
        envelope['observed_at'] = at.isoformat(timespec='microseconds').replace('+00:00', 'Z')
    original = json.loads(feed.raw_response)
    original['observed_at'] = at.isoformat(timespec='microseconds').replace('+00:00', 'Z')
    bodies = [feed.request.inventory_raw, encode(reference), encode(original), request.page_receipt,
        request.history_raw, encode(document), encode(stored)]
    return expected, feed.request.inventory_request, bodies, at


class Port:
    def __init__(self, bodies): self.bodies = bodies; self.calls = []
    def __call__(self, sql):
        self.calls.append(sql)
        item = self.bodies[len(self.calls)-1]
        if isinstance(item, BaseException): raise item
        if type(item) is WorkerOutput: return item
        return WorkerOutput(item+b'\n'+COMMIT_MARKER+b'\n', b'', 0)


def run(port, *, expected=None, inventory=None, clock=None):
    e, inv, _, at = fixture()
    if expected is not None: e = expected
    return read_retained_document(inv if inventory is None else inventory, binding=e.binding,
        mapping=e.mapping, association=e.association, query=port, utc_now=clock or (lambda: at))


class RetainedDocumentReaderTests(unittest.TestCase):
    def test_exact_seven_reads_return_original_and_full_receipt_without_rewriting(self):
        e, inv, bodies, at = fixture(); port = Port(bodies)
        result = run(port)
        self.assertEqual(result.status, 'confirmed_original_and_complete_result')
        self.assertEqual(result.query_count, 7)
        self.assertEqual(result.reopened.result_request.document_raw, e.document_raw)
        self.assertEqual(result.full_receipt, bodies[-1])
        self.assertEqual(result.stored.artifact_id, result.reference.reference.artifact_id)
        self.assertEqual(result.stored.operation_id, e.operation_id)
        for sql, route in zip(port.calls, ROUTES):
            self.assertIn('select '+route+'(', sql)
            self.assertIn('repeatable read read only', sql)
        self.assertNotIn(e.binding.source_url, repr(result))
        self.assertNotIn(e.document_raw.decode(), repr(result))

    def test_explicit_absence_stops_after_two_without_original_or_fallback(self):
        _, _, bodies, _ = fixture(); ref = json.loads(bodies[1]); ref['reference'] = None
        port = Port([bodies[0], encode(ref)])
        result = run(port)
        self.assertEqual((result.status, result.query_count), ('absent_for_selected_occurrence', 2))
        self.assertIsNone(result.reopened); self.assertIsNone(result.full_receipt); self.assertIsNone(result.stored)
        self.assertEqual(len(port.calls), 2)

    def test_selected_page_miss_is_distinct_and_does_not_read_a_reference(self):
        e, inv, bodies, at = fixture(); port = Port(bodies)
        e = replace(e, association=replace(e.association, feed_item_id=uid(99)))
        with self.assertRaisesRegex(RetainedDocumentReadError, '^retained_document_outside_selected_page$'):
            run(port, expected=e)
        self.assertEqual(len(port.calls), 1)

    def test_independent_identity_mismatch_stops_before_raw_reads(self):
        e, inv, bodies, at = fixture()
        for key, bad in [('artifact_id', uid(99)), ('operation_id', uid(99)), ('source_key', 'fictional-other'),
                ('content_sha256', 'f'*64), ('mapping_sha256', 'f'*64), ('language_code', 'nb')]:
            with self.subTest(key=key):
                changed = list(bodies); reference = json.loads(changed[1]); reference['reference'][key] = bad
                changed[1] = encode(reference); port = Port(changed)
                with self.assertRaises(RetainedDocumentReadError): run(port)
                # Artifact/operation candidates are checked against later native
                # current history/original, never adopted as trusted bindings.
                self.assertEqual(len(port.calls), 6 if key == 'artifact_id' else 5 if key == 'operation_id' else 2)

    def test_closed_input_shapes_and_inconsistent_expectations_refuse_before_io(self):
        e, inv, bodies, at = fixture()
        changes = [replace(e, binding=None), replace(e, mapping=replace(e.mapping, mapping_sha256='f'*64)),
            replace(e, association=replace(e.association, document_source_url='https://example.org/other')),
            replace(e, mapping=replace(e.mapping, spans=list(e.mapping.spans))),
            replace(e, binding=replace(e.binding, retrieved_at=at.replace(tzinfo=None)))]
        for changed in changes:
            port = Port(bodies)
            with self.assertRaises(RetainedDocumentReadError): run(port, expected=changed)
            self.assertEqual(port.calls, [])
        for bad in [replace(inv, canonical_input=b'{}'), replace(inv, canonical_input=bytearray(inv.canonical_input))]:
            port = Port(bodies)
            with self.assertRaises(RetainedDocumentReadError): run(port, inventory=bad)
            self.assertEqual(port.calls, [])

    def test_transport_exception_at_each_step_stops_and_does_not_echo_private_details(self):
        _, _, bodies, _ = fixture()
        for index in range(7):
            port = Port(bodies[:index]+[RetainedDocumentReadError('PRIVATE_CANARY /home/private secret SQL')])
            with self.assertRaisesRegex(RetainedDocumentReadError, '^retained_document_read_unavailable$') as caught:
                run(port)
            self.assertIsNone(caught.exception.__cause__)
            self.assertEqual(len(port.calls), index+1)

    def test_incomplete_or_failed_native_output_at_each_step_stops_before_next_read(self):
        _, _, bodies, _ = fixture()
        for index in range(7):
            for output in [WorkerOutput(bodies[index]+b'\n', b'', 0),
                    WorkerOutput(bodies[index]+b'\n'+COMMIT_MARKER+b'\n', b'private', 0),
                    WorkerOutput(bodies[index]+b'\n'+COMMIT_MARKER+b'\n', b'', 1),
                    WorkerOutput(b'{}\n'+COMMIT_MARKER+b'\n', b'', 0),
                    WorkerOutput(b'x'*131073, b'', 0)]:
                with self.subTest(index=index, output=output.returncode):
                    port = Port(bodies[:index]+[output])
                    with self.assertRaises(RetainedDocumentReadError): run(port)
                    self.assertEqual(len(port.calls), index+1)

    def test_changed_originals_and_complete_result_never_return_partial_success(self):
        _, _, bodies, _ = fixture()
        for index in [2, 5, 6]:
            changed = list(bodies); value = json.loads(changed[index])
            if index in [2, 5]: value['raw_base64'] = base64.b64encode(b'CHANGED ORIGINAL').decode()
            else: value['input']['snapshot']['passages'][0]['text'] = 'CHANGED RESULT'
            changed[index] = encode(value); port = Port(changed)
            with self.assertRaises(RetainedDocumentReadError): run(port)
            self.assertEqual(len(port.calls), index+1)

    def test_each_pre_and_post_io_clock_must_be_utc_nonregressing(self):
        _, _, bodies, at = fixture()
        for position in range(14):
            for bad in [at.replace(tzinfo=None), at-timedelta(days=1), None]:
                ticks = iter([at]*position+[bad]); port = Port(bodies)
                with self.assertRaises(RetainedDocumentReadError): run(port, clock=lambda: next(ticks))
                self.assertEqual(len(port.calls), (position+1)//2)
        ticks = iter([at, at+timedelta(seconds=1), at]); port = Port(bodies)
        with self.assertRaises(RetainedDocumentReadError): run(port, clock=lambda: next(ticks))
        self.assertEqual(len(port.calls), 1)

    def test_inventory_occurrence_must_match_independent_parent_even_when_reference_absent(self):
        e, inv, bodies, at = fixture(); ref = json.loads(bodies[1]); ref['reference'] = None
        port = Port([bodies[0], encode(ref)])
        changed = replace(e, association=replace(e.association, feed_operation_id=uid(99)))
        with self.assertRaises(RetainedDocumentReadError): run(port, expected=changed)
        self.assertEqual(len(port.calls), 1)

    def test_output_type_and_bytes_subclass_hooks_are_not_admitted(self):
        _, _, bodies, _ = fixture(); calls = []
        class Hook(bytes):
            def __len__(self): calls.append('length'); return 1
            def decode(self, *args, **kwargs): calls.append('decode'); return '{}'
        class Child(WorkerOutput): pass
        for output in [WorkerOutput(Hook(b'{}'), b'', 0), WorkerOutput(b'{}', b'', True)]:
            port = Port([output])
            with self.assertRaises(RetainedDocumentReadError): run(port)
            self.assertEqual(len(port.calls), 1)
        def query(sql): return Child(bodies[0]+b'\n'+COMMIT_MARKER+b'\n', b'', 0)
        with self.assertRaises(RetainedDocumentReadError): run(query)
        self.assertEqual(calls, [])

    def test_clock_failure_is_curated_and_process_interrupt_is_not_swallowed(self):
        _, _, bodies, _ = fixture(); port = Port(bodies)
        def broken(): raise RuntimeError('PRIVATE_CLOCK')
        with self.assertRaisesRegex(RetainedDocumentReadError, '^retained_document_read_unavailable$'):
            run(port, clock=broken)
        self.assertEqual(port.calls, [])
        port = Port([KeyboardInterrupt()])
        with self.assertRaises(KeyboardInterrupt): run(port)
        self.assertEqual(len(port.calls), 1)


class RetainedReaderTrialScopeTests(unittest.TestCase):
    def test_extra_target_argument_refuses_before_constructing_resource(self):
        from unittest.mock import patch
        from scripts import rehearse_retained_document_reader as module
        with patch.object(module.sys, 'argv', ['trial', 'existing-target']), patch.object(module, 'FreshFeedPostgres') as make:
            with self.assertRaises(module.FeedPgTrialError): module.main()
            make.assert_not_called()

    def test_foreign_or_untyped_port_custodian_refuses_before_io(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        from scripts.rehearse_retained_document_reader import RestrictedPort, FeedPgTrialError
        from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
        trial = SimpleNamespace(query=Mock()); foreign = SimpleNamespace(query=Mock())
        for roles in (OwnedRuntimeRoles(foreign), SimpleNamespace(trial=trial)):
            with self.assertRaises(FeedPgTrialError): RestrictedPort(trial, roles, 'invented')
        trial.query.assert_not_called(); foreign.query.assert_not_called()

    def test_failure_still_stops_owned_resources_and_verifies_frozen_sources(self):
        from unittest.mock import Mock, patch
        from scripts import rehearse_retained_document_reader as module
        trial = Mock(); trial.identity = 'owned'; events = []
        trial.stop.side_effect = lambda: events.append('stop')
        trial.stop_initializer.side_effect = lambda: events.append('initializer')
        trial.verify_sources.side_effect = lambda label: events.append(label)
        trial.inspect.side_effect = lambda: events.append('inspect') or {'owned': True}
        with patch.object(module.sys, 'argv', ['trial']), patch.object(module, 'FreshFeedPostgres', return_value=trial), \
                patch.object(module, 'freeze_all'), patch.object(module, 'freeze_reference'), patch.object(module, 'freeze_worker'), \
                patch.object(module, 'cases', side_effect=RuntimeError('invented')):
            with self.assertRaises(RuntimeError): module.main()
        self.assertEqual(events, ['stop', 'initializer', 'FINAL_RETAINED_WORKER', 'inspect'])
        self.assertTrue(any(call.args[0] == 'RETAINED_WORKER_FAILED' for call in trial.record.call_args_list))


if __name__ == '__main__': unittest.main()
