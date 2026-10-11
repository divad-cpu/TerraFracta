from hashlib import sha256
import json
from pathlib import Path
import re
import unittest
ROOT=Path(__file__).resolve().parents[1]/'research/pending'


class ConnectedBundleTests(unittest.TestCase):
    def test_component_hashes_and_literal_sql_reconcile(self):
        manifest=json.loads((ROOT/'TF009_local_connected_capture_bundle.manifest.json').read_text())
        body=(ROOT/manifest['bundleFile']).read_bytes()
        self.assertEqual(sha256(body).hexdigest(),manifest['bundleSha256'])
        for row in manifest['files']:
            component=(ROOT/row['path']).read_bytes()
            self.assertEqual(sha256(component).hexdigest(),row['sha256'])
            self.assertIn(component,body)

    def test_runtime_identity_and_previous_proposal_are_not_widened(self):
        manifest=json.loads((ROOT/'TF009_local_connected_capture_bundle.manifest.json').read_text())
        body=(ROOT/manifest['bundleFile']).read_text()
        self.assertEqual(len(re.findall(r'^create table ',body,re.M)),5)
        self.assertEqual(len(re.findall(r'^create (?:or replace )?function ',body,re.M)),21)
        self.assertEqual(len(re.findall(r'^create (?:constraint )?trigger ',body,re.M)),20)
        self.assertNotIn('security definer',body.lower())
        self.assertNotIn('terra_capture_test_api',body)
        old=json.loads((ROOT/'TF009_local_capture_visibility_bundle.manifest.json').read_text())
        self.assertEqual(sha256((ROOT/'TF009_local_capture_visibility_bundle.sql').read_bytes()).hexdigest(),old['bundleSha256'])
        self.assertFalse(manifest['runtimeGrants'])
        self.assertIn('after insert or update on terra_private.source_response_pairs',body)

if __name__=='__main__':unittest.main()
