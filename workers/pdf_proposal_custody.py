"""Historical detached PDF preparation, not a store or current qualification.

Keep all four exact parts and a separately retained prewrite intent. Every
opening still requires full independently supplied PDF result expectations and
its original receipt/intent; hashes alone cannot recreate those assertions.
Only two regenerated observation fields may change during fresh reobservation.
No SQL, durable association, backend, source request, authorization or capture.
"""
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256

from workers.closed_pair_channel import _json as strict_json
from workers.detached_proposal_custody import DetachedProposalParts, part_bytes
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.feed_postgres_contract import MAX_CAPTURE_OUTPUT, _uuid
from workers.pdf_extraction_held_proposal import prepare_pdf_extraction_held_proposal
from workers.pdf_extraction_request import _request_snapshot
from workers.pdf_passage_binding import _utc_copy, _stamp
from workers.pdf_result_custody import MAX_CUSTODY_INTENT_BYTES
from workers.pdf_result_packet import PdfResultPacketExpected, _RECORDS
from workers.private_extraction_held_proposal import MAX_CONTEXT_BYTES, _json, _instant, _date
from workers.prose_passage_selection import _digest

MAX_INTENT_BYTES = 4096
KIND = 'invented_detached_pdf_proposal_preparation'
INTENT_FIELDS = frozenset(('schema_version', 'kind', 'operation_id',
    'extraction_operation_id', 'extraction_artifact_id', 'extraction_request_sha256',
    'extraction_output_sha256', 'payload_sha256', 'selection_sha256',
    'provenance_sha256', 'context_raw_sha256', 'prepared_at'))
PART_HASHES = ('payload_sha256', 'selection_sha256', 'provenance_sha256', 'context_raw_sha256')
ARTIFACT_KEYS = frozenset(('operation_id', 'artifact_id', 'request_sha256', 'output_sha256'))
OBSERVATION_FIELDS = frozenset(('prepared_at', 'artifact_observed_at'))
PREPARED_STATE = 'invented_pdf_preparation_only_not_stored_or_captured'


class PdfProposalCustodyError(ValueError):
    """All-or-nothing private refusal, never a source-quality judgment."""


@dataclass(frozen=True)
class PdfPreparationIntent:
    canonical_metadata: bytes = field(repr=False)


@dataclass(frozen=True)
class PreparedPdfProposal:
    intent: PdfPreparationIntent = field(repr=False)
    parts: DetachedProposalParts = field(repr=False)
    receipt: bytes = field(repr=False)
    extraction_expected: PdfResultPacketExpected = field(repr=False)
    intent_raw: bytes = field(repr=False)
    observed_at: datetime
    evidence_state: str = PREPARED_STATE


@dataclass(frozen=True)
class ReobservedPdfProposal:
    intent: PdfPreparationIntent = field(repr=False)
    parts: DetachedProposalParts = field(repr=False)
    prepared_at: datetime
    historical_artifact_observed_at: datetime
    stored_at: datetime
    observed_at: datetime
    evidence_state: str = 'invented_pdf_historical_preparation_not_current_qualification_or_capture'


_LOCAL_RECORDS = _RECORDS + (DetachedProposalParts, PdfPreparationIntent, PreparedPdfProposal)


def _raw_inputs(receipt, expected, intent_raw):
    if (type(receipt) is not bytes or not 1 <= len(receipt) <= MAX_CAPTURE_OUTPUT
            or type(expected) is not PdfResultPacketExpected
            or type(intent_raw) is not bytes or not 1 <= len(intent_raw) <= MAX_CUSTODY_INTENT_BYTES):
        raise ValueError


def _intent_metadata(intent):
    if (type(intent) is not PdfPreparationIntent or type(intent.canonical_metadata) is not bytes
            or not 1 <= len(intent.canonical_metadata) <= MAX_INTENT_BYTES):
        raise ValueError
    value = strict_json(intent.canonical_metadata)
    if (type(value) is not dict or set(value) != INTENT_FIELDS or _json(value) != intent.canonical_metadata
            or type(value['schema_version']) is not int or value['schema_version'] != 1 or value['kind'] != KIND
            or any(not _uuid(value[k]) for k in ('operation_id', 'extraction_operation_id', 'extraction_artifact_id'))
            or any(not _digest(value[k]) for k in ('extraction_request_sha256', 'extraction_output_sha256', *PART_HASHES))):
        raise ValueError
    _instant(value['prepared_at'])
    return value


def intent_metadata(intent):
    """Read one exact supplied intent; it never authenticates a prior write."""
    try:
        captured = thaw_input(freeze_input(intent, _LOCAL_RECORDS))
        return _intent_metadata(captured)
    except Exception:
        raise PdfProposalCustodyError('pdf_proposal_preparation_unavailable') from None


def _metadata(operation_id, parts):
    proof = strict_json(parts.provenance_raw); artifact = proof['artifact']
    if type(artifact) is not dict or set(artifact) != ARTIFACT_KEYS:
        raise ValueError
    values = part_bytes(parts)
    value = dict(schema_version=1, kind=KIND, operation_id=operation_id,
        **{'extraction_' + key: artifact[key] for key in ARTIFACT_KEYS},
        **{key: sha256(raw).hexdigest() for raw, key in zip(values, PART_HASHES)},
        prepared_at=proof['prepared_at'])
    intent = PdfPreparationIntent(_json(value))
    _intent_metadata(intent)
    return intent


def _match_parts(parts, intent):
    values = part_bytes(parts); metadata = _intent_metadata(intent)
    if any(sha256(raw).hexdigest() != metadata[key] for raw, key in zip(values, PART_HASHES)):
        raise ValueError
    for raw in values[:3]:
        if _json(strict_json(raw)) != raw:
            raise ValueError
    if _metadata(metadata['operation_id'], parts).canonical_metadata != intent.canonical_metadata:
        raise ValueError
    return metadata, strict_json(parts.provenance_raw)


def _identity(receipt, expected, intent_raw, proof):
    # Minimal cheap independent selectors before the actual cold producer. Its
    # existing full receipt/original/request parser remains the sole engine.
    request = _request_snapshot(expected.request)
    if (type(proof) is not dict or type(proof['schema_version']) is not int or proof['schema_version'] != 1
            or proof['kind'] != 'detached_pdf_extraction_proposal'
            or proof['scope'] != 'invented_supplied_pdf_custody_only'
            or proof['evidence_state'] != 'unverified_not_captured_no_durable_association'
            or proof['full_receipt_sha256'] != sha256(receipt).hexdigest()
            or proof['canonical_intent_sha256'] != sha256(intent_raw).hexdigest()
            or proof['artifact']['operation_id'] != expected.operation_id
            or proof['artifact']['request_sha256'] != request.request_sha256
            or proof['artifact']['output_sha256'] != expected.output_sha256
            or proof['current']['packet_sha256'] != expected.current.packet_sha256
            or (proof['previous'] is None) != (expected.previous is None)
            or expected.previous is not None and proof['previous']['packet_sha256'] != expected.previous.packet_sha256):
        raise ValueError


def _historical(receipt, expected, parts, intent, intent_raw, stored_at, observed_at):
    metadata, proof = _match_parts(parts, intent)
    _identity(receipt, expected, intent_raw, proof)
    prepared = _instant(metadata['prepared_at']); old_observed = _instant(proof['artifact_observed_at'])
    if (proof['prepared_at'] != metadata['prepared_at'] or old_observed != prepared
            or not _instant(proof['recorded_observed_at']) <= _instant(proof['artifact_prepared_at'])
                <= _instant(proof['artifact_stored_at']) <= old_observed <= stored_at <= observed_at
            or proof['supplied_context_sha256'] != sha256(parts.context_raw).hexdigest()):
        raise ValueError
    context = proof['independent_context']
    if (_instant(context['held']['decided_at']) > prepared or _instant(context['issue']['observed_at']) > prepared
            or _date(context['content']['last_evidence_review_on']) > prepared.date()):
        raise ValueError
    return metadata, proof, prepared, old_observed


def _prepare(receipt, expected, context_raw, intent_raw, operation_id, observed_at):
    _raw_inputs(receipt, expected, intent_raw)
    if (not _uuid(operation_id) or type(context_raw) is not bytes
            or not 1 <= len(context_raw) <= MAX_CONTEXT_BYTES):
        raise ValueError
    at = _utc_copy(observed_at)
    candidate = prepare_pdf_extraction_held_proposal(receipt, expected, context_raw,
        intent_raw=intent_raw, observed_at=at)
    parts = DetachedProposalParts(candidate.payload_raw, candidate.selection_raw,
        candidate.provenance_raw, candidate.context_raw)
    intent = _metadata(operation_id, parts)
    _historical(receipt, expected, parts, intent, intent_raw, at, at)
    return PreparedPdfProposal(intent, parts, receipt, expected, intent_raw, at)


def prepare_pdf_proposal_custody(receipt, extraction_expected, context_raw, *, intent_raw, operation_id, observed_at):
    """Create an exact prewrite intent; execute no store or capture operation."""
    try:
        _raw_inputs(receipt, extraction_expected, intent_raw)
        values = thaw_input(freeze_input((receipt, extraction_expected, context_raw, intent_raw,
            operation_id, observed_at), _LOCAL_RECORDS))
        return _prepare(*values)
    except Exception:
        raise PdfProposalCustodyError('pdf_proposal_preparation_unavailable') from None


def recheck_prepared_pdf_proposal(prepared):
    """Reproduce the exact supplied preparation time, not a fresh observation."""
    try:
        if type(prepared) is not PreparedPdfProposal:
            raise ValueError
        captured = thaw_input(freeze_input(prepared, _LOCAL_RECORDS))
        _raw_inputs(captured.receipt, captured.extraction_expected, captured.intent_raw)
        if type(captured.evidence_state) is not str or captured.evidence_state != PREPARED_STATE:
            raise ValueError
        metadata, _ = _match_parts(captured.parts, captured.intent)
        if _stamp(_utc_copy(captured.observed_at)) != metadata['prepared_at']:
            raise ValueError
        _historical(captured.receipt, captured.extraction_expected, captured.parts, captured.intent,
            captured.intent_raw, captured.observed_at, captured.observed_at)
        fresh = _prepare(captured.receipt, captured.extraction_expected, captured.parts.context_raw,
            captured.intent_raw, metadata['operation_id'], captured.observed_at)
        if (part_bytes(fresh.parts) != part_bytes(captured.parts)
                or fresh.intent.canonical_metadata != captured.intent.canonical_metadata):
            raise ValueError
        return fresh
    except Exception:
        raise PdfProposalCustodyError('pdf_proposal_preparation_unavailable') from None


def reobserve_pdf_proposal(receipt, extraction_expected, parts, intent, *, intent_raw, stored_at, observed_at):
    """Retain historical bytes while the complete originals/output reopen once.

    Matching supplied parts/intents are correspondence, not proof of a stored
    row, authenticated observer, past wall-clock occurrence or renewed rights.
    """
    try:
        _raw_inputs(receipt, extraction_expected, intent_raw)
        receipt, expected, parts, intent, intent_raw, stored_at, observed_at = thaw_input(freeze_input(
            (receipt, extraction_expected, parts, intent, intent_raw, stored_at, observed_at), _LOCAL_RECORDS))
        stored = _utc_copy(stored_at); at = _utc_copy(observed_at)
        _, historical, prepared, old_observed = _historical(receipt, expected, parts, intent, intent_raw, stored, at)
        candidate = prepare_pdf_extraction_held_proposal(receipt, expected, parts.context_raw,
            intent_raw=intent_raw, observed_at=at)
        current = strict_json(candidate.provenance_raw)
        if (candidate.payload_raw != parts.payload_raw or candidate.selection_raw != parts.selection_raw
                or candidate.context_raw != parts.context_raw or set(current) != set(historical)
                or current['artifact_observed_at'] != _stamp(at) or current['prepared_at'] != _stamp(at)):
            raise ValueError
        stable = lambda value: {key: item for key, item in value.items() if key not in OBSERVATION_FIELDS}
        # Canonical bytes preserve every JSON type: True must not equal1.
        if _json(stable(current)) != _json(stable(historical)):
            raise ValueError
        return ReobservedPdfProposal(intent, parts, prepared, old_observed, stored, at)
    except Exception:
        raise PdfProposalCustodyError('pdf_proposal_reobservation_unavailable') from None
