"""Shared invented source/admission setup; no native or live-source access."""
from dataclasses import asdict, replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path

from scripts.ssb_execution_inventory import inventory
from scripts.freeze_ssb_source import freeze_fixture_source
from tests import test_reserved_ssb_capture as response_support
from tests import test_ssb_pair_processing as pair_support

ROOT = Path(__file__).resolve().parents[1]


def snapshot_at(root):
    root.mkdir(mode=0o700)
    raw = inventory(ROOT)
    for name in json.loads(raw)['files']:
        p = root/name
        p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        p.write_bytes((ROOT/name).read_bytes())
        p.chmod(0o600)
    (root/'MANIFEST.json').write_bytes(raw)
    (root/'MANIFEST.json').chmod(0o600)
    return sha256(raw).hexdigest()


def invented_bodies():
    return {kind: json.dumps(json.loads((ROOT/'fixtures'/name).read_text()), separators=(',', ':')).encode()
            for kind, name in (('metadata', 'ssb_14059_metadata_minimal_2024_2025.json'),
                               ('data', 'ssb_14059_jsonstat_minimal_2024_2025.json'))}


def frozen_at(root):
    fingerprint = snapshot_at(root)
    return freeze_fixture_source(root, fingerprint, invented_bodies())


def admitted_context(source_fingerprint, *, now=None):
    now = datetime.now(timezone.utc) if now is None else now
    first, second = response_support.contexts()
    request = replace(first.invocation, code_version='ssb-sha256:'+source_fingerprint,
        limits=replace(first.invocation.limits, max_items=3, max_retries=0, max_response_bytes=131074))
    work = replace(first.work, attempt=1, observed_at=now, lease_expires_at=now+timedelta(seconds=30),
        deadline_at=now+timedelta(seconds=request.limits.max_duration_seconds))
    metadata, data = (replace(item, invocation=request, work=work) for item in (first, second))
    versions = {'metadata': pair_support.META, 'data': pair_support.DATA}
    fields = {'request': asdict(request), 'work': asdict(work),
        'responses': {kind: {'registration_id': item.registration_id, 'request_key': item.request_key}
                      for kind, item in (('metadata', metadata), ('data', data))},
        'versions': versions, 'pairId': pair_support.PAIR, 'principal': response_support.PRINCIPAL}
    raw = json.dumps(fields, default=str, separators=(',', ':')).encode()
    expected = {'metadata': metadata, 'data': data, 'versions': versions,
                'pair_id': pair_support.PAIR, 'principal': response_support.PRINCIPAL}
    return raw, expected
