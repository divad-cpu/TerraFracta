import base64
from datetime import datetime, timezone
import json
import socket
import threading
import time
import unittest

from workers.closed_pair_channel import (FIELDS, MAX_BODY_BYTES, MAX_PACKETS,
    MAX_REQUEST_BYTES, PairChannelClient, PairChannelError, PairCustodianSession,
    validate_operation)


def b64(raw):
    return base64.b64encode(raw).decode('ascii')


class ClosedPairChannelTests(unittest.TestCase):
    def packet(self, value, *, expected_id=1, callbacks=None, raw=None):
        calls = []
        ops = {name: lambda args, name=name: calls.append((name, args)) or b'{"ok":true}' for name in FIELDS}
        if callbacks:
            ops.update(callbacks)
        session = PairCustodianSession(ops, time.monotonic() + 2)
        session.next_id = expected_id
        parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        with parent, child:
            child.settimeout(2)
            child.send(raw if raw is not None else json.dumps(value).encode())
            state = session.serve_one(parent)
            response = json.loads(child.recv(45057))
        return state, response, calls, session

    def request(self, operation='reserve_response', arguments=None, **extra):
        return {'schemaVersion': 1, 'requestId': 1, 'operation': operation,
                'arguments': {'kind': 'metadata'} if arguments is None else arguments, **extra}

    def test_sql_role_connection_and_transaction_inputs_never_reach_backend(self):
        invalid = [self.request(sql='SET CONSTRAINTS ALL IMMEDIATE'),
            self.request(role='postgres'), self.request(connection='private-canary'),
            self.request(transaction='begin'), self.request(operation='SET CONSTRAINTS ALL IMMEDIATE'),
            self.request(arguments={'kind': 'metadata', 'sql': 'select 1'}),
            self.request(arguments={'kind': 'other'}), self.request(operation='publish'),
            self.request(schemaVersion=True), self.request(requestId=True),
            self.request(requestId=2), self.request(requestId=0), self.request(requestId=33),
            self.request(arguments=[]), [], None]
        for value in invalid:
            with self.subTest(value=value):
                state, response, calls, session = self.packet(value)
                self.assertEqual(state, 'refused')
                self.assertEqual(calls, [])
                self.assertTrue(session.closed)
                self.assertNotIn('private-canary', json.dumps(response))

    def test_duplicate_invalid_utf8_nonfinite_and_truncated_messages_are_terminal(self):
        invalid = [b'\xff', b'{"requestId":1,"requestId":2}',
            b'{"schemaVersion":1,"requestId":NaN,"operation":"reserve_response","arguments":{"kind":"metadata"}}',
            b'x' * (MAX_REQUEST_BYTES + 1), b'[' * 1500]
        for raw in invalid:
            state, response, calls, session = self.packet(None, raw=raw)
            self.assertEqual((state, calls, session.closed), ('refused', [], True))
            self.assertEqual(response['reason'], 'invalid_request')

    def test_all_eight_operations_have_closed_validated_arguments(self):
        timestamp = datetime.now(timezone.utc).isoformat()
        rid = '11111111-1111-4111-8111-111111111111'
        inputs = {
            'reserve_response': {'kind': 'metadata'},
            'dispatch_response': {'kind': 'data', 'reservationId': rid},
            'settle_response': {'kind': 'data', 'reservationId': rid, 'outcome': 'measured', 'bodyBytes': 2, 'contentSha256': 'a' * 64},
            'confirm_response': {'kind': 'metadata', 'phase': 'reserve', 'receipt': b64(b'{"ok":true}')},
            'store_pair': {'metadata': b64(b'{}'), 'data': b64(b'{}'), 'metadataRetrievedAt': timestamp,
                           'dataRetrievedAt': timestamp, 'manifest': '{}'},
            'read_pair_checkpoint': {}, 'close_processing': {}, 'read_closeout': {},
        }
        for name, arguments in inputs.items():
            with self.subTest(name=name):
                state, response, calls, session = self.packet(self.request(name, arguments))
                self.assertEqual(state, 'receipt')
                self.assertEqual(calls, [(name, arguments)])
                self.assertEqual(base64.b64decode(response['receipt']), b'{"ok":true}')
                self.assertFalse(session.closed)
                self.assertEqual(session.next_id, 2)

    def test_full_size_two_bodies_fit_actual_unix_packet(self):
        stamp = datetime.now(timezone.utc).isoformat()
        arguments = {'metadata': b64(b'm' * MAX_BODY_BYTES), 'data': b64(b'd' * MAX_BODY_BYTES),
                     'metadataRetrievedAt': stamp, 'dataRetrievedAt': stamp, 'manifest': '{}'}
        self.assertLess(len(json.dumps(self.request('store_pair', arguments))), MAX_REQUEST_BYTES)
        state, _, calls, _ = self.packet(self.request('store_pair', arguments))
        self.assertEqual(state, 'receipt')
        self.assertEqual(len(calls), 1)

    def test_bad_measurement_uuid_phase_base64_chronology_or_manifest_is_refused(self):
        rid = '11111111-1111-4111-8111-111111111111'
        settlement = {'kind': 'metadata', 'reservationId': rid, 'outcome': 'uncertain',
                      'bodyBytes': MAX_BODY_BYTES + 1, 'contentSha256': None}
        confirm = {'kind': 'data', 'phase': 'dispatch', 'receipt': b64(b'{}')}
        store = {'metadata': b64(b'{}'), 'data': b64(b'{}'), 'metadataRetrievedAt': '2026-10-01T12:00:00+00:00',
                 'dataRetrievedAt': '2026-10-01T12:00:01+00:00', 'manifest': '{}'}
        cases = [('settle_response', {**settlement, 'bodyBytes': True}),
                 ('settle_response', {**settlement, 'contentSha256': 'a' * 64}),
                 ('settle_response', {**settlement, 'bodyBytes': 1}),
                 ('settle_response', {**settlement, 'reservationId': 'SELECT 1'}),
                 ('settle_response', {**settlement, 'outcome': []}),
                 ('confirm_response', {**confirm, 'phase': 'commit'}),
                 ('confirm_response', {**confirm, 'receipt': b64(b'[]')}),
                 ('confirm_response', {**confirm, 'receipt': 'e31='}),
                 ('store_pair', {**store, 'metadata': b64(b'x' * (MAX_BODY_BYTES + 1))}),
                 ('store_pair', {**store, 'dataRetrievedAt': '2026-10-01T11:59:59+00:00'}),
                 ('store_pair', {**store, 'dataRetrievedAt': '2026-10-01T12:05:01+00:00'}),
                 ('store_pair', {**store, 'metadataRetrievedAt': '2026-10-01T12:00:00'}),
                 ('store_pair', {**store, 'manifest': '[]'}),
                 ('store_pair', {**store, 'manifest': '{"x":1,"x":2}'}),
                 ('read_closeout', {'sql': 'SET CONSTRAINTS ALL IMMEDIATE'})]
        for name, arguments in cases:
            with self.subTest(name=name, arguments=str(arguments)[:90]):
                state, _, calls, session = self.packet(self.request(name, arguments))
                self.assertEqual((state, calls, session.closed), ('refused', [], True))

    def test_backend_error_bad_or_late_result_never_leaks_or_retries(self):
        def error(_args):
            raise ValueError('database-password-private-canary')
        def late(_args):
            time.sleep(.04)
            return b'{}'
        callbacks = [error, lambda _: b'{"duplicate":1,"duplicate":2}', lambda _: b'[]',
                     lambda _: b'{"huge":"' + b'x' * 32768 + b'"}', lambda _: 'private-canary']
        for callback in callbacks:
            state, response, _, session = self.packet(self.request(), callbacks={'reserve_response': callback})
            self.assertEqual((state, session.closed, session.next_id), ('refused', True, 2))
            self.assertEqual(response['reason'], 'unavailable')
            self.assertNotIn('private-canary', json.dumps(response))
        ops = {name: late for name in FIELDS}
        parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        with parent, child:
            session = PairCustodianSession(ops, time.monotonic() + .02)
            child.send(json.dumps(self.request()).encode())
            self.assertEqual(session.serve_one(parent), 'refused')
            self.assertTrue(session.closed)

    def test_replay_packet_budget_and_ancillary_descriptor_never_invoke_callback(self):
        for expected in (2, MAX_PACKETS + 1):
            state, _, calls, session = self.packet(self.request(), expected_id=expected)
            self.assertEqual((state, calls, session.closed), ('refused', [], True))
        import array
        import os
        read_fd, write_fd = os.pipe()
        parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        calls = []
        try:
            with parent, child:
                session = PairCustodianSession({n: lambda _: calls.append('bad') or b'{}' for n in FIELDS}, time.monotonic() + 2)
                child.sendmsg([json.dumps(self.request()).encode()], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [read_fd]))])
                self.assertEqual(session.serve_one(parent), 'refused')
                self.assertEqual(calls, [])
        finally:
            os.close(read_fd)
            os.close(write_fd)

    def test_client_actual_round_trip_and_terminal_ambiguity(self):
        parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        failures = []
        with parent, child:
            session = PairCustodianSession({n: lambda _: b'{"actual":true}' for n in FIELDS}, time.monotonic() + 2)
            def serve():
                try:
                    session.serve_one(parent)
                    session.serve_one(parent)
                except BaseException as error:
                    failures.append(error)
            thread = threading.Thread(target=serve)
            thread.start()
            client = PairChannelClient(child, timeout=1)
            self.assertEqual(client.call('reserve_response', {'kind': 'metadata'}), b'{"actual":true}')
            self.assertEqual(client.call('read_closeout', {}), b'{"actual":true}')
            thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertEqual(failures, [])
        parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        with parent, child:
            parent.close()
            client = PairChannelClient(child, timeout=.05)
            with self.assertRaises(PairChannelError):
                client.call('reserve_response', {'kind': 'metadata'})
            self.assertTrue(client.closed)
            with self.assertRaises(PairChannelError):
                client.call('read_closeout', {})
            self.assertEqual(client.next_id, 2)

    def test_client_changed_response_identity_and_extra_fields_are_terminal(self):
        for response in ({'schemaVersion': True, 'requestId': 1, 'state': 'receipt', 'receipt': b64(b'{}')},
                         {'schemaVersion': 1, 'requestId': 2, 'state': 'receipt', 'receipt': b64(b'{}')},
                         {'schemaVersion': 1, 'requestId': 1, 'state': 'receipt', 'receipt': b64(b'{}'), 'role': 'postgres'},
                         {'schemaVersion': 1, 'requestId': 1, 'state': 'receipt', 'receipt': b64(b'[]')}):
            parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
            with parent, child:
                parent.send(json.dumps(response).encode())
                client = PairChannelClient(child)
                with self.assertRaises(PairChannelError):
                    client.call('read_closeout', {})
                self.assertTrue(client.closed)


if __name__ == '__main__':
    unittest.main()
