import unittest
from pathlib import Path
from scripts.build_unknown_ssb_pair_api import build_unknown_ssb_pair_api

ROOT=Path(__file__).resolve().parents[1]

class UnknownPairCandidateTests(unittest.TestCase):
    def test_reproducible_isolated_candidate_with_no_preknown_body_authority(self):
        sql=build_unknown_ssb_pair_api()
        self.assertEqual(sql,(ROOT/'research/pending/TF009_unknown_ssb_pair_api_v1.sql').read_text())
        self.assertIn('p.body_sha256 is not null or p.body_bytes is not null or p.trusted_manifest is not null',sql)
        self.assertNotIn("Measured paired fixture differs from trusted body",sql)
        self.assertIn("octet_length(body) is distinct from s.body_bytes",sql)
        self.assertIn("encode(sha256(body),'hex') is distinct from s.content_sha256",sql)
        self.assertIn("supplied is distinct from expected",sql)
        self.assertIn('First-capture manifest differs from actual measured contexts',sql)
        self.assertIn("'validationState',v.validation_state",sql)
        self.assertIn("'pending'",sql)
        self.assertNotIn('insert into terra_private.source_checkpoints',sql)
        self.assertNotIn('insert into terra_private.issue_publications',sql)

if __name__=='__main__':unittest.main()
