"""Integration checks across the offline SSB response pair."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import unittest

from workers.ssb_14059_batch import assemble_private_ssb_14059_batch
from workers.ssb_14059_validation_proposal import (
    PrivatePairValidationProposal,
    propose_private_ssb_14059_pair_validation,
)
from workers.ssb_14059 import SSB14059ShapeError
from workers.ssb_14059_capture import (
    CapturedResponse,
    DATA_URL,
    METADATA_URL,
    SSB14059CaptureError,
)
from workers.ssb_14059_metadata import SSB14059MetadataError


ROOT = Path(__file__).resolve().parents[1]


class SSB14059BatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.data = json.loads(
            (ROOT / "fixtures/ssb_14059_jsonstat_minimal_2024_2025.json").read_text()
        )
        cls.metadata = json.loads(
            (ROOT / "fixtures/ssb_14059_metadata_minimal_2024_2025.json").read_text()
        )
        cls.first_retrieval = datetime(2026, 9, 25, 5, 30, tzinfo=timezone.utc)

    def captured(self, url: str, payload: dict, *, later: bool = False) -> CapturedResponse:
        return CapturedResponse(
            requested_url=url,
            final_url=url,
            redirect_count=0,
            status=200,
            content_type="application/json",
            body=json.dumps(payload).encode("utf-8"),
            retrieved_at=self.first_retrieval + timedelta(days=1) if later else self.first_retrieval,
        )

    def batch(self, data: dict | None = None, metadata: dict | None = None, previous=None, *, previous_metadata=None, later=False):
        return assemble_private_ssb_14059_batch(
            metadata_response=self.captured(METADATA_URL, self.metadata if metadata is None else metadata, later=later),
            data_response=self.captured(DATA_URL, self.data if data is None else data, later=later),
            previous_accepted_data=previous,
            previous_accepted_metadata=previous_metadata,
        )

    def test_first_response_pair_yields_only_private_unreviewed_candidates(self) -> None:
        result = self.batch()
        self.assertEqual(
            propose_private_ssb_14059_pair_validation(result),
            PrivatePairValidationProposal("pending", None),
        )
        self.assertEqual(result.reconciliation.state, "new")
        self.assertEqual(result.metadata_reconciliation.state, "first_capture")
        self.assertFalse(result.response_pair_unchanged)
        self.assertEqual(result.attention_reasons, ("first_response_pair",))
        self.assertEqual([item.survey_year for item in result.candidates], [2024, 2025])
        self.assertTrue(all(item.review_state == "unreviewed" for item in result.candidates))
        self.assertTrue(all(item.metadata_response_sha256 == result.metadata.raw_sha256 for item in result.candidates))

    def test_validation_proposal_rejects_unknown_internal_states(self) -> None:
        from dataclasses import replace

        first = self.batch()
        with self.assertRaises(TypeError):
            propose_private_ssb_14059_pair_validation(object())
        for changed in (
            replace(first, reconciliation=replace(first.reconciliation, state="unrecognized")),
            replace(first, metadata_reconciliation=replace(first.metadata_reconciliation, state="unrecognized")),
        ):
            with self.subTest(changed=changed):
                with self.assertRaises(ValueError):
                    propose_private_ssb_14059_pair_validation(changed)

    def test_validation_proposal_rejects_contradictory_first_pair_states(self) -> None:
        from dataclasses import replace

        first = self.batch()
        contradictory = (
            replace(first, reconciliation=replace(first.reconciliation, state="unchanged")),
            replace(first, metadata_reconciliation=replace(first.metadata_reconciliation, state="unchanged")),
        )
        for changed in contradictory:
            with self.subTest(changed=changed):
                with self.assertRaisesRegex(ValueError, "Inconsistent first-response-pair"):
                    propose_private_ssb_14059_pair_validation(changed)

    def test_repeated_data_stays_unchanged_with_new_retrieval_time(self) -> None:
        first = self.batch()
        second = self.batch(previous=first.data, previous_metadata=first.metadata, later=True)
        self.assertEqual(second.reconciliation.state, "unchanged")
        self.assertEqual(second.metadata_reconciliation.state, "unchanged")
        self.assertTrue(second.response_pair_unchanged)
        self.assertEqual(second.candidates, ())
        self.assertEqual(second.attention_reasons, ())
        self.assertEqual(
            propose_private_ssb_14059_pair_validation(second),
            PrivatePairValidationProposal("pending", None),
        )

    def test_changed_metadata_body_is_visible_with_unchanged_data(self) -> None:
        first = self.batch()
        changed_metadata = deepcopy(self.metadata)
        changed_metadata["label"] = "Changed non-selected table description"
        second = self.batch(
            metadata=changed_metadata,
            previous=first.data,
            previous_metadata=first.metadata,
            later=True,
        )
        self.assertEqual(second.reconciliation.state, "unchanged")
        self.assertEqual(second.candidates, ())
        self.assertEqual(second.metadata_reconciliation.state, "changed")
        self.assertTrue(second.metadata_reconciliation.raw_version_changed)
        self.assertFalse(second.response_pair_unchanged)
        self.assertEqual(second.attention_reasons, ("metadata_body_changed",))
        self.assertEqual(
            propose_private_ssb_14059_pair_validation(second),
            PrivatePairValidationProposal("held", "metadata_definition_changed"),
        )

    def test_missing_previous_metadata_cannot_prove_pair_unchanged(self) -> None:
        first = self.batch()
        second = self.batch(previous=first.data, later=True)
        self.assertEqual(second.reconciliation.state, "unchanged")
        self.assertEqual(second.metadata_reconciliation.state, "prior_metadata_unknown")
        self.assertFalse(second.response_pair_unchanged)
        self.assertEqual(second.attention_reasons, ("prior_metadata_unknown",))
        self.assertEqual(
            propose_private_ssb_14059_pair_validation(second),
            PrivatePairValidationProposal("held", "prior_metadata_unknown"),
        )

    def test_previous_metadata_must_match_previous_data(self) -> None:
        from dataclasses import replace

        first = self.batch()
        wrong_metadata = replace(
            first.metadata,
            source_updated_at=first.metadata.source_updated_at + timedelta(days=1),
        )
        with self.assertRaises(SSB14059CaptureError):
            self.batch(previous=first.data, previous_metadata=wrong_metadata, later=True)

    def test_previous_metadata_without_previous_data_is_rejected(self) -> None:
        first = self.batch()
        with self.assertRaises(SSB14059CaptureError):
            self.batch(previous_metadata=first.metadata, later=True)

    def test_regressed_metadata_version_remains_visible_as_regression(self) -> None:
        newer_data = deepcopy(self.data)
        newer_data["updated"] = "2026-05-01T06:00:00Z"
        newer_metadata = deepcopy(self.metadata)
        newer_metadata["updated"] = newer_data["updated"]
        first = self.batch(data=newer_data, metadata=newer_metadata)
        second = self.batch(
            previous=first.data, previous_metadata=first.metadata, later=True
        )
        self.assertEqual(second.reconciliation.state, "held")
        self.assertEqual(second.metadata_reconciliation.state, "source_time_regressed")
        self.assertFalse(second.response_pair_unchanged)
        self.assertEqual(
            second.attention_reasons,
            (
                "data_body_changed",
                "metadata_body_changed",
                "data_reconciliation_held",
                "metadata_source_time_regressed",
            ),
        )
        self.assertEqual(
            propose_private_ssb_14059_pair_validation(second),
            PrivatePairValidationProposal("held", "data_reconciliation_held"),
        )

    def test_metadata_retrieval_chronology_must_not_regress(self) -> None:
        from dataclasses import replace

        first = self.batch()
        future_metadata = replace(
            first.metadata,
            retrieved_at=first.metadata.retrieved_at + timedelta(days=2),
        )
        with self.assertRaises(SSB14059CaptureError):
            self.batch(
                previous=first.data, previous_metadata=future_metadata, later=True
            )

    def test_changed_number_without_source_revision_stays_held(self) -> None:
        first = self.batch()
        changed = deepcopy(self.data)
        changed["value"][1] = 12.9
        second = self.batch(data=changed, previous=first.data, later=True)
        self.assertEqual(second.reconciliation.state, "held")
        self.assertEqual([item.review_state for item in second.candidates], ["held"])
        self.assertEqual(
            second.attention_reasons,
            ("data_body_changed", "share_cells_changed", "prior_metadata_unknown", "data_reconciliation_held"),
        )
        self.assertEqual(
            propose_private_ssb_14059_pair_validation(second),
            PrivatePairValidationProposal("held", "data_reconciliation_held"),
        )

    def test_response_count_only_revision_has_distinct_attention_reason(self) -> None:
        first = self.batch()
        revised = deepcopy(self.data)
        revised["updated"] = "2026-05-01T06:00:00Z"
        revised["value"][5] = 5000
        revised_metadata = deepcopy(self.metadata)
        revised_metadata["updated"] = revised["updated"]
        second = self.batch(
            data=revised,
            metadata=revised_metadata,
            previous=first.data,
            previous_metadata=first.metadata,
            later=True,
        )
        self.assertEqual(second.reconciliation.changed_share_years, ())
        self.assertEqual(second.reconciliation.changed_response_count_years, (2025,))
        self.assertEqual(
            second.attention_reasons,
            ("data_body_changed", "response_count_changed", "metadata_body_changed"),
        )

    def test_data_body_change_without_new_numeric_cells_is_not_silent(self) -> None:
        first = self.batch()
        changed = deepcopy(self.data)
        changed["label"] = "Changed non-selected data description"
        second = self.batch(
            data=changed,
            previous=first.data,
            previous_metadata=first.metadata,
            later=True,
        )
        self.assertEqual(second.reconciliation.state, "changed")
        self.assertEqual(second.reconciliation.changed_years, ())
        self.assertEqual(second.candidates, ())
        self.assertEqual(second.attention_reasons, ("data_body_changed",))
        self.assertEqual(
            propose_private_ssb_14059_pair_validation(second),
            PrivatePairValidationProposal("pending", None),
        )

    def test_concurrent_data_and_metadata_body_changes_are_both_visible(self) -> None:
        first = self.batch()
        changed_data = deepcopy(self.data)
        changed_data["label"] = "Changed non-selected data description"
        changed_metadata = deepcopy(self.metadata)
        changed_metadata["label"] = "Changed non-selected metadata description"
        second = self.batch(
            data=changed_data,
            metadata=changed_metadata,
            previous=first.data,
            previous_metadata=first.metadata,
            later=True,
        )
        self.assertEqual(second.candidates, ())
        self.assertEqual(
            second.attention_reasons,
            ("data_body_changed", "metadata_body_changed"),
        )

    def test_data_and_metadata_versions_must_match(self) -> None:
        changed = deepcopy(self.metadata)
        changed["updated"] = "2026-05-01T06:00:00Z"
        with self.assertRaises(SSB14059CaptureError):
            self.batch(metadata=changed)

    def test_one_attempt_requires_metadata_first_and_within_five_minutes(self) -> None:
        from dataclasses import replace

        metadata = self.captured(METADATA_URL, self.metadata)
        base_data = self.captured(DATA_URL, self.data)
        for data_time in (
            self.first_retrieval - timedelta(seconds=1),
            self.first_retrieval + timedelta(minutes=6),
        ):
            with self.subTest(data_time=data_time):
                with self.assertRaises(SSB14059CaptureError):
                    assemble_private_ssb_14059_batch(
                        metadata_response=metadata,
                        data_response=replace(base_data, retrieved_at=data_time),
                        previous_accepted_data=None,
                    )

    def test_changed_definition_blocks_the_whole_batch(self) -> None:
        changed = deepcopy(self.metadata)
        changed["dimension"]["ContentsCode"]["category"]["unit"]["Boutg5"]["base"] = "NOK"
        with self.assertRaises(SSB14059MetadataError):
            self.batch(metadata=changed)

    def test_conflicting_definitions_inside_data_block_the_whole_batch(self) -> None:
        for field in ("unit", "label", "alternativeText", "tableid", "note"):
            changed = deepcopy(self.data)
            if field == "unit":
                changed["dimension"]["ContentsCode"]["category"]["unit"] = {
                    "Boutg4": {"base": "NOK", "decimals": 1}
                }
            elif field == "label":
                changed["dimension"]["ContentsCode"]["category"]["label"] = {
                    "Boutg4": "Unrelated meaning"
                }
            elif field == "alternativeText":
                changed["dimension"]["ContentsCode"]["extension"] = {
                    "alternativeText": {"Boutg4": "Unrelated meaning"}
                }
            elif field == "tableid":
                changed["extension"] = {"px": {"tableid": "99999", "language": "en"}}
            else:
                changed["note"] = ["No series breaks"]
            with self.subTest(field=field):
                with self.assertRaises(SSB14059ShapeError):
                    self.batch(data=changed)


if __name__ == "__main__":
    unittest.main()
