"""Source-link shape checks shared by the fictional extraction and decision path."""

from __future__ import annotations

import unittest

from workers.public_source_url import public_https_source_url


class PublicSourceUrlTests(unittest.TestCase):
    def test_public_https_domain_with_a_data_query_is_allowed(self) -> None:
        self.assertTrue(public_https_source_url(
            "https://data.example.org/table?lang=en&year=2025"))

    def test_local_credentialed_or_malformed_addresses_are_rejected(self) -> None:
        for url in (
            "http://example.org/table",
            "https://localhost/table",
            "https://data.local/table",
            "https://10.0.0.1/table",
            "https://123.456.7.8/table",
            "https://user:password@example.org/table",
            "https://example.org:0/table",
            "https://example.org:bad/table",
            "https://example.org/table#private",
            "https://example.org/table?api_key=redacted",
            "https://example.org/table?key=redacted",
            "https://example.org/table?%61pi_key=redacted",
            "https://example.org\\@local.test/table",
            "https://example.org/table\nInjected: yes",
        ):
            with self.subTest(url=url):
                self.assertFalse(public_https_source_url(url))


if __name__ == "__main__":
    unittest.main()
