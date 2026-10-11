"""Compose one private SSB 14059 response pair without fetching or writing.

The caller supplies recorded transport responses and, if available, the last
accepted data and metadata captures. Data-only reconciliation cannot establish
that the response pair is unchanged. This module does not decide source approval,
retention, checkpoint advancement, editorial acceptance or public eligibility.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from workers.ssb_14059_candidates import (
    NumericalEvidenceCandidate,
    build_private_ssb_14059_candidates,
)
from workers.ssb_14059_capture import (
    CapturedResponse,
    ParsedCapture,
    ParsedMetadataCapture,
    SSB14059CaptureError,
    parse_captured_ssb_14059,
    parse_captured_ssb_14059_metadata,
    require_bounded_pair_chronology,
    require_matching_metadata,
)
from workers.ssb_14059_reconcile import ReconciliationPlan, reconcile_ssb_14059


MetadataChangeState = Literal[
    "first_capture", "prior_metadata_unknown", "unchanged", "changed", "source_time_regressed"
]
AttentionReason = Literal[
    "first_response_pair",
    "data_body_changed",
    "share_cells_changed",
    "response_count_changed",
    "metadata_body_changed",
    "prior_metadata_unknown",
    "data_reconciliation_held",
    "metadata_source_time_regressed",
]


@dataclass(frozen=True)
class MetadataReconciliation:
    state: MetadataChangeState
    previous_raw_sha256: str | None
    current_raw_sha256: str
    raw_version_changed: bool | None


@dataclass(frozen=True)
class PrivateCollectionBatch:
    data: ParsedCapture
    metadata: ParsedMetadataCapture
    reconciliation: ReconciliationPlan
    candidates: tuple[NumericalEvidenceCandidate, ...]
    metadata_reconciliation: MetadataReconciliation

    @property
    def response_pair_unchanged(self) -> bool:
        """Only both known response bodies can establish a repeated pair."""
        return (
            self.reconciliation.state == "unchanged"
            and self.metadata_reconciliation.state == "unchanged"
        )

    @property
    def attention_reasons(self) -> tuple[AttentionReason, ...]:
        """Expose changes needing disposition even if no numeric cell changed.

        These are private review signals, not a queue or publication decision.
        An empty tuple is justified only by a known, unchanged response pair.
        """
        reasons: list[AttentionReason] = []
        if self.reconciliation.state == "new":
            reasons.append("first_response_pair")
        elif self.reconciliation.raw_version_changed:
            reasons.append("data_body_changed")
            if self.reconciliation.changed_share_years:
                reasons.append("share_cells_changed")
            if self.reconciliation.changed_response_count_years:
                reasons.append("response_count_changed")
        if self.metadata_reconciliation.raw_version_changed:
            reasons.append("metadata_body_changed")
        if self.metadata_reconciliation.state == "prior_metadata_unknown":
            reasons.append("prior_metadata_unknown")
        if self.reconciliation.state == "held":
            reasons.append("data_reconciliation_held")
        if self.metadata_reconciliation.state == "source_time_regressed":
            reasons.append("metadata_source_time_regressed")
        return tuple(reasons)


def _reconcile_metadata(
    previous_data: ParsedCapture | None,
    previous_metadata: ParsedMetadataCapture | None,
    current_metadata: ParsedMetadataCapture,
) -> MetadataReconciliation:
    current_hash = current_metadata.raw_sha256
    if previous_data is None:
        if previous_metadata is not None:
            raise SSB14059CaptureError("Previous metadata requires previous accepted data")
        return MetadataReconciliation("first_capture", None, current_hash, None)
    if previous_metadata is None:
        return MetadataReconciliation("prior_metadata_unknown", None, current_hash, None)
    if not isinstance(previous_metadata, ParsedMetadataCapture):
        raise SSB14059CaptureError("Previous metadata is not a parsed capture")
    require_matching_metadata(previous_data, previous_metadata)
    if previous_metadata.source_updated_at > previous_metadata.retrieved_at:
        raise SSB14059CaptureError("Previous metadata source time is later than retrieval")
    if previous_metadata.retrieved_at > current_metadata.retrieved_at:
        raise SSB14059CaptureError("Metadata retrieval chronology regressed")
    previous_hash = previous_metadata.raw_sha256
    if previous_hash == current_hash:
        if previous_metadata.source_updated_at != current_metadata.source_updated_at:
            raise SSB14059CaptureError("Same metadata hash has conflicting source dates")
        return MetadataReconciliation("unchanged", previous_hash, current_hash, False)
    state: MetadataChangeState = (
        "source_time_regressed"
        if current_metadata.source_updated_at < previous_metadata.source_updated_at
        else "changed"
    )
    return MetadataReconciliation(state, previous_hash, current_hash, True)


def assemble_private_ssb_14059_batch(
    *,
    metadata_response: CapturedResponse,
    data_response: CapturedResponse,
    previous_accepted_data: ParsedCapture | None,
    previous_accepted_metadata: ParsedMetadataCapture | None = None,
) -> PrivateCollectionBatch:
    """Fail closed before mapping any numerical candidate from a response pair."""
    metadata = parse_captured_ssb_14059_metadata(metadata_response)
    data = parse_captured_ssb_14059(data_response)
    require_matching_metadata(data, metadata)
    require_bounded_pair_chronology(data, metadata)
    reconciliation = reconcile_ssb_14059(previous_accepted_data, data)
    metadata_reconciliation = _reconcile_metadata(
        previous_accepted_data, previous_accepted_metadata, metadata
    )
    candidates = build_private_ssb_14059_candidates(data, reconciliation, metadata)
    return PrivateCollectionBatch(
        data, metadata, reconciliation, candidates, metadata_reconciliation
    )
