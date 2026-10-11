"""Fixed metadata-only copy inspection cannot issue complete-copy authority."""
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import audit_raw_copy_scope as policy
from scripts import inspect_current_copy_scope as current


class CurrentCopyScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root / 'backup.json'
        self.body = b'{"btrfs_mode":"false","exclude":["/home/*/**"],"secret":"private-canary"}'
        self.config.write_bytes(self.body); self.config.chmod(0o600)

    def test_actual_regular_read_is_exact_and_output_redacts_body_path_hash_and_grants(self):
        self.assertEqual(policy.read_copy_policy(self.config), self.body)
        with patch.object(policy, 'TIMESHIFT', self.config), patch.object(policy, 'RCLONE', self.root/'absent'):
            result = current.build_observation(policy.observe_copy_policy(), now=datetime.now(timezone.utc))
        self.assertEqual(result['backupExclusion'], 'observed'); self.assertEqual(result['syncSetup'], 'not_found')
        for key in ('allCopyPathsVerified', 'credentialFilesRead', 'rawBodiesRead', 'configurationChanged', 'collectionPermissionIssued', 'publicationEnabled'):
            self.assertIs(result[key], False)
        for value in ('private-canary', str(self.root), 'policySha256', '/home/*'):
            self.assertNotIn(value, json.dumps(result))

    def test_symlink_hardlink_fifo_directory_and_unsafe_permissions_are_refused(self):
        symbolic = self.root/'symbolic'; symbolic.symlink_to(self.config)
        hard = self.root/'hard'; os.link(self.config, hard)
        fifo = self.root/'fifo'; os.mkfifo(fifo, 0o600)
        for path in (symbolic, hard, fifo, self.root):
            with self.subTest(path=path.name), self.assertRaises((OSError, ValueError)):
                policy.read_copy_policy(path)
        hard.unlink(); self.config.chmod(0o622)
        with self.assertRaises(ValueError): policy.read_copy_policy(self.config)

    def test_oversize_short_and_replaced_entry_fail_without_returning_bytes(self):
        for body in (b'x', b' ' * 131073):
            self.config.write_bytes(body)
            with self.assertRaises(ValueError): policy.read_copy_policy(self.config)
        self.config.write_bytes(self.body)
        read = os.read
        def replace(descriptor, limit):
            raw = read(descriptor, limit)
            old = self.root/'old'; self.config.rename(old); self.config.write_bytes(self.body); self.config.chmod(0o600)
            return raw
        with patch.object(policy.os, 'read', side_effect=replace), self.assertRaises(ValueError):
            policy.read_copy_policy(self.config)

    def test_sync_presence_never_opens_credential_entry_including_symlink_and_directory(self):
        credential = self.root/'credentials'; credential.write_text('private-canary')
        symbolic = self.root/'sync'; symbolic.symlink_to(credential)
        opened = []; actual = os.open
        def record(path, *args, **kwargs):
            opened.append(Path(path)); return actual(path, *args, **kwargs)
        for entry in (credential, symbolic, self.root):
            with patch.object(policy, 'TIMESHIFT', self.config), patch.object(policy, 'RCLONE', entry), patch.object(policy.os, 'open', side_effect=record):
                self.assertEqual(policy.observe_copy_policy()['syncSetup'], 'present')
        self.assertEqual(opened, [self.config]*3)

    def test_unavailable_sync_entry_is_distinct_from_absence_and_unsupported_backup_stays_held(self):
        self.config.write_text('{"btrfs_mode":"true","exclude":["/home/*/**"]}')
        actual = Path.lstat
        def denied(path, *args, **kwargs):
            if path == self.root/'denied': raise PermissionError('private-canary')
            return actual(path, *args, **kwargs)
        with patch.object(policy, 'TIMESHIFT', self.config), patch.object(policy, 'RCLONE', self.root/'denied'), patch.object(Path, 'lstat', denied):
            self.assertEqual(policy.observe_copy_policy(), {'backupExclusion':'not_established', 'syncSetup':'unavailable'})

    def test_unknown_fields_coercions_and_naive_time_are_refused(self):
        good = {'backupExclusion':'observed', 'syncSetup':'present'}
        for value in ({**good, 'privatePath':'canary'}, {**good, 'backupExclusion':True}, {**good, 'syncSetup':'verified'}):
            with self.assertRaises(ValueError): current.build_observation(value, now=datetime.now(timezone.utc))
        with self.assertRaises(ValueError): current.build_observation(good, now=datetime.now())

    def test_selectors_refuse_before_any_read_and_failures_withhold_private_diagnostics(self):
        with patch.object(current.sys, 'argv', ['observer', '--root', 'canary']), patch.object(current, 'observe_copy_policy') as observe, patch('sys.stderr', io.StringIO()):
            self.assertEqual(current.main(), 2); observe.assert_not_called()
        with patch.object(current.sys, 'argv', ['observer']), patch.object(current, 'observe_copy_policy', side_effect=OSError('private-canary')), patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(current.main(), 0)
            self.assertEqual(json.loads(output.getvalue()), {'state':'held', 'reason':'copy_observation_unavailable'})


if __name__ == '__main__': unittest.main()
