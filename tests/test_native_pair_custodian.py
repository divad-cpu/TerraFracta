"""Independent parent checks using the existing invented receipt fixtures.

No native connection or live source. Actual native integration is recorded
separately; these fixtures supply committed-shaped replies and controlled faults.
"""
import base64
from datetime import timedelta
import json
from types import SimpleNamespace
import unittest

from tests import test_closed_ssb_worker as composition_support
from tests.test_reserved_ssb_capture import NOW
from workers.closed_ssb_worker import process_closed_ssb_context
from workers.native_pair_custodian import NativePairCustodian, OPERATIONS
from workers.pair_native_sql import operation_sql

packet, wire = composition_support.packet, composition_support.wire


class NativeCustodianTests(unittest.TestCase):
    def setUp(self):
        self.backend = composition_support.ClosedCompositionTests(); self.backend.setUp()
        self.observed = NOW
        self.executed = []
        self.transform = lambda operation, arguments, raw:raw
        self.before = lambda operation, arguments:None
        self.parent = NativePairCustodian(wire(packet()), self.execute,
            utc_now=lambda:self.observed)

    def execute(self, operation, arguments):
        self.executed.append(operation)
        self.before(operation, arguments)
        raw = self.backend.call(operation, arguments)
        if operation == 'store_pair': raw = b'{"stored":true,"status":"created"}'
        if operation == 'close_processing':
            # The native API returns its full committed closeout. The older
            # cooperative worker fixture used an unused two-field acknowledgment.
            raw = self.backend.receipts['read_closeout']
        return self.transform(operation, arguments, raw)

    def run_worker(self, call=None):
        return process_closed_ssb_context(wire(packet()),
            SimpleNamespace(call=self.parent.invoke if call is None else call),
            self.backend.shared.fetch, utc_now=lambda:NOW,
            monotonic=lambda:self.backend.shared.ticks)

    def test_nominal_parent_checks_all_six_confirmations_and_both_terminal_receipts(self):
        result = self.run_worker()
        self.assertEqual(tuple(self.executed), OPERATIONS)
        self.assertEqual(tuple(self.parent.calls), OPERATIONS)
        self.assertEqual(result.checkpoint, self.parent.committed_receipts['read_pair_checkpoint'])
        self.assertEqual(result.closeout, self.parent.committed_receipts['read_closeout'])
        self.assertEqual(self.parent.stored_context.attention_reasons, ('first_response_pair',))
        self.assertTrue(self.parent.closed)
        with self.assertRaises(ValueError): self.parent.invoke('read_closeout', {})
        self.assertEqual(len(self.executed), 16)

    def test_wrong_kind_or_skipped_confirmation_refuses_before_native_execution(self):
        for before_reservation in (True, False):
            self.setUp()
            if before_reservation:
                arguments = {'kind':'data'}; operation = 'reserve_response'
            else:
                raw = self.parent.invoke('reserve_response', {'kind':'metadata'})
                arguments = {'kind':'metadata', 'reservationId':json.loads(raw)['reservationId']}
                operation = 'dispatch_response'
            with self.assertRaises(ValueError): self.parent.invoke(operation, arguments)
            with self.assertRaises(ValueError): self.parent.invoke('reserve_response', {'kind':'metadata'})
            self.assertEqual(len(self.executed), int(not before_reservation))
            self.assertTrue(self.parent.closed)

    def test_substituted_confirmation_bytes_or_phase_never_reach_native_confirmer(self):
        for wrong_phase in (False, True):
            self.setUp(); raw = self.parent.invoke('reserve_response', {'kind':'metadata'})
            arguments = {'kind':'metadata', 'phase':'dispatch' if wrong_phase else 'reserve',
                'receipt':base64.b64encode(raw if wrong_phase else b'{}').decode()}
            with self.assertRaises(ValueError): self.parent.invoke('confirm_response', arguments)
            self.assertEqual(self.executed, ['reserve_response'])

    def test_native_principal_hash_or_expiry_substitution_stops_before_fetch(self):
        for field, value in (('principal','another_principal'), ('receiptSha256','0'*64),
                ('authorityExpiresAt',NOW.isoformat())):
            self.setUp()
            def transform(operation, arguments, raw):
                if operation != 'confirm_response': return raw
                payload = json.loads(raw); payload[field] = value
                return json.dumps(payload).encode()
            self.transform = transform
            with self.assertRaises(ValueError): self.run_worker()
            self.assertEqual(self.executed, ['reserve_response', 'confirm_response'])
            self.assertFalse(any(event[1]=='fetch' for event in self.backend.shared.events))
            self.assertTrue(self.parent.closed)

    def test_bad_backend_reply_is_consumed_without_retry_or_exception_details(self):
        for reply in (b'{}', b'[]', b'\xff', b'{"duplicate":1,"duplicate":2}', b'x'*32769):
            self.setUp(); self.transform = lambda *args:reply
            with self.assertRaisesRegex(ValueError, '^Private custodian operation refused$'):
                self.parent.invoke('reserve_response', {'kind':'metadata'})
            with self.assertRaises(ValueError): self.parent.invoke('reserve_response', {'kind':'metadata'})
            self.assertEqual(self.executed, ['reserve_response'])

    def test_expiry_during_native_callback_closes_after_one_committed_reservation(self):
        self.before = lambda *_:setattr(self, 'observed', NOW+timedelta(seconds=31))
        with self.assertRaises(ValueError): self.parent.invoke('reserve_response', {'kind':'metadata'})
        with self.assertRaises(ValueError): self.parent.invoke('reserve_response', {'kind':'metadata'})
        self.assertEqual(self.executed, ['reserve_response'])
        self.assertTrue(self.parent.closed)

    def test_lost_reply_and_local_journal_failure_never_replay_native_write(self):
        for fault in ('reply', 'journal'):
            self.setUp()
            def fail(*_): raise ValueError('invented-private-diagnostic-canary')
            if fault == 'reply': self.transform = fail
            else: self.parent.on_confirmed = fail
            with self.assertRaises(ValueError) as error: self.parent.invoke('reserve_response', {'kind':'metadata'})
            self.assertNotIn('canary', str(error.exception))
            with self.assertRaises(ValueError): self.parent.invoke('reserve_response', {'kind':'metadata'})
            self.assertEqual(self.executed, ['reserve_response'])

    def test_changed_valid_body_is_held_before_private_or_native_store(self):
        def changed_call(operation, arguments):
            if operation == 'store_pair':
                data = json.loads(base64.b64decode(arguments['data'])); data['value'][0] = 7.7
                arguments = {**arguments, 'data':base64.b64encode(json.dumps(data).encode()).decode()}
            return self.parent.invoke(operation, arguments)
        with self.assertRaises(ValueError): self.run_worker(changed_call)
        self.assertEqual(len(self.executed), 12)
        self.assertNotIn('store_pair', self.executed)
        self.assertEqual(self.backend.pending.events, [])

    def test_forged_usable_checkpoint_and_closeout_are_not_released(self):
        for forged_operation in ('read_pair_checkpoint', 'close_processing', 'read_closeout'):
            self.setUp()
            def transform(operation, arguments, raw):
                if operation != forged_operation: return raw
                payload = json.loads(raw)
                if operation == 'read_pair_checkpoint': payload['validationState'] = 'usable'
                else: payload['summary']['runState'] = 'completed'
                return json.dumps(payload).encode()
            self.transform = transform
            with self.assertRaises(ValueError): self.run_worker()
            self.assertEqual(self.executed[-1], forged_operation)
            self.assertTrue(self.parent.closed)

    def test_store_acknowledgment_cannot_add_raw_content_to_the_receipt_journal(self):
        for reply in (b'{"stored":true}',b'{"stored":1,"status":"created"}',
                b'{"stored":true,"status":"created","rawBody":"invented-private-canary"}'):
            self.setUp()
            self.transform=lambda operation,arguments,raw:reply if operation=='store_pair' else raw
            with self.assertRaises(ValueError):self.run_worker()
            self.assertNotIn('store_pair',self.parent.calls)
            self.assertEqual(self.executed[-1],'store_pair')

    def test_sql_role_and_endpoint_selectors_refuse_without_native_call(self):
        for operation, arguments in (('set role postgres', {}),
                ('reserve_response', {'kind':'metadata','sql':'select 1'}),
                ('reserve_response', {'kind':'metadata','endpoint':'https://example.org'})):
            self.setUp()
            with self.assertRaises(ValueError): self.parent.invoke(operation, arguments)
            self.assertEqual(self.executed, [])

    def test_read_closeout_cannot_substitute_a_later_finish_for_the_committed_closeout(self):
        def transform(operation, arguments, raw):
            if operation != 'read_closeout': return raw
            self.observed = NOW+timedelta(seconds=1)
            payload = json.loads(raw)
            payload['finishedAt'] = (NOW+timedelta(microseconds=1)).isoformat()
            return json.dumps(payload).encode()
        self.transform = transform
        with self.assertRaises(ValueError): self.run_worker()
        self.assertEqual(self.executed[-1], 'read_closeout')
        self.assertNotIn('read_closeout', self.parent.calls)


class NativeSQLTests(unittest.TestCase):
    def test_fixed_function_identifier_has_no_client_selected_schema_or_control(self):
        self.assertIn('terra_pair_capture_test_api.read_pair_checkpoint();', operation_sql('read_pair_checkpoint', {}))
        for operation, arguments in (('read_pair_checkpoint;select 1', {}),
                ('reserve_response', {'kind':'metadata','schema':'public'}),
                ('reserve_response', {'kind':"metadata');set role postgres;--"})):
            with self.assertRaises(ValueError): operation_sql(operation, arguments)

    def test_json_receipt_literals_escape_quotes_and_refuse_embedded_nul(self):
        raw = b'{"text":"\' ; select 1; --"}'
        sql = operation_sql('confirm_response', {'kind':'metadata','phase':'reserve',
            'receipt':base64.b64encode(raw).decode()})
        self.assertIn("'' ; select 1; --", sql)
        self.assertTrue(sql.startswith('set standard_conforming_strings=on;'))
        from workers.pair_native_sql import _literal
        with self.assertRaises(ValueError): _literal('a\x00b')


if __name__ == '__main__': unittest.main()
