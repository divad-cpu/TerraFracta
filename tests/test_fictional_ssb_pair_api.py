from pathlib import Path
import re
import unittest
from scripts.build_fictional_ssb_pair_api import build_fictional_ssb_pair_api, SCHEMA
from workers.ssb_14059_capture import METADATA_URL, DATA_URL

ROOT=Path(__file__).resolve().parents[1]


class FictionalSSBPairAPITests(unittest.TestCase):
    def test_composer_matches_exact_isolated_candidate_and_pins_both_endpoints(self):
        sql=build_fictional_ssb_pair_api()
        self.assertEqual(sql,(ROOT/'research/pending/TF009_fictional_ssb_pair_api_v2.sql').read_text())
        self.assertIn(METADATA_URL,sql);self.assertIn(DATA_URL,sql)
        # LOGIN in an explanatory comment is not role provisioning.
        self.assertIsNone(re.search(r'(?im)^\s*(?:create|alter)\s+role\b',sql))

    def test_response_guard_copies_preserve_installed_native_check_bodies(self):
        sql=build_fictional_ssb_pair_api()
        for name in ('check_response_source_check','check_source_pair_run_binding','require_response_pair_context_binding'):
            original=(ROOT/'supabase/migrations/20261001104654_tf009_connected_capture_controls.sql').read_text()
            match=re.search(r'create function terra_private\.'+name+r'\(\).*?\$guard\$;',original,re.S)
            check=re.search(r'create function '+SCHEMA+r'\.'+name+r'\(\).*?\$guard\$;',sql,re.S)
            self.assertIsNotNone(check)
            # The adapter adds its principal gate before the original body.
            native=match.group().split('begin\n',1)[1]
            self.assertTrue(check.group().endswith(native))

    def test_internal_helpers_revoked_and_only_shadow_pending_pair_can_be_written(self):
        sql=build_fictional_ssb_pair_api()
        self.assertIn("r.mode<>'shadow'",sql)
        self.assertIn("'pending'",sql)
        self.assertNotIn('insert into terra_private.source_checkpoints',sql)
        self.assertNotIn('insert into terra_private.machine_candidate_decisions',sql)
        self.assertNotIn('insert into terra_private.issue_publications',sql)
        self.assertIn('revoke all on all functions in schema '+SCHEMA,sql)
        self.assertIn('primary key(principal,response_kind)',sql)
        self.assertIn('order by response_kind for no key update',sql)

    def test_native_pair_update_commit_event_is_preserved(self):
        sql=build_fictional_ssb_pair_api()
        self.assertIn('response_pair_context_binding_commit after insert or update on terra_private.source_response_pairs',sql)


if __name__=='__main__':unittest.main()
