import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import unittest

from scripts.fictional_trial_guard import trial_process_lock,FictionalTrialBusy,fixed_trial_guard,FictionalTrialInterrupted


class TrialGuardTests(unittest.TestCase):
    def setUp(self):self.scratch=tempfile.TemporaryDirectory(prefix='tf-trial-guard-');self.addCleanup(self.scratch.cleanup);self.directory=Path(self.scratch.name)/'store'
    def test_existing_empty_lock_is_preserved_and_reopens_with_private_modes(self):
        with trial_process_lock(self.directory):
            self.assertEqual(stat.S_IMODE(self.directory.stat().st_mode),0o700)
            self.assertEqual(stat.S_IMODE((self.directory/'process.lock').stat().st_mode),0o600)
            self.assertEqual((self.directory/'process.lock').read_bytes(),b'')
        inode=(self.directory/'process.lock').stat().st_ino
        with trial_process_lock(self.directory):self.assertEqual((self.directory/'process.lock').stat().st_ino,inode)
    def test_another_actual_process_is_refused_then_can_acquire_after_release(self):
        code='from scripts.fictional_trial_guard import trial_process_lock; from pathlib import Path; import sys\nwith trial_process_lock(Path(sys.argv[1])):print("acquired")'
        with trial_process_lock(self.directory):
            refused=subprocess.run([sys.executable,'-c',code,str(self.directory)],capture_output=True,text=True,timeout=5)
            self.assertNotEqual(refused.returncode,0);self.assertNotIn('acquired',refused.stdout)
        allowed=subprocess.run([sys.executable,'-c',code,str(self.directory)],capture_output=True,text=True,timeout=5)
        self.assertEqual(allowed.returncode,0);self.assertEqual(allowed.stdout.strip(),'acquired')
    def test_symlink_broad_modes_or_unexpected_content_are_refused_without_mutation(self):
        for case in ('symlink_directory','directory_mode','symlink_lock','lock_mode','lock_content'):
            with self.subTest(case=case),tempfile.TemporaryDirectory(prefix='tf-guard-bad-') as scratch:
                root=Path(scratch)/'store';root.mkdir(mode=0o700);lock=root/'process.lock'
                if case=='symlink_directory':root.rename(Path(scratch)/'target');root.symlink_to(Path(scratch)/'target',target_is_directory=True)
                elif case=='directory_mode':root.chmod(0o755)
                elif case=='symlink_lock':(Path(scratch)/'target').write_bytes(b'');lock.symlink_to(Path(scratch)/'target')
                elif case=='lock_mode':lock.write_bytes(b'');lock.chmod(0o644)
                elif case=='lock_content':lock.write_bytes(b'kept-canary');lock.chmod(0o600)
                with self.assertRaises((RuntimeError,OSError)),trial_process_lock(root):self.fail('Invalid lock accepted')
                if case=='lock_content':self.assertEqual(lock.read_bytes(),b'kept-canary')
    def test_interrupt_guard_restores_signal_handler_and_runs_cleanup(self):
        # Exercise the installed handler without signaling another process.
        from unittest.mock import patch
        previous=signal.getsignal(signal.SIGTERM);cleaned=[]
        with patch('scripts.fictional_trial_guard.trial_process_lock',lambda:trial_process_lock(self.directory)):
            with self.assertRaises(FictionalTrialInterrupted):
                with fixed_trial_guard():
                    try:signal.getsignal(signal.SIGTERM)(signal.SIGTERM,None)
                    finally:cleaned.append(True)
        self.assertEqual(cleaned,[True]);self.assertEqual(signal.getsignal(signal.SIGTERM),previous)
        with trial_process_lock(self.directory):pass


if __name__=='__main__':unittest.main()
