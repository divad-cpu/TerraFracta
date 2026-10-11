"""Credential-free fixture worker; private capability supplied by inherited fd.

The child has no database client, password/role environment, owner callback or
SQL interface. Its broker opens two fixed invented repository fixtures only.
This is cooperative protocol separation, not an OS sandbox or real collection.
"""
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import socket
import sys
import time

from workers.closed_pair_channel import PairChannelClient, _json, _packet
from workers.closed_ssb_worker import MAX_CONTEXT_BYTES, process_closed_ssb_context
from workers.ssb_14059_capture import CapturedResponse, METADATA_URL, DATA_URL
from workers.update_run_completion import canonical_run_manifest

ROOT = Path(__file__).resolve().parents[1]
FILES = {'metadata': 'ssb_14059_metadata_minimal_2024_2025.json',
         'data': 'ssb_14059_jsonstat_minimal_2024_2025.json'}


def main(*, fixed_fetcher=None):
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        raise ValueError('Private worker requires one inherited descriptor')
    descriptor = int(sys.argv[1])
    if descriptor < 3:
        raise ValueError('Invalid private worker descriptor')
    # Only a fixed non-secret environment is supplied by the parent harness.
    if set(os.environ) - {'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'PYTHONDONTWRITEBYTECODE'}:
        raise ValueError('Unexpected private worker environment')
    raw = sys.stdin.buffer.read(MAX_CONTEXT_BYTES + 1)
    if not 2 <= len(raw) <= MAX_CONTEXT_BYTES:
        raise ValueError('Invalid private fixture context')
    fixture_reads = []
    with socket.socket(fileno=descriptor) as connection:
        client = PairChannelClient(connection)
        def broker(kind, *, deadline):
            if kind not in FILES or time.monotonic() >= deadline:
                raise ValueError('Private fixture deadline ended')
            fixture_reads.append(kind)
            body = json.dumps(json.loads((ROOT / 'fixtures' / FILES[kind]).read_text()), separators=(',', ':')).encode()
            endpoint = METADATA_URL if kind == 'metadata' else DATA_URL
            return CapturedResponse(endpoint, endpoint, 0, 200, 'application/json', body, datetime.now(timezone.utc))
        closed = process_closed_ssb_context(raw, client, broker if fixed_fetcher is None else fixed_fetcher)
        result = closed.pending
        if fixed_fetcher is not None:
            fixture_reads = fixed_fetcher.fixture_reads
        # The separate worker deliberately attempts the previously held SQL
        # timing control. Its unknown transaction/SQL fields must never reach
        # the native callback, even after a successful paired operation.
        attack = {'schemaVersion': 1, 'requestId': client.next_id, 'operation': 'read_closeout',
                  'arguments': {}, 'sql': 'SET CONSTRAINTS ALL IMMEDIATE', 'transaction': 'begin', 'role': 'postgres'}
        connection.send(json.dumps(attack, separators=(',', ':')).encode())
        refusal = _json(_packet(connection, 45056))
        if refusal != {'schemaVersion': 1, 'requestId': client.next_id, 'state': 'refused', 'reason': 'invalid_request'}:
            raise ValueError('Private worker SQL timing probe was not refused')
        output = {'schemaVersion': 1, 'fixtureReads': fixture_reads,
            'canonicalManifest': canonical_run_manifest(result.context.manifest),
            'metadataRetrievedAt': result.context.metadata_retrieved_at.isoformat(),
            'dataRetrievedAt': result.context.data_retrieved_at.isoformat(),
            'checkpoint': base64.b64encode(closed.checkpoint).decode('ascii'),
            'closeout': base64.b64encode(closed.closeout).decode('ascii'),
            'operations': client.next_id - 1, 'credentialEnvironmentPresent': False,
            'actualSourceRequests': 0, 'databaseClientPresent': False, 'transactionControlProbeRefused': True}
    print(json.dumps(output, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print('Private fixture worker refused the operation', file=sys.stderr)
        raise SystemExit(1)
