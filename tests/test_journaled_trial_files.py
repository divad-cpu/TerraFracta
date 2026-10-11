"""Actual filesystem boundary tests; no Docker, native write or source request."""
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch

from scripts import journaled_trial_files as files


class JournaledTrialFilesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name); self.root.chmod(0o700)
        self.original = self.root/'original'; self.original.mkdir(mode=0o700)
        for label, suffix, *_ in files.CASES:
            case = self.original/suffix; case.mkdir(mode=0o700)
            journal = case/'fixture-custodian-journal'; journal.mkdir(mode=0o700)
            for name in files.JOURNAL_NAMES: files.write_exact(journal/name, b'{}\n')
            if label == 'retained_nominal': files.write_exact(case/'RAW_POST_COMMIT_BINDING.json', b'{}\n')
            raw = case/'fixture-raw-store'; raw.mkdir(mode=0o700)
            if label != 'owned_cancellation':
                attempt = raw/('a'*32); attempt.mkdir(mode=0o700)
                for name in files.RAW_NAMES: files.write_exact(attempt/name, b'{"invented":true}\n')
        web = self.original/files.WEB; web.mkdir(mode=0o700)
        for name in ('START.json', 'FINISH.json'): files.write_exact(web/name, b'{}\n')
        self.selected = files.selected_files(lambda suffix:self.original/suffix, web)
        self.manifest = files.manifest_for(self.selected)

    def test_exact_copy_retains_empty_cancellation_and_originals(self):
        destination = self.root/'copy'
        restored = files.copy_selected(self.selected, self.manifest, destination)
        self.assertEqual(len(restored), 30)
        self.assertEqual(files.manifest_for(restored), self.manifest)
        self.assertEqual(files.manifest_for(self.selected), self.manifest)
        cancel = next(suffix for label, suffix, *_ in files.CASES if label == 'owned_cancellation')
        self.assertEqual(list((destination/cancel/'fixture-raw-store').iterdir()), [])
        self.assertEqual(list(destination.rglob('*.lock')), [])
        self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in restored.values()))

    def test_existing_destination_is_preserved_and_never_replaced(self):
        destination = self.root/'copy'; destination.mkdir(mode=0o700)
        files.write_exact(destination/'FAILED.json', b'{}\n')
        with self.assertRaises(FileExistsError): files.copy_selected(self.selected, self.manifest, destination)
        self.assertEqual((destination/'FAILED.json').read_bytes(), b'{}\n')

    def test_changed_source_fails_before_destination_creation(self):
        path = next(iter(self.selected.values())); path.write_bytes(b'{"changed":true}\n')
        destination = self.root/'copy'
        with self.assertRaises(ValueError): files.copy_selected(self.selected, self.manifest, destination)
        self.assertFalse(destination.exists())

    def test_symlink_and_additional_raw_pair_are_refused(self):
        path = next(iter(self.selected.values())); raw = path.read_bytes()
        path.unlink(); target = self.root/'outside.json'; files.write_exact(target, raw); path.symlink_to(target)
        with self.assertRaises((ValueError, OSError)): files.manifest_for(self.selected)
        path.unlink(); files.write_exact(path, raw)
        case = self.original/files.CASES[0][1]
        (case/'fixture-raw-store'/('b'*32)).mkdir(mode=0o700)
        with self.assertRaises(ValueError): files.selected_files(lambda suffix:self.original/suffix, self.original/files.WEB)

    def test_reopened_archive_rejects_tampered_bytes(self):
        destination = self.root/'copy'; copied = files.copy_selected(self.selected, self.manifest, destination)
        with patch.object(files, 'FILES_ARCHIVE', destination):
            self.assertEqual(files.archived_files()[1], self.manifest)
            next(iter(copied.values())).write_bytes(b'{"changed":true}\n')
            with self.assertRaises(ValueError): files.archived_files()

    def test_same_bytes_replacement_is_not_a_write_acknowledgement(self):
        path = self.root/'receipt.json'; original_read = files.private_read
        def replace_after_read(candidate, **kwargs):
            raw = original_read(candidate, **kwargs)
            replacement = self.root/'replacement.json'
            with replacement.open('xb') as stream: stream.write(raw)
            replacement.chmod(0o600); os.replace(replacement, candidate)
            return raw
        with patch.object(files, 'private_read', side_effect=replace_after_read):
            with self.assertRaises(ValueError): files.write_exact(path, b'{}\n')
        self.assertEqual(path.read_bytes(), b'{}\n')

    def test_new_raw_directory_during_copy_preserves_failed_copy(self):
        destination = self.root/'copy'; original_write = files.write_exact; changed = False
        def write_and_add(path, raw):
            nonlocal changed
            original_write(path, raw)
            if not changed:
                changed = True
                (self.original/files.CASES[0][1]/'fixture-raw-store'/('b'*32)).mkdir(mode=0o700)
        with patch.object(files, 'write_exact', side_effect=write_and_add):
            with self.assertRaises(ValueError): files.copy_selected(self.selected, self.manifest, destination)
        self.assertTrue(destination.is_dir())
        self.assertTrue(any(destination.rglob('*.json')))
        self.assertFalse((destination/'MANIFEST.json').exists())

    def test_source_namespace_change_during_final_hash_is_refused(self):
        destination = self.root/'copy'; original_check = files.rechecked_manifest
        original_read = files.private_read; checks = 0; changed = False
        def check(selected):
            nonlocal checks
            checks += 1
            return original_check(selected)
        def read_and_add(path, **kwargs):
            nonlocal changed
            raw = original_read(path, **kwargs)
            if checks == 2 and not changed and self.original in path.parents:
                changed = True
                (self.original/files.CASES[0][1]/'fixture-raw-store'/('b'*32)).mkdir(mode=0o700)
            return raw
        with patch.object(files, 'rechecked_manifest', side_effect=check), \
                patch.object(files, 'private_read', side_effect=read_and_add):
            with self.assertRaises(ValueError): files.copy_selected(self.selected, self.manifest, destination)
        self.assertTrue(changed)
        self.assertFalse((destination/'MANIFEST.json').exists())

    def test_destination_namespace_change_during_final_hash_is_refused(self):
        destination = self.root/'copy'; original_read = files.private_read
        original_check = files.rechecked_manifest; checks = 0; changed = False
        def check(selected):
            nonlocal checks
            checks += 1
            return original_check(selected)
        def read_and_add(path, **kwargs):
            nonlocal changed
            raw = original_read(path, **kwargs)
            if checks == 3 and not changed and destination in path.parents:
                changed = True
                (destination/files.CASES[0][1]/'fixture-raw-store'/('b'*32)).mkdir(mode=0o700)
            return raw
        with patch.object(files, 'rechecked_manifest', side_effect=check), \
                patch.object(files, 'private_read', side_effect=read_and_add):
            with self.assertRaises(ValueError): files.copy_selected(self.selected, self.manifest, destination)
        self.assertTrue(changed)
        self.assertFalse((destination/'MANIFEST.json').exists())


if __name__ == '__main__': unittest.main()
