"""Strict, untrusted model-output boundary for future prose extraction.

Successful parsing produces a private unverified proposal, never a publication
decision. Source identity and locator must be supplied independently.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from re import fullmatch


MAX_OUTPUT_BYTES = 8 * 1024
CLAIM_TYPES = frozenset({
    "condition", "policy_action", "funding", "delivery",
    "attributed_finding", "evaluation",
})
FIELDS = frozenset({
    "schema_version", "source_version_id", "source_sha256", "locator",
    "proposed_claim_type", "proposed_assertion", "source_date_text",
    "language_code",
})


class ModelProposalError(ValueError):
    """The model output is not a bounded, source-bound proposal."""


@dataclass(frozen=True)
class AllowedEvidence:
    source_version_id: str
    source_sha256: str
    locators: tuple[str, ...]
    language_code: str


@dataclass(frozen=True)
class ModelProposal:
    source_version_id: str
    source_sha256: str
    locator: str
    proposed_claim_type: str
    proposed_assertion: str
    source_date_text: str | None
    language_code: str
    review_state: str = "unverified"


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ModelProposalError("Duplicate JSON key")
        result[key] = value
    return result


def _plain_bounded(value: object, *, minimum: int, maximum: int) -> bool:
    if not (
        isinstance(value, str)
        and minimum <= len(value.strip()) <= maximum
        and value == value.strip()
        and all(ord(character) >= 32 or character in "\n\t" for character in value)
    ):
        return False
    # JSON escapes can create unpaired surrogates after valid byte decoding.
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def parse_untrusted_model_proposal(raw: bytes, allowed: AllowedEvidence) -> ModelProposal:
    """Validate schema and exact source binding; support must be checked later."""

    if type(raw) is not bytes or not raw or len(raw) > MAX_OUTPUT_BYTES:
        raise ModelProposalError("Model output size is invalid")
    if (
        not isinstance(allowed, AllowedEvidence)
        or any(type(value) is not str for value in
               (allowed.source_version_id, allowed.source_sha256, allowed.language_code))
        or type(allowed.locators) is not tuple
        or any(type(locator) is not str for locator in allowed.locators)
    ):
        raise ModelProposalError("Trusted evidence configuration is invalid")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
    except ModelProposalError:
        raise
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise ModelProposalError("Model output is not UTF-8 JSON") from exc
    if not isinstance(value, dict) or set(value) != FIELDS:
        raise ModelProposalError("Model output fields are invalid")
    if type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise ModelProposalError("Model schema version is unsupported")
    if (
        value["source_version_id"] != allowed.source_version_id
        or value["source_sha256"] != allowed.source_sha256
        or value["language_code"] != allowed.language_code
    ):
        raise ModelProposalError("Model source binding does not match")
    if not fullmatch(r"[0-9a-f]{64}", allowed.source_sha256):
        raise ModelProposalError("Trusted source hash is invalid")
    locator = value["locator"]
    if not _plain_bounded(locator, minimum=1, maximum=200) or locator not in allowed.locators:
        raise ModelProposalError("Evidence locator was not supplied by the source parser")
    claim_type = value["proposed_claim_type"]
    if not isinstance(claim_type, str) or claim_type not in CLAIM_TYPES:
        raise ModelProposalError("Proposed claim type is unsupported")
    assertion = value["proposed_assertion"]
    if not _plain_bounded(assertion, minimum=10, maximum=600):
        raise ModelProposalError("Proposed assertion is invalid")
    date_text = value["source_date_text"]
    if date_text is not None and not _plain_bounded(date_text, minimum=1, maximum=80):
        raise ModelProposalError("Source date text is invalid")
    if not fullmatch(r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?", allowed.language_code):
        raise ModelProposalError("Trusted language code is invalid")
    return ModelProposal(
        source_version_id=allowed.source_version_id,
        source_sha256=allowed.source_sha256,
        locator=locator,
        proposed_claim_type=claim_type,
        proposed_assertion=assertion,
        source_date_text=date_text,
        language_code=allowed.language_code,
    )
