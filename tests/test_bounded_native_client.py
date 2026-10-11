"""Actual owned processes; invented replies/credentials, no SQL server or source."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading
import time
import unittest
from unittest.mock import patch

from workers.bounded_native_client import BoundedNativeClient
from workers.private_pair_native_sql import private_admission_sql,private_operation_sql,private_retention_sql
from datetime import datetime,timezone


class BoundedNativeClientTests(unittest.TestCase):
    def client(self,program,**options):
        client=BoundedNativeClient((sys.executable,'-c',program),**options)
        self.addCleanup(client.cancel);return client

    def test_exact_pre_save_reader_crosses_the_owned_transport(self):
        client=self.client('import json,sys;print(json.dumps({"query":sys.stdin.read()}))')
        result=client(private_retention_sql())
        self.assertEqual(json.loads(result.stdout),{'query':private_retention_sql()})
        self.assertEqual(client.calls,1);self.assertFalse(client.active)

    def test_actual_round_trip_uses_stdin_without_inheriting_parent_credentials(self):
        program='import json,os,sys;data=sys.stdin.buffer.read();print(json.dumps({"line":data.split(b"\\n",1)[0].decode(),"query":data.split(b"\\n",1)[1].decode(),"ambient":os.environ.get("TERRA_NATIVE_TEST_CANARY"),"argv":sys.argv[1:]}))'
        with patch.dict(os.environ,{'TERRA_NATIVE_TEST_CANARY':'invented-parent-canary'}):
            client=self.client(program,stdin_prefix=b'invented-credential-line\n')
            result=client(private_admission_sql())
        value=json.loads(result.stdout)
        self.assertEqual(value['line'],'invented-credential-line')
        self.assertEqual(value['query'],private_admission_sql())
        self.assertIsNone(value['ambient']);self.assertEqual(value['argv'],[])
        self.assertEqual((result.returncode,result.stderr),(0,''))
        self.assertEqual(client.calls,1);self.assertFalse(client.active)
        client.cancel();self.assertTrue(client.closed)
        with self.assertRaises(ValueError):client(private_admission_sql())
        self.assertEqual(client.calls,1)

    def test_largest_body_literals_cross_bounded_stdin_without_worker_input_cap(self):
        stamp=datetime(2026,10,2,tzinfo=timezone.utc)
        arguments={kind:base64.b64encode(b'x'*65536).decode() for kind in ('metadata','data')}
        arguments.update(metadataRetrievedAt=stamp.isoformat(),dataRetrievedAt=stamp.isoformat(),manifest='{}')
        sql=private_operation_sql('store_pair',arguments,raw_attempt_id='a'*32,stored_at=stamp)
        self.assertGreater(len(sql),262144)
        client=self.client('import json,sys;print(json.dumps({"bytes":len(sys.stdin.buffer.read())}))')
        result=client(sql)
        self.assertEqual(json.loads(result.stdout)['bytes'],len(sql.encode()))
        self.assertFalse(client.active)

    def test_unknown_statement_and_oversized_sql_refuse_before_any_process(self):
        for sql in ('select 1;',private_admission_sql()+'select 1;',True,
                private_admission_sql()[:-2]+'x'*278528+');',private_admission_sql()+'\0'):
            with self.subTest(sql_type=type(sql).__name__):
                client=self.client('raise SystemExit(99)')
                with self.assertRaises(ValueError):client(sql)
                self.assertEqual(client.calls,0);self.assertTrue(client.closed)

    def test_stalled_process_times_out_and_is_reaped_without_retry(self):
        client=self.client('import time;time.sleep(20)',timeout=.05)
        began=time.monotonic()
        with self.assertRaises(ValueError):client(private_admission_sql())
        self.assertLess(time.monotonic()-began,1)
        self.assertTrue(client.closed);self.assertFalse(client.active);self.assertEqual(client.calls,1)
        with self.assertRaises(ValueError):client(private_admission_sql())
        self.assertEqual(client.calls,1)

    def test_stdout_stderr_failure_and_invalid_utf8_never_return_native_diagnostics(self):
        programs=('import sys;sys.stdin.buffer.read();sys.stdout.write("private-canary"*10000)',
            'import sys;sys.stdin.buffer.read();sys.stderr.write("private-canary"*10000)',
            'import sys;sys.stdin.buffer.read();sys.stderr.write("private-canary");sys.exit(17)',
            'import sys;sys.stdin.buffer.read();sys.stdout.buffer.write(b"\\xff\\xff")')
        for program in programs:
            client=self.client(program)
            with self.assertRaises(ValueError) as error:client(private_admission_sql())
            self.assertNotIn('canary',str(error.exception));self.assertTrue(client.closed)
            self.assertFalse(client.active)

    def test_external_cancellation_reaps_serving_process_before_join_returns(self):
        client=self.client('import sys,time;sys.stdin.buffer.read();time.sleep(20)')
        errors=[]
        def serve():
            try:client(private_admission_sql())
            except ValueError as error:errors.append(str(error))
        thread=threading.Thread(target=serve);thread.start()
        deadline=time.monotonic()+2
        while not client.active and thread.is_alive() and time.monotonic()<deadline:time.sleep(.001)
        self.assertTrue(client.active)
        client.cancel();thread.join(timeout=2)
        self.assertFalse(thread.is_alive());self.assertFalse(client.active);self.assertTrue(client.closed)
        self.assertEqual(len(errors),1);self.assertEqual(client.calls,1)

    def test_concurrent_second_call_cancels_the_first_without_launching_a_second_process(self):
        client=self.client('import sys,time;sys.stdin.buffer.read();time.sleep(20)')
        errors=[]
        def first():
            try:client(private_admission_sql())
            except ValueError:errors.append('refused')
        thread=threading.Thread(target=first);thread.start()
        deadline=time.monotonic()+2
        while not client.active and thread.is_alive() and time.monotonic()<deadline:time.sleep(.001)
        self.assertTrue(client.active)
        with self.assertRaises(ValueError):client(private_admission_sql())
        thread.join(timeout=2)
        self.assertFalse(thread.is_alive());self.assertEqual(errors,['refused']);self.assertEqual(client.calls,1)
        self.assertFalse(client.active);self.assertTrue(client.closed)

    def test_bad_command_prefix_and_timing_configuration_refuse_before_process(self):
        for command,options in ((['/bin/true'],{}),(('relative',),{}),(('/bin/true',),{'stdin_prefix':b'line\nsecond\n'}),
                (('/bin/true',),{'stdin_prefix':b'nul\0\n'}),(('/bin/true',),{'timeout':True}),
                (('/bin/true',),{'timeout':16})):
            with self.subTest(options=options),self.assertRaises(ValueError):BoundedNativeClient(command,**options)


if __name__=='__main__':unittest.main()
