"""Fixed invented-response worker executed only from a verified sealed ZIP.

The initial composition has no live-source selector. It shares actual bounded
children, native admission/dispatch, closed operations and private custody with
the existing worker. No repository path is reopened by these children.
"""
import base64
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
import os
import socket
import sys
from time import monotonic
from zipfile import ZipFile

from workers.closed_pair_channel import PairChannelClient, _json, _packet
from workers.closed_ssb_worker import MAX_CONTEXT_BYTES, parse_closed_ssb_context, process_closed_ssb_context
from workers.linux_parent_lifetime import arm_parent_lifetime
from workers.ssb_14059_capture import CapturedResponse, DATA_URL, METADATA_URL
from workers.ssb_14059_pair_transport import _serve_child
from workers.ssb_frozen_source import FrozenSSBSource, check_sealed, child_command
from workers.ssb_sealed_transport import SealedSSBTransportBroker
from workers.update_run_completion import canonical_run_manifest

FIXTURE_FILES = {'metadata': 'fixtures/ssb_14059_metadata_minimal_2024_2025.json',
                 'data': 'fixtures/ssb_14059_jsonstat_minimal_2024_2025.json'}


def fixed_frozen_fixture(source, kind, *, deadline):
    if kind not in FIXTURE_FILES or monotonic() >= deadline:
        raise ValueError('Frozen invented response deadline ended')
    with ZipFile(BytesIO(source.check())) as archive:
        body = archive.read(FIXTURE_FILES[kind])
    if not 1 <= len(body) <= 65536 or monotonic() >= deadline:
        raise ValueError('Frozen invented response refused')
    endpoint = METADATA_URL if kind == 'metadata' else DATA_URL
    return CapturedResponse(endpoint, endpoint, 0, 200, 'application/json', body, datetime.now(timezone.utc))


class FrozenFixtureTransportBroker(SealedSSBTransportBroker):
    def __init__(self, source, context_sha256):
        super().__init__(source)
        self.context_sha256 = context_sha256
        self.fixture_reads = self.response_kinds

    def _command(self, kind):
        return child_command(kind, self.source, context_sha256=self.context_sha256, parent_pid=os.getpid())


def frozen_main(kind, descriptor, archive_sha256, source_fingerprint, channel, context_sha256, parent_pid):
    # All candidate modules have passed the independent bootstrap before this
    # import. Lifetime is armed before channel access or transport dispatch.
    arm_parent_lifetime(parent_pid)
    source = FrozenSSBSource(descriptor, archive_sha256, source_fingerprint, 0)
    check_sealed(descriptor, archive_sha256)
    if kind in ('metadata', 'data'):
        return _serve_child(['--single-response-child', kind],
            lambda selected, *, deadline: fixed_frozen_fixture(source, selected, deadline=deadline))
    if kind != 'worker':
        raise ValueError('Frozen worker kind refused')
    raw = sys.stdin.buffer.read(MAX_CONTEXT_BYTES + 1)
    if sha256(raw).hexdigest() != context_sha256:
        raise ValueError('Frozen worker context changed')
    context = parse_closed_ssb_context(raw, now=datetime.now(timezone.utc))
    request = context.metadata.invocation
    if request.code_version != 'ssb-sha256:'+source_fingerprint or request.trigger != 'manual' \
            or request.scheduled_due_at is not None or request.limits.max_retries != 0 \
            or request.limits.max_model_calls != 0 or request.limits.max_response_bytes != 131074 \
            or request.limits.max_items != 3 \
            or context.metadata.work.attempt != 1:
        raise ValueError('Frozen worker admission differs')
    with socket.socket(fileno=channel) as connection:
        if connection.family != socket.AF_UNIX or connection.type != socket.SOCK_SEQPACKET:
            raise ValueError('Frozen worker capability refused')
        client = PairChannelClient(connection)
        broker = FrozenFixtureTransportBroker(source, context_sha256)
        result = process_closed_ssb_context(raw, client, broker)
        # Fixed fictional acceptance probe, as in the earlier separate-worker
        # trial. This first entry point is not a live publication/collector CLI.
        attack = {'schemaVersion': 1, 'requestId': client.next_id, 'operation': 'read_closeout',
                  'arguments': {}, 'sql': 'SET CONSTRAINTS ALL IMMEDIATE', 'transaction': 'begin', 'role': 'postgres'}
        connection.send(json.dumps(attack, separators=(',', ':')).encode())
        refusal = _json(_packet(connection, 45056))
        if refusal != {'schemaVersion': 1, 'requestId': client.next_id, 'state': 'refused', 'reason': 'invalid_request'}:
            raise ValueError('Frozen worker control probe was not refused')
        pending = result.pending
        output = {'schemaVersion': 1, 'fixtureReads': broker.fixture_reads,
            'canonicalManifest': canonical_run_manifest(pending.context.manifest),
            'metadataRetrievedAt': pending.context.metadata_retrieved_at.isoformat(),
            'dataRetrievedAt': pending.context.data_retrieved_at.isoformat(),
            'checkpoint': base64.b64encode(result.checkpoint).decode('ascii'),
            'closeout': base64.b64encode(result.closeout).decode('ascii'),
            'operations': client.next_id - 1, 'credentialEnvironmentPresent': False,
            'actualSourceRequests': 0, 'databaseClientPresent': False, 'transactionControlProbeRefused': True,
            'launchReceipt': {'schemaVersion': 1, 'sourceFingerprint': source_fingerprint,
                'archiveSha256': archive_sha256, 'contextSha256': context_sha256,
                'sealedSource': True, 'sealedTransportChildren': 2, 'repositoryCodeReopened': False}}
    print(json.dumps(output, separators=(',', ':')))
    return 0
