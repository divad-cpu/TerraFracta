"""Owned pipe effects remain inside one original elapsed-time interval."""
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from workers.bounded_worker_process import BoundedWorkerError, communicate_bounded


class Stream:
    def __init__(self, descriptor):
        self.descriptor=descriptor
        self.closed=False
    def fileno(self):return self.descriptor
    def close(self):self.closed=True


class Process:
    def __init__(self, clock, wait_tick=None):
        self.stdin=Stream(10);self.stdout=Stream(11);self.stderr=Stream(12)
        self.returncode=None;self.kills=0;self.waits=[];self.clock=clock;self.wait_tick=wait_tick
    def poll(self):return self.returncode
    def kill(self):self.kills+=1
    def wait(self, timeout):
        self.waits.append(timeout)
        self.returncode=-9 if self.kills else 0
        if self.wait_tick is not None:self.clock[0]=self.wait_tick
        return self.returncode


class Selector:
    def __init__(self, clock, select_tick=None):
        self.mapping={};self.clock=clock;self.select_tick=select_tick;self.waits=[]
    def __enter__(self):return self
    def __exit__(self,*_):return None
    def register(self,stream,event,name):self.mapping[stream]=SimpleNamespace(data=name,fileobj=stream)
    def unregister(self,stream):self.mapping.pop(stream)
    def get_map(self):return self.mapping
    def select(self, timeout):
        self.waits.append(timeout)
        if self.select_tick is not None:self.clock[0]=self.select_tick
        return [(key,0) for key in self.mapping.values()]


class OwnedPipeDeadlineTests(unittest.TestCase):
    def run_owned(self, origin=0, *, current=None, select_tick=None, wait_tick=None, after_write=None, payload=b'invented'):
        clock=[origin];process=Process(clock,wait_tick);selector=Selector(clock,select_tick);effects=[]
        calls=[0]
        def observe():
            calls[0]+=1
            return origin if calls[0]==1 or current is None else current
        def write(fd, body):
            effects.append(('write',fd,len(body)))
            if after_write is not None:clock[0]=after_write
            return len(body)
        with patch('workers.bounded_worker_process.time.monotonic',side_effect=observe if current is not None else lambda:clock[0]), \
                patch('workers.bounded_worker_process.selectors.DefaultSelector',return_value=selector), \
                patch('workers.bounded_worker_process.os.set_blocking'), \
                patch('workers.bounded_worker_process.os.write',side_effect=write), \
                patch('workers.bounded_worker_process.os.read',side_effect=lambda fd,_:effects.append(('read',fd,0)) or b''):
            try:
                result=communicate_bounded(process,payload,timeout=30 if type(origin) in (int,float) and abs(origin)>100 else 1)
                error=None
            except Exception as observed:
                result=None;error=observed
        self.assertTrue(all(getattr(process,n).closed for n in ('stdin','stdout','stderr')))
        self.assertIsNotNone(process.poll())
        return result,error,effects,process,selector

    def test_invalid_initial_clock_refuses_with_owned_child_reaped(self):
        for origin in (float('nan'),float('inf'),float('-inf'),True,None,'0',10**1000):
            with self.subTest(origin=repr(origin)):
                result,error,effects,process,_=self.run_owned(origin)
                self.assertIsInstance(error,BoundedWorkerError)
                self.assertIsNone(result);self.assertEqual(effects,[]);self.assertEqual(process.kills,1)

    def test_invalid_or_backwards_later_clock_allows_no_pipe_effect(self):
        for current in (float('nan'),float('inf'),float('-inf'),True,'0',10**1000,-1):
            with self.subTest(current=repr(current)):
                result,error,effects,process,_=self.run_owned(current=current)
                self.assertIsInstance(error,BoundedWorkerError)
                self.assertIsNone(result);self.assertEqual(effects,[]);self.assertEqual(process.kills,1)

    def test_selector_expiry_prevents_input_delivery(self):
        result,error,effects,process,_=self.run_owned(select_tick=1)
        self.assertIsInstance(error,BoundedWorkerError);self.assertIsNone(result)
        self.assertEqual(effects,[]);self.assertEqual(process.kills,1)

    def test_selector_expiry_prevents_output_read(self):
        result,error,effects,process,_=self.run_owned(select_tick=1,payload=b'')
        self.assertIsInstance(error,BoundedWorkerError);self.assertIsNone(result)
        self.assertEqual(effects,[]);self.assertEqual(process.kills,1)

    def test_each_selected_effect_rechecks_the_original_deadline(self):
        result,error,effects,process,_=self.run_owned(after_write=1)
        self.assertIsInstance(error,BoundedWorkerError);self.assertIsNone(result)
        self.assertEqual(effects,[('write',10,8)]);self.assertEqual(process.kills,1)

    def test_late_wait_completion_withholds_output_without_claiming_rollback(self):
        result,error,_,process,_=self.run_owned(wait_tick=1)
        self.assertIsInstance(error,BoundedWorkerError);self.assertIsNone(result)
        self.assertEqual(process.returncode,0);self.assertEqual(process.kills,0)

    def test_large_origin_does_not_round_thirty_seconds_to_thirty_two(self):
        result,error,effects,process,_=self.run_owned(float(2**55),current=2**55+31)
        self.assertIsInstance(error,BoundedWorkerError);self.assertIsNone(result)
        self.assertEqual(effects,[]);self.assertEqual(process.kills,1)

    def test_timely_native_origins_preserve_bytes_bounds_and_cleanup(self):
        for origin in (0,-1,0.5,-0.5):
            with self.subTest(origin=origin):
                result,error,effects,process,selector=self.run_owned(origin)
                self.assertIsNone(error);self.assertEqual((result.stdout,result.stderr,result.returncode),(b'',b'',0))
                self.assertEqual(effects,[('write',10,8),('read',11,0),('read',12,0)])
                self.assertEqual(process.kills,0);self.assertEqual(selector.waits,[1])


if __name__=='__main__':unittest.main()
