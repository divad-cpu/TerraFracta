import json
import socket
import threading
import unittest
from workers.closed_projection_channel import ProjectionChannelError,request_projection,serve_projection_request


class ClosedProjectionChannelTests(unittest.TestCase):
    def packet(self,raw,callback):
        parent,child=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
        with parent,child:
            child.send(raw);state=serve_projection_request(parent,callback)
            return state,json.loads(child.recv(65537))

    def test_invalid_packets_never_call_custodian(self):
        def forbidden():self.fail('Invalid request reached the database callback')
        base={'schemaVersion':1,'requestId':1,'operation':'read_current'}
        invalid=[{**base,'sql':'SET CONSTRAINTS ALL IMMEDIATE'},
            {**base,'role':'postgres'},{**base,'operation':'write'},{**base,'schemaVersion':True},
            {**base,'requestId':True},{**base,'requestId':0},{**base,'requestId':33},[],None]
        packets=[json.dumps(value).encode() for value in invalid]+[b'\xff',b'x'*4097,
            b'{"schemaVersion":1,"requestId":1,"requestId":2,"operation":"read_current"}',
            b'{"schemaVersion":1,"requestId":NaN,"operation":"read_current"}']
        for raw in packets:
            with self.subTest(raw=raw[:40]):
                state,response=self.packet(raw,forbidden)
                self.assertEqual(state,'refused');self.assertEqual(response['reason'],'invalid_request')
                self.assertEqual(set(response),{'schemaVersion','requestId','state','reason'})

    def test_truncated_packet_is_refused_without_callback(self):
        state,response=self.packet(b'x'*8192,lambda:self.fail('Truncated packet reached callback'))
        self.assertEqual((state,response['reason']),('refused','invalid_request'))

    def test_callback_failure_and_oversize_never_expose_details(self):
        def error():raise ValueError('private-password-path-canary')
        raw=json.dumps({'schemaVersion':1,'requestId':2,'operation':'read_current'}).encode()
        for callback in (error,lambda:None,lambda:{'huge':'x'*65536},lambda:{'bad':float('nan')}):
            state,response=self.packet(raw,callback)
            self.assertEqual(state,'refused');self.assertEqual(response['reason'],'unavailable')
            self.assertNotIn('canary',json.dumps(response))

    def test_actual_packet_round_trip_correlates_identity(self):
        parent,child=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
        with parent,child:
            parent.settimeout(2);child.settimeout(2)
            observed=[];failures=[]
            def serve():
                try:observed.append(serve_projection_request(parent,lambda:{'publicationId':'checked'}))
                except BaseException as error:failures.append(error)
            worker=threading.Thread(target=serve)
            worker.start()
            try:self.assertEqual(request_projection(child,7),{'publicationId':'checked'})
            finally:worker.join(timeout=3)
            self.assertFalse(worker.is_alive());self.assertEqual(observed,['issue']);self.assertEqual(failures,[])

    def test_client_refuses_changed_identity_or_extra_fields(self):
        base={'schemaVersion':1,'requestId':1,'state':'issue','issue':{'publicationId':'checked'}}
        for altered in ({**base,'requestId':2},{**base,'schemaVersion':True},{**base,'extra':'private'},
            {'schemaVersion':1,'requestId':1,'state':'refused','reason':'unavailable'}):
            parent,child=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
            with parent,child:
                child.settimeout(2);parent.send(json.dumps(altered).encode())
                with self.assertRaises(ProjectionChannelError):request_projection(child,1)

    def test_client_rejects_invalid_request_without_sending(self):
        class NoTransport:
            def send(self,_value):raise AssertionError('Invalid identity sent')
        for invalid in (True,0,33,'1',None):
            with self.assertRaises(ProjectionChannelError):request_projection(NoTransport(),invalid)

    def test_malformed_response_reports_only_generic_channel_error(self):
        for raw in (b'\xff',b'{"requestId":1,"requestId":1}',b'{"private":"canary",',b'x'*65537):
            parent,child=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
            with parent,child:
                child.settimeout(2);parent.send(raw)
                with self.assertRaises(ProjectionChannelError) as observed:request_projection(child,1)
                self.assertNotIn('canary',str(observed.exception));self.assertNotIn('private',str(observed.exception))

if __name__=='__main__':unittest.main()
