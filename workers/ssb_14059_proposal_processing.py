"""Inactive fixed annual stage for the existing captured processing operation.

The trusted backend owns the strict TS reader/command/receipt validation and
actual current-work database fence. These projections check correspondence,
not authentication. Missing storage never proves a write was not dispatched:
only a supplied development context may identify never-dispatched preparation.
Stored-only recovery has no producer import, raw loader, source opener or retry.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from re import fullmatch
import time
from typing import Protocol

from workers.captured_update_pipeline import (
    PipelineResumeRequired, _bounded_work_check, parse_processing_checkpoint)
from workers.update_run_completion import canonical_run_manifest, _uuid
from workers.update_run_work import WorkClaim

ANNUAL_KEYS = ('ssb-14059-year-2024', 'ssb-14059-year-2025')
READ_KINDS = frozenset({'ok', 'capture_missing', 'changed', 'unavailable',
    'unconfigured', 'not_found', 'invalid_scope'})
INPUT_KEYS = frozenset({'metadata_response', 'data_response', 'raw_binding',
    'run_id', 'pair_id', 'pair', 'sources', 'decision', 'target', 'claim_id'})
RECEIPT_KEYS = frozenset({'schemaVersion', 'status', 'runId', 'decisionId',
    'issueId', 'captureId', 'basePublicationId', 'proposalSha256',
    'capturedAt', 'observedAt'})


@dataclass(frozen=True)
class AnnualScope:
    run_id: str
    item_key: str
    decision_id: str
    source_version_id: str
    issue_id: str


@dataclass(frozen=True)
class AnnualRead:
    scope: AnnualScope
    kind: str
    report: dict | None = None


@dataclass(frozen=True)
class UnpreparedAnnual:
    """Explicit development context; not an operational absence certificate."""
    scope: AnnualScope
    capture_id: str
    inputs: dict
    never_dispatched: bool


@dataclass(frozen=True)
class AnnualWrite:
    scope: AnnualScope
    request_fingerprint: str
    work_claim_id: str
    kind: str
    receipt: dict | None = None


class AnnualBackend(Protocol):
    def read_annual(self, scope: AnnualScope, work: WorkClaim) -> AnnualRead: ...
    def capture(self, scope, work, selection, payload) -> AnnualWrite: ...
    def recover(self, scope, work, report) -> AnnualWrite: ...
    def read_processing(self, manifest, work) -> bytes: ...


def _stamp(value):
    if type(value) is not str or fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z', value) is None:
        raise ValueError('Annual receipt time is invalid')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def _selection(scope, capture):
    if type(capture) is not dict or not _uuid(capture.get('captureId')) or \
            (capture.get('basePublicationId') is not None and not _uuid(capture['basePublicationId'])):
        raise ValueError('Annual capture identity is invalid')
    return {'runId': scope.run_id, 'decisionId': scope.decision_id,
        'issueId': scope.issue_id, 'captureId': capture['captureId'],
        'basePublicationId': capture['basePublicationId']}


def _stored_selection(read, scope, sources, now):
    # The entire report/canonical payload is validated by the existing reader
    # and recovery command. Check only this stage's independently fixed inputs.
    p = read.report
    try:
        if type(p) is not dict or p['requested'] != {'runId': scope.run_id, 'decisionId': scope.decision_id} or \
                p['decision']['decisionId'] != scope.decision_id or \
                p['decision']['sourceVersionId'] != scope.source_version_id or \
                p['decision']['sourceSha256'] != sources['ssb-14059-data'].content_sha256 or \
                p['target']['issueId'] != scope.issue_id or \
                p['target']['jurisdictionSlug'] != 'norway' or p['target']['issueSlug'] != 'housing-cost-burden' or \
                type(p['sourceReceipts']) is not list or len(p['sourceReceipts']) != 2 or \
                {(s['sourceVersionId'], s['contentSha256']) for s in p['sourceReceipts']} != \
                    {(s.source_version_id, s.content_sha256) for s in sources.values()} or \
                type(p['capture']['proposalSha256']) is not str or \
                fullmatch('[0-9a-f]{64}', p['capture']['proposalSha256']) is None or \
                _stamp(p['capture']['capturedAt']) > now:
            raise ValueError
        return _selection(scope, p['capture'])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError('Stored annual proposal disagrees with current scope') from exc


def _confirmed(result, scope, manifest, work, selection, now, stored=None):
    if type(result) is not AnnualWrite or result.scope != scope or \
            result.request_fingerprint != manifest.request_fingerprint or \
            result.work_claim_id != str(work.lease_id) or \
            result.kind not in {'confirmed', 'not_dispatched', 'outcome_unknown'}:
        raise ValueError('Annual write correspondence is invalid')
    if result.kind != 'confirmed':
        if result.receipt is not None:
            raise ValueError('Unconfirmed annual write contains a receipt')
        raise PipelineResumeRequired('Annual write is unconfirmed; inspect stored state before further work')
    p = result.receipt
    try:
        if type(p) is not dict or frozenset(p) != RECEIPT_KEYS or \
                type(p['schemaVersion']) is not int or p['schemaVersion'] != 1 or \
                p['status'] not in {'stored', 'replayed'} or \
                any(p[k] != v for k, v in selection.items()) or \
                type(p['proposalSha256']) is not str or fullmatch('[0-9a-f]{64}', p['proposalSha256']) is None or \
                not _stamp(p['capturedAt']) <= _stamp(p['observedAt']) <= now:
            raise ValueError
        if stored is not None and (p['status'] != 'replayed' or \
                any(p[k] != stored[k] for k in ('captureId', 'proposalSha256', 'capturedAt', 'basePublicationId'))):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError('Annual confirmed receipt disagrees with the command') from exc


class PrivateSSBProposalStage:
    def __init__(self, scopes, backend: AnnualBackend, *, load_unprepared=None,
            utc_now=lambda: datetime.now(timezone.utc), monotonic=time.monotonic):
        self.scopes = scopes
        self.backend = backend
        self.load_unprepared = load_unprepared
        self.utc_now = utc_now
        self.monotonic = monotonic

    def process(self, manifest, work):
        started_at = self.utc_now()
        check = _bounded_work_check(work, started_at, self.utc_now, self.monotonic,
            'Private SSB processing exceeded its original work duration')
        canonical_run_manifest(manifest)
        sources = {s.source_key: s for s in manifest.sources}
        items = {i.item_key: i for i in manifest.items}
        if type(work) is not WorkClaim or work.status not in {'claimed', 'existing_claim', 'renewed'} or \
                str(work.run_id) != manifest.run_id or not _uuid(str(work.lease_id)) or \
                work.observed_at is None or work.observed_at > started_at or manifest.mode != 'shadow' or \
                set(sources) != {'ssb-14059-data', 'ssb-14059-metadata'} or \
                set(items) != set(ANNUAL_KEYS) | {'ssb-14059-metadata-review'} or \
                any(items[k].source_key != ('ssb-14059-metadata' if k == 'ssb-14059-metadata-review' else 'ssb-14059-data') for k in items) or \
                type(self.scopes) is not tuple or len(self.scopes) != 2 or \
                any(type(s) is not AnnualScope for s in self.scopes) or \
                tuple(s.item_key for s in self.scopes) != ANNUAL_KEYS or \
                len({s.decision_id for s in self.scopes}) != 2 or len({s.issue_id for s in self.scopes}) != 1 or \
                any(s.run_id != manifest.run_id or s.source_version_id != items[s.item_key].source_version_id or \
                    not _uuid(s.decision_id) or not _uuid(s.issue_id) for s in self.scopes):
            raise ValueError('Private SSB processing scope is invalid')
        check()
        for scope in self.scopes:
            read = self.backend.read_annual(scope, work)
            check()
            if type(read) is not AnnualRead or read.scope != scope or read.kind not in READ_KINDS or \
                    (read.kind != 'ok' and read.report is not None):
                raise ValueError('Annual read correspondence is invalid')
            if read.kind == 'ok':
                selection = _stored_selection(read, scope, sources, self.utc_now())
                stored = dict(read.report['capture'])
                check()
                result = self.backend.recover(scope, work, read.report)
            elif read.kind == 'capture_missing' and self.load_unprepared is not None:
                context = self.load_unprepared(scope, work)
                check()
                if type(context) is not UnpreparedAnnual or context.scope != scope or \
                        context.never_dispatched is not True or not _uuid(context.capture_id) or \
                        type(context.inputs) is not dict or frozenset(context.inputs) != INPUT_KEYS:
                    raise ValueError('Never-dispatched development context is unavailable')
                inputs = context.inputs
                try:
                    if inputs['run_id'] != scope.run_id or inputs['decision'].decision_id != scope.decision_id or \
                            inputs['decision'].item_key != scope.item_key or inputs['decision'].source_version_id != scope.source_version_id or \
                            inputs['target'].issue_id != scope.issue_id or \
                            any(s.source_version_id != sources[s.source_key].source_version_id or \
                                s.content_sha256 != sources[s.source_key].content_sha256 for s in inputs['sources']):
                        raise ValueError
                except (AttributeError, KeyError, TypeError, ValueError) as exc:
                    raise ValueError('Preparation context disagrees with the fixed manifest') from exc
                # A cold stored-only invocation never loads producer/raw modules.
                from workers.ssb_14059_private_proposal import prepare_private_ssb_proposal
                payload = prepare_private_ssb_proposal(**inputs, now=self.utc_now())
                selection = _selection(scope, {'captureId': context.capture_id,
                    'basePublicationId': inputs['target'].publication_id})
                check()
                result = self.backend.capture(scope, work, selection, payload)
                stored = None
            else:
                raise PipelineResumeRequired('Annual proposal is missing or withheld; further processing is stopped')
            check()
            _confirmed(result, scope, manifest, work, selection, self.utc_now(), stored)
            check()
        raw = self.backend.read_processing(manifest, work)
        check()
        processing = parse_processing_checkpoint(raw, manifest, now=self.utc_now())
        expected = {(s.decision_id, s.item_key, s.source_version_id, 'held') for s in self.scopes}
        if processing.activations or processing.invalid_source_keys or len(processing.decisions) != 2 or \
                {(d.decision_id, d.item_key, d.source_version_id, d.disposition) for d in processing.decisions} != expected:
            raise ValueError('Private SSB processing must retain two held annuals and pending metadata')
        check()
        return processing

    def close(self, *_):
        raise ValueError('Pending SSB metadata must not invoke closeout')
