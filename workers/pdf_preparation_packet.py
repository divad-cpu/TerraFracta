"""Portable four-part PDF preparation bytes, never a stored/capture receipt.

A separately retained prewrite intent and complete independent PDF result inputs
remain mandatory. The caller's checkpoint time is an assertion, not an observed
store. This frame adds no backend, path, actor, transport or publication power.
"""
import base64
from workers.closed_pair_channel import _json as strict_json, _binary
from workers.detached_proposal_custody import DetachedProposalParts, PART_LIMITS, part_bytes
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.pdf_proposal_custody import (
    PdfPreparationIntent, MAX_INTENT_BYTES, _LOCAL_RECORDS, _match_parts,
    recheck_prepared_pdf_proposal, reobserve_pdf_proposal,
)
from workers.private_extraction_held_proposal import _json

MAX_PACKET_BYTES = 192 * 1024
KIND = 'invented_portable_pdf_preparation'
PART_KEYS = ('payload_base64', 'selection_base64', 'provenance_base64', 'context_base64')
FIELDS = frozenset(('schema_version', 'kind', 'intent_base64', *PART_KEYS))


class PdfPreparationPacketError(ValueError):
    """Fixed private refusal; never a source or storage verdict."""


def prepare_pdf_preparation_packet(prepared):
    """Recheck one original preparation once, then encode all exact bytes."""
    try:
        checked = recheck_prepared_pdf_proposal(prepared)
        values = (checked.intent.canonical_metadata, *part_bytes(checked.parts))
        encoded = [base64.b64encode(raw).decode('ascii') for raw in values]
        raw = _json(dict(schema_version=1, kind=KIND, intent_base64=encoded[0],
            **dict(zip(PART_KEYS, encoded[1:]))))
        if not 1 <= len(raw) <= MAX_PACKET_BYTES:
            raise ValueError
        return raw
    except Exception:
        raise PdfPreparationPacketError('pdf_preparation_packet_unavailable') from None


def _parts(raw, intent):
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_PACKET_BYTES:
        raise ValueError
    value = strict_json(raw)
    if (type(value) is not dict or set(value) != FIELDS or _json(value) != raw
            or type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['kind'] != KIND):
        raise ValueError
    metadata = _binary(value['intent_base64'], MAX_INTENT_BYTES)
    if type(intent) is not PdfPreparationIntent or metadata != intent.canonical_metadata:
        raise ValueError
    parts = DetachedProposalParts(*(_binary(value[key], limit) for key, limit in zip(PART_KEYS, PART_LIMITS)))
    _match_parts(parts, intent)
    return parts


def reopen_pdf_preparation_packet(raw, intent, *, receipt, extraction_expected, intent_raw, stored_at, observed_at):
    """Decode exact supplied bytes, then cold-reobserve with external assertions.

    No time or independently expected result/intent is adopted from this frame.
    The existing producer alone opens the complete originals, once per original.
    """
    try:
        raw, intent, receipt, expected, result_intent, checkpoint, at = thaw_input(freeze_input(
            (raw, intent, receipt, extraction_expected, intent_raw, stored_at, observed_at), _LOCAL_RECORDS))
        parts = _parts(raw, intent)
        return reobserve_pdf_proposal(receipt, expected, parts, intent,
            intent_raw=result_intent, stored_at=checkpoint, observed_at=at)
    except Exception:
        raise PdfPreparationPacketError('pdf_preparation_packet_unavailable') from None
