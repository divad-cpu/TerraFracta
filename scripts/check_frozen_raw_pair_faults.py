"""Three actual storage/acknowledgment faults through the sealed source launch.

Reuse the existing fault injection and network-none native fixture. Preserve
each failed database and orphan; never retry a write or normalize its history.
"""
from datetime import datetime, timezone
import json
import sys

from scripts.captured_fictional_pipeline import private_file
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_ssb_pair_capture import _run_trial
from scripts.run_frozen_raw_pair_trial import prepare_frozen_fixture_source
from scripts.run_raw_unknown_pair_trial import runtime_with_raw
from workers.ssb_14059_recovery import reconcile_private_ssb_14059_pairs


def main():
    if sys.argv[1:]:
        raise ValueError('Fixed frozen storage faults accept no arguments')
    results = []
    with fixed_trial_guard():
        source, source_proof = prepare_frozen_fixture_source()
        try:
            for fault in ('database_rejected_after_raw', 'raw_store_reply_lost', 'raw_binding_read_before_commit'):
                observed = {}
                def runner(requests, versions, pair_id, principal, client, proof, canonical, reads):
                    observed['proof'] = proof
                    return runtime_with_raw(requests, versions, pair_id, principal, client, proof, canonical, reads,
                        fault=fault, transport_children=True, frozen_source=source)
                try:
                    _run_trial('nominal', runtime_runner=runner, unknown_response_mode=True,
                        raw_custody_mode=True, code_fingerprint=source.source_fingerprint)
                except ValueError:
                    pass
                else:
                    raise ValueError('Expected frozen storage fault did not occur')
                proof = observed['proof']
                state = json.loads((proof/'AUTHENTICATED_PAIR_FAILURE_STATE.json').read_bytes())
                inventory = json.loads((proof/'RAW_TERMINAL_INVENTORY.json').read_bytes())
                committed = fault == 'raw_store_reply_lost'
                if state['pairs'] != int(committed) or state['rawArtifacts'] != int(committed) \
                        or state['versions'] != 2*int(committed) or state['publications'] != 0 \
                        or any(state[name] != 2 for name in ('reservations', 'dispatches', 'settlements')) \
                        or inventory['count'] != 1 or set(inventory['filesPresent']) != {'metadata.json', 'data.json', 'manifest.json'} \
                        or list(proof.glob('CHANNEL_*close_processing*')) or list(proof.glob('CHANNEL_*read_closeout*')):
                    raise ValueError('Frozen storage fault evidence differs')
                if not committed:
                    findings = reconcile_private_ssb_14059_pairs([], root=proof/'fixture-raw-store')
                    if len(findings) != 1 or findings[0].state != 'local_only_complete' \
                            or findings[0].issues != ('database_reference_missing',):
                        raise ValueError('Frozen storage orphan is not identifiable')
                result = {'scenario': fault, 'failureState': state, 'rawPairRetained': True,
                    'automaticRestage': False, 'processingCloseoutClaimed': False, 'actualSourceRequests': 0,
                    'sourceFingerprint': source.source_fingerprint, 'privateEvidenceDirectory': str(proof)}
                private_file(proof/'FROZEN_RAW_FAULT_RESULT.json', json.dumps(result, indent=2)+'\n')
                results.append(result)
            final = {'evidenceKind': 'actual_frozen_source_raw_custody_faults',
                'observedAt': datetime.now(timezone.utc).isoformat(), 'cases': results,
                'sourceEvidenceDirectory': str(source_proof), 'primaryChanged': False, 'actualSourceRequests': 0}
            private_file(source_proof/'FAULT_RESULTS.json', json.dumps(final, indent=2)+'\n')
        finally:
            source.close()
    print(json.dumps(final, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
