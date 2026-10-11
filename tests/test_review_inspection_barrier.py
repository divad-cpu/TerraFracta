"""A truly unconfirmed owned worker blocks subsequent common native trials."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import fictional_trial_guard as guard


class ReviewInspectionBarrierTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.directory=Path(self.temp.name)/'private-guard'

    def test_recorded_barrier_is_private_fsynced_and_blocks_later_common_guard_without_reset(self):
        with guard.trial_process_lock(self.directory):
            self.assertTrue(guard.record_review_inspection_barrier('d'*64,1971,'supervised-correction-review-20261003110000_abcdef',directory=self.directory))
        target=self.directory/guard.INSPECTION_REQUIRED;original=target.read_bytes()
        self.assertEqual(target.stat().st_mode&0o777,0o600)
        with self.assertRaises(guard.FictionalTrialInspectionRequired),guard.trial_process_lock(self.directory):
            self.fail('A later native trial acquired the shared guard')
        self.assertEqual(target.read_bytes(),original)
        with self.assertRaises(FileExistsError):
            guard.record_review_inspection_barrier('e'*64,1972,'supervised-correction-review-20261003110000_bcdefa',directory=self.directory)
        self.assertEqual(target.read_bytes(),original)

    def test_failed_file_sync_keeps_partial_marker_and_still_blocks_without_promoting_durability(self):
        with guard.trial_process_lock(self.directory),patch.object(guard.os,'fsync',side_effect=OSError('Invented fsync refusal')):
            with self.assertRaises(OSError):guard.record_review_inspection_barrier('d'*64,1971,'supervised-correction-review-20261003110000_abcdef',directory=self.directory)
        with self.assertRaises(guard.FictionalTrialInspectionRequired),guard.trial_process_lock(self.directory):pass

    def test_any_existing_malformed_linked_directory_or_unreadable_marker_refuses_without_following(self):
        for kind in ('malformed','unreadable','symlink','directory'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as scratch:
                directory=Path(scratch)/'store'
                with guard.trial_process_lock(directory):pass
                path=directory/guard.INSPECTION_REQUIRED
                if kind=='directory':path.mkdir(mode=0o700)
                elif kind=='symlink':path.symlink_to(Path(scratch)/'not-opened')
                else:path.write_bytes(b'private-canary');path.chmod(0 if kind=='unreadable' else 0o600)
                with self.assertRaises(guard.FictionalTrialInspectionRequired),guard.trial_process_lock(directory):pass
                self.assertTrue(path.is_symlink() or path.exists())

    def test_bad_owned_context_cannot_create_a_marker(self):
        with guard.trial_process_lock(self.directory):
            for values in (('primary',1971,'supervised-correction-review-20261003110000_abcdef'),
                           ('d'*64,True,'supervised-correction-review-20261003110000_abcdef'),
                           ('d'*64,1971,'../../other')):
                with self.subTest(values=values),self.assertRaises(ValueError):
                    guard.record_review_inspection_barrier(*values,directory=self.directory)
        self.assertFalse((self.directory/guard.INSPECTION_REQUIRED).exists())


if __name__=='__main__':unittest.main()
