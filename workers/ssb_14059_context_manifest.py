"""Keep both SSB retrieval contexts in one private expected-work manifest.

The data context supplies numerical candidates; metadata remains a separately
charged required source context. This cannot qualify a source, mark a pair
usable, store raw bytes or approve any political meaning/publication.
"""
from dataclasses import dataclass
from datetime import datetime,timezone
from hashlib import sha256

from workers.source_response_receipts import (ResponseRequest,ResponseReservation,ResponseDispatch,
    ResponseSettlement,validate_response_request)
from workers.reserved_ssb_capture import ReservedSSBResponse
from workers.reserved_response_capture import ReservedCapture
from workers.ssb_14059_capture import (DATA_URL,METADATA_URL,parse_captured_ssb_14059,
    parse_captured_ssb_14059_metadata,require_matching_metadata,require_bounded_pair_chronology)
from workers.update_request_identity import identify_update_request
from workers.update_run_completion import RunManifest,PlannedSource,PlannedItem,canonical_run_manifest,_uuid
from workers.ssb_14059_batch import assemble_private_ssb_14059_batch

METADATA_KEY='ssb-14059-metadata'
DATA_KEY='ssb-14059-data'


@dataclass(frozen=True)
class SSBContextManifest:
    manifest: RunManifest
    logical_source_key: str
    metadata_registration_id: str
    data_registration_id: str
    metadata_retrieved_at: datetime
    data_retrieved_at: datetime
    metadata_charged_bytes: int
    data_charged_bytes: int
    attention_reasons: tuple[str, ...]

    @property
    def total_charged_bytes(self):
        return self.metadata_charged_bytes+self.data_charged_bytes


def build_ssb_context_manifest(metadata_request: ResponseRequest,data_request: ResponseRequest,
                               metadata: ReservedSSBResponse,data: ReservedSSBResponse,
                               metadata_version_id: str,data_version_id: str, *,
                               previous_accepted_data=None, previous_accepted_metadata=None) -> SSBContextManifest:
    if not isinstance(metadata_request,ResponseRequest) or not isinstance(data_request,ResponseRequest) or \
       metadata_request.invocation!=data_request.invocation or metadata_request.work!=data_request.work or \
       metadata_request.registration_id==data_request.registration_id or \
       metadata_request.request_key==data_request.request_key or \
       metadata_request.endpoint!=METADATA_URL or data_request.endpoint!=DATA_URL or \
       not _uuid(metadata_version_id) or not _uuid(data_version_id) or metadata_version_id==data_version_id:
        raise ValueError('SSB paired context identity is invalid')
    for kind,request,response in (('metadata',metadata_request,metadata),('data',data_request,data)):
        if not isinstance(response,ReservedSSBResponse) or response.request!=request or not isinstance(response.receipt,ReservedCapture):
            raise ValueError('SSB capture was relabelled to another request context')
        reservation,dispatch,settlement=response.receipt.reservation,response.receipt.dispatch,response.receipt.settlement
        if not isinstance(reservation,ResponseReservation) or not isinstance(dispatch,ResponseDispatch) or not isinstance(settlement,ResponseSettlement):
            raise ValueError('SSB capture lacks typed durable response checkpoints')
        times=(reservation.reserved_at,dispatch.dispatched_at,response.capture.retrieved_at,settlement.settled_at)
        if any(not isinstance(stamp,datetime) or stamp.tzinfo is None or stamp.utcoffset()!=timezone.utc.utcoffset(stamp) for stamp in times):
            raise ValueError('SSB response chronology is invalid')
        validate_response_request(request,settlement.settled_at)
        if not _uuid(reservation.reservation_id) or reservation.reservation_id!=dispatch.reservation_id or reservation.reservation_id!=settlement.reservation_id or \
           type(reservation.reserved_bytes) is not int or reservation.reserved_bytes!=request.max_body_bytes+1 or \
           reservation.status not in ('reserved','existing') or dispatch.status not in ('dispatched','existing') or settlement.status not in ('settled','existing') or \
           not reservation.reserved_at<=dispatch.dispatched_at<=response.capture.retrieved_at<=settlement.settled_at:
            raise ValueError('SSB response checkpoints do not form one captured request')
        if response.kind!=kind or \
           response.capture.requested_url!=request.endpoint or response.capture.final_url!=request.endpoint or \
           response.receipt.body!=response.capture.body or response.receipt.settlement.outcome!='measured' or \
           response.receipt.settlement.body_bytes!=len(response.capture.body) or \
           response.receipt.settlement.charged_bytes!=len(response.capture.body) or \
           response.receipt.settlement.content_sha256!=sha256(response.capture.body).hexdigest() or \
           response.capture.retrieved_at>response.receipt.settlement.settled_at or \
           len(response.capture.body)>request.max_body_bytes:
            raise ValueError('SSB pair is not bound to both measured captures')
    # Reparse the captured bytes rather than trusting replaceable parsed fields.
    meta=parse_captured_ssb_14059_metadata(metadata.capture)
    values=parse_captured_ssb_14059(data.capture)
    require_matching_metadata(values,meta);require_bounded_pair_chronology(values,meta)
    if meta!=metadata.parsed or values!=data.parsed:
        raise ValueError('SSB parsed response was substituted')
    invocation=metadata_request.invocation;identity=identify_update_request(invocation)
    batch=assemble_private_ssb_14059_batch(metadata_response=metadata.capture,data_response=data.capture,
        previous_accepted_data=previous_accepted_data,previous_accepted_metadata=previous_accepted_metadata)
    items=[PlannedItem(f'ssb-14059-year-{year}',DATA_KEY,data_version_id) for year in batch.reconciliation.changed_years]
    if batch.metadata_reconciliation.state!='unchanged':
        items.append(PlannedItem('ssb-14059-metadata-review',METADATA_KEY,metadata_version_id))
    if not batch.reconciliation.changed_years and batch.reconciliation.raw_version_changed:
        items.append(PlannedItem('ssb-14059-data-review',DATA_KEY,data_version_id))
    manifest=RunManifest(str(metadata_request.work.run_id),identity.request_fingerprint,invocation.mode,
        (PlannedSource(METADATA_KEY,metadata_request.registration_id,metadata_version_id,meta.raw_sha256),
         PlannedSource(DATA_KEY,data_request.registration_id,data_version_id,values.raw_sha256)),
        tuple(items))
    canonical_run_manifest(manifest)
    if invocation.limits.max_items<max(2,len(items)) or metadata.receipt.settlement.charged_bytes+data.receipt.settlement.charged_bytes>invocation.limits.max_response_bytes:
        raise ValueError('SSB pair exceeds its admitted manifest or response bounds')
    return SSBContextManifest(manifest,'ssb-14059',metadata_request.registration_id,data_request.registration_id,
        meta.retrieved_at,values.retrieved_at,metadata.receipt.settlement.charged_bytes,data.receipt.settlement.charged_bytes,
        batch.attention_reasons)
