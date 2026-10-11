"""Reproducible isolated candidate; actual SQL compatibility is a separate gate."""
from pathlib import Path
import unittest
from scripts.build_private_ssb_capture_api import build_private_ssb_capture_api,PRIVATE_SCHEMA,REQUEST_PREFIX

ROOT=Path(__file__).resolve().parents[1]


class PrivateCaptureCandidateTests(unittest.TestCase):
    def test_reviewed_candidate_is_reproducible_without_primary_migration(self):
        sql=build_private_ssb_capture_api()
        self.assertEqual(sql,(ROOT/'research/pending/TF009_private_ssb_capture_api_v2.sql').read_text())
        self.assertIn(PRIVATE_SCHEMA+'.read_admitted_context()',sql)
        self.assertIn(PRIVATE_SCHEMA+'.read_retention_context()',sql)
        self.assertIn(REQUEST_PREFIX,sql)
        self.assertNotIn('terra_pair_capture_test_api.',sql)
        for statement in ('create role ','insert into terra_private.source_checkpoints',
                'insert into terra_private.issue_publications','cron.schedule'):
            self.assertNotIn(statement,sql.lower())

    def test_previous_reviewed_candidate_is_preserved(self):
        from hashlib import sha256
        self.assertEqual(sha256((ROOT/'research/pending/TF009_private_ssb_capture_api_v1.sql').read_bytes()).hexdigest(),
            '4854e956f83325e17e4747f786b43cc533f02e2775a21d92dc337283db3d7afa')


if __name__=='__main__':unittest.main()
