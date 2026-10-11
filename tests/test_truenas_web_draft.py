"""Offline exact payload/context assembly; no image, NAS or server operation."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from scripts import prepare_truenas_web_draft as draft
from scripts import prepare_local_web_candidate as candidate
from tests import test_local_web_candidate as support


class TrueNasWebDraftTests(unittest.TestCase):
    def setUp(self):
        helper = support.LocalWebCandidateTests()
        helper.setUp()
        self.addCleanup(helper.doCleanups)
        helper.prepare()
        self.source = helper.destination
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.target = Path(self.temp.name) / 'draft'

    def prepare(self):
        return draft.prepare_draft(self.source, self.target)

    def reseal_inventory(self, edit):
        path = self.target / draft.MANIFEST
        saved = json.loads(path.read_bytes())
        inventory = draft._inventory(self.target, private=True)
        inventory['entries'] = [row for row in inventory['entries'] if row['path'] != draft.MANIFEST]
        inventory['bytes'] -= path.stat().st_size
        saved['inventory'] = inventory
        edit(saved)
        path.write_text(json.dumps(saved))

    def test_exact_payload_preserves_internal_links_notices_and_original_source(self):
        before = draft._inventory(self.source, private=True)
        saved = self.prepare()
        report = draft.verify_draft(self.target)
        self.assertEqual(draft._inventory(self.source, private=True), before)
        self.assertEqual(draft._inventory(self.target / 'payload', private=True), before)
        self.assertEqual(report['links'], 1)
        for name in draft.FALSE_FIELDS:
            self.assertIs(saved[name], False)
        self.assertIsNone(saved['selectedNasVersion'])
        self.assertIsNone(saved['baseImageReference'])
        self.assertFalse(report['filesExecuted'])
        self.assertEqual(os.readlink(self.target / 'payload/node_modules/alias'), 'example')

    def test_actual_compose_parser_keeps_loopback_nonroot_readonly_and_no_build_or_mounts(self):
        self.prepare()
        result = subprocess.run(['/usr/bin/docker', 'compose', '--env-file', '/dev/null', '-f', str(self.target / 'compose.yaml'),
                                 'config', '--format', 'json'], capture_output=True, text=True, check=True)
        service = json.loads(result.stdout)['services']['web']
        self.assertEqual(service['ports'][0]['host_ip'], '127.0.0.1')
        self.assertEqual(service['ports'][0]['target'], 3210)
        self.assertEqual(service['user'], '1000:1000')
        self.assertIs(service['read_only'], True)
        self.assertEqual(service['pull_policy'], 'never')
        self.assertNotIn('build', service)
        self.assertNotIn('volumes', service)
        self.assertNotIn('environment', service)
        self.assertNotIn('privileged', service)
        self.assertNotIn('network_mode', service)
        self.assertEqual(service['cap_drop'], ['ALL'])
        self.assertEqual(service['mem_limit'], '536870912')

    def test_opaque_build_identity_always_yields_a_valid_bounded_image_tag(self):
        # Next build identities and Docker tags have different external grammars.
        seen = set()
        for identity in ('-invented-build', '-' + 'a' * 127, 'a' * 128, '_',
                         '5gdNDgquFlIciUtKyy_O-'):
            with self.subTest(identity=identity):
                image = json.loads(draft.compose(identity))['services']['web']['image']
                repository, tag = image.rsplit(':', 1)
                self.assertEqual(repository, 'terrafracta-private-preview')
                self.assertIsNotNone(re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}', tag))
                self.assertNotIn(tag, seen)
                seen.add(tag)
                self.assertEqual(draft.compose(identity), draft.compose(identity))
                self.assertIn(json.dumps(identity).encode(), draft.entrypoint(identity))

    def test_existing_destination_and_source_overlap_keep_user_evidence(self):
        self.target.mkdir(mode=0o700)
        kept = self.target / 'kept'
        kept.write_bytes(b'original')
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual(kept.read_bytes(), b'original')
        with self.assertRaises(ValueError):
            draft.prepare_draft(self.source, self.source / 'nested-draft')
        self.assertFalse((self.source / 'nested-draft').exists())

    def test_bad_source_refuses_before_any_destination_or_private_body_copy(self):
        private = self.source / '.env.private'
        private.write_bytes(b'invented-private-canary')
        original = candidate._body
        with patch.object(candidate, '_body', side_effect=lambda path: (_ for _ in ()).throw(
                AssertionError('Private file opened')) if path == private else original(path)):
            with self.assertRaises(ValueError) as error:
                self.prepare()
        self.assertNotIn('invented-private-canary', str(error.exception))
        self.assertFalse(self.target.exists())

    def test_source_change_during_copy_retains_partial_without_completed_receipt(self):
        original = draft._copy_tree
        def copy(source, destination, **kwargs):
            result = original(source, destination, **kwargs)
            (self.source / 'server.js').write_bytes(b'changed invented server')
            return result
        with patch.object(draft, '_copy_tree', side_effect=copy), self.assertRaises(ValueError):
            self.prepare()
        self.assertTrue((self.target / 'payload/server.js').exists())
        self.assertFalse((self.target / draft.MANIFEST).exists())

    def test_self_consistent_control_changes_cannot_grant_lan_or_runtime_authority(self):
        self.prepare()
        path = self.target / 'compose.yaml'
        body = json.loads(path.read_bytes())
        body['services']['web']['ports'][0]['host_ip'] = '0.0.0.0'
        path.write_text(json.dumps(body))
        self.reseal_inventory(lambda saved: None)
        with self.assertRaisesRegex(ValueError, 'control differs'):
            draft.verify_draft(self.target)
        path.write_bytes(draft.compose('invented-build'))
        self.reseal_inventory(lambda saved: saved.update(runtime_enabled=True))
        with self.assertRaisesRegex(ValueError, 'held NAS draft'):
            draft.verify_draft(self.target)

    def test_unknown_duplicate_fields_and_selected_image_or_version_remain_refused(self):
        self.prepare()
        path = self.target / draft.MANIFEST
        original = path.read_bytes()
        for field, value in (('selectedNasVersion', '25.10.7'), ('baseImageReference', 'node:latest'),
                             ('unknown', 'extra'), ('imageBuilt', 0), ('schemaVersion', True)):
            saved = json.loads(original)
            saved[field] = value
            path.write_text(json.dumps(saved))
            with self.assertRaises(ValueError):
                draft.verify_draft(self.target)
        path.write_bytes(original[:-2] + b', "schemaVersion":1}\n')
        with self.assertRaises(ValueError):
            draft.verify_draft(self.target)

    def test_payload_tampering_outside_link_and_nonprivate_modes_remain_preserved(self):
        self.prepare()
        server = self.target / 'payload/server.js'
        original = server.read_bytes()
        server.write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            draft.verify_draft(self.target)
        server.write_bytes(original)
        entry = self.target / 'entrypoint.cjs'
        entry.chmod(0o644)
        with self.assertRaises(ValueError):
            draft.verify_draft(self.target)
        entry.chmod(0o600)
        link = self.target / 'payload/node_modules/alias'
        link.unlink()
        link.symlink_to('/etc')
        with self.assertRaises(ValueError):
            draft.verify_draft(self.target)
        self.assertEqual(os.readlink(link), '/etc')

    def test_verifier_needs_no_original_packet_or_program_execution(self):
        self.prepare()
        moved = self.source.with_name('original-kept')
        self.source.rename(moved)
        with patch.object(subprocess, 'run', side_effect=AssertionError('Program started')):
            report = draft.verify_draft(self.target)
        self.assertEqual(report['buildId'], 'invented-build')
        self.assertFalse(report['imageBuilt'])


if __name__ == '__main__':
    unittest.main()
