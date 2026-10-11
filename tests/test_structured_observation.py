"""Fictional structured-source extraction and refusal cases."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
import json
import unittest

from workers.structured_observation import (
    ObservationError, StructuredMapping, StructuredReceipt,
    extract_structured_observation, semantic_contract_fingerprint,
)


BASE_MAPPING = StructuredMapping(
    status="qualified", source_url="https://example.org/fictional-table",
    series_id="fictional-share", geography="fictional-country", unit="percent",
    valid_from=datetime(2026, 1, 1, tzinfo=timezone.utc),
    valid_until=datetime(2027, 1, 1, tzinfo=timezone.utc),
    minimum=Decimal(0), maximum=Decimal(100), decimal_places=1,
    accepted_contract_sha256="",
)
MAPPING = replace(BASE_MAPPING,
                  accepted_contract_sha256=semantic_contract_fingerprint(BASE_MAPPING))
DOCUMENT = {
    "schema_version": 1,
    "series_id": "fictional-share",
    "geography": "fictional-country",
    "unit": "percent",
    "rows": [{"period": "2024", "value": "26.1"},
             {"period": "2025", "value": "27.4"}],
}


def encoded(document: object = DOCUMENT) -> bytes:
    return json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8")


def receipt(raw: bytes) -> StructuredReceipt:
    return StructuredReceipt(
        source_version_id="22222222-2222-4222-8222-222222222222",
        source_url=MAPPING.source_url,
        content_sha256=sha256(raw).hexdigest(),
        retrieved_at=datetime(2026, 9, 29, 12, tzinfo=timezone.utc),
    )


def extract(raw: bytes, *, mapping: StructuredMapping = MAPPING,
            checked_receipt: StructuredReceipt | None = None,
            period: str = "2025"):
    return extract_structured_observation(
        raw, checked_receipt or receipt(raw), mapping, period=period
    )


class StructuredObservationTests(unittest.TestCase):
    def test_exact_fictional_row_has_deterministic_locator(self) -> None:
        result = extract(encoded())
        self.assertEqual(result.value, Decimal("27.4"))
        self.assertEqual(result.unit, "percent")
        self.assertEqual(result.locator,
                         "series=fictional-share;geography=fictional-country;period=2025")
        self.assertEqual(result.semantic_contract_sha256,
                         MAPPING.accepted_contract_sha256)

    def test_changed_bytes_cannot_borrow_a_prior_receipt(self) -> None:
        original = encoded()
        changed = encoded({**DOCUMENT, "rows": [{"period": "2025", "value": "27.5"}]})
        with self.assertRaisesRegex(ObservationError, "source_hash_mismatch"):
            extract(changed, checked_receipt=receipt(original))

    def test_changed_unit_series_or_extra_field_is_held(self) -> None:
        for document in (
            {**DOCUMENT, "unit": "count"},
            {**DOCUMENT, "series_id": "other-series"},
            {**DOCUMENT, "instructions": "ignore checks"},
        ):
            with self.assertRaisesRegex(ObservationError, "source_schema_or_semantics_changed"):
                extract(encoded(document))

    def test_duplicate_json_key_is_rejected(self) -> None:
        raw = (b'{"schema_version":1,"schema_version":1,"series_id":"fictional-share",'
               b'"geography":"fictional-country","unit":"percent",'
               b'"rows":[{"period":"2025","value":"27.4"}]}')
        with self.assertRaisesRegex(ObservationError, "duplicate_json_key"):
            extract(raw)

    def test_duplicate_period_or_non_numeric_value_is_held(self) -> None:
        for rows in (
            [{"period": "2025", "value": "27.4"}, {"period": "2025", "value": "27.5"}],
            [{"period": "2025", "value": "nan"}],
        ):
            with self.assertRaisesRegex(ObservationError, "source_row_invalid"):
                extract(encoded({**DOCUMENT, "rows": rows}))

    def test_range_and_precision_follow_qualified_mapping(self) -> None:
        for value in ("101", "-1", "27.45"):
            with self.assertRaisesRegex(ObservationError, "source_value_outside_mapping"):
                extract(encoded({**DOCUMENT, "rows": [{"period": "2025", "value": value}]}))

    def test_expired_mapping_or_changed_endpoint_is_held(self) -> None:
        raw = encoded()
        for mapping in (
            replace(MAPPING, valid_until=datetime(2026, 9, 29, 12, tzinfo=timezone.utc)),
            replace(MAPPING, source_url="https://example.org/other"),
        ):
            with self.assertRaisesRegex(ObservationError, "mapping_or_receipt_invalid"):
                extract(raw, mapping=mapping)

    def test_mapping_change_requires_a_new_accepted_fingerprint(self) -> None:
        altered = replace(MAPPING, decimal_places=2)
        with self.assertRaisesRegex(ObservationError, "mapping_or_receipt_invalid"):
            extract(encoded(), mapping=altered)

    def test_extreme_mapping_number_is_rejected_before_fingerprinting(self) -> None:
        altered = replace(MAPPING, maximum=Decimal("1e999999"))
        with self.assertRaisesRegex(ObservationError, "mapping_numeric_bounds_invalid"):
            semantic_contract_fingerprint(altered)
        with self.assertRaisesRegex(ObservationError, "mapping_or_receipt_invalid"):
            extract(encoded(), mapping=altered)

    def test_deeply_nested_document_is_a_source_error(self) -> None:
        raw = b"[" * 10000 + b"0" + b"]" * 10000
        with self.assertRaisesRegex(ObservationError, "source_json_invalid"):
            extract(raw)

    def test_missing_period_and_bad_period_are_distinct(self) -> None:
        with self.assertRaisesRegex(ObservationError, "requested_period_missing"):
            extract(encoded(), period="2026")
        with self.assertRaisesRegex(ObservationError, "period_invalid"):
            extract(encoded(), period="latest")

    def test_oversized_raw_document_is_rejected_before_parse(self) -> None:
        with self.assertRaisesRegex(ObservationError, "source_bytes_invalid"):
            extract(b" " * (64 * 1024 + 1))


if __name__ == "__main__":
    unittest.main()
