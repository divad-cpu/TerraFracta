"""A fixed paired capability does not gain time from an invalid clock."""
import json
from unittest.mock import patch
import unittest
from workers.closed_pair_channel import FIELDS, PairCustodianSession, PairChannelError, _encode


class Connection:
    def __init__(self):self.timeouts=[]
    def settimeout(self,value):self.timeouts.append(value)


class PairChannelClockTests(unittest.TestCase):
    def operations(self, calls, callback=None):
        return {name:callback or (lambda args,name=name:calls.append((name,args)) or b'{"invented":true}') for name in FIELDS}

    def request(self, identity=1):
        return json.dumps({'schemaVersion':1,'requestId':identity,'operation':'read_closeout','arguments':{}}).encode()

    def test_invalid_initial_clock_never_creates_capability(self):
        for value in (float('-inf'),True,None,'0',10**1000):
            with self.subTest(value=repr(value)),patch('workers.closed_pair_channel.time.monotonic',return_value=value):
                with self.assertRaises(PairChannelError):PairCustodianSession(self.operations([]),10)

    def test_invalid_pre_receive_clock_closes_without_read_or_callback(self):
        for value in (float('nan'),float('inf'),float('-inf'),True,None,'0',10**1000):
            calls=[];sent=[]
            with patch('workers.closed_pair_channel.time.monotonic',return_value=0):session=PairCustodianSession(self.operations(calls),10)
            with self.subTest(value=repr(value)),patch('workers.closed_pair_channel.time.monotonic',return_value=value),patch('workers.closed_pair_channel._packet',side_effect=AssertionError('No packet read')),patch('workers.closed_pair_channel._send',side_effect=lambda _,raw:sent.append(json.loads(raw))):
                self.assertEqual(session.serve_one(Connection()),'refused')
            self.assertEqual(calls,[]);self.assertTrue(session.closed);self.assertEqual(session.next_id,1)
            self.assertEqual(sent,[{'schemaVersion':1,'requestId':0,'state':'refused','reason':'invalid_request'}])

    def test_invalid_or_backwards_received_tick_cannot_invoke_callback(self):
        for value in (float('nan'),float('-inf'),True,-1):
            calls=[];clock=[0]
            with patch('workers.closed_pair_channel.time.monotonic',side_effect=lambda:clock[0]):session=PairCustodianSession(self.operations(calls),10)
            def receive(*_):clock[0]=value;return self.request()
            with self.subTest(value=repr(value)),patch('workers.closed_pair_channel.time.monotonic',side_effect=lambda:clock[0]),patch('workers.closed_pair_channel._packet',side_effect=receive),patch('workers.closed_pair_channel._send'):
                self.assertEqual(session.serve_one(Connection()),'refused')
            self.assertEqual(calls,[]);self.assertTrue(session.closed);self.assertEqual(session.next_id,1)

    def test_invalid_callback_finish_withholds_receipt_and_consumes_identity_once(self):
        clock=[0];calls=[];sent=[]
        def callback(args):calls.append(args);clock[0]=float('nan');return b'{"invented":true}'
        with patch('workers.closed_pair_channel.time.monotonic',side_effect=lambda:clock[0]):session=PairCustodianSession(self.operations(calls,callback),10)
        with patch('workers.closed_pair_channel.time.monotonic',side_effect=lambda:clock[0]),patch('workers.closed_pair_channel._packet',return_value=self.request()),patch('workers.closed_pair_channel._send',side_effect=lambda _,raw:sent.append(json.loads(raw))):
            self.assertEqual(session.serve_one(Connection()),'refused')
            self.assertEqual(session.serve_one(Connection()),'refused')
        self.assertEqual(calls,[{}]);self.assertEqual(session.next_id,2);self.assertTrue(session.closed)
        self.assertEqual(sent[0],{'schemaVersion':1,'requestId':1,'state':'refused','reason':'unavailable'})
        self.assertFalse(any('receipt' in value for value in sent))

    def test_backwards_next_packet_cannot_reuse_a_previously_observed_capability(self):
        clock=[0];calls=[];counter=[0]
        with patch('workers.closed_pair_channel.time.monotonic',side_effect=lambda:clock[0]):session=PairCustodianSession(self.operations(calls),10)
        def receive(*_):counter[0]+=1;return self.request(counter[0])
        with patch('workers.closed_pair_channel.time.monotonic',side_effect=lambda:clock[0]),patch('workers.closed_pair_channel._packet',side_effect=receive),patch('workers.closed_pair_channel._send'):
            clock[0]=2;self.assertEqual(session.serve_one(Connection()),'receipt')
            clock[0]=1;self.assertEqual(session.serve_one(Connection()),'refused')
        self.assertEqual(calls,[('read_closeout',{})]);self.assertEqual(session.next_id,2);self.assertTrue(session.closed)

    def test_native_large_deadline_residual_does_not_round_socket_wait_up(self):
        origin=float(2**56);calls=[];connection=Connection()
        with patch('workers.closed_pair_channel.time.monotonic',return_value=origin):
            session=PairCustodianSession(self.operations(calls),2**56+10)
            with patch('workers.closed_pair_channel._packet',return_value=self.request()),patch('workers.closed_pair_channel._send'):
                self.assertEqual(session.serve_one(connection),'receipt')
        self.assertEqual(connection.timeouts[0],10);self.assertEqual(calls,[('read_closeout',{})])


    def test_receipt_encoding_latency_cannot_send_late_success(self):
        clock=[0];calls=[];sent=[]
        with patch('workers.closed_pair_channel.time.monotonic',side_effect=lambda:clock[0]):session=PairCustodianSession(self.operations(calls),10)
        def encode(value):
            result=_encode(value)
            if value['state']=='receipt':clock[0]=10
            return result
        with patch('workers.closed_pair_channel.time.monotonic',side_effect=lambda:clock[0]),patch('workers.closed_pair_channel._packet',return_value=self.request()),patch('workers.closed_pair_channel._encode',side_effect=encode),patch('workers.closed_pair_channel._send',side_effect=lambda _,raw:sent.append(json.loads(raw))):
            self.assertEqual(session.serve_one(Connection()),'refused')
        self.assertEqual(calls,[('read_closeout',{})]);self.assertEqual(session.next_id,2);self.assertTrue(session.closed)
        self.assertEqual(sent,[{'schemaVersion':1,'requestId':1,'state':'refused','reason':'unavailable'}])


if __name__=='__main__':unittest.main()
