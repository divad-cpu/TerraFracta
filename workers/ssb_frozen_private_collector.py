"""Unconnected credential-free private collector with a fixed sealed closure.

There is no CLI, source grant, native writer or live-folder selection. A future
trusted custodian must provide separately confirmed admission and a constrained
channel before this can collect. Parsing context is not authenticating it.
"""
import base64
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
import os
import socket
import sys
from zipfile import ZipFile

from workers.closed_pair_channel import PairChannelClient
from workers.closed_ssb_worker import MAX_CONTEXT_BYTES, parse_closed_ssb_context, process_closed_ssb_context
from workers.linux_parent_lifetime import arm_parent_lifetime
from workers.ssb_14059_pair_transport import _serve_child
from workers.ssb_14059_transport import fetch_ssb_14059_once
from workers.ssb_frozen_source import BOOTSTRAP as SOURCE_BOOTSTRAP, FrozenSSBSource, child_command
from workers.ssb_sealed_transport import SealedSSBTransportBroker
from workers.update_run_completion import canonical_run_manifest

ROOTS=['workers.ssb_frozen_private_collector']
CONTRACT_SHA256='d863b0b4989f2fb4cce0caafce9f105d1732008bd115bb2c0a6cec80d9fef007'


def _fixed_replace(source,old,new):
    if source.count(old)!=1:
        raise ValueError('Private collector bootstrap template changed')
    return source.replace(old,new)


# Fixed literals reuse the independent source/interpreter bootstrap. No caller
# selects a purpose, import, expression or executable. Template drift refuses
# module construction; the compiled child still validates before importing it.
BOOTSTRAP=_fixed_replace(SOURCE_BOOTSTRAP,
    "set(files) | {'MANIFEST.json', 'fixtures/ssb_14059_metadata_minimal_2024_2025.json', 'fixtures/ssb_14059_jsonstat_minimal_2024_2025.json'}",
    "set(files) | {'MANIFEST.json'}")
BOOTSTRAP=_fixed_replace(BOOTSTRAP,"        files = payload['files']\n",
    "        files = payload['files']\n        if payload['roots'] != ['workers.ssb_frozen_private_collector'] or hashlib.sha256(json.dumps(payload['contract'],sort_keys=True,separators=(',',':')).encode()).hexdigest() != '"+CONTRACT_SHA256+"':\n            raise ValueError\n")
BOOTSTRAP=_fixed_replace(BOOTSTRAP,'from workers.ssb_frozen_runtime import frozen_main',
    'from workers.ssb_frozen_private_collector import private_collector_main as frozen_main')
BOOTSTRAP=_fixed_replace(BOOTSTRAP,'Frozen private SSB worker refused the operation.',
    'Frozen private collector candidate refused the operation.')


def check_private_collector_source(source):
    if type(source) is not FrozenSSBSource:
        raise ValueError('Private collector source refused')
    with ZipFile(BytesIO(source.check())) as archive:
        raw=archive.read('MANIFEST.json');payload=json.loads(raw);names=archive.namelist()
        contract_hash=sha256(json.dumps(payload['contract'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
        if sha256(raw).hexdigest()!=source.source_fingerprint or payload['roots']!=ROOTS \
                or contract_hash!=CONTRACT_SHA256 or len(names)!=len(set(names)) \
                or set(names)!=set(payload['files'])|{'MANIFEST.json'}:
            raise ValueError('Private collector source purpose changed')
    return payload


def private_collector_child_command(kind,source,*,channel=-1,context_sha256,parent_pid):
    check_private_collector_source(source)
    command=child_command(kind,source,channel=channel,context_sha256=context_sha256,parent_pid=parent_pid)
    command[5]=BOOTSTRAP
    return command


class PrivateCollectorTransportBroker(SealedSSBTransportBroker):
    def __init__(self,source,context_sha256):
        check_private_collector_source(source)
        super().__init__(source)
        self.context_sha256=context_sha256

    def _command(self,kind):
        return private_collector_child_command(kind,self.source,context_sha256=self.context_sha256,parent_pid=os.getpid())


def private_collector_main(kind,descriptor,archive_sha256,source_fingerprint,channel,context_sha256,parent_pid):
    arm_parent_lifetime(parent_pid)
    source=FrozenSSBSource(descriptor,archive_sha256,source_fingerprint,0)
    check_private_collector_source(source)
    if kind in ('metadata','data'):
        return _serve_child(['--single-response-child',kind],fetch_ssb_14059_once)
    if kind!='worker':raise ValueError('Private collector kind refused')
    raw=sys.stdin.buffer.read(MAX_CONTEXT_BYTES+1)
    if sha256(raw).hexdigest()!=context_sha256:
        raise ValueError('Private collector context changed')
    context=parse_closed_ssb_context(raw,now=datetime.now(timezone.utc));request=context.metadata.invocation
    if request.code_version!='ssb-sha256:'+source_fingerprint or request.trigger!='manual' \
            or request.scheduled_due_at is not None or request.limits.max_retries!=0 \
            or request.limits.max_model_calls!=0 or request.limits.max_items!=3 \
            or request.limits.max_response_bytes!=131074 or context.metadata.work.attempt!=1:
        raise ValueError('Private collector admission differs')
    with socket.socket(fileno=channel) as connection:
        if connection.family!=socket.AF_UNIX or connection.type!=socket.SOCK_SEQPACKET:
            raise ValueError('Private collector channel refused')
        client=PairChannelClient(connection);broker=PrivateCollectorTransportBroker(source,context_sha256)
        result=process_closed_ssb_context(raw,client,broker);pending=result.pending
        if broker.response_kinds!=['metadata','data']:
            raise ValueError('Private collector response sequence differs')
        value={'schemaVersion':1,'evidenceKind':'private_collector_pending_worker_result',
            'canonicalManifest':canonical_run_manifest(pending.context.manifest),
            'metadataRetrievedAt':pending.context.metadata_retrieved_at.isoformat(),
            'dataRetrievedAt':pending.context.data_retrieved_at.isoformat(),
            'checkpoint':base64.b64encode(result.checkpoint).decode('ascii'),
            'closeout':base64.b64encode(result.closeout).decode('ascii'),'operations':client.next_id-1,
            'completedResponseChildren':2,'responseKinds':broker.response_kinds,
            'databaseClientPresent':False,'sourcePermissionIssued':False,
            'publicQualificationIssued':False,'publicationEnabled':False,
            'launchReceipt':{'schemaVersion':1,'sourceFingerprint':source_fingerprint,
                'archiveSha256':archive_sha256,'contextSha256':context_sha256,
                'sealedSource':True,'sealedTransportChildren':2,'repositoryCodeReopened':False}}
    print(json.dumps(value,separators=(',',':')))
    return 0
