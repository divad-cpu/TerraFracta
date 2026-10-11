"""Shared private SSB pair-to-processing composition with exact readback.

No connection, broker, approval, raw store, credential or source registration is
supplied here. The trusted caller provides both exact admitted contexts and a
constrained backend. Only a pending shadow pair can be acknowledged; this module
never publishes, declares usable source data or claims website visibility.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
from typing import Protocol

from workers.reserved_ssb_capture import capture_reserved_ssb_pair, ReservedSSBResponse
from workers.source_response_receipts import ResponseRequest
from workers.ssb_14059_context_manifest import build_ssb_context_manifest, SSBContextManifest
from workers.update_run_completion import canonical_run_manifest, reconcile_run_completion, _uuid
from workers.update_run_closeout import parse_run_closeout, RunCloseout

MAX_PAIR_CHECKPOINT_BYTES=32768
CHECKPOINT_FIELDS=frozenset({'schemaVersion','runId','workClaimId','canonicalManifest','manifestSha256',
    'pairId','validationState','metadataVersionId','dataVersionId'})


def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('Paired checkpoint is invalid')
        result[key]=value
    return result


def require_pending_pair_checkpoint(data:bytes,context:SSBContextManifest,
                                   expected_pair_id:str,work_claim_id:str)->None:
    """A database receipt cannot substitute a pair, fence, plan or eligibility."""
    if not isinstance(context,SSBContextManifest) or not _uuid(expected_pair_id) or not _uuid(work_claim_id) \
       or context.manifest.mode!='shadow' or type(data) is not bytes or not 2<=len(data)<=MAX_PAIR_CHECKPOINT_BYTES:
        raise ValueError('Paired checkpoint is invalid')
    canonical=canonical_run_manifest(context.manifest)
    sources={s.source_key:s for s in context.manifest.sources}
    if set(sources)!={'ssb-14059-metadata','ssb-14059-data'}:
        raise ValueError('Paired checkpoint context is invalid')
    try:
        p=json.loads(data.decode('utf-8'),object_pairs_hook=_unique)
        if type(p) is not dict or frozenset(p)!=CHECKPOINT_FIELDS or type(p['schemaVersion']) is not int or p['schemaVersion']!=1 \
           or p['runId']!=context.manifest.run_id or p['workClaimId']!=work_claim_id \
           or p['pairId']!=expected_pair_id or p['validationState']!='pending' \
           or p['canonicalManifest']!=canonical or p['manifestSha256']!=sha256(canonical.encode('ascii')).hexdigest() \
           or p['metadataVersionId']!=sources['ssb-14059-metadata'].source_version_id \
           or p['dataVersionId']!=sources['ssb-14059-data'].source_version_id:
            raise ValueError
    except (ValueError,TypeError,UnicodeError,RecursionError) as error:
        raise ValueError('Paired checkpoint disagrees with both captured contexts') from error


class PendingPairBackend(Protocol):
    def store_pair(self,context:SSBContextManifest,metadata:ReservedSSBResponse,data:ReservedSSBResponse)->bytes:
        """Store atomically and return an independently reopened COMMIT receipt."""
        ...
    def close_pair(self,context:SSBContextManifest)->bytes:
        """Close processing and independently reopen its committed receipt."""
        ...


@dataclass(frozen=True)
class PendingPairResult:
    context:SSBContextManifest
    pair_id:str
    closeout:RunCloseout


def process_reserved_ssb_pair(metadata_request:ResponseRequest,data_request:ResponseRequest,
                              metadata_version_id:str,data_version_id:str,expected_pair_id:str,
                              backend_factory,fixed_fetcher,backend:PendingPairBackend,*,
                              utc_now=lambda:datetime.now(timezone.utc),monotonic=None)->PendingPairResult:
    if not isinstance(metadata_request,ResponseRequest) or not isinstance(data_request,ResponseRequest) \
       or not _uuid(expected_pair_id) or not _uuid(metadata_version_id) or not _uuid(data_version_id) \
       or metadata_version_id==data_version_id \
       or metadata_request.invocation.mode!='shadow' or data_request.invocation.mode!='shadow':
        raise ValueError('Pending pair requires a fixed shadow identity')
    options={'utc_now':utc_now}
    if monotonic is not None:options['monotonic']=monotonic
    metadata,data=capture_reserved_ssb_pair(metadata_request,data_request,backend_factory,fixed_fetcher,**options)
    context=build_ssb_context_manifest(metadata_request,data_request,metadata,data,metadata_version_id,data_version_id)
    checkpoint=backend.store_pair(context,metadata,data)
    require_pending_pair_checkpoint(checkpoint,context,expected_pair_id,str(metadata_request.work.lease_id))
    # Pending source eligibility is deliberately reflected as undecided work.
    expected=reconcile_run_completion(context.manifest,(),(),(),now=utc_now())
    closeout=parse_run_closeout(backend.close_pair(context),context.manifest,str(metadata_request.work.lease_id),expected,
        started_at=metadata_request.work.observed_at,now=utc_now())
    return PendingPairResult(context,expected_pair_id,closeout)
