"""Borrowed invented custody frames retain one finite exact elapsed budget."""
from fractions import Fraction
import json
import unittest
from unittest.mock import patch
from workers import invented_review_custody as custody

PACKET={'schemaVersion':1,'status':'continue_invented_review'}

class Frame:
    def __init__(self,*,origin=100,fault=None,phase=None,steps=None,packet=PACKET):
        body=json.dumps(packet).encode()
        self.parts=[len(body).to_bytes(4,'big'),body]
        self.now=origin;self.fault=fault;self.phase=phase;self.steps=steps or []
        self.calls=0;self.timeouts=[];self.closed=False
        self.sent=[]
    def gettimeout(self):return 25
    def settimeout(self,value):self.timeouts.append(value)
    def sendall(self,value):self.sent.append(value)
    def recv(self,size):
        part=self.parts.pop(0);self.calls+=1
        if self.steps:self.now=self.steps.pop(0)
        if self.phase==self.calls:self.now=self.fault
        self.assert_size=size
        return part
    def clock(self):
        if isinstance(self.now,Exception):raise self.now
        return self.now

class CustodyFrameClockTests(unittest.TestCase):
    def receive(self,frame,**kwargs):
        with patch.object(custody.time,'monotonic',side_effect=frame.clock):
            return custody.receive_packet(frame,**kwargs)
    def assert_restored_open(self,frame):
        self.assertEqual(frame.timeouts[-1],25)
        self.assertFalse(frame.closed)
    def test_invalid_initial_clock_is_curated_before_receiving(self):
        for value in (float('nan'),float('inf'),float('-inf'),True,'100',10**500,RuntimeError('invented-clock-canary')):
            with self.subTest(value=type(value).__name__):
                frame=Frame(origin=value)
                with self.assertRaises(ValueError):self.receive(frame)
                self.assertEqual(frame.calls,0)
                self.assert_restored_open(frame)
    def test_invalid_header_observation_refuses_body_and_restores_borrowed_timeout(self):
        for value in (float('nan'),float('-inf'),True,99,RuntimeError('invented-clock-canary')):
            with self.subTest(value=type(value).__name__):
                frame=Frame(phase=1,fault=value)
                with self.assertRaises(ValueError):self.receive(frame)
                self.assertEqual(frame.calls,1)
                self.assert_restored_open(frame)
    def test_invalid_final_body_observation_never_releases_ack(self):
        for value in (float('nan'),float('-inf'),True,99,RuntimeError('invented-clock-canary')):
            with self.subTest(value=type(value).__name__):
                frame=Frame(phase=2,fault=value)
                with self.assertRaises(ValueError):self.receive(frame)
                self.assertEqual(frame.calls,2)
                self.assert_restored_open(frame)
    def test_invalid_parser_observation_never_releases_ack(self):
        parser=custody._json
        for value in (float('nan'),float('-inf'),True,99):
            frame=Frame()
            def parse(raw):
                result=parser(raw);frame.now=value;return result
            with self.subTest(value=type(value).__name__),patch.object(custody,'_json',side_effect=parse):
                with self.assertRaises(ValueError):self.receive(frame)
                self.assert_restored_open(frame)
    def test_expired_complete_header_is_withheld_before_body_receive(self):
        frame=Frame(phase=1,fault=110)
        with self.assertRaises(ValueError):self.receive(frame)
        self.assertEqual(frame.calls,1);self.assert_restored_open(frame)
    def test_native_origins_keep_exact_timeout_without_local_float_deadline(self):
        for origin in (0,-100,2**56,float(2**56),float(2**1023)):
            with self.subTest(origin=origin):
                frame=Frame(origin=origin)
                self.assertEqual(self.receive(frame,timeout=7),PACKET)
                self.assertTrue(all(0<Fraction(v)<=7 for v in frame.timeouts[:-1]))
                self.assertEqual(frame.timeouts[:-1],[7,7])
                self.assert_restored_open(frame)
    def test_partial_delivery_consumes_shared_budget_without_renewal(self):
        frame=Frame(steps=[102,103,104,107])
        body=frame.parts[1]
        frame.parts=[b'\0',b'\0',len(body).to_bytes(2,'big'),body]
        self.assertEqual(self.receive(frame),PACKET)
        self.assertEqual(frame.timeouts,[10,8,7,6,25])
        self.assertEqual(frame.calls,4);self.assert_restored_open(frame)
    def test_invalid_complete_ack_cannot_advance_owned_start_or_review_stage(self):
        for phase in ('start','stage'):
            with self.subTest(phase=phase):
                selected=object.__new__(custody.ReviewWorkerCustody)
                selected.started=phase=='stage';selected.staged=False
                selected.pins={'intake':'a'*64,'reliability':'b'*64,'review':'c'*64}
                suffix='20261003090000_abcdef'
                owned={'schemaVersion':1,'evidenceKind':'invented_review_owned_start',
                       'suffix':suffix,'candidateSha256':selected.pins}
                ack={'schemaVersion':1,'status':'owned_start_recorded','packetSha256':custody.sha256(
                    json.dumps(owned,sort_keys=True,separators=(',',':')).encode()+b'\n').hexdigest()}
                frame=Frame(phase=2,fault=float('nan'),packet=ack if phase=='start' else PACKET)
                selected.channel=frame
                with patch.object(custody.time,'monotonic',side_effect=frame.clock):
                    with self.assertRaises(ValueError):
                        selected.before_start(suffix) if phase=='start' else selected.first_reports()
                self.assertEqual(selected.started,phase=='stage');self.assertFalse(selected.staged)
                self.assertEqual(len(frame.sent),1);self.assert_restored_open(frame)

if __name__=='__main__':unittest.main()
