"""Actual fixed invented children with the production startup/pipe protocol."""
from datetime import datetime, timezone
import json
import subprocess
import sys
from time import monotonic
import unittest
from unittest.mock import patch
from scripts.paired_transport_fixture_child import FixtureTransportBroker
from workers.ssb_14059_pair_transport import PROJECT_ROOT, _run_child, _run_one, _encode_capture, SSB14059PairTransportError
from workers.ssb_14059_capture import CapturedResponse, METADATA_URL
from workers.bounded_worker_process import WorkerOutput


class FictionalTransportProcessTests(unittest.TestCase):
    def test_actual_two_children_have_exact_fixed_commands_and_shared_deadline(self):
        real_popen=subprocess.Popen;children=[];commands=[]
        def launch(*args,**kwargs):
            commands.append((args,kwargs));child=real_popen(*args,**kwargs);children.append(child);return child
        broker=FixtureTransportBroker();deadline=monotonic()+10
        with patch('workers.ssb_14059_pair_transport.subprocess.Popen',side_effect=launch):
            metadata=broker('metadata',deadline=deadline)
            data=broker('data',deadline=deadline)
            with self.assertRaises(ValueError):broker('metadata',deadline=deadline)
        self.assertEqual(broker.fixture_reads,['metadata','data'])
        self.assertEqual(len(children),2)
        for ((args,kwargs),child,kind) in zip(commands,children,('metadata','data'),strict=True):
            self.assertEqual(args[0],[sys.executable,'-E','-s','-m','scripts.ssb_transport_fixture_child','--single-response-child',kind])
            self.assertEqual(kwargs['env'],{});self.assertTrue(kwargs['close_fds'])
            self.assertNotIn('pass_fds',kwargs);self.assertEqual(child.returncode,0)
            self.assertTrue(all(getattr(child,name).closed for name in ('stdin','stdout','stderr')))
        for kind,capture in (('metadata',metadata),('data',data)):
            name='ssb_14059_metadata_minimal_2024_2025.json' if kind=='metadata' else 'ssb_14059_jsonstat_minimal_2024_2025.json'
            body=json.dumps(json.loads((PROJECT_ROOT/'fixtures'/name).read_text()),separators=(',',':')).encode()
            self.assertEqual(capture.body,body)
        self.assertLessEqual(metadata.retrieved_at,data.retrieved_at)

    def test_actual_fictional_children_cannot_start_without_valid_bounded_packet(self):
        for packet in (b'',b'{"kind":"data","deadline":1}',b'x'*257,
                       b'{"kind":"metadata","deadline":true}',
                       json.dumps({'kind':'metadata','deadline':monotonic()+10,'endpoint':'https://private.invalid/'}).encode()):
            result=subprocess.run([sys.executable,'-E','-s','-m','scripts.ssb_transport_fixture_child','--single-response-child','metadata'],
                cwd=PROJECT_ROOT,env={},input=packet,capture_output=True,timeout=2,check=False)
            self.assertNotEqual(result.returncode,0);self.assertEqual(result.stdout,b'');self.assertEqual(result.stderr,b'')

    def test_invalid_parent_identity_deadline_or_selector_never_creates_child(self):
        for kind,deadline,fixture in (('other',monotonic()+10,True),('metadata',True,True),
                                    ('metadata',float('nan'),True),('metadata',monotonic()+11,True),
                                    ('metadata',monotonic()+10,'other-module')):
            with self.subTest(kind=kind,fixture=fixture),patch('workers.ssb_14059_pair_transport.subprocess.Popen') as start:
                with self.assertRaises(SSB14059PairTransportError):_run_child(kind,deadline=deadline,fixture=fixture)
                start.assert_not_called()

    def test_successful_exit_with_stderr_is_held_without_echoing_details(self):
        capture=CapturedResponse(METADATA_URL,METADATA_URL,0,200,'application/json',b'{}',datetime.now(timezone.utc))
        from unittest.mock import MagicMock
        child=MagicMock();child.poll.return_value=0
        with patch('workers.ssb_14059_pair_transport.subprocess.Popen',return_value=child), \
             patch('workers.ssb_14059_pair_transport.communicate_bounded',return_value=WorkerOutput(_encode_capture('metadata',capture),b'private-canary',0)):
            with self.assertRaises(SSB14059PairTransportError) as caught:_run_one('metadata',deadline=monotonic()+10)
        self.assertNotIn('private-canary',str(caught.exception))


if __name__=='__main__':unittest.main()
