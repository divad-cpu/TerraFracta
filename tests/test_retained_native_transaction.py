"""Actual owned invented processes for retained-store framing and cleanup.

No native database, source request or actual credential. Existing builder
provides the statement; only the fixed subprocess interaction is exercised.
"""
from datetime import datetime, timezone
import json
import os
import sys
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from workers.bounded_native_client import BoundedNativeClient
from workers.private_pair_native_sql import private_operation_sql, private_admission_sql
from workers.retained_native_transaction import BEGIN, END, RetainedPairStore

NOW = datetime(2026, 10, 2, tzinfo=timezone.utc)
ARGS = {'metadata': 'e30=', 'data': 'e30=', 'metadataRetrievedAt': NOW.isoformat(),
    'dataRetrievedAt': NOW.isoformat(), 'manifest': '{}'}
SQL = private_operation_sql('store_pair', ARGS, raw_attempt_id='a'*32, stored_at=NOW)
STORE = RetainedPairStore(ARGS, 'a'*32, NOW)
FIRST = '''import os,sys,json,time
buf=b''
while not buf.endswith(b'.read_retention_context();\\n'):
    part=sys.stdin.buffer.read1(4096)
    if not part:raise SystemExit(11)
    buf+=part
print(json.dumps({"begin":buf.decode(),"ambient":os.environ.get("TF_RETAINED_CANARY")}),flush=True)
'''
SECOND = '''rest=sys.stdin.buffer.read()
print(json.dumps({"store":rest.decode()}),flush=True)
print('TF_PRIVATE_PAIR_STORE_COMMITTED',flush=True)
'''


class RetainedNativeTransactionTests(unittest.TestCase):
    def client(self, code=FIRST+SECOND, **options):
        selected=BoundedNativeClient((sys.executable,'-B','-c',code),**options)
        self.addCleanup(selected.cancel)
        return selected

    def test_begin_then_callback_then_one_store_with_clean_exit(self):
        observed=[]
        client=self.client(stdin_prefix=b'invented-credential\n')
        def prepare(raw):
            value=json.loads(raw);observed.append(value)
            self.assertTrue(client.active)
            self.assertEqual(value['begin'],'invented-credential\n'+BEGIN.decode())
            return STORE
        with patch.dict(os.environ,{'TF_RETAINED_CANARY':'never-inherited'}):
            result=client.store_pair_transaction(prepare)
        self.assertEqual(json.loads(result.stdout),{'store':SQL+END.decode()})
        self.assertEqual(observed[0]['ambient'],None)
        self.assertEqual(len(observed),1);self.assertEqual(client.calls,1)
        self.assertFalse(client.active);self.assertFalse(client.closed)

    def test_maximum_body_statement_fits_cumulative_bound(self):
        import base64
        args={**ARGS,'metadata':base64.b64encode(b'x'*65536).decode(),'data':base64.b64encode(b'x'*65536).decode()}
        sql=private_operation_sql('store_pair',args,raw_attempt_id='a'*32,stored_at=NOW)
        code=FIRST+'''rest=sys.stdin.buffer.read();print(json.dumps({"bytes":len(rest)}),flush=True);print('TF_PRIVATE_PAIR_STORE_COMMITTED',flush=True)'''
        client=self.client(code)
        result=client.store_pair_transaction(lambda _raw:RetainedPairStore(args,'a'*32,NOW))
        self.assertEqual(json.loads(result.stdout)['bytes'],len(sql.encode())+len(END))

    def test_callback_failure_cancels_and_cannot_replay(self):
        client=self.client();calls=[]
        def fail(raw):calls.append(raw);raise OSError('private-filesystem-canary')
        with self.assertRaises(ValueError) as error:client.store_pair_transaction(fail)
        self.assertNotIn('canary',str(error.exception));self.assertEqual(len(calls),1)
        self.assertTrue(client.closed);self.assertFalse(client.active)
        with self.assertRaises(ValueError):client.store_pair_transaction(lambda _raw:STORE)
        self.assertEqual(client.calls,1)

    def test_first_phase_malformed_extra_line_stderr_utf8_and_early_eof_stop_before_callback(self):
        endings=("print('[]',flush=True)","print('{}\\nprivate-canary',flush=True)",
            "sys.stderr.write('private-canary');sys.stderr.flush()", "sys.stdout.buffer.write(b'\\xff\\n');sys.stdout.buffer.flush()",
            "raise SystemExit(0)","print('x'*17000,flush=True)")
        for ending in endings:
            with self.subTest(ending=ending):
                code='import sys,time\n'+ending+'\ntime.sleep(.05)'
                client=self.client(code,timeout=.2);calls=[]
                with self.assertRaises(ValueError) as error:client.store_pair_transaction(lambda raw:(calls.append(raw),STORE)[1])
                self.assertEqual(calls,[]);self.assertNotIn('canary',str(error.exception));self.assertFalse(client.active);self.assertTrue(client.closed)

    def test_missing_wrong_extra_commit_marker_or_nonzero_exit_never_returns_store_receipt(self):
        endings=("print('{}',flush=True)","print('{}\\nWRONG',flush=True)",
            "print('{}\\nTF_PRIVATE_PAIR_STORE_COMMITTED\\n{}',flush=True)",
            "print('{}\\nTF_PRIVATE_PAIR_STORE_COMMITTED',flush=True);raise SystemExit(17)",
            "sys.stderr.write('private-canary');print('{}\\nTF_PRIVATE_PAIR_STORE_COMMITTED',flush=True)")
        for ending in endings:
            with self.subTest(ending=ending):
                client=self.client(FIRST+'sys.stdin.buffer.read()\n'+ending)
                with self.assertRaises(ValueError) as error:client.store_pair_transaction(lambda _raw:STORE)
                self.assertNotIn('canary',str(error.exception));self.assertFalse(client.active);self.assertTrue(client.closed)

    def test_receipt_and_marker_do_not_succeed_until_process_exit(self):
        client=self.client(FIRST+SECOND+'time.sleep(20)',timeout=.08)
        with self.assertRaises(ValueError):client.store_pair_transaction(lambda _raw:STORE)
        self.assertFalse(client.active);self.assertTrue(client.closed)

    def test_stdout_overflow_is_terminal_and_diagnostics_are_not_returned(self):
        client=self.client(FIRST+"sys.stdin.buffer.read();print('private-canary'*10000,flush=True)")
        with self.assertRaises(ValueError) as error:client.store_pair_transaction(lambda _raw:STORE)
        self.assertNotIn('canary',str(error.exception));self.assertFalse(client.active)

    def test_unknown_callback_statement_or_invalid_store_data_never_reaches_second_phase(self):
        for value in ('select 1;',private_admission_sql(),True,SQL+'select 1;',SQL+'\0',SQL+'x'*300000,
                RetainedPairStore({**ARGS,'workerSql':'select 1'},'a'*32,NOW),RetainedPairStore(ARGS,'../private',NOW)):
            with self.subTest(value_type=type(value).__name__):
                client=self.client()
                with self.assertRaises(ValueError):client.store_pair_transaction(lambda _raw:value)
                self.assertTrue(client.closed);self.assertFalse(client.active)

    def test_callback_time_uses_original_deadline_and_preserves_its_side_effect(self):
        # Keep real process framing/cleanup and its independent watchdog, but
        # make deadline passage independent of Python startup/scheduler delay.
        client=self.client(timeout=8);saved=[];clock={'now':0.0}
        def slow(raw):
            saved.append('invented-private-save');clock['now']=9.0;return STORE
        with patch('workers.retained_native_transaction.time',SimpleNamespace(monotonic=lambda:clock['now'])), \
                self.assertRaises(ValueError):client.store_pair_transaction(slow)
        self.assertEqual(saved,['invented-private-save']);self.assertTrue(client.closed);self.assertFalse(client.active)
        self.assertEqual(client.calls,1)

    def test_external_cancellation_during_callback_is_terminal_without_a_second_process(self):
        client=self.client();entered=threading.Event();release=threading.Event();errors=[]
        def prepare(raw):entered.set();release.wait(2);return STORE
        def serve():
            try:client.store_pair_transaction(prepare)
            except ValueError:errors.append('held')
        thread=threading.Thread(target=serve);thread.start();self.assertTrue(entered.wait(2))
        client.cancel();release.set();thread.join(2)
        self.assertFalse(thread.is_alive());self.assertEqual(errors,['held']);self.assertEqual(client.calls,1);self.assertFalse(client.active)

    def test_a_competing_call_cancels_the_open_transaction_without_parallel_native_use(self):
        client=self.client();entered=threading.Event();release=threading.Event();errors=[]
        def prepare(raw):entered.set();release.wait(2);return STORE
        def serve():
            try:client.store_pair_transaction(prepare)
            except ValueError:errors.append('held')
        thread=threading.Thread(target=serve);thread.start();self.assertTrue(entered.wait(2))
        with self.assertRaises(ValueError):client(private_admission_sql())
        release.set();thread.join(2);self.assertFalse(thread.is_alive());self.assertEqual(errors,['held']);self.assertEqual(client.calls,1)

    def test_closed_or_invalid_callback_refuses_without_launch(self):
        client=self.client()
        with self.assertRaises(ValueError):client.store_pair_transaction(None)
        self.assertEqual(client.calls,0);self.assertTrue(client.closed)
        with self.assertRaises(ValueError):client.store_pair_transaction(lambda _raw:STORE)
        self.assertEqual(client.calls,0)


if __name__=='__main__':unittest.main()
