"""No private data or invented live acceptance in the saved display record."""
from copy import deepcopy
from hashlib import sha256
import json
import unittest

from scripts.export_frozen_source_snapshot import build_snapshot, SCENARIOS


def proofs():
    source = 'a'*64
    request = json.dumps({'code_version': 'ssb-sha256:'+source}, separators=(',', ':'))
    fingerprint = sha256(request.encode()).hexdigest()
    record = {'evidenceKind': 'actual_closed_scram_ssb_format_fixture_pair', 'actualSourceRequests': 0,
        'modelCalls': 0, 'primaryChanged': False, 'publicWriterEnabled': False, 'runtimeUsesOwnerSql': False,
        'replayRefetched': False, 'generalSqlTimingAccepted': False, 'rawCustodyBound': True,
        'closedWorkerBoundaryVerified': True, 'validationState': 'pending', 'runState': 'partial', 'rawArtifacts': 1,
        'counts': {'pairs': 1, 'checks': 2, 'bindings': 1, 'versions': 2, 'manifests': 1},
        'observedAt': '2026-10-02T05:00:02+00:00'}
    native = {'schemaVersion': 1, 'codeVersion': 'ssb-sha256:'+source, 'runId': 'invented-run',
        'canonicalRequest': request, 'requestFingerprint': fingerprint}
    launch = {'schemaVersion': 1, 'sourceFingerprint': source, 'archiveSha256': 'b'*64,
        'contextSha256': 'c'*64, 'sealedSource': True, 'sealedTransportChildren': 2, 'repositoryCodeReopened': False}
    worker = {'launchReceipt': deepcopy(launch), 'actualSourceRequests': 0, 'credentialEnvironmentPresent': False,
        'databaseClientPresent': False, 'transactionControlProbeRefused': True,
        'metadataRetrievedAt': '2026-10-02T05:00:00+00:00', 'dataRetrievedAt': '2026-10-02T05:00:01+00:00',
        'canonicalManifest': json.dumps({'runId': 'invented-run', 'requestFingerprint': fingerprint, 'mode': 'shadow'})}
    raw = {'state': 'matched', 'exactHashesAndTimesMatch': True, 'coordinatedPrivateRoot': True,
        'liveRawRootTouched': False, 'sourceRequests': 0}
    cases = []
    for scenario in SCENARIOS:
        stored = int(scenario == 'raw_store_reply_lost')
        cases.append({'scenario': scenario, 'sourceFingerprint': source, 'rawPairRetained': True,
            'automaticRestage': False, 'processingCloseoutClaimed': False, 'actualSourceRequests': 0,
            'failureState': {'pairs': stored, 'rawArtifacts': stored, 'versions': 2*stored, 'publications': 0,
                'reservations': 2, 'dispatches': 2, 'settlements': 2, 'chargedBytes': 1924}})
    faults = {'evidenceKind': 'actual_frozen_source_raw_custody_faults', 'primaryChanged': False,
        'actualSourceRequests': 0, 'observedAt': '2026-10-02T05:00:03+00:00', 'cases': cases}
    return record, native, worker, launch, raw, faults


class FrozenSourceExportTests(unittest.TestCase):
    def test_only_bounded_saved_outcomes_are_returned(self):
        inputs = proofs()
        for index, value in enumerate(inputs):
            if index == 3:  # The closed launch receipt must reject all extras.
                continue
            value.update(privatePath='private-display-canary', rawBody='private-display-canary',
                         password='private-display-canary', sql='private-display-canary')
        result = build_snapshot(*inputs)
        self.assertNotIn('private-display-canary', json.dumps(result))
        self.assertEqual(result['pairsStored'], 1)
        self.assertEqual(result['collectionState'], 'pending')
        self.assertFalse(result['websiteVisibilityVerified'])
        self.assertEqual(len(result['faults']), 3)
        inputs = proofs()
        inputs[3]['privatePath'] = 'private-display-canary'
        with self.assertRaises(ValueError):
            build_snapshot(*inputs)

    def test_live_calls_publication_completion_or_counter_coercion_are_refused(self):
        for field, value in (('actualSourceRequests', True), ('actualSourceRequests', 1),
                             ('publicWriterEnabled', True), ('validationState', 'usable'),
                             ('runState', 'completed'), ('rawArtifacts', True)):
            inputs = proofs()
            inputs[0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                build_snapshot(*inputs)
        inputs = proofs()
        inputs[0]['counts']['pairs'] = True
        with self.assertRaises(ValueError):
            build_snapshot(*inputs)

    def test_native_request_cannot_be_relabelled_or_borrowed_from_another_run(self):
        for field, value in (('codeVersion', 'ssb-sha256:'+'d'*64), ('requestFingerprint', '0'*64),
                             ('runId', 'another-run'), ('schemaVersion', True)):
            inputs = proofs()
            inputs[1][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                build_snapshot(*inputs)

    def test_worker_seal_receipt_and_types_are_not_coerced(self):
        for field, value in (('sourceFingerprint', '0'*64), ('schemaVersion', True),
                             ('sealedSource', 1), ('sealedTransportChildren', 2.0)):
            inputs = proofs()
            inputs[2]['launchReceipt'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                build_snapshot(*inputs)

    def test_duplicate_fault_missing_charge_refetch_or_claimed_closeout_refuse(self):
        for change in ('duplicate', 'charge', 'refetch', 'closeout', 'pairs'):
            inputs = proofs()
            cases = inputs[5]['cases']
            if change == 'duplicate':
                cases[2] = deepcopy(cases[0])
            elif change == 'charge':
                cases[0]['failureState']['chargedBytes'] = 0
            elif change == 'refetch':
                cases[0]['automaticRestage'] = True
            elif change == 'closeout':
                cases[0]['processingCloseoutClaimed'] = True
            else:
                cases[0]['failureState']['pairs'] = False
            with self.subTest(change=change), self.assertRaises(ValueError):
                build_snapshot(*inputs)

    def test_missing_raw_match_and_late_capture_cannot_be_displayed_as_success(self):
        inputs = proofs()
        inputs[4]['state'] = 'local_only_complete'
        with self.assertRaises(ValueError):
            build_snapshot(*inputs)
        inputs = proofs()
        inputs[2]['dataRetrievedAt'] = '2026-10-02T05:00:04+00:00'
        with self.assertRaises(ValueError):
            build_snapshot(*inputs)


if __name__ == '__main__':
    unittest.main()
