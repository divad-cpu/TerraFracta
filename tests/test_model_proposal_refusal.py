"""Keep invalid model bytes/configuration inside the unverified proposal boundary."""
from dataclasses import replace
import json
import sys
import unittest

from tests.test_model_proposal import ALLOWED, VALID
from workers.model_proposal import ModelProposalError, parse_untrusted_model_proposal


def raw(value=VALID):
    return json.dumps(value, separators=(",", ":")).encode()


class ModelProposalRefusalTests(unittest.TestCase):
    def test_bounded_large_json_integer_is_a_curated_model_refusal(self):
        for key, token in [(b'"schema_version":1', b'"schema_version":'),
                           (b'"proposed_assertion":"The fictional authority announced a sample measure."', b'"proposed_assertion":')]:
            document = raw().replace(key, token + b'9' * 6000)
            self.assertLess(len(document), 8192)
            with self.subTest(key=key):
                with self.assertRaises(ModelProposalError):
                    parse_untrusted_model_proposal(document, ALLOWED)

    def test_missing_trusted_source_identity_cannot_yield_a_proposal(self):
        for value in [None, False, 42, [], {}]:
            with self.subTest(value=value):
                with self.assertRaises(ModelProposalError):
                    parse_untrusted_model_proposal(raw({**VALID, "source_version_id": value}), replace(ALLOWED, source_version_id=value))

    def test_string_locator_container_cannot_admit_a_substring_locator(self):
        for locators in ["prefix:" + VALID["locator"] + ":suffix", {VALID["locator"]: "private-canary"}, [VALID["locator"]]]:
            with self.subTest(container=type(locators).__name__):
                with self.assertRaises(ModelProposalError):
                    parse_untrusted_model_proposal(raw(), replace(ALLOWED, locators=locators))

    def test_non_string_trusted_hash_and_language_are_curated_refusals(self):
        for key, field in [("source_sha256", "source_sha256"), ("language_code", "language_code")]:
            for value in [None, False, 42, [], {}]:
                with self.subTest(key=key, value=value):
                    with self.assertRaises(ModelProposalError):
                        parse_untrusted_model_proposal(raw({**VALID, key: value}), replace(ALLOWED, **{field: value}))

    def test_non_evidence_object_and_mixed_locator_tuple_are_curated_refusals(self):
        for allowed in [None, {}, replace(ALLOWED, locators=(VALID["locator"], None))]:
            with self.subTest(kind=type(allowed).__name__):
                with self.assertRaises(ModelProposalError):
                    parse_untrusted_model_proposal(raw(), allowed)

    def test_duplicate_key_keeps_its_specific_refusal(self):
        document = raw().replace(b'"schema_version":1', b'"schema_version":1,"schema_version":1')
        with self.assertRaisesRegex(ModelProposalError, "^Duplicate JSON key$"):
            parse_untrusted_model_proposal(document, ALLOWED)

    def test_valid_tuple_locators_and_source_text_remain_unverified(self):
        before = sys.get_int_max_str_digits()
        proposal = parse_untrusted_model_proposal(raw(), ALLOWED)
        self.assertEqual(proposal.review_state, "unverified")
        self.assertEqual(proposal.locator, VALID["locator"])
        self.assertEqual(proposal.source_version_id, ALLOWED.source_version_id)
        self.assertEqual(sys.get_int_max_str_digits(), before)

    def test_malformed_json_utf8_and_oversize_keep_curated_refusals(self):
        for document in [b'\xff', b'{"private-canary":', b'x' * 8193]:
            with self.subTest(size=len(document)):
                with self.assertRaises(ModelProposalError):
                    parse_untrusted_model_proposal(document, ALLOWED)


if __name__ == "__main__":
    unittest.main()
