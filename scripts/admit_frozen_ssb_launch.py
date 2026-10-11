"""One-shot launch binding to a trusted custodian's native admitted context.

The caller supplies independently confirmed response/work/version identities.
Parsing or a fingerprint alone is not native admission or source permission.
This composition supports only the fixed invented-response trial at present.
"""
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
import os
import socket
import subprocess
from zipfile import ZipFile

from scripts.ssb_execution_inventory import runtime_record, ROOTS, CONTRACT
from workers.closed_ssb_worker import parse_closed_ssb_context
from workers.ssb_frozen_source import FrozenSSBSource, child_command


class AdmittedFrozenFixtureLaunch:
    def __init__(self, source, raw_context, *, metadata, data, versions, pair_id, principal, now=None):
        if type(source) is not FrozenSSBSource or type(raw_context) is not bytes:
            raise ValueError('Frozen launch binding refused')
        context = parse_closed_ssb_context(raw_context, now=datetime.now(timezone.utc) if now is None else now)
        if context.metadata != metadata or context.data != data or type(versions) is not dict \
                or versions != {'metadata': context.metadata_version_id, 'data': context.data_version_id} \
                or context.pair_id != pair_id or context.principal != principal:
            raise ValueError('Frozen launch differs from custodian admission')
        request = context.metadata.invocation
        if request.code_version != 'ssb-sha256:'+source.source_fingerprint or request.trigger != 'manual' \
                or request.scheduled_due_at is not None or request.limits.max_retries != 0 \
                or request.limits.max_model_calls != 0 or request.limits.max_response_bytes != 131074 \
                or request.limits.max_items != 3 \
                or context.metadata.work.attempt != 1:
            raise ValueError('Frozen launch exceeds the single-attempt contract')
        self.source = source
        self.raw_context = raw_context
        self.context_sha256 = sha256(raw_context).hexdigest()
        self.context = context
        self._consumed = False
        self._verify_source()

    def _verify_source(self):
        with ZipFile(BytesIO(self.source.check())) as archive:
            manifest = archive.read('MANIFEST.json')
            names = archive.namelist()
        payload = json.loads(manifest)
        if sha256(manifest).hexdigest() != self.source.source_fingerprint \
                or payload['interpreter'] != runtime_record():
            raise ValueError('Frozen launch source/interpreter changed')
        if payload['roots'] != list(ROOTS) or payload['contract'] != CONTRACT \
                or len(names) != len(set(names)) \
                or set(names) != set(payload['files']) | {'MANIFEST.json',
                    'fixtures/ssb_14059_metadata_minimal_2024_2025.json',
                    'fixtures/ssb_14059_jsonstat_minimal_2024_2025.json'}:
            raise ValueError('Frozen launch source purpose changed')

    def receipt(self):
        return {'schemaVersion': 1, 'sourceFingerprint': self.source.source_fingerprint,
                'archiveSha256': self.source.archive_sha256, 'contextSha256': self.context_sha256,
                'sealedSource': True, 'sealedTransportChildren': 2, 'repositoryCodeReopened': False}

    def start(self, connection):
        # Consume before process creation. A slow/failed spawn or ambiguous
        # completion never reopens this launch capability. Native dispatch is
        # separately durable and continues to refuse refetch across processes.
        if self._consumed:
            raise ValueError('Frozen launch already consumed; no automatic retry')
        self._consumed = True
        if type(connection) is not socket.socket or connection.family != socket.AF_UNIX \
                or connection.type != socket.SOCK_SEQPACKET or connection.fileno() < 3:
            raise ValueError('Frozen launch capability refused')
        self._verify_source()
        parse_closed_ssb_context(self.raw_context, now=datetime.now(timezone.utc))
        command = self._command(connection)
        return subprocess.Popen(command, cwd='/', env={}, close_fds=True,
            pass_fds=(self.source.descriptor, connection.fileno()),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def _command(self,connection):
        return child_command('worker',self.source,channel=connection.fileno(),
            context_sha256=self.context_sha256,parent_pid=os.getpid())
