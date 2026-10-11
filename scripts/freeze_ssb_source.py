"""Bind an externally reviewed inventory to immutable source bytes.

The fixed invented response bodies are included separately from source identity.
This first launch composition deliberately has no live-source entry point.
"""
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import stat
from zipfile import ZIP_STORED, ZipFile, ZipInfo

from scripts.ssb_execution_inventory import verify
from workers.ssb_frozen_source import FrozenSSBSource, seal_source

FIXTURES = {'metadata': 'ssb_14059_metadata_minimal_2024_2025.json',
            'data': 'ssb_14059_jsonstat_minimal_2024_2025.json'}


def freeze_fixture_source(snapshot, expected_fingerprint, fixture_bodies):
    """No candidate code runs and no source permission is inferred."""
    if type(fixture_bodies) is not dict or set(fixture_bodies) != set(FIXTURES) \
            or any(type(body) is not bytes or not 1 <= len(body) <= 65536 for body in fixture_bodies.values()):
        raise ValueError('Fixed invented response bodies refused')
    extras = {'fixtures/'+name: fixture_bodies[kind] for kind, name in FIXTURES.items()}
    return _freeze_reviewed_source(snapshot, expected_fingerprint, verify, extras)


def _freeze_reviewed_source(snapshot, expected_fingerprint, fixed_verifier, extras):
    # Trusted fixed-purpose wrappers only; no CLI chooses a verifier or source
    # entry. Source identity is independently supplied, never an authority.
    snapshot = Path(snapshot)
    checked = fixed_verifier(snapshot, expected_fingerprint)
    raw_manifest = (snapshot/'MANIFEST.json').read_bytes()
    manifest = json.loads(raw_manifest)
    if sha256(raw_manifest).hexdigest() != expected_fingerprint:
        raise ValueError('Frozen SSB inventory changed')
    payload = {'MANIFEST.json': raw_manifest}
    for name, expected in manifest['files'].items():
        descriptor = os.open(snapshot/name, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() \
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 262144:
                raise ValueError('Frozen SSB source file refused')
            body = stream.read(262145)
        if len(body) != info.st_size or sha256(body).hexdigest() != expected:
            raise ValueError('Frozen SSB source bytes changed')
        payload[name] = body
    # The archived fixture bytes are data, never imported as modules.
    payload.update(extras)
    archive = BytesIO()
    with ZipFile(archive, 'w', compression=ZIP_STORED) as zipped:
        for name, body in sorted(payload.items()):
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            zipped.writestr(info, body)
    fixed_verifier(snapshot, expected_fingerprint)
    descriptor, archive_hash = seal_source(archive.getvalue())
    return FrozenSSBSource(descriptor, archive_hash, expected_fingerprint, checked['files'])
