"""Local invented commands only: lifetime, no fallback and redacted startup."""
import errno
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from workers.bounded_native_client import BoundedNativeClient
from workers.native_parent_guard import _launch, _ordinary_executable, main, native_parent_command
from workers.private_pair_native_sql import private_admission_sql

ROOT = Path(__file__).resolve().parents[1]
SLEEPER = ('import json,os,sys,time; '
    'f=open(sys.argv[1],"x"); json.dump({"pid":os.getpid(),"parent":os.getppid()},f); f.close(); time.sleep(3)')

# The separate supervisor adopts only its own descendants. It always waits for
# their finite sleepers and never searches for or signals unrelated processes.
SUPERVISOR = r'''
import ctypes,json,os,pathlib,signal,subprocess,sys,time
root,marker,guard=sys.argv[1:]
if ctypes.CDLL(None).prctl(36,1,0,0,0) != 0: raise RuntimeError('Subreaper unavailable')
code="""
import sys
sys.path.insert(0,sys.argv[1])
from workers.bounded_native_client import BoundedNativeClient
from workers.private_pair_native_sql import private_admission_sql
child='import json,os,sys,time; f=open(sys.argv[1],"x"); json.dump({"pid":os.getpid(),"parent":os.getppid()},f); f.close(); time.sleep(3)'
client=BoundedNativeClient((sys.executable,'-I','-S','-B','-c',child,sys.argv[2]),timeout=4,parent_lifetime=sys.argv[3]=='1')
client(private_admission_sql())
"""
parent=subprocess.Popen((sys.executable,'-I','-S','-B','-c',code,root,marker,guard),
    stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={},close_fds=True)
child=None;reaped=False
try:
    deadline=time.monotonic()+2
    while not pathlib.Path(marker).exists() and time.monotonic()<deadline: time.sleep(.01)
    witness=json.loads(pathlib.Path(marker).read_text())
    if witness['parent'] != parent.pid: raise RuntimeError('Owned ancestry mismatch')
    child=witness['pid']
    parent.kill();parent.wait(timeout=3)
    deadline=time.monotonic()+.5
    while time.monotonic()<deadline:
        exited,status=os.waitpid(child,os.WNOHANG)
        if exited:
            reaped=True;break
        time.sleep(.01)
    if guard=='1':
        assert reaped and os.WIFSIGNALED(status) and os.WTERMSIG(status)==signal.SIGKILL
    else:
        assert not reaped, 'Legacy control should survive the creating parent'
    print(json.dumps({'guard':guard=='1','promptChildExit':reaped,'ownedParentReaped':True}))
finally:
    if parent.poll() is None: parent.kill()
    parent.wait(timeout=3)
    for stream in (parent.stdout,parent.stderr): stream.close()
    # Finite local children also exit on a failed assertion/startup. Reap only
    # this supervisor's own children; no borrowed PID or discovery/takeover.
    deadline=time.monotonic()+4
    while time.monotonic()<deadline:
        try:
            pid,_=os.waitpid(-1,os.WNOHANG)
            if not pid: time.sleep(.01)
        except ChildProcessError: break
    else: raise RuntimeError('Owned test descendants not reaped')
'''


class NativeParentGuardTests(unittest.TestCase):
    def test_guard_is_explicit_and_configuration_is_strict(self):
        self.assertFalse(BoundedNativeClient(('/bin/false',)).parent_lifetime_requested)
        self.assertTrue(BoundedNativeClient(('/bin/false',), parent_lifetime=True).parent_lifetime_requested)
        for value in (1, None, 'true'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                BoundedNativeClient(('/bin/false',), parent_lifetime=value)

    def test_command_binds_current_creating_thread_without_sql_or_credentials(self):
        command = native_parent_command(('/bin/false', 'fixed'))
        self.assertEqual(command[:4], (sys.executable, '-I', '-S', '-B'))
        self.assertEqual(command[5:7], (str(os.getpid()), str(threading.get_native_id())))
        self.assertEqual(command[7:], ('/bin/false', 'fixed'))
        self.assertEqual(Path(command[4]), ROOT / 'workers/native_parent_guard.py')

    def test_unsupported_guard_holds_before_launch_and_never_falls_back(self):
        client = BoundedNativeClient(('/bin/false',), parent_lifetime=True)
        with patch('workers.native_parent_guard.sys.platform', 'unsupported'), \
                patch('workers.bounded_native_client.subprocess.Popen') as launch:
            with self.assertRaises(ValueError): client(private_admission_sql())
            self.assertEqual(launch.call_count, 0); self.assertEqual(client.calls, 0)
            self.assertTrue(client.closed); self.assertTrue(client.cleanup_confirmed)

    def test_both_native_paths_use_the_exact_guarded_command(self):
        for retained in (False, True):
            with self.subTest(retained=retained):
                client = BoundedNativeClient(('/bin/false',), parent_lifetime=True)
                with patch('workers.bounded_native_client.native_parent_command', return_value=('/fixed/guard',)) as guard, \
                        patch('workers.bounded_native_client.subprocess.Popen', side_effect=OSError('private-start-canary')) as launch:
                    with self.assertRaises(ValueError) as error:
                        if retained: client.store_pair_transaction(lambda _raw: None)
                        else: client(private_admission_sql())
                    self.assertNotIn('canary', str(error.exception)); guard.assert_called_once_with(('/bin/false',))
                    self.assertEqual(launch.call_args.args[0], ('/fixed/guard',))
                    self.assertEqual(launch.call_args.kwargs['env'], {})

    def test_privilege_changing_or_uninspectable_exec_is_refused(self):
        for mode in (stat.S_IFDIR | 0o755, stat.S_IFREG | 0o4755, stat.S_IFREG | 0o2755):
            with self.subTest(mode=mode), patch('workers.native_parent_guard.os.stat', return_value=type('Entry', (), {'st_mode': mode})()):
                with self.assertRaises(ValueError): _ordinary_executable('/fixed')
        with patch('workers.native_parent_guard.os.stat', return_value=type('Entry', (), {'st_mode': stat.S_IFREG | 0o755})()):
            for result in (b'capability', OSError(errno.EACCES, 'private-capability-canary')):
                with self.subTest(result=type(result).__name__), patch('workers.native_parent_guard.os.getxattr', **(
                        {'side_effect': result} if isinstance(result, Exception) else {'return_value': result})):
                    with self.assertRaises(ValueError): _ordinary_executable('/fixed')
            with patch('workers.native_parent_guard.os.getxattr', side_effect=OSError(errno.ENODATA, 'absent')):
                _ordinary_executable('/fixed')

    def test_bad_startup_or_lost_creating_thread_does_not_exec(self):
        for args in ((), ('1', '2', '/bin/false'), ('2', '2', 'relative'), ('2', '٢', '/bin/false')):
            with self.subTest(args=args), patch('workers.native_parent_guard.os.execve') as execute:
                with self.assertRaises(ValueError): _launch(args)
                execute.assert_not_called()
        with patch('workers.native_parent_guard.Path.is_dir', side_effect=(True, False)), \
                patch('workers.native_parent_guard._ordinary_executable'), \
                patch('workers.linux_parent_lifetime.arm_parent_lifetime'), \
                patch('workers.native_parent_guard.os.execve') as execute:
            with self.assertRaises(ValueError): _launch(('2', '2', '/bin/false'))
            execute.assert_not_called()

    def test_startup_failures_emit_only_the_fixed_diagnostic(self):
        import io
        output = io.StringIO()
        with patch('workers.native_parent_guard._launch', side_effect=OSError('private-startup-canary')), \
                patch('workers.native_parent_guard.sys.stderr', output):
            self.assertEqual(main(), 1)
        self.assertEqual(output.getvalue(), 'Native parent lifetime unavailable\n')

    def test_actual_ordinary_exec_preserves_stdin_without_ambient_credentials(self):
        client = BoundedNativeClient((sys.executable, '-I', '-S', '-B', '-c',
            'import json,os,sys; data=sys.stdin.buffer.read(); print(json.dumps({"input":data.decode(),"ambient":os.environ.get("TERRA_GUARD_CANARY")}))'),
            stdin_prefix=b'invented-prefix\n', parent_lifetime=True)
        # Python may add LC_CTYPE itself. Check the inherited credential canary
        # and exact input; the Popen/exec tests separately bind the empty env.
        with patch.dict(os.environ, {'TERRA_GUARD_CANARY': 'invented-parent-canary'}):
            reply = client(private_admission_sql())
        self.assertEqual(json.loads(reply.stdout), {'input': 'invented-prefix\n' + private_admission_sql(), 'ambient': None})
        self.assertFalse(client.active)
        client.cancel(); self.assertTrue(client.cleanup_confirmed)

    def test_actual_creating_thread_exit_terminates_child_while_parent_survives(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'marker.json'; owned = []; errors = []
            def create():
                try:
                    process = subprocess.Popen(native_parent_command((sys.executable, '-I', '-S', '-B', '-c', SLEEPER, str(marker))),
                        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={}, close_fds=True)
                    owned.append(process)
                    deadline = time.monotonic() + 2
                    while not marker.exists() and time.monotonic() < deadline: time.sleep(.01)
                    if not marker.exists(): raise RuntimeError('Invented child did not start')
                except Exception as error: errors.append(type(error).__name__)
            thread = threading.Thread(target=create); thread.start(); thread.join(3)
            try:
                self.assertFalse(thread.is_alive()); self.assertEqual(errors, []); self.assertEqual(len(owned), 1)
                self.assertEqual(owned[0].wait(timeout=2), -9)
                self.assertEqual(json.loads(marker.read_text())['parent'], os.getpid())
            finally:
                for process in owned:
                    if process.poll() is None: process.kill()
                    process.wait(timeout=4)
                    for stream in (process.stdout, process.stderr): stream.close()

    def test_actual_parent_death_with_owned_reaping_and_legacy_control(self):
        with tempfile.TemporaryDirectory() as directory:
            for guard in (False, True):
                with self.subTest(guard=guard):
                    result = subprocess.run((sys.executable, '-I', '-S', '-B', '-c', SUPERVISOR,
                        str(ROOT), str(Path(directory) / f'child-{guard}.json'), '1' if guard else '0'),
                        stdin=subprocess.DEVNULL, capture_output=True, env={}, close_fds=True, timeout=12)
                    self.assertEqual(result.returncode, 0, result.stderr.decode())
                    self.assertEqual(json.loads(result.stdout), {'guard': guard, 'promptChildExit': guard, 'ownedParentReaped': True})


if __name__ == '__main__': unittest.main()
