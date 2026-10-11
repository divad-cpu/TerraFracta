"""Shared capture-to-processing driver with separately committed checkpoints.

A trusted, source-specific backend supplies fixed plans and constrained writes.
This module supplies no connection, network opener, credential or live policy.
The returned closeout describes processing; website visibility remains separate.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from fractions import Fraction
from hashlib import sha256
import json
from math import isfinite
import time
from typing import Callable, Protocol

from workers.reserved_response_capture import DurableResponseBackend, ReservedCapture, ReservedCaptureError, capture_reserved_response
from workers.source_response_receipts import ResponseRequest, ResponseReservation, ResponseDispatch, ResponseSettlement, validate_response_request, parse_response_reservation, parse_response_dispatch, parse_response_settlement
from workers.update_run_completion import (ActivationReceipt, DecisionReceipt, PlannedItem,
    PlannedSource, RunManifest, canonical_run_manifest, parse_canonical_run_manifest, reconcile_run_completion, _uuid)
from workers.update_run_closeout import RunCloseout, parse_run_closeout
from workers.update_request_identity import UpdateRequest, identify_update_request
from workers.update_run_work import WorkClaim, remaining_work_seconds
from workers.exact_timestamp import parse_exact_timestamp


@dataclass(frozen=True)
class CapturePlan:
    source_key: str
    response: ResponseRequest
    source_version_id: str
    expected_item_keys: tuple[str, ...]
    requires_sources: tuple[str, ...] = ()


@dataclass(frozen=True)
class FailedCapture:
    """A terminal, independently checked charge; never a body or refund."""
    reservation: ResponseReservation
    dispatch: ResponseDispatch
    settlement: ResponseSettlement


class _CaptureWitness:
    """Retain validated terminal receipts around the existing shared reader."""
    def __init__(self, backend, utc_now):
        self.backend=backend; self.utc_now=utc_now
        self.reservation=None; self.dispatch_receipt=None; self.settlement=None
    def reserve(self, expected):
        raw=self.backend.reserve(expected)
        self.reservation=parse_response_reservation(raw,expected,now=self.utc_now())
        return raw
    def dispatch(self, expected, reservation):
        raw=self.backend.dispatch(expected,reservation)
        self.dispatch_receipt=parse_response_dispatch(raw,expected,reservation,now=self.utc_now())
        return raw
    def settle(self, expected, reservation, *, outcome, body_bytes, content_sha256):
        raw=self.backend.settle(expected,reservation,outcome=outcome,body_bytes=body_bytes,content_sha256=content_sha256)
        self.settlement=parse_response_settlement(raw,expected,reservation,self.dispatch_receipt,
          outcome=outcome,body_bytes=body_bytes,content_sha256=content_sha256,now=self.utc_now())
        return raw
    def proven_failure(self):
        if self.reservation is None or self.dispatch_receipt is None or self.settlement is None or \
           self.settlement.charged_bytes!=self.reservation.reserved_bytes:
            raise ValueError('Capture failure has no confirmed terminal full charge; recovery is required')
        return FailedCapture(self.reservation,self.dispatch_receipt,self.settlement)


@dataclass(frozen=True)
class StoredProcessing:
    """Trusted backend readback, independently checked against the fixed plan."""
    decisions: tuple[DecisionReceipt, ...]
    activations: tuple[ActivationReceipt, ...]
    invalid_source_keys: tuple[str, ...] = ()


class PipelineBackend(Protocol):
    def response_backend(self, plan: CapturePlan) -> DurableResponseBackend: ...
    def opener(self, plan: CapturePlan): ...
    def store_capture(self, plan: CapturePlan, capture: ReservedCapture) -> bytes:
        """Commit source version and source check, then read that exact check."""
        ...
    def store_failed_capture(self, plan: CapturePlan, failure: FailedCapture) -> bytes:
        """Commit failed coverage with the exact checked terminal charge."""
        ...
    def store_deferred_capture(self, plan: CapturePlan) -> bytes:
        """Commit zero-byte dependency deferral, without a reservation/opener."""
        ...
    def extract_items(self, plan: CapturePlan, capture: ReservedCapture) -> tuple[PlannedItem, ...]: ...
    def store_manifest(self, manifest: RunManifest, work: WorkClaim) -> bytes: ...
    def process(self, manifest: RunManifest, work: WorkClaim) -> StoredProcessing:
        """Use current decision/activation guards and read committed receipts."""
        ...
    def close(self, manifest: RunManifest, work: WorkClaim) -> bytes: ...


class PipelineResumeRequired(ValueError):
    """A dispatched capture must be recovered from storage, never fetched again."""


@dataclass(frozen=True)
class CapturedManifestCheckpoint:
    """Checked stored plan; the original capture fence is not current authority."""
    manifest: RunManifest
    captured_work_claim_id: str
    raw: bytes


def _object(data: bytes, fields: set[str], maximum: int) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError('Checkpoint is invalid')
            result[key] = value
        return result
    if type(data) is not bytes or not 2 <= len(data) <= maximum:
        raise ValueError('Checkpoint is invalid')
    try:
        result = json.loads(data.decode('utf-8'), object_pairs_hook=unique)
        if type(result) is not dict or set(result) != fields:
            raise ValueError
        return result
    except (ValueError, TypeError, UnicodeError, RecursionError) as exc:
        raise ValueError('Checkpoint is invalid') from exc


def require_capture_checkpoint(data: bytes, plan: CapturePlan, capture: ReservedCapture,
                               *, now: datetime) -> None:
    """A measured body cannot be replaced by a backend's claimed counters."""
    fields = {'schemaVersion', 'runId', 'workClaimId', 'registrationId', 'sourceKey',
              'sourceVersionId', 'contentSha256', 'outcome', 'totalResponseBytes', 'checkedAt'}
    p = _object(data, fields, 4096)
    try:
        checked = parse_exact_timestamp(p['checkedAt'])
        if type(p['schemaVersion']) is not int or p['schemaVersion'] != 1 or \
           p['runId'] != str(plan.response.work.run_id) or \
           p['workClaimId'] != str(plan.response.work.lease_id) or \
           p['registrationId'] != plan.response.registration_id or p['sourceKey'] != plan.source_key or \
           p['sourceVersionId'] != plan.source_version_id or p['outcome'] != 'captured' or \
           p['contentSha256'] != sha256(capture.body).hexdigest() or \
           capture.settlement.outcome != 'measured' or capture.settlement.content_sha256 != p['contentSha256'] or \
           capture.settlement.body_bytes != len(capture.body) or \
           type(p['totalResponseBytes']) is not int or p['totalResponseBytes'] != capture.settlement.charged_bytes or \
           checked.tzinfo is None or checked.utcoffset() != timezone.utc.utcoffset(checked) or \
           not capture.settlement.settled_at <= checked <= now:
            raise ValueError
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        raise ValueError('Capture checkpoint disagrees with measured response') from exc


def require_unavailable_checkpoint(data: bytes, plan: CapturePlan, *, outcome: str,
                                   charged_bytes: int, earliest: datetime, now: datetime) -> None:
    fields={'schemaVersion','runId','workClaimId','registrationId','sourceKey',
            'sourceVersionId','contentSha256','outcome','totalResponseBytes','checkedAt'}
    p=_object(data,fields,4096)
    try:
        checked=parse_exact_timestamp(p['checkedAt'])
        if outcome not in {'failed','deferred'} or type(charged_bytes) is not int or charged_bytes<0 or \
           (outcome=='deferred' and charged_bytes!=0) or type(p['schemaVersion']) is not int or p['schemaVersion']!=1 or \
           p['runId']!=str(plan.response.work.run_id) or p['workClaimId']!=str(plan.response.work.lease_id) or \
           p['registrationId']!=plan.response.registration_id or p['sourceKey']!=plan.source_key or \
           p['sourceVersionId'] is not None or p['contentSha256'] is not None or p['outcome']!=outcome or \
           type(p['totalResponseBytes']) is not int or p['totalResponseBytes']!=charged_bytes or \
           checked.tzinfo is None or checked.utcoffset()!=timezone.utc.utcoffset(checked) or not earliest<=checked<=now:
            raise ValueError
    except (ValueError,TypeError,KeyError,OverflowError) as exc:
        raise ValueError('Unavailable source checkpoint disagrees with terminal coverage') from exc


def require_manifest_checkpoint(data: bytes, manifest: RunManifest, work: WorkClaim) -> None:
    _require_manifest_claim(data, manifest, str(work.lease_id))


def _require_manifest_claim(data: bytes, manifest: RunManifest, captured_work_claim_id: str) -> None:
    canonical = canonical_run_manifest(manifest)
    p = _object(data, {'schemaVersion', 'runId', 'workClaimId', 'canonicalManifest', 'manifestSha256'}, 45056)
    if type(p['schemaVersion']) is not int or p['schemaVersion'] != 1 or \
       p['runId'] != manifest.run_id or p['workClaimId'] != captured_work_claim_id or \
       p['canonicalManifest'] != canonical or p['manifestSha256'] != sha256(canonical.encode('ascii')).hexdigest():
        raise ValueError('Manifest checkpoint disagrees with fixed expected work')


def load_captured_manifest_checkpoint(data: bytes, invocation: UpdateRequest, work: WorkClaim,
                                     *, now: datetime) -> CapturedManifestCheckpoint:
    """Reload a durable plan without source fetch, counters or caller authentication.

    The trusted backend supplies its admitted request and independently checked
    current lease. A stored original fence may differ after takeover. This pure
    loader validates the closed canonical plan before the existing resume driver;
    it does not create/renew a lease, extend a deadline or authorize a connection.
    """
    try:
        p = _object(data, {'schemaVersion','runId','workClaimId','canonicalManifest','manifestSha256'}, 45056)
        if type(p['canonicalManifest']) is not str or not _uuid(p['workClaimId']):raise ValueError
        manifest = parse_canonical_run_manifest(p['canonicalManifest'].encode('ascii'))
        _require_manifest_claim(data, manifest, p['workClaimId'])
        identity = identify_update_request(invocation)
        if not isinstance(work, WorkClaim) or work.status not in {'claimed','existing_claim','renewed'} or \
           str(work.run_id) != manifest.run_id or not _uuid(str(work.lease_id)) or \
           identity.request_fingerprint != manifest.request_fingerprint or invocation.mode != manifest.mode or \
           work.observed_at is None or work.observed_at > now or remaining_work_seconds(work, now) < 1 or \
           len(manifest.items) > invocation.limits.max_items or len(manifest.sources) > invocation.limits.max_items:
            raise ValueError
        return CapturedManifestCheckpoint(manifest, p['workClaimId'], data)
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError,OverflowError) as error:
        raise ValueError('Captured manifest reload is invalid or expired') from error


def _bounded_work_check(work, started_at, utc_now, monotonic, failure):
    """Keep one original budget; invalid/backwards ticks cannot grant time."""
    def tick():
        value = monotonic()
        try:
            valid = type(value) in (int, float) and isfinite(value)
        except OverflowError:
            valid = False
        if not valid:
            raise ValueError(failure)
        return value
    previous = tick()
    duration = remaining_work_seconds(work, started_at)
    # Keep the existing refusal for clocks unable to represent a positive
    # interval; compare the admitted int/binary64 numbers without rounding
    # the original budget upward or resetting it at an intermediate tick.
    try:
        approximate_deadline=previous+duration
        valid_interval=isfinite(approximate_deadline) and approximate_deadline>previous
    except OverflowError:
        valid_interval=False
    if not valid_interval:
        raise ValueError(failure)
    deadline = Fraction(previous) + duration
    def check_time():
        nonlocal previous
        current = tick()
        if current < previous or Fraction(current) >= deadline or remaining_work_seconds(work, utc_now()) < 1:
            raise ValueError(failure)
        previous = current
    return check_time


def execute_captured_update(plans: tuple[CapturePlan, ...], backend: PipelineBackend, *,
                            utc_now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                            monotonic: Callable[[], float] = time.monotonic,
                            close_capture_failures: bool = False) -> RunCloseout:
    """Capture each due source exactly once, fix expected work, then close out.

    Failures propagate with committed checkpoints retained. A replay stops at
    dispatch before extraction, decisions or closeout; recovery needs the saved
    body and an independently checked recovery adapter. No retry is implicit.
    Plans are trusted onboarding inputs, never source or browser instructions.
    An explicit failure-close mode requires optional backend checkpoints: only
    a confirmed terminal full charge may become failed coverage. Unconfirmed
    settlement, cancellation or expiry still needs recovery, never a refund.
    A dependency is recorded as deferred without reading or reserving it.
    """
    if type(close_capture_failures) is not bool:
        raise ValueError('Capture failure mode is invalid')
    if type(plans) is not tuple or not plans or any(not isinstance(p, CapturePlan) for p in plans):
        raise ValueError('Capture plan is invalid')
    if any(not isinstance(p.response, ResponseRequest) for p in plans):
        raise ValueError('Capture response context is invalid')
    invocation: UpdateRequest = plans[0].response.invocation
    work = plans[0].response.work
    started_at = utc_now()
    check_time = _bounded_work_check(work, started_at, utc_now, monotonic,
        'Update pipeline exceeded its original work duration')
    identity = identify_update_request(invocation)
    source_keys, registration_ids, version_ids, item_keys = set(), set(), set(), set()
    # Validate every plan before the first durable write or opener.
    for plan in plans:
        validate_response_request(plan.response, started_at)
        if plan.response.invocation != invocation or plan.response.work != work or \
           not _uuid(plan.source_version_id) or type(plan.expected_item_keys) is not tuple or \
           any(type(k) is not str for k in plan.expected_item_keys):
            raise ValueError('Capture plan is invalid')
        canonical_run_manifest(RunManifest(str(work.run_id), identity.request_fingerprint, invocation.mode,
            (PlannedSource(plan.source_key, plan.response.registration_id, plan.source_version_id, 'a'*64),),
            tuple(PlannedItem(k, plan.source_key, plan.source_version_id) for k in plan.expected_item_keys)))
        if plan.source_key in source_keys or plan.response.registration_id in registration_ids or \
           plan.source_version_id in version_ids or \
           item_keys.intersection(plan.expected_item_keys):
            raise ValueError('Capture plans overlap')
        if type(plan.requires_sources) is not tuple or any(type(key) is not str for key in plan.requires_sources) or \
           len(set(plan.requires_sources))!=len(plan.requires_sources) or not set(plan.requires_sources).issubset(source_keys):
            raise ValueError('Capture dependencies must be distinct earlier planned sources')
        source_keys.add(plan.source_key); registration_ids.add(plan.response.registration_id)
        version_ids.add(plan.source_version_id)
        item_keys.update(plan.expected_item_keys)
    if len(plans) > invocation.limits.max_items or len(item_keys) > invocation.limits.max_items:
        raise ValueError('Capture plan exceeds admitted item bounds')

    sources, items = [], []
    covered=set()
    for plan in plans:
        check_time()
        if not set(plan.requires_sources).issubset(covered):
            if not close_capture_failures:
                raise ValueError('Capture dependency is unavailable; no dependent source was opened')
            receipt=backend.store_deferred_capture(plan)
            check_time()
            require_unavailable_checkpoint(receipt,plan,outcome='deferred',charged_bytes=0,
                                           earliest=started_at,now=utc_now())
            sources.append(PlannedSource(plan.source_key,plan.response.registration_id,None))
            continue
        response_backend=backend.response_backend(plan)
        check_time()
        witness=_CaptureWitness(response_backend,utc_now) if close_capture_failures else None
        try:
            source_opener = backend.opener(plan)
            check_time()
            capture = capture_reserved_response(plan.response, witness or response_backend, source_opener,
                                                utc_now=utc_now, monotonic=monotonic)
        except ReservedCaptureError:
            if not close_capture_failures:raise
            check_time()
            failure=witness.proven_failure()
            receipt=backend.store_failed_capture(plan,failure)
            check_time()
            require_unavailable_checkpoint(receipt,plan,outcome='failed',charged_bytes=failure.settlement.charged_bytes,
                                           earliest=failure.settlement.settled_at,now=utc_now())
            sources.append(PlannedSource(plan.source_key,plan.response.registration_id,None))
            continue
        if capture is None:
            raise PipelineResumeRequired('Dispatched capture requires stored recovery; no new fetch was made')
        check_time()
        receipt = backend.store_capture(plan, capture)
        check_time()
        require_capture_checkpoint(receipt, plan, capture, now=utc_now())
        check_time()
        extracted = backend.extract_items(plan, capture)
        check_time()
        if type(extracted) is not tuple or any(not isinstance(i, PlannedItem) for i in extracted) or \
           len(extracted) != len(plan.expected_item_keys) or \
           {i.item_key for i in extracted} != set(plan.expected_item_keys) or \
           any(i.source_key != plan.source_key or i.source_version_id != plan.source_version_id for i in extracted):
            raise ValueError('Extracted items disagree with fixed expected work')
        sources.append(PlannedSource(plan.source_key, plan.response.registration_id, plan.source_version_id,
                                     capture.settlement.content_sha256))
        items.extend(extracted)
        covered.add(plan.source_key)
    manifest = RunManifest(str(work.run_id), identity.request_fingerprint, invocation.mode, tuple(sources), tuple(items))
    check_time()
    receipt = backend.store_manifest(manifest, work)
    check_time()
    require_manifest_checkpoint(receipt, manifest, work)
    check_time()
    processing = backend.process(manifest, work)
    check_time()
    if not isinstance(processing, StoredProcessing):
        raise ValueError('Processing readback is invalid')
    expected = reconcile_run_completion(manifest, processing.decisions, processing.activations, (), now=utc_now(),
                                        invalid_source_keys=processing.invalid_source_keys)
    check_time()
    receipt = backend.close(manifest, work)
    check_time()
    closeout = parse_run_closeout(receipt, manifest, str(work.lease_id), expected, started_at=started_at, now=utc_now())
    check_time()
    return closeout


def _process_captured_manifest(manifest: RunManifest, invocation: UpdateRequest, work: WorkClaim,
                               stored_manifest_checkpoint: bytes, captured_work_claim_id: str,
                               backend: PipelineBackend, *,
                               utc_now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                               monotonic: Callable[[], float] = time.monotonic):
    """Check and process an independently loaded immutable work manifest.

    No response backend, opener, extraction or new manifest write is invoked.
    The stored capture fence can differ after a legitimate lease takeover;
    only the separately validated current work claim permits further writes.
    The backend must replay decisions/activation idempotently, recheck current
    source bindings and return committed records, including invalid sources.
    Neither this shape check nor a fencing UUID authenticates the caller.
    """
    now = utc_now()
    check_time = _bounded_work_check(work, now, utc_now, monotonic,
        'Processing recovery exceeded its original work duration')
    canonical_run_manifest(manifest)
    identity = identify_update_request(invocation)
    if not isinstance(work, WorkClaim) or work.status not in {'claimed','existing_claim','renewed'} or \
       str(work.run_id) != manifest.run_id or not _uuid(str(work.lease_id)) or \
       manifest.request_fingerprint != identity.request_fingerprint or manifest.mode != invocation.mode or \
       not _uuid(captured_work_claim_id) or work.observed_at is None or work.observed_at > now or \
       remaining_work_seconds(work, now) < 1 or len(manifest.items) > invocation.limits.max_items or \
       len(manifest.sources) > invocation.limits.max_items:
        raise ValueError('Processing recovery context is invalid or expired')
    _require_manifest_claim(stored_manifest_checkpoint, manifest, captured_work_claim_id)
    check_time()
    processing = backend.process(manifest, work)
    check_time()
    if not isinstance(processing, StoredProcessing):
        raise ValueError('Processing recovery readback is invalid')
    expected = reconcile_run_completion(manifest, processing.decisions, processing.activations, (), now=utc_now(),
                                        invalid_source_keys=processing.invalid_source_keys)
    return processing, expected, check_time


def process_captured_manifest(manifest: RunManifest, invocation: UpdateRequest, work: WorkClaim,
                             stored_manifest_checkpoint: bytes, captured_work_claim_id: str,
                             backend: PipelineBackend, *,
                             utc_now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                             monotonic: Callable[[], float] = time.monotonic) -> StoredProcessing:
    """Process checked captured work without closing the run.

    Reuse the completion driver's identity, checkpoint, deadline and receipt
    checks. An ambiguous backend write must raise PipelineResumeRequired before
    further processing. Pending metadata remains undecided; returning checked
    receipts does not finish work, qualify data or authorize a connection.
    No capture, opener, extraction, manifest write or backend.close is called.
    """
    processing, _, check_time = _process_captured_manifest(manifest, invocation, work,
        stored_manifest_checkpoint, captured_work_claim_id, backend, utc_now=utc_now, monotonic=monotonic)
    check_time()
    return processing


def resume_manifest_processing(manifest: RunManifest, invocation: UpdateRequest, work: WorkClaim,
                               stored_manifest_checkpoint: bytes, captured_work_claim_id: str,
                               backend: PipelineBackend, *,
                               utc_now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                               monotonic: Callable[[], float] = time.monotonic) -> RunCloseout:
    """Resume checked processing and acknowledge its independently stored closeout.

    Capture and lease authority remain unchanged. This completion entry retains
    its close behavior; callers with undecided private work use the processing
    entry and must not infer completion from its checked receipt readback.
    """
    _, expected, check_time = _process_captured_manifest(manifest, invocation, work,
        stored_manifest_checkpoint, captured_work_claim_id, backend, utc_now=utc_now, monotonic=monotonic)
    check_time()
    receipt = backend.close(manifest, work)
    check_time()
    # Recovery may acknowledge an older immutable closeout. Bind its finish
    # to the original admitted start rather than this recovery invocation.
    from datetime import timedelta
    started_at = work.deadline_at - timedelta(seconds=invocation.limits.max_duration_seconds)
    closeout = parse_run_closeout(receipt, manifest, str(work.lease_id), expected, started_at=started_at, now=utc_now())
    check_time()
    return closeout


def parse_processing_checkpoint(data: bytes, manifest: RunManifest, *, now: datetime) -> StoredProcessing:
    """Decode a bounded committed-processing readback without trusting counters.

    Backend authentication/COMMIT remain separate. Closed per-record fields and
    independent reconciliation reject foreign, duplicate or impossible records.
    """
    p=_object(data,{'decisions','activations','invalidSourceKeys'},65536)
    try:
        if any(type(p[key]) is not list or len(p[key])>50 for key in p):raise ValueError
        decisions=[];activations=[]
        for row in p['decisions']:
            if type(row) is not dict or set(row)!={'decisionId','itemKey','sourceVersionId','disposition'}:raise ValueError
            decisions.append(DecisionReceipt(row['decisionId'],row['itemKey'],row['sourceVersionId'],row['disposition']))
        for row in p['activations']:
            if type(row) is not dict or set(row)!={'publicationId','decisionId','publicationSha256','activatedAt'} or type(row['activatedAt']) is not str:raise ValueError
            activations.append(ActivationReceipt(row['publicationId'],row['decisionId'],row['publicationSha256'],parse_exact_timestamp(row['activatedAt'])))
        invalid=tuple(p['invalidSourceKeys'])
        if any(type(key) is not str for key in invalid) or len(set(invalid))!=len(invalid):raise ValueError
        result=StoredProcessing(tuple(decisions),tuple(activations),invalid)
        reconcile_run_completion(manifest,result.decisions,result.activations,(),now=now,invalid_source_keys=invalid)
        return result
    except (ValueError,TypeError,KeyError,OverflowError,AttributeError) as exc:
        raise ValueError('Committed processing checkpoint is invalid or outside its manifest') from exc
