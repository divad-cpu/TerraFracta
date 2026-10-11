"""Bind exact native context before one isolated invented worker launch."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import socket
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts.admit_frozen_ssb_launch import AdmittedFrozenFixtureLaunch
from scripts.ssb_execution_inventory import runtime_record
from workers.closed_ssb_worker import parse_closed_ssb_context
from workers.bounded_worker_process import communicate_bounded
from tests.frozen_ssb_support import admitted_context, frozen_at


class FrozenAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = frozen_at(Path(self.temp.name)/'source')
        self.addCleanup(self.source.close)
        self.now = datetime.now(timezone.utc)
        self.raw, self.expected = admitted_context(self.source.source_fingerprint, now=self.now)
        self.runtime = runtime_record()

    def bind(self, raw=None, **changes):
        return AdmittedFrozenFixtureLaunch(self.source, self.raw if raw is None else raw,
            **{**self.expected, **changes}, now=self.now)

    def test_bound_receipt_records_exact_source_and_context_without_credentials(self):
        from hashlib import sha256
        launch = self.bind()
        receipt = launch.receipt()
        self.assertEqual(receipt['sourceFingerprint'], self.source.source_fingerprint)
        self.assertEqual(receipt['contextSha256'], sha256(self.raw).hexdigest())
        self.assertTrue(receipt['sealedSource'])
        self.assertFalse(receipt['repositoryCodeReopened'])
        self.assertNotIn('principal', receipt)

    def test_run_work_registration_pair_principal_and_version_changes_refuse_before_spawn(self):
        changes = [dict(metadata=self.expected['data']), dict(data=self.expected['metadata']),
            dict(metadata=replace(self.expected['metadata'], work=replace(self.expected['metadata'].work, attempt=2))),
            dict(metadata=replace(self.expected['metadata'], request_key='changed:key')),
            dict(pair_id=self.expected['versions']['metadata']), dict(principal='other_principal'),
            dict(versions={**self.expected['versions'], 'metadata': self.expected['versions']['data']})]
        with patch('scripts.admit_frozen_ssb_launch.subprocess.Popen') as spawn:
            for change in changes:
                with self.subTest(change=tuple(change)), self.assertRaises(ValueError):
                    self.bind(**change)
            spawn.assert_not_called()

    def test_source_version_retry_and_extra_capacity_never_authorize_launch(self):
        for alter in ('source', 'retry', 'bytes', 'items'):
            value = json.loads(self.raw)
            if alter == 'source':
                value['request']['code_version'] = 'ssb-sha256:'+'0'*64
            elif alter == 'retry':
                value['request']['limits']['max_retries'] = 1
            elif alter == 'bytes':
                value['request']['limits']['max_response_bytes'] += 1
            else:
                value['request']['limits']['max_items'] += 1
            raw = json.dumps(value).encode()
            context = parse_closed_ssb_context(raw, now=self.now)
            with self.subTest(alter=alter), self.assertRaisesRegex(ValueError, 'single-attempt contract'):
                self.bind(raw, metadata=context.metadata, data=context.data)

    def test_actual_changed_stdin_refuses_before_any_channel_operation(self):
        launch = self.bind()
        parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        with parent, child:
            process = launch.start(child)
            child.close()
            result = communicate_bounded(process, self.raw+b' ', timeout=5)
            self.assertEqual((result.returncode, result.stdout, result.stderr),
                (1, b'', b'Frozen private SSB worker refused the operation.\n'))
            parent.settimeout(1)
            self.assertEqual(parent.recv(4096), b'')
            with self.assertRaisesRegex(ValueError, 'already consumed'):
                launch.start(parent)

    def test_stream_socket_does_not_grant_the_packet_capability_or_a_second_try(self):
        launch = self.bind()
        parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        with parent, child, patch('scripts.admit_frozen_ssb_launch.subprocess.Popen') as spawn:
            with self.assertRaisesRegex(ValueError, 'capability refused'):
                launch.start(child)
            with self.assertRaisesRegex(ValueError, 'already consumed'):
                launch.start(child)
            spawn.assert_not_called()

    def test_private_transport_purpose_cannot_bind_the_fictional_worker_launch(self):
        from tests import test_ssb_frozen_private_transport as private_support
        helper=private_support.PrivateTransportSourceTests();helper.setUp()
        self.addCleanup(helper.doCleanups)
        source=helper.source()
        raw,expected=admitted_context(source.source_fingerprint,now=self.now)
        with patch('scripts.admit_frozen_ssb_launch.runtime_record',return_value=self.runtime), \
                patch('scripts.admit_frozen_ssb_launch.subprocess.Popen') as spawn:
            with self.assertRaisesRegex(ValueError,'purpose changed'):
                AdmittedFrozenFixtureLaunch(source,raw,**expected,now=self.now)
            spawn.assert_not_called()

    def test_failed_spawn_consumes_launch_without_automatic_retry(self):
        launch = self.bind()
        parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        with parent, child, patch('scripts.admit_frozen_ssb_launch.runtime_record', return_value=self.runtime), \
                patch('scripts.admit_frozen_ssb_launch.subprocess.Popen', side_effect=OSError('invented spawn refusal')) as spawn:
            with self.assertRaises(OSError):
                launch.start(child)
            with self.assertRaisesRegex(ValueError, 'already consumed'):
                launch.start(child)
            self.assertEqual(spawn.call_count, 1)

    def test_expired_work_is_refused_again_immediately_before_spawn(self):
        launch = self.bind()
        parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        with parent, child, patch('scripts.admit_frozen_ssb_launch.datetime') as clock, \
                patch('scripts.admit_frozen_ssb_launch.runtime_record', return_value=self.runtime), \
                patch('scripts.admit_frozen_ssb_launch.subprocess.Popen') as spawn:
            clock.now.return_value = self.now+timedelta(seconds=31)
            with self.assertRaises(ValueError):
                launch.start(child)
            spawn.assert_not_called()


if __name__ == '__main__':
    unittest.main()
