"""Read-only comparison of a fixed saved preparation with current named bytes.

No unlisted file discovery, candidate import, worker, native client, raw read,
configuration mutation, source request or collection authority occurs here.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
import sys
from scripts.export_private_parent_snapshot import PROOF, PIN, ROOT, build_snapshot
from scripts.ssb_execution_inventory import _json
from scripts.ssb_private_parent_inventory import _read, verify


def compare_named_files(manifest, root):
    """Read only the supplied, already verified preparation names."""
    counts = {'matchedFiles': 0, 'changedFiles': 0, 'unavailableFiles': 0}
    for name, expected in sorted(manifest['files'].items()):
        try:
            raw = _read(root/name)
        except (OSError, ValueError):
            counts['unavailableFiles'] += 1
        else:
            counts['matchedFiles' if sha256(raw).hexdigest() == expected else 'changedFiles'] += 1
    return counts


def observe():
    source = PROOF/'source'
    record = _json(_read(PROOF/'PREPARATION_RESULT.json', limit=8192, private=True))
    checked = verify(source, PIN)
    now = datetime.now(timezone.utc)
    preparation = build_snapshot(record, checked, expected_snapshot=source, expected_pin=PIN, now=now)
    manifest_raw = _read(source/'MANIFEST.json', limit=32768, private=True)
    if sha256(manifest_raw).hexdigest() != PIN:
        raise ValueError('Saved preparation identity changed')
    manifest = _json(manifest_raw)
    counts = compare_named_files(manifest, ROOT)
    comparison = 'unavailable' if counts['unavailableFiles'] else 'changed' if counts['changedFiles'] else 'matched'
    return {'state': 'observed', 'observation': {
        'schemaVersion': 1, 'evidenceKind': 'current_named_parent_source_comparison',
        'recordedAt': datetime.now(timezone.utc).isoformat(), 'preparedAt': preparation['recordedAt'],
        'pointInTimeOnly': True, 'preparedFilesOnly': True, 'preparedFiles': preparation['sourceFiles'],
        'comparison': comparison, **counts, 'deploymentReviewComplete': False,
        'collectionPermissionIssued': False, 'candidateModulesImported': False,
        'workerExecuted': False, 'configurationChanged': False, 'sourceRequests': 0,
        'publicationEnabled': False, 'scheduleEnabled': False}}


def main():
    if sys.argv[1:]:
        raise ValueError('Fixed saved-source comparison accepts no arguments')
    try:
        result = observe()
    except (OSError, ValueError, TypeError, KeyError):
        result = {'state': 'held', 'reason': 'parent_source_comparison_unavailable'}
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__': raise SystemExit(main())
