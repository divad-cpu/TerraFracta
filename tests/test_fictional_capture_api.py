"""Guard against widening the isolated closed capture experiment while composing it."""
from pathlib import Path
import re
import unittest
from scripts.build_fictional_capture_api import build_capture_api
ROOT=Path(__file__).resolve().parents[1]


class ClosedCaptureCompositionTests(unittest.TestCase):
    def test_literal_candidate_equals_existing_guard_composition(self):
        self.assertEqual(build_capture_api(),(ROOT/'research/pending/TF009_fictional_capture_api.sql').read_text())

    def test_original_owner_functions_are_not_replaced_or_exported(self):
        candidate=build_capture_api()
        created=re.findall(r'^create function ([^(]+)',candidate,re.M)
        self.assertEqual(len(created),15)
        self.assertTrue(all(name.startswith('terra_capture_test_api.') for name in created))
        self.assertNotIn('create role ',candidate.lower())
        self.assertNotRegex(candidate.lower(),r'grant (?:execute|insert|update|delete|all)')
        self.assertNotIn('create or replace function terra_private.',candidate)

    def test_capture_api_stores_no_qualification_decision_or_publication(self):
        operation=(ROOT/'research/pending/TF009_fictional_capture_api_operations.sql').read_text()
        self.assertEqual(set(re.findall(r'insert into terra_private\.(\w+)',operation)),
            {'source_versions','update_run_source_checks','update_run_manifests'})
        self.assertIn("m->>'mode' is distinct from 'shadow'",operation)
        self.assertIn('Captured manifest differs from the trusted single-fixture plan',operation)
        self.assertIn('xmin<>pg_current_xact_id()::xid',operation)
        self.assertIn('revoke all on all functions in schema terra_capture_test_api',operation)


if __name__=='__main__':unittest.main()
