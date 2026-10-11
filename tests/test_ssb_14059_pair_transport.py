"""Network-free shared-deadline, startup and bounded-pipe transport checks."""
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import os
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from workers.bounded_worker_process import BoundedWorkerError, WorkerOutput
from workers.ssb_14059_capture import CapturedResponse, DATA_URL, METADATA_URL
from workers.ssb_14059_pair_transport import (
    PAIR_DEADLINE_SECONDS, PROJECT_ROOT, SSB14059PairTransportError,
    _child_main, _decode_capture, _encode_capture, _run_one,
    fetch_ssb_14059_pair_with_deadline,
)

FIXTURES = PROJECT_ROOT / 'fixtures'


class SSB14059PairTransportTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)
        self.metadata_body = (FIXTURES / 'ssb_14059_metadata_minimal_2024_2025.json').read_bytes()
        self.data_body = (FIXTURES / 'ssb_14059_jsonstat_minimal_2024_2025.json').read_bytes()

    def response(self, kind, body):
        url = METADATA_URL if kind == 'metadata' else DATA_URL
        return CapturedResponse(url, url, 0, 200, 'application/json', body, self.now)

    def result(self, kind, body, *, returncode=0):
        return WorkerOutput(_encode_capture(kind, self.response(kind, body)), b'', returncode)

    def process(self):
        process = MagicMock()
        process.poll.return_value = 0
        for name in ('stdin', 'stdout', 'stderr'):
            getattr(process, name).closed = False
        return process

    def test_valid_pair_authorizes_exactly_two_fixed_children_under_one_budget(self):
        results = [self.result('metadata', self.metadata_body), self.result('data', self.data_body)]
        with patch('workers.ssb_14059_pair_transport.subprocess.Popen', side_effect=[self.process(), self.process()]) as launch, \
             patch('workers.ssb_14059_pair_transport.communicate_bounded', side_effect=results) as communicate, \
             patch('workers.ssb_14059_pair_transport.monotonic', side_effect=[100,100,101,101,102,102,102,103,103,104,104,104]):
            metadata, data = fetch_ssb_14059_pair_with_deadline()
        self.assertEqual((metadata.body, data.body), (self.metadata_body, self.data_body))
        self.assertEqual(launch.call_count, 2)
        for call, kind in zip(launch.call_args_list, ('metadata','data'), strict=True):
            args, kwargs = call
            self.assertEqual(args[0][-2:], ['--single-response-child',kind])
            self.assertEqual(args[0][:4], [sys.executable,'-E','-s','-m'])
            self.assertEqual(kwargs['env'], {})
            self.assertEqual(kwargs['cwd'], PROJECT_ROOT)
            self.assertTrue(kwargs['close_fds'])
            self.assertEqual(kwargs['stdin'], subprocess.PIPE)
        for call, kind, budget in zip(communicate.call_args_list, ('metadata','data'), (9,7), strict=True):
            args, kwargs = call
            self.assertEqual(json.loads(args[1]), {'kind':kind,'deadline':110,'parentPid':os.getpid()})
            self.assertEqual(kwargs['timeout'], budget)
            self.assertLessEqual(kwargs['max_stdout'], 90000)
            self.assertEqual(kwargs['max_stderr'], 1024)
        self.assertEqual(PAIR_DEADLINE_SECONDS, 10)

    def test_invalid_metadata_stops_before_data_child(self):
        with patch('workers.ssb_14059_pair_transport.subprocess.Popen', return_value=self.process()) as launch, \
             patch('workers.ssb_14059_pair_transport.communicate_bounded', return_value=self.result('metadata',b'{}')), \
             patch('workers.ssb_14059_pair_transport.monotonic', side_effect=[100,100,101,101,102,102]):
            with self.assertRaises(ValueError): fetch_ssb_14059_pair_with_deadline()
        self.assertEqual(launch.call_count, 1)

    def test_timeout_output_limit_and_child_failure_stop_without_retry(self):
        for outcome in (BoundedWorkerError('private canary'), self.result('metadata',self.metadata_body,returncode=1)):
            with self.subTest(outcome=type(outcome).__name__), \
                 patch('workers.ssb_14059_pair_transport.subprocess.Popen', return_value=self.process()) as launch, \
                 patch('workers.ssb_14059_pair_transport.communicate_bounded', side_effect=outcome if isinstance(outcome,Exception) else None, return_value=outcome), \
                 patch('workers.ssb_14059_pair_transport.monotonic', side_effect=[100,100,101,101,102]):
                with self.assertRaises(SSB14059PairTransportError) as caught: fetch_ssb_14059_pair_with_deadline()
                self.assertNotIn('private canary', str(caught.exception))
            self.assertEqual(launch.call_count, 1)

    def test_slow_process_start_never_sends_authorization_and_reaps_child(self):
        process = self.process(); process.poll.return_value = None
        with patch('workers.ssb_14059_pair_transport.subprocess.Popen', return_value=process), \
             patch('workers.ssb_14059_pair_transport.communicate_bounded') as communicate, \
             patch('workers.ssb_14059_pair_transport.monotonic', side_effect=[100,100,111]):
            with self.assertRaisesRegex(SSB14059PairTransportError,'child authorization'): fetch_ssb_14059_pair_with_deadline()
        communicate.assert_not_called(); process.kill.assert_called_once(); process.wait.assert_called_once()
        for name in ('stdin','stdout','stderr'): getattr(process,name).close.assert_called_once()

    def test_late_child_result_is_rejected_before_second_request(self):
        with patch('workers.ssb_14059_pair_transport.subprocess.Popen', return_value=self.process()) as launch, \
             patch('workers.ssb_14059_pair_transport.communicate_bounded', return_value=self.result('metadata',self.metadata_body)), \
             patch('workers.ssb_14059_pair_transport.monotonic', side_effect=[100,100,101,101,111]):
            with self.assertRaisesRegex(SSB14059PairTransportError,'result acceptance'): fetch_ssb_14059_pair_with_deadline()
        self.assertEqual(launch.call_count,1)

    def test_source_version_and_reversed_capture_times_are_rejected(self):
        from dataclasses import replace
        changed = json.loads(self.data_body); changed['updated']='2026-05-01T06:00:00Z'
        reversed_capture = replace(self.response('data',self.data_body),retrieved_at=self.now-timedelta(minutes=1))
        for second in (self.result('data',json.dumps(changed).encode()), WorkerOutput(_encode_capture('data',reversed_capture),b'',0)):
            with self.subTest(), \
                 patch('workers.ssb_14059_pair_transport.subprocess.Popen', side_effect=[self.process(),self.process()]), \
                 patch('workers.ssb_14059_pair_transport.communicate_bounded', side_effect=[self.result('metadata',self.metadata_body),second]), \
                 patch('workers.ssb_14059_pair_transport.monotonic', side_effect=[100,100,101,101,102,102,102,103,103,104,104]):
                with self.assertRaises(ValueError): fetch_ssb_14059_pair_with_deadline()

    def test_wire_rejects_wrong_kind_url_oversize_duplicate_and_noncanonical_base64(self):
        valid = json.loads(_encode_capture('metadata',self.response('metadata',b'a')))
        packets = [json.dumps({**valid,**change}).encode() for change in (
            {'kind':'data'}, {'final_url':'https://example.invalid/'}, {'body_base64':'x'*90000},
            {'body_base64':'YR=='}, {'redirect_count':False}, {'status':200.0})]
        packets += [json.dumps(valid).replace('"kind": "metadata"','"kind": "data", "kind": "metadata"').encode(),
                    b'\xff', b'{"kind":NaN}']
        for packet in packets:
            with self.subTest(size=len(packet)), self.assertRaises(SSB14059PairTransportError): _decode_capture('metadata',packet)

    def test_actual_child_without_startup_packet_or_invalid_kind_never_fetches(self):
        for kind in ('metadata','other'):
            result = subprocess.run([sys.executable,'-E','-s','-m','workers.ssb_14059_pair_transport','--single-response-child',kind],
                cwd=PROJECT_ROOT,env={},input=b'',capture_output=True,timeout=2,check=False)
            self.assertEqual(result.returncode,2); self.assertEqual(result.stdout,b''); self.assertEqual(result.stderr,b'')

    def test_child_refuses_malformed_expired_or_extended_startup_before_transport(self):
        def startup(**changes):
            return json.dumps({'kind':'metadata','deadline':105,'parentPid':os.getppid(),**changes}).encode()
        packets = [b'', b'x'*257, b'\xff', startup(deadline=float('nan')),
            startup(kind='data'), startup(deadline=True), startup(deadline=100), startup(deadline=111),
            startup(sql='select 1'), startup(parentPid=True), startup(parentPid=1),
            b'{"kind":"metadata","deadline":101,"deadline":105,"parentPid":2}']
        for packet in packets:
            with self.subTest(packet=packet[:40]), \
                 patch('workers.ssb_14059_pair_transport.sys.stdin',SimpleNamespace(buffer=BytesIO(packet))), \
                 patch('workers.ssb_14059_pair_transport.monotonic',return_value=100), \
                 patch('workers.ssb_14059_pair_transport.fetch_ssb_14059_once') as transport:
                self.assertNotEqual(_child_main(['--single-response-child','metadata']),0)
                transport.assert_not_called()

    def test_child_uses_residual_deadline_and_withholds_late_capture(self):
        for accepted, times in ((True,[100,101,104,104]),(False,[100,101,106])):
            output=BytesIO()
            with patch('workers.ssb_14059_pair_transport.sys.stdin',SimpleNamespace(buffer=BytesIO(json.dumps({'kind':'metadata','deadline':105,'parentPid':os.getppid()}).encode()))), \
                 patch('workers.ssb_14059_pair_transport.sys.stdout',SimpleNamespace(buffer=output)), \
                 patch('workers.ssb_14059_pair_transport.monotonic',side_effect=times), \
                 patch('workers.ssb_14059_pair_transport.arm_parent_lifetime'), \
                 patch('workers.ssb_14059_pair_transport.fetch_ssb_14059_once',return_value=self.response('metadata',self.metadata_body)) as transport:
                self.assertEqual(_child_main(['--single-response-child','metadata']),0 if accepted else 1)
                transport.assert_called_once_with('metadata',deadline=105)
            self.assertEqual(bool(output.getvalue()),accepted)

    def test_actual_pipe_accepts_full_64k_body_within_encoded_wire_cap(self):
        real_popen=subprocess.Popen; children=[]
        packet=_encode_capture('metadata',self.response('metadata',b'x'*65536))
        def launch(*args,**kwargs):
            code='import sys;sys.stdin.buffer.read();sys.stdout.buffer.write('+repr(packet)+')'
            child=real_popen([sys.executable,'-c',code],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            children.append(child);return child
        from time import monotonic
        with patch('workers.ssb_14059_pair_transport.subprocess.Popen',side_effect=launch):
            capture=_run_one('metadata',deadline=monotonic()+10)
        self.assertEqual(capture.body,b'x'*65536)
        self.assertEqual(children[0].returncode,0)

    def test_actual_flooding_child_is_stopped_without_unbounded_allocation(self):
        real_popen=subprocess.Popen; children=[]
        def launch(*args,**kwargs):
            child=real_popen([sys.executable,'-c','import sys,time;sys.stdin.buffer.read();sys.stdout.buffer.write(b"x"*200000);sys.stdout.flush();time.sleep(10)'],
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            children.append(child);return child
        with patch('workers.ssb_14059_pair_transport.subprocess.Popen',side_effect=launch):
            with self.assertRaisesRegex(SSB14059PairTransportError,'I/O or time'): fetch_ssb_14059_pair_with_deadline()
        self.assertEqual(len(children),1);self.assertIsNotNone(children[0].poll())
        self.assertTrue(all(getattr(children[0],name).closed for name in ('stdin','stdout','stderr')))

if __name__=='__main__': unittest.main()
