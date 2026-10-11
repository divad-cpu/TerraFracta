"""Offline checks for the selected SSB 14059 table definition."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import unittest

from workers.ssb_14059_capture import (
    CapturedResponse,
    METADATA_URL,
    SSB14059CaptureError,
    parse_captured_ssb_14059_metadata,
)
from workers.ssb_14059_metadata import SSB14059MetadataError


ROOT = Path(__file__).resolve().parents[1]


class SSB14059MetadataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = json.loads(
            (ROOT / "fixtures/ssb_14059_metadata_minimal_2024_2025.json").read_text()
        )
        cls.retrieved_at = datetime(2026, 9, 25, 5, 30, tzinfo=timezone.utc)

    def capture(self, payload: dict | None = None, *, url: str = METADATA_URL):
        body = json.dumps(self.fixture if payload is None else payload).encode("utf-8")
        return CapturedResponse(url, url, 0, 200, "application/json", body, self.retrieved_at)

    def test_reviewed_definition_has_metadata_provenance(self) -> None:
        capture = self.capture()
        parsed = parse_captured_ssb_14059_metadata(capture)
        self.assertEqual(parsed.metadata_url, METADATA_URL)
        self.assertEqual(parsed.source_updated_at.isoformat(), "2026-04-16T06:00:00+00:00")
        self.assertEqual(parsed.raw_sha256, sha256(capture.body).hexdigest())

    def test_old_misspelled_api_path_is_rejected(self) -> None:
        old = METADATA_URL.replace("pxwebapi/v2", "pxwebapiv2")
        with self.assertRaises(SSB14059CaptureError):
            parse_captured_ssb_14059_metadata(self.capture(url=old))

    def test_changed_selected_label_or_unit_is_held(self) -> None:
        for field, value in (("label", "Unrelated indicator"), ("unit", {"base": "NOK", "decimals": 1})):
            changed = deepcopy(self.fixture)
            changed["dimension"]["ContentsCode"]["category"][field]["Boutg4"] = value
            with self.subTest(field=field):
                with self.assertRaises(SSB14059MetadataError):
                    parse_captured_ssb_14059_metadata(self.capture(changed))

    def test_changed_respondent_meaning_or_survey_period_is_held(self) -> None:
        for field, value in (("measuringType", "Average"), ("refperiod", "Unknown period")):
            changed = deepcopy(self.fixture)
            changed["dimension"]["ContentsCode"]["extension"][field]["AntHushSvar"] = value
            with self.subTest(field=field):
                with self.assertRaises(SSB14059MetadataError):
                    parse_captured_ssb_14059_metadata(self.capture(changed))

    def test_changed_adjustment_or_extended_unit_is_held(self) -> None:
        changed_adjustment = deepcopy(self.fixture)
        changed_adjustment["dimension"]["ContentsCode"]["extension"]["adjustment"]["Boutg4"] = "Seasonal"
        changed_unit = deepcopy(self.fixture)
        changed_unit["dimension"]["ContentsCode"]["category"]["unit"]["Boutg4"]["scale"] = 1000
        for changed in (changed_adjustment, changed_unit):
            with self.assertRaises(SSB14059MetadataError):
                parse_captured_ssb_14059_metadata(self.capture(changed))

    def test_extra_unrelated_year_does_not_change_selected_meaning(self) -> None:
        changed = deepcopy(self.fixture)
        changed["dimension"]["Tid"]["category"]["index"]["2026"] = 2
        changed["dimension"]["Tid"]["category"]["label"]["2026"] = "2026"
        changed["size"][2] = 3
        self.assertEqual(
            parse_captured_ssb_14059_metadata(self.capture(changed)).metadata_url,
            METADATA_URL,
        )

    def test_missing_selected_code_or_invalid_positions_is_held(self) -> None:
        missing = deepcopy(self.fixture)
        del missing["dimension"]["ContentsCode"]["category"]["index"]["Boutg5"]
        duplicate = deepcopy(self.fixture)
        duplicate["dimension"]["ContentsCode"]["category"]["index"]["Boutg5"] = 0
        for changed in (missing, duplicate):
            with self.assertRaises(SSB14059MetadataError):
                parse_captured_ssb_14059_metadata(self.capture(changed))

    def test_changed_comparability_note_is_held(self) -> None:
        changed = deepcopy(self.fixture)
        changed["note"] = ["No known series breaks"]
        with self.assertRaises(SSB14059MetadataError):
            parse_captured_ssb_14059_metadata(self.capture(changed))

    def test_changed_table_identity_or_language_is_held(self) -> None:
        for field, value in (("tableid", "99999"), ("language", "no")):
            changed = deepcopy(self.fixture)
            changed["extension"]["px"][field] = value
            with self.subTest(field=field):
                with self.assertRaises(SSB14059MetadataError):
                    parse_captured_ssb_14059_metadata(self.capture(changed))

    def test_future_metadata_update_is_rejected(self) -> None:
        changed = deepcopy(self.fixture)
        changed["updated"] = "2030-04-16T06:00:00Z"
        with self.assertRaises(SSB14059CaptureError):
            parse_captured_ssb_14059_metadata(self.capture(changed))

    def test_duplicate_json_fields_are_rejected(self) -> None:
        capture = self.capture()
        changed = CapturedResponse(
            capture.requested_url,
            capture.final_url,
            0,
            200,
            "application/json",
            b'{"source":"A","source":"B"}',
            capture.retrieved_at,
        )
        with self.assertRaises(SSB14059CaptureError):
            parse_captured_ssb_14059_metadata(changed)


    def test_selected_unit_precision_rejects_boolean_and_decimal_json_tokens(self) -> None:
        for code, value in (('Boutg4', True), ('Boutg4', 1.0), ('Boutg5', True), ('AntHushSvar', False), ('AntHushSvar', 0.0)):
            with self.subTest(code=code, value=value):
                changed = deepcopy(self.fixture)
                changed['dimension']['ContentsCode']['category']['unit'][code]['decimals'] = value
                with self.assertRaises(SSB14059MetadataError):
                    parse_captured_ssb_14059_metadata(self.capture(changed))


if __name__ == "__main__":
    unittest.main()
