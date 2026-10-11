from pathlib import Path
import re
import unittest
from scripts.build_fictional_publication_api import build_publication_api
ROOT=Path(__file__).resolve().parents[1]


class QualifiedFixtureApiTests(unittest.TestCase):
    def test_literal_candidate_reconciles_to_existing_guard_composition(self):
        self.assertEqual(build_publication_api(),(ROOT/'research/pending/TF009_fictional_publication_api.sql').read_text())

    def test_publication_fixture_has_no_untrusted_control_input_or_runtime_grant(self):
        body=build_publication_api()
        self.assertEqual(len(re.findall(r'^create function ',body,re.M)),20)
        self.assertIn("check(scope='fictional-activation-country')",body)
        self.assertIn('trusted_fixture jsonb not null',body)
        for name in ('stage_decision','stage_publication','activate_fact','read_fact'):
            self.assertIn('create function terra_publication_test_api.'+name+'()',body)
        self.assertNotIn('create role ',body.lower())
        self.assertNotRegex(body.lower(),r'grant (?:execute|insert|update|delete|all)')
        self.assertIn("to_char(transaction_timestamp() at time zone 'UTC'",body)
        self.assertIn("case when public_use_allowed then 'eligible' else 'held' end",body)

if __name__=='__main__':unittest.main()
