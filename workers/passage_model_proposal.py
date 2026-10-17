"""Bind an untrusted model proposal to the exact changed-passage input.

The caller independently supplies the original selected-payload digest and
trusted parsed captures. No provider invocation or approval is established.
"""

from __future__ import annotations

import json
from re import fullmatch

from workers.model_proposal import (
    AllowedEvidence, ModelProposal, ModelProposalError, parse_untrusted_model_proposal,
)
from workers.prose_passage_selection import (
    PassageSnapshot, PassageSelectionError, select_changed_passages,
)


def parse_changed_passage_proposal(
    raw: bytes, *, current: PassageSnapshot, previous: PassageSnapshot | None,
    expected_payload_sha256: str,
) -> ModelProposal:
    """Unchanged/removed/unselected locators cannot acquire implied support."""
    if (type(expected_payload_sha256) is not str
            or not fullmatch(r"[0-9a-f]{64}", expected_payload_sha256)):
        raise ModelProposalError("Changed passage input binding is invalid")
    try:
        selected = select_changed_passages(current, previous)
    except PassageSelectionError as exc:
        raise ModelProposalError("Changed passage selection is unavailable") from exc
    if (selected.state != "ready" or selected.payload is None
            or selected.payload_sha256 != expected_payload_sha256):
        raise ModelProposalError("Changed passage input binding does not match")
    # These bytes were just produced by the strict selector, not supplied by
    # the model. The unchanged original parser still checks the output schema.
    payload = json.loads(selected.payload)
    locators = tuple(locator for group in payload["passages"] for locator in group["locators"])
    return parse_untrusted_model_proposal(raw, AllowedEvidence(
        source_version_id=current.source_version_id, source_sha256=current.content_sha256,
        locators=locators, language_code=current.language_code,
    ))
