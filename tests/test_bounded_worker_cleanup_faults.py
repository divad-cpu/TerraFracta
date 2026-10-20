"""Owned cleanup fault coverage uses invented objects, never child processes."""
import subprocess
import unittest
from unittest.mock import patch
from workers.bounded_worker_process import BoundedWorkerError, communicate_bounded


class Stream:
    def __init__(self, name, attempts, fault=None):
        self.name=name; self.attempts=attempts; self.fault=fault; self.closed=False
    def fileno(self): return 10
    def close(self):
        self.attempts.append(self.name)
        if self.fault is not None: raise self.fault
        self.closed=True


class Process:
    def __init__(self, phase=None, fault=None, close_fault=None):
        self.phase=phase; self.fault=fault; self.kills=0; self.waits=[]; self.polls=0
        self.attempts=[]; self.returncode=None
        for name in ('stdin','stdout','stderr'):
            setattr(self,name,Stream(name,self.attempts,close_fault if name=='stdin' else None))
    def poll(self):
        self.polls+=1
        if self.phase=='poll': raise self.fault
        return self.returncode
    def kill(self):
        self.kills+=1
        if self.phase=='kill': raise self.fault
    def wait(self, timeout):
        self.waits.append(timeout)
        if self.phase=='wait': raise self.fault
        if self.phase!='unknown': self.returncode=-9
        return self.returncode


class BoundedWorkerCleanupFaultTests(unittest.TestCase):
    def invoke(self, process, clock_fault=None):
        clock={'side_effect':clock_fault} if clock_fault is not None else {'return_value':float('nan')}
        with patch('workers.bounded_worker_process.time.monotonic',**clock):
            try: communicate_bounded(process,b'')
            except BaseException as error: return error
        self.fail('The rejected operation must not return output')
    def assert_attempts(self, process):
        self.assertEqual(process.attempts,['stdin','stdout','stderr'])
        self.assertTrue(process.stdout.closed and process.stderr.closed)
    def assert_cleanup_refusal(self, error):
        self.assertIs(type(error),BoundedWorkerError)
        self.assertEqual(str(error),'Private process cleanup unavailable')

    def test_cleanup_wait_timeout_still_closes_all_pipes_and_keeps_exit_unknown(self):
        process=Process('wait',subprocess.TimeoutExpired('invented-private-command',5))
        error=self.invoke(process)
        self.assert_attempts(process); self.assert_cleanup_refusal(error)
        self.assertEqual(process.kills,1); self.assertEqual(process.waits,[5])
        self.assertIsNone(process.returncode)

    def test_poll_and_kill_faults_still_attempt_every_close_with_fixed_refusal(self):
        for phase in ('poll','kill'):
            with self.subTest(phase=phase):
                process=Process(phase,OSError('fictional-private-canary'))
                error=self.invoke(process)
                self.assert_attempts(process); self.assert_cleanup_refusal(error)
                self.assertIsNone(process.returncode)

    def test_close_fault_does_not_skip_other_pipes(self):
        process=Process(close_fault=OSError('fictional-close-canary'))
        error=self.invoke(process)
        self.assert_attempts(process); self.assert_cleanup_refusal(error)
        self.assertFalse(process.stdin.closed); self.assertEqual(process.returncode,-9)

    def test_wait_return_without_confirmed_exit_is_not_cleanup_success(self):
        process=Process('unknown')
        error=self.invoke(process)
        self.assert_attempts(process); self.assert_cleanup_refusal(error)
        self.assertIsNone(process.returncode)

    def test_normal_cleanup_preserves_original_generic_operation_failure(self):
        process=Process(); error=self.invoke(process)
        self.assert_attempts(process)
        self.assertIs(type(error),BoundedWorkerError)
        self.assertEqual(str(error),'Private process unavailable or outside its bounds')
        self.assertEqual(process.returncode,-9)

    def test_original_cancellation_survives_cleanup_fault_and_all_closes_attempted(self):
        for cancellation in (KeyboardInterrupt('invented-cancel'),SystemExit(7)):
            with self.subTest(kind=type(cancellation).__name__):
                process=Process('wait',subprocess.TimeoutExpired('invented',5))
                error=self.invoke(process,cancellation)
                self.assertIs(error,cancellation); self.assert_attempts(process)
                self.assertIsNone(process.returncode)

    def test_cancellation_during_cleanup_still_closes_remaining_streams(self):
        cancellation=KeyboardInterrupt('invented-close-cancel')
        process=Process(close_fault=cancellation)
        error=self.invoke(process)
        self.assertIs(error,cancellation); self.assert_attempts(process)

    def test_handled_caller_cancellation_cannot_suppress_this_operations_cleanup_failure(self):
        class EmptySelector:
            def __enter__(self): return self
            def __exit__(self,*_): return None
            def register(self,*_): pass
            def get_map(self): return {}
        for cancellation in (KeyboardInterrupt('handled-outer'),SystemExit(9)):
            with self.subTest(kind=type(cancellation).__name__):
                process=Process()
                process.stdout.fault=OSError('fictional-current-close-canary')
                with patch('workers.bounded_worker_process.time.monotonic',return_value=0), \
                        patch('workers.bounded_worker_process.selectors.DefaultSelector',return_value=EmptySelector()), \
                        patch('workers.bounded_worker_process.os.set_blocking'):
                    try:
                        raise cancellation
                    except BaseException:
                        with self.assertRaises(BoundedWorkerError) as caught:
                            communicate_bounded(process,b'invented')
                self.assert_cleanup_refusal(caught.exception)
                self.assertEqual(process.attempts,['stdin','stdout','stderr'])
                self.assertTrue(process.stdin.closed and process.stderr.closed)
                self.assertFalse(process.stdout.closed)
                self.assertEqual(process.kills,0)
                self.assertEqual(len(process.waits),1)


if __name__=='__main__': unittest.main()
