import base64
from copy import deepcopy
import unittest
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from workers.bounded_worker_process import WorkerOutput
from scripts.run_closed_pair_channel_trial import validate_committed_worker_result, persist_checked_worker_output


def encoded(raw):
    return base64.b64encode(raw).decode('ascii')


class ClosedWorkerResultTests(unittest.TestCase):
    def setUp(self):
        self.times = {'metadataRetrievedAt': '2026-10-01T12:00:00+00:00',
                      'dataRetrievedAt': '2026-10-01T12:00:01+00:00'}
        self.receipts = {'read_pair_checkpoint': b'{"state":"pending"}',
                         'read_closeout': b'{"state":"partial"}'}
        self.payload = {'schemaVersion': 1, 'fixtureReads': ['metadata', 'data'],
            'canonicalManifest': '{"scope":"fictional"}', **self.times,
            'checkpoint': encoded(self.receipts['read_pair_checkpoint']),
            'closeout': encoded(self.receipts['read_closeout']), 'operations': 16,
            'credentialEnvironmentPresent': False, 'databaseClientPresent': False,
            'actualSourceRequests': 0, 'transactionControlProbeRefused': True}

    def check(self, payload, **changes):
        options = {'canonical': self.payload['canonicalManifest'], 'calls': ['fixed'] * 16,
                   'failures': [], 'committed_times': self.times, 'committed_receipts': self.receipts}
        options.update(changes)
        return validate_committed_worker_result(payload, **options)

    def test_exact_custodian_observed_result_is_accepted(self):
        self.assertIsNone(self.check(self.payload))

    def output(self, proof, result):
        return persist_checked_worker_output(proof,result,canonical=self.payload['canonicalManifest'],
            calls=['fixed']*16,failures=[],committed_times=self.times,committed_receipts=self.receipts)

    def test_only_validated_exact_worker_output_is_persisted(self):
        with TemporaryDirectory() as directory:
            proof=Path(directory)
            result=WorkerOutput(json.dumps(self.payload).encode(),b'',0)
            self.assertEqual(self.output(proof,result),self.payload)
            self.assertEqual((proof/'CLOSED_WORKER_STDOUT.json').read_bytes(),result.stdout)
            self.assertEqual((proof/'CLOSED_WORKER_STDERR.log').read_bytes(),b'')

    def test_raw_canaries_in_stderr_invalid_json_or_extra_fields_create_no_copies(self):
        valid=json.dumps(self.payload).encode()
        cases=(WorkerOutput(valid,b'private-raw-canary',0),WorkerOutput(valid,b'private-raw-canary',1),
               WorkerOutput(b'\xffprivate-raw-canary',b'',0),
               WorkerOutput(json.dumps({**self.payload,'rawBody':'private-raw-canary'}).encode(),b'',0),
               WorkerOutput(valid[:-1]+b',"schemaVersion":1}',b'',0))
        for result in cases:
            with self.subTest(code=result.returncode),TemporaryDirectory() as directory:
                proof=Path(directory)
                with self.assertRaises(ValueError):self.output(proof,result)
                self.assertEqual(list(proof.iterdir()),[])

    def test_worker_cannot_replace_commit_receipts_times_or_claim_live_success(self):
        changes = [('schemaVersion', True), ('actualSourceRequests', False), ('actualSourceRequests', 1),
            ('operations', 15), ('credentialEnvironmentPresent', True), ('databaseClientPresent', True),
            ('transactionControlProbeRefused', False), ('canonicalManifest', '{}'),
            ('fixtureReads', ['data', 'metadata']), ('metadataRetrievedAt', '2030-01-01T12:00:00+00:00'),
            ('dataRetrievedAt', '2026-10-01T12:00:02+00:00'),
            ('checkpoint', encoded(b'{"state":"usable"}')),
            ('closeout', encoded(b'{"state":"completed"}')),
            ('checkpoint', encoded(b'{ "state": "pending" }'))]
        for key, value in changes:
            with self.subTest(key=key, value=value):
                payload = {**self.payload, key: value}
                with self.assertRaises(ValueError):
                    self.check(payload)

    def test_missing_custodian_evidence_is_not_borrowed_from_worker(self):
        for changes in ({'calls': ['fixed'] * 15}, {'failures': ['PairChannelError']},
                        {'committed_times': {}}, {'committed_receipts': {}}):
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    self.check(self.payload, **changes)
        for value in ({**self.payload, 'sql': 'private-canary'}, []):
            with self.assertRaises(ValueError):
                self.check(value)

    def test_frozen_launch_receipt_must_match_custodian_bytes_and_strict_types(self):
        expected = {'schemaVersion': 1, 'sourceFingerprint': 'a'*64, 'archiveSha256': 'b'*64,
            'contextSha256': 'c'*64, 'sealedSource': True, 'sealedTransportChildren': 2,
            'repositoryCodeReopened': False}
        self.check({**self.payload, 'launchReceipt': expected}, expected_launch_receipt=expected)
        for key, value in (('sourceFingerprint', 'd'*64), ('archiveSha256', 'd'*64),
                           ('contextSha256', 'd'*64), ('sealedSource', False),
                           ('sealedTransportChildren', 3), ('repositoryCodeReopened', True),
                           ('schemaVersion', True), ('sealedSource', 1),
                           ('sealedTransportChildren', 2.0), ('repositoryCodeReopened', 0)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check({**self.payload, 'launchReceipt': {**expected, key: value}}, expected_launch_receipt=expected)
        with self.assertRaises(ValueError):
            self.check({**self.payload, 'launchReceipt': expected})
        with self.assertRaises(ValueError):
            self.check(self.payload, expected_launch_receipt=expected)


if __name__ == '__main__':
    unittest.main()
