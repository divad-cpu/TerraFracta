import io
import os
import subprocess
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from scripts import check_machine_activation_concurrency as transport


class SqlSessionStartupTests(unittest.TestCase):
    def test_each_reader_startup_failure_reaps_the_owned_child_and_closes_all_pipes(self):
        for fail_at in (1, 2):
            for signal_ack in ('success', 'lost'):
                for needs_kill in (False, True):
                    with self.subTest(fail_at=fail_at, signal_ack=signal_ack, needs_kill=needs_kill):
                        events = []; starts = []; waits = []
                        streams = [io.StringIO() for _ in range(3)]
                        def terminate():
                            events.append('terminate')
                            if signal_ack == 'lost': raise OSError('Invented signal acknowledgment loss')
                        def wait(*, timeout):
                            waits.append(timeout); events.append('wait')
                            if needs_kill and len(waits) == 1: raise subprocess.TimeoutExpired('invented-child', timeout)
                            return 1
                        child = SimpleNamespace(stdin=streams[0], stdout=streams[1], stderr=streams[2],
                            terminate=terminate, wait=wait, kill=lambda: events.append('kill'))
                        def thread(**_kwargs):
                            def start():
                                starts.append(True)
                                if len(starts) == fail_at: raise RuntimeError('Invented reader thread resource failure')
                            return SimpleNamespace(start=start, ident=None, is_alive=lambda: False)
                        with patch.object(transport.subprocess, 'Popen', return_value=child), patch.object(transport.threading, 'Thread', side_effect=thread):
                            with self.assertRaisesRegex(RuntimeError, 'reader thread resource failure'): transport.Session(['invented-owned-child'])
                        self.assertEqual(events, ['terminate', 'wait', 'kill', 'wait'] if needs_kill else ['terminate', 'wait'])
                        self.assertTrue(all(stream.closed for stream in streams)); self.assertEqual(waits, [5, 5] if needs_kill else [5])

    def test_unconfirmed_child_exit_remains_a_failure_with_every_pipe_closed(self):
        streams = [io.StringIO() for _ in range(3)]
        child = SimpleNamespace(stdin=streams[0], stdout=streams[1], stderr=streams[2],
            terminate=lambda: None, kill=lambda: None,
            wait=lambda **kwargs: (_ for _ in ()).throw(subprocess.TimeoutExpired('invented-child', kwargs['timeout'])))
        with patch.object(transport.subprocess, 'Popen', return_value=child), \
                patch.object(transport.threading, 'Thread', return_value=SimpleNamespace(ident=None, is_alive=lambda: False,
                    start=lambda: (_ for _ in ()).throw(RuntimeError('Invented startup failure')))):
            with self.assertRaises(subprocess.TimeoutExpired): transport.Session(['invented-owned-child'])
        self.assertTrue(all(stream.closed for stream in streams))

    def test_failed_process_creation_has_no_child_to_signal(self):
        with patch.object(transport.subprocess, 'Popen', side_effect=OSError('Invented process resource failure')), \
                patch.object(transport.threading, 'Thread') as thread:
            with self.assertRaises(OSError): transport.Session(['invented-owned-child'])
            thread.assert_not_called()

    def test_queue_failure_precedes_child_creation(self):
        with patch.object(transport.queue, 'Queue', side_effect=KeyboardInterrupt('Invented queue initialization interruption')), \
                patch.object(transport.subprocess, 'Popen') as popen:
            with self.assertRaises(KeyboardInterrupt): transport.Session(['invented-owned-child'])
            popen.assert_not_called()

    def test_failed_reader_construction_after_popen_still_reaps_child(self):
        streams = [io.StringIO() for _ in range(3)]; events = []
        child = SimpleNamespace(stdin=streams[0], stdout=streams[1], stderr=streams[2],
            terminate=lambda: events.append('terminate'), wait=lambda **_kwargs: events.append('wait'))
        with patch.object(transport.subprocess, 'Popen', return_value=child), \
                patch.object(transport.threading, 'Thread', side_effect=MemoryError('Invented reader allocation failure')):
            with self.assertRaises(MemoryError): transport.Session(['invented-owned-child'])
        self.assertEqual(events, ['terminate', 'wait']); self.assertTrue(all(stream.closed for stream in streams))

    def test_unconfirmed_exit_does_not_block_on_a_live_buffered_pipe_reader(self):
        real_thread = threading.Thread
        read_fd, write_fd = os.pipe()
        reader = os.fdopen(read_fd, 'r'); writer = os.fdopen(write_fd, 'w')
        entered = threading.Event(); returned = threading.Event(); errors = []; readers = []
        class ObservedReader:
            def __iter__(self): entered.set(); return iter(reader)
            def close(self): reader.close()
        stdout = ObservedReader(); stderr = io.StringIO(); stdin = io.StringIO()
        child = SimpleNamespace(stdin=stdin, stdout=stdout, stderr=stderr,
            terminate=lambda: None, kill=lambda: None,
            wait=lambda **kwargs: (_ for _ in ()).throw(subprocess.TimeoutExpired('invented-child', kwargs['timeout'])))
        def thread(**kwargs):
            selected = real_thread(**kwargs); readers.append(selected)
            if len(readers) == 2:
                def start():
                    if not entered.wait(1): raise AssertionError('Invented reader did not enter')
                    raise RuntimeError('Invented second reader startup failure')
                selected.start = start
            return selected
        def instantiate():
            try: transport.Session(['invented-owned-child'])
            except BaseException as error: errors.append(error)
            finally: returned.set()
        constructor = real_thread(target=instantiate, daemon=True)
        before_release = False
        try:
            with patch.object(transport.subprocess, 'Popen', return_value=child), patch.object(transport.threading, 'Thread', side_effect=thread):
                constructor.start(); before_release = returned.wait(1)
        finally:
            writer.close(); constructor.join(timeout=2)
            for selected in readers:
                if selected.ident is not None: selected.join(timeout=2)
            if not reader.closed: reader.close()
        self.assertTrue(before_release, 'Constructor waited on the still-live reader pipe')
        self.assertEqual(len(errors), 1); self.assertIsInstance(errors[0], subprocess.TimeoutExpired)
        self.assertTrue(stdin.closed and stderr.closed and reader.closed)
        self.assertFalse(constructor.is_alive()); self.assertTrue(all(not selected.is_alive() for selected in readers))


if __name__ == '__main__': unittest.main()
