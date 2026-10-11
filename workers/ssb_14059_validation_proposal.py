"""Conservative private disposition proposed from one already parsed SSB pair.

This never returns ``usable``. A later authorized writer must recheck current
source rights, retained bytes and the database transaction before that state
or a success checkpoint can be considered.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from workers.ssb_14059_batch import PrivateCollectionBatch


ProposalState = Literal["pending", "held"]
HoldReason = Literal[
    "data_reconciliation_held",
    "metadata_source_time_regressed",
    "prior_metadata_unknown",
    "metadata_definition_changed",
]


@dataclass(frozen=True)
class PrivatePairValidationProposal:
    state: ProposalState
    reason_code: HoldReason | None


def propose_private_ssb_14059_pair_validation(
    batch: PrivateCollectionBatch,
) -> PrivatePairValidationProposal:
    """Turn parsed pair concerns into a pending/held row proposal only."""
    if not isinstance(batch, PrivateCollectionBatch):
        raise TypeError("A parsed private response pair is required")
    data_state = batch.reconciliation.state
    metadata_state = batch.metadata_reconciliation.state
    if data_state not in {"new", "unchanged", "changed", "held"}:
        raise ValueError("Unknown data reconciliation state")
    if metadata_state not in {
        "first_capture", "prior_metadata_unknown", "unchanged", "changed", "source_time_regressed"
    }:
        raise ValueError("Unknown metadata reconciliation state")
    if (data_state == "new") != (metadata_state == "first_capture"):
        raise ValueError("Inconsistent first-response-pair states")
    if data_state == "held":
        return PrivatePairValidationProposal("held", "data_reconciliation_held")
    if metadata_state == "source_time_regressed":
        return PrivatePairValidationProposal("held", "metadata_source_time_regressed")
    if metadata_state == "prior_metadata_unknown":
        return PrivatePairValidationProposal("held", "prior_metadata_unknown")
    if metadata_state == "changed":
        return PrivatePairValidationProposal("held", "metadata_definition_changed")
    return PrivatePairValidationProposal("pending", None)
