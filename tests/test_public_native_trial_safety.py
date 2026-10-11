"""Offline tests for the owned public-reader trial's privacy/cleanup boundary."""
import io
import json
import queue
import unittest
from pathlib import Path
from scripts import check_postgres_issue_provider_native as trial


class PublicNativeTrialSafety(unittest.TestCase):
    def test_raw_diagnostic_payload_is_never_retained(self):
        counters={'node warning':0,'node stderr suppressed':0}
        dirty='[MODULE_TYPELESS_PACKAGE_JSON] PRIVATE_KEY_CANARY\n'+('PRIVATE_PASSWORD_CANARY'*300)+'\n'
        trial.drain_diagnostic_categories(io.StringIO(dirty),counters)
        self.assertEqual(counters['node warning'],1)
        self.assertGreater(counters['node stderr suppressed'],1)
        self.assertNotIn('PRIVATE',json.dumps(counters))
        self.assertEqual(set(counters),{'node warning','node stderr suppressed'})

    def test_stream_retirement_error_has_only_a_fixed_counter(self):
        class Refused:
            def readline(self,_):raise OSError('PRIVATE_KEY_CANARY')
        counters={'node warning':0,'node stderr suppressed':0}
        trial.drain_diagnostic_categories(Refused(),counters)
        self.assertEqual(counters,{'node warning':0,'node stderr suppressed':1})

    def test_utf8_frame_limit_is_bytes_and_invalid_or_incomplete_frames_stop(self):
        large=(json.dumps({'x':'æ'*33000},ensure_ascii=False)+'\n').encode('utf-8')
        self.assertGreater(len(large),65536)
        for body in (large,b'{"x":"\xff"}\n',b'{"x":1}'):
            outputs=queue.Queue();trial.read_protocol_frames(io.BytesIO(body),outputs)
            self.assertIsNone(outputs.get_nowait());self.assertTrue(outputs.empty())
        outputs=queue.Queue();trial.read_protocol_frames(io.BytesIO(b'{"kind":"ready"}\n'),outputs)
        self.assertEqual(outputs.get_nowait(),'{"kind":"ready"}\n');self.assertIsNone(outputs.get_nowait())

    def test_same_kind_unknown_payload_never_reaches_retained_phase_receipt(self):
        clean={'kind':'preabort','result':{'held':True,'diagnosticCodes':[]}}
        receipt=trial.protocol_receipt('preabort',clean,0)
        self.assertEqual(receipt,{'kind':'preabort','protocolChecked':True,'diagnosticEvents':0})
        for dirty in ({**clean,'private':'PRIVATE_KEY_CANARY'},
          {**clean,'result':{**clean['result'],'private':'PRIVATE_PASSWORD_CANARY'}},
          {**clean,'result':{'held':'PRIVATE_PASSWORD_CANARY','diagnosticCodes':[]}}):
            with self.assertRaises(ValueError):trial.protocol_receipt('preabort',dirty,0)
        self.assertNotIn('PRIVATE',json.dumps(receipt))

    def test_total_preservation_cannot_move_a_fault_into_caller_cancellation(self):
        silent={'kind':'preabort','result':{'held':True,'diagnosticCodes':[]}}
        fault={'kind':'bad-password','result':{'held':True,'closed':True,'diagnosticCodes':['public_issue_read']}}
        self.assertEqual(trial.protocol_receipt('bad-password',fault,1)['diagnosticEvents'],1)
        silent['result']['diagnosticCodes']=['public_issue_read'];fault['result']['diagnosticCodes']=[]
        with self.assertRaises(ValueError):trial.protocol_receipt('preabort',silent,0)
        with self.assertRaises(ValueError):trial.protocol_receipt('bad-password',fault,1)

    def test_duplicate_protocol_fields_cannot_hide_untrusted_data(self):
        with self.assertRaises(ValueError):json.loads('{"kind":"preabort","kind":"bad-password"}',object_pairs_hook=trial.unique_json)

    def test_independent_cleanup_keeps_all_turns_after_failed_reaping(self):
        seen=[]
        def failed():seen.append('node');raise OSError('PRIVATE_PASSWORD_CANARY')
        failures=trial.complete_cleanup([('node',failed),('roles',lambda:seen.append('roles')),
          ('stop',lambda:seen.append('stop')),('readback',lambda:seen.append('readback'))])
        self.assertEqual(seen,['node','roles','stop','readback'])
        self.assertEqual(failures,[{'phase':'node','exceptionType':'OSError'}])

    def test_actual_common_owner_tls_producer_and_primary_context_are_bound(self):
        before=trial.bound_inputs();after=trial.bound_inputs()
        self.assertEqual(before,after)
        paths={row['path'] for row in before}
        required={'src/server/postgres-read-owner.ts','src/server/public-issue-reader.ts',
          'src/public-read-consistency.ts','src/public-issue-projection.ts',
          'app/reader-preview/[country]/[issue]/[view]/page.tsx','src/server/error-diagnostics.ts',
          'scripts/check_postgres_operator_audit_native.py','scripts/fictional_trial_guard.py',
          'scripts/fictional_activation_payload.py','scripts/update_rehearsal.py',
          'workers/automatic_publication_gate.py','workers/update_request_identity.py',
          'fixtures/fictional_structured_source.json','package.json','pnpm-lock.yaml'}
        self.assertLessEqual(required,paths)
        self.assertEqual(sum(path.startswith('supabase/migrations/') for path in paths),30)
        for row in before:
            self.assertEqual(set(row),{'path','bytes','sha256'})
            self.assertEqual(len(row['sha256']),64)
            self.assertGreater(row['bytes'],0)


if __name__=='__main__':unittest.main()
