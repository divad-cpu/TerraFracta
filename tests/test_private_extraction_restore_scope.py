"""Binary archive adapter/target/fault boundaries; no PostgreSQL execution."""
from types import SimpleNamespace
import unittest
import gzip
from unittest.mock import Mock,patch
from scripts import rehearse_private_extraction_restore as module
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase


def target_fixture():
    trial=SimpleNamespace(run=Mock(return_value=SimpleNamespace(returncode=0,stdout=b'',stderr=b'')),identity='owned')
    target=object.__new__(OwnedRestoreDatabase);target.trial=trial;target.name='tf_document_restore_generated'
    target.oid=42;target.current=Mock(return_value={'oid':42});target.query=Mock()
    return trial,target


class PrivateExtractionRestoreScopeTests(unittest.TestCase):
    def test_mutable_subclass_oversize_or_nonarchive_input_refuses_before_dispatch(self):
        trial,target=target_fixture();adapter=module.OwnedPrivateArchiveRestore(trial,target);calls=[]
        class Hook(bytes):
            def startswith(self,*args):calls.append(True);return True
        for raw in [bytearray(gzip.compress(b'PGDMPabc',mtime=0)),Hook(gzip.compress(b'PGDMPabc',mtime=0)),b'',b'not archive',b'PGDMP'+b'x'*131068]:
            with self.assertRaises(module.FeedPgTrialError):adapter.restore(raw)
        trial.run.assert_not_called();target.current.assert_not_called();target.query.assert_not_called();self.assertEqual(calls,[])

    def test_gzip_crc_truncation_extra_member_and_expansion_bound_refuse(self):
        raw=gzip.compress(b'PGDMPbytes',mtime=0)
        for bad in [raw[:-1],raw+b'extra',raw+raw,raw[:-8]+b'\x00'*8,gzip.compress(b'PGDMP'+b'x'*294908,mtime=0)]:
            with self.assertRaises(module.FeedPgTrialError):module.decode_private_archive(bad)

    def test_exact_native_input_capacity_is_preserved_without_larger_channel(self):
        inner=b'PGDMP'+b'x'*294907
        self.assertEqual(len(inner),294912)
        self.assertEqual(module.decode_private_archive(gzip.compress(inner,mtime=0)),inner)

    def test_foreign_fake_or_unbound_target_refuses_before_dispatch(self):
        trial,target=target_fixture()
        for bad in [SimpleNamespace(trial=trial,oid=42),object.__new__(OwnedRestoreDatabase)]:
            if type(bad) is OwnedRestoreDatabase:bad.trial=trial;bad.oid=None
            with self.assertRaises(module.FeedPgTrialError):module.OwnedPrivateArchiveRestore(trial,bad)
        foreign=SimpleNamespace(run=Mock())
        with self.assertRaises(module.FeedPgTrialError):module.OwnedPrivateArchiveRestore(foreign,target)
        trial.run.assert_not_called();foreign.run.assert_not_called()

    def test_exact_binary_payload_fixed_restore_flags_and_pre_post_identity(self):
        trial,target=target_fixture();adapter=module.OwnedPrivateArchiveRestore(trial,target);inner=b'PGDMP\x00\xff\n';raw=gzip.compress(inner,mtime=0)
        adapter.restore(raw)
        self.assertEqual(target.current.call_count,2)
        args=trial.run.call_args.args[0];kwargs=trial.run.call_args.kwargs
        self.assertEqual(args,['docker','exec','-i','owned',module.BIN+'pg_restore','-h','/tmp','-U','postgres',
            '--dbname=tf_document_restore_generated','--single-transaction','--exit-on-error'])
        self.assertEqual(kwargs['payload'],inner);target.query.assert_not_called()

    def test_failure_still_checks_same_target_after_restore_attempt(self):
        trial,target=target_fixture();adapter=module.OwnedPrivateArchiveRestore(trial,target)
        trial.run.side_effect=RuntimeError('invented')
        with self.assertRaises(RuntimeError):adapter.restore(gzip.compress(b'PGDMPabc',mtime=0))
        self.assertEqual(target.current.call_count,2)

    def test_target_custodian_or_identity_change_holds_before_or_after_dispatch(self):
        trial,target=target_fixture();adapter=module.OwnedPrivateArchiveRestore(trial,target)
        target.trial=SimpleNamespace(run=Mock())
        with self.assertRaises(module.FeedPgTrialError):adapter.restore(gzip.compress(b'PGDMPabc',mtime=0))
        trial.run.assert_not_called()
        trial,target=target_fixture();adapter=module.OwnedPrivateArchiveRestore(trial,target)
        target.current.side_effect=[{'oid':42},None]
        with self.assertRaises(module.FeedPgTrialError):adapter.restore(gzip.compress(b'PGDMPabc',mtime=0))
        self.assertEqual(trial.run.call_count,1)

    def test_fault_cleanup_refuses_unknown_or_changed_objects(self):
        trial,target=target_fixture()
        with patch.object(module,'fault_profile',return_value={'changed':True}):
            with self.assertRaises(module.FeedPgTrialError):module.remove_fault(target,{'bound':True})
        target.query.assert_not_called()
        with self.assertRaises(module.FeedPgTrialError):module.install_fault(SimpleNamespace(oid=42))

    def test_existing_target_argument_refuses_before_resource_construction(self):
        with patch.object(module.sys,'argv',['trial','existing-target']),patch.object(module,'FreshFeedPostgres') as make:
            with self.assertRaises(module.FeedPgTrialError):module.main()
            make.assert_not_called()

    def test_failed_trial_still_stops_owned_resources_and_verifies_sources(self):
        trial=Mock();trial.identity='owned';events=[]
        trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer')
        trial.verify_sources.side_effect=lambda label:events.append(label);trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
        with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial), \
                patch.object(module,'freeze_all'),patch.object(module,'freeze_change'),patch.object(module,'freeze_reference'), \
                patch.object(module,'freeze_private'),patch.object(module,'freeze_restore'),patch.object(module,'cases',side_effect=RuntimeError('invented')):
            with self.assertRaises(RuntimeError):module.main()
        self.assertEqual(events,['stop','initializer','FINAL_PRIVATE_RESTORE','inspect'])
        self.assertTrue(any(call.args[0]=='PRIVATE_RESTORE_FAILED' for call in trial.record.call_args_list))


if __name__=='__main__':unittest.main()
