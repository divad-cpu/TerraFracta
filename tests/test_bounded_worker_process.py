import subprocess
import sys
import time
import unittest
from workers.bounded_worker_process import BoundedWorkerError, communicate_bounded


class BoundedWorkerProcessTests(unittest.TestCase):
    def child(self, program):
        return subprocess.Popen([sys.executable, '-c', program], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True)

    def test_actual_round_trip_and_exact_boundary(self):
        worker = self.child('import sys; b=sys.stdin.buffer.read();sys.stdout.buffer.write(b);sys.stderr.buffer.write(b"ok")')
        result = communicate_bounded(worker, b'x' * 16384, max_stdout=16384, max_stderr=2)
        self.assertEqual((result.stdout, result.stderr, result.returncode), (b'x' * 16384, b'ok', 0))
        self.assertTrue(all(getattr(worker, name).closed for name in ('stdin', 'stdout', 'stderr')))

    def test_stdout_and_stderr_flood_are_bounded_and_child_reaped(self):
        for stream, cap in (('stdout', 16384), ('stderr', 1024)):
            worker = self.child('import sys,time;sys.stdin.buffer.read();sys.' + stream + '.buffer.write(b"x"*1000000);sys.' + stream + '.flush();time.sleep(10)')
            began = time.monotonic()
            with self.assertRaises(BoundedWorkerError):
                communicate_bounded(worker, b'{}', timeout=2)
            self.assertLess(time.monotonic() - began, 2)
            self.assertIsNotNone(worker.poll())
            self.assertTrue(all(getattr(worker, name).closed for name in ('stdin', 'stdout', 'stderr')))

    def test_deadline_and_pipe_eof_without_exit_kill_owned_child(self):
        for program in ('import time;time.sleep(10)',
                        'import os,time;os.close(0);os.close(1);os.close(2);time.sleep(10)'):
            worker = self.child(program)
            with self.assertRaises(BoundedWorkerError):
                communicate_bounded(worker, b'', timeout=.05)
            self.assertIsNotNone(worker.poll())

    def test_child_failure_is_returned_without_inventing_success(self):
        worker = self.child('import sys;sys.stdin.buffer.read();sys.stderr.write("synthetic failure");sys.exit(17)')
        result = communicate_bounded(worker, b'{}')
        self.assertEqual(result.returncode, 17)
        self.assertEqual(result.stderr, b'synthetic failure')

    def test_output_is_not_in_generic_error(self):
        worker = self.child('import sys;sys.stdin.buffer.read();sys.stdout.buffer.write(b"private-canary"*10000)')
        with self.assertRaises(BoundedWorkerError) as observed:
            communicate_bounded(worker, b'{}')
        self.assertNotIn('canary', str(observed.exception))

    def test_explicit_fixed_review_ceiling_preserves_default_and_deadline_cleanup(self):
        for options in ({'timeout':31}, {'timeout':46,'timeout_ceiling':45},
                        {'timeout_ceiling':True}, {'timeout_ceiling':31}, {'timeout_ceiling':60}):
            with self.subTest(options=options), self.assertRaises(BoundedWorkerError):
                communicate_bounded(None, b'', **options)
        worker=self.child('import sys;sys.stdin.buffer.read();sys.stdout.write("ok")')
        result=communicate_bounded(worker,b'',timeout=45,timeout_ceiling=45)
        self.assertEqual((result.stdout,result.returncode),(b'ok',0))
        worker=self.child('import time;time.sleep(10)')
        with self.assertRaises(BoundedWorkerError):
            communicate_bounded(worker,b'',timeout=.05,timeout_ceiling=45)
        self.assertIsNotNone(worker.poll())
        self.assertTrue(all(getattr(worker,name).closed for name in ('stdin','stdout','stderr')))


if __name__ == '__main__':
    unittest.main()
