"""Post-COMMIT receipts cannot substitute a different private saved pair."""
from datetime import datetime, timedelta, timezone
import json
import unittest
from workers.ssb_14059_recovery import ExpectedRawPair
from workers.ssb_14059_raw_binding_receipt import parse_raw_binding


class RawBindingReceiptTests(unittest.TestCase):
    def setUp(self):
        self.pair = '11111111-1111-4111-8111-111111111111'
        self.versions = {'metadata': '22222222-2222-4222-8222-222222222222',
                         'data': '33333333-3333-4333-8333-333333333333'}
        t = datetime(2026, 10, 1, tzinfo=timezone.utc)
        self.expected = ExpectedRawPair('a'*32, 'b'*64, 'c'*64, t+timedelta(days=30),
                                        t, t+timedelta(seconds=1), t+timedelta(seconds=2))
        e = self.expected
        self.value = {'schemaVersion': 1, 'pairId': self.pair, 'rawAttemptId': e.attempt_id,
                      'metadataSha256': e.metadata_sha256, 'dataSha256': e.data_sha256,
                      'storedAt': e.stored_at.isoformat(), 'expiresAt': e.expires_at.isoformat(),
                      'metadataRetrievedAt': e.metadata_retrieved_at.isoformat(),
                      'dataRetrievedAt': e.data_retrieved_at.isoformat(),
                      'metadataVersionId': self.versions['metadata'], 'dataVersionId': self.versions['data']}

    def parse(self, value):
        return parse_raw_binding(json.dumps(value).encode(), pair_id=self.pair,
                                 versions=self.versions, expected=self.expected)

    def test_exact_saved_identity_and_times_round_trip(self):
        self.assertEqual(self.parse(self.value), self.expected)

    def test_field_substitution_and_private_selectors_are_refused(self):
        variants = {'schemaVersion': True, 'pairId': self.versions['data'], 'rawAttemptId': '../raw',
                    'metadataSha256': 'd'*64, 'dataSha256': 'd'*64,
                    'storedAt': '2026-10-01T00:00:03+00:00',
                    'expiresAt': '2026-11-01T00:00:00+00:00',
                    'metadataRetrievedAt': '2026-10-01T00:00:01+00:00',
                    'dataRetrievedAt': '2026-10-01T00:00:00',
                    'metadataVersionId': self.versions['data'], 'dataVersionId': self.versions['metadata'],
                    'rawPath': '/private/selector'}
        for key, value in variants.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.parse({**self.value, key: value})
        for key in self.value:
            with self.subTest(missing=key), self.assertRaises(ValueError):
                self.parse({k: v for k, v in self.value.items() if k != key})

    def test_duplicate_json_and_unbounded_payload_are_refused(self):
        duplicate = json.dumps(self.value)[:-1] + ',"schemaVersion":1}'
        for body in (duplicate.encode(), b' '*4097, b'{"schemaVersion":NaN}', b'\xff'):
            with self.subTest(body=body[:30]), self.assertRaises(ValueError):
                parse_raw_binding(body, pair_id=self.pair, versions=self.versions, expected=self.expected)

    def test_trusted_context_must_itself_have_exact_retention_and_distinct_versions(self):
        e = self.expected
        wrong = ExpectedRawPair(e.attempt_id, e.metadata_sha256, e.data_sha256,
                                e.expires_at+timedelta(seconds=1), e.metadata_retrieved_at,
                                e.data_retrieved_at, e.stored_at)
        for versions, expected in (({'metadata': self.versions['metadata'], 'data': self.versions['metadata']}, e),
                                   (self.versions, wrong)):
            with self.assertRaises(ValueError):
                parse_raw_binding(json.dumps(self.value).encode(), pair_id=self.pair,
                                  versions=versions, expected=expected)


if __name__ == '__main__': unittest.main()
