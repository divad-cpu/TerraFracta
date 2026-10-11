"""Curated refusals for bounded invented source JSON parser limits."""
from hashlib import sha256
from dataclasses import replace
import sys
import unittest

from tests.test_structured_observation import MAPPING, DOCUMENT, encoded, receipt
from workers.structured_observation import ObservationError, extract_structured_observation


def extract(raw):
    return extract_structured_observation(raw, receipt(raw), MAPPING, period="2025")


class StructuredJsonRefusalTests(unittest.TestCase):
    def test_large_json_integer_in_schema_is_a_curated_source_refusal(self):
        raw = encoded().replace(b'"schema_version":1', b'"schema_version":' + b'9' * 6000)
        with self.assertRaises(ObservationError):
            extract(raw)

    def test_large_json_integer_in_row_is_a_curated_source_refusal(self):
        raw = encoded().replace(b'"value":"27.4"', b'"value":' + b'9' * 6000)
        with self.assertRaises(ObservationError):
            extract(raw)

    def test_duplicate_keys_keep_the_existing_specific_refusal(self):
        raw = encoded().replace(b'"schema_version":1', b'"schema_version":1,"schema_version":1')
        with self.assertRaisesRegex(ObservationError, "^duplicate_json_key$"):
            extract(raw)

    def test_malformed_utf8_and_json_keep_the_existing_curated_refusal(self):
        for raw, reason in [(b'\xff', "source_json_invalid"), (b'{"private-canary":', "source_json_invalid"),
                            (b'[' * 2000 + b']' * 2000, "source_json_invalid|source_schema_or_semantics_changed")]:
            with self.subTest(size=len(raw)):
                with self.assertRaisesRegex(ObservationError, f"^(?:{reason})$"):
                    extract(raw)

    def test_prior_hash_and_mapping_guards_still_precede_json_decoding(self):
        raw = b'9' * 6000
        for changed_receipt, changed_mapping, reason in [
            (replace(receipt(raw), content_sha256=sha256(b"other").hexdigest()), MAPPING, "source_hash_mismatch"),
            (receipt(raw), replace(MAPPING, accepted_contract_sha256="a" * 64), "mapping_or_receipt_invalid"),
        ]:
            with self.subTest(reason=reason):
                with self.assertRaisesRegex(ObservationError, f"^{reason}$"):
                    extract_structured_observation(raw, changed_receipt, changed_mapping, period="2025")

    def test_valid_observation_and_integer_limit_remain_unchanged(self):
        before = sys.get_int_max_str_digits()
        self.assertEqual(str(extract(encoded(DOCUMENT)).value), "27.4")
        self.assertEqual(sys.get_int_max_str_digits(), before)


if __name__ == "__main__":
    unittest.main()
