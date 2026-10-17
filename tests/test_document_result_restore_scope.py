"""Pure refusal tests for the fresh restore DB boundary, no Docker/DB call."""
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from scripts.rehearse_document_result_restore import OwnedRestoreDatabase
from scripts.rehearse_postgres_feed_journal import FeedPgTrialError
from workers.bounded_worker_process import WorkerOutput


def output(value=None):
    return WorkerOutput(b'' if value is None else json.dumps(value).encode()+b'\n',b'',0)


def trial():
    return SimpleNamespace(suffix='20261015T080000Z-01234567',identity='a'*64,record=Mock(),inspect=Mock(),query=Mock(),run=Mock(return_value=output()))


class DocumentRestoreScopeTests(unittest.TestCase):
    def setUp(self):self.trial=trial();self.target=OwnedRestoreDatabase(self.trial)
    def identity(self,**changes):return {'oid':18200,'name':self.target.name,'owner':'postgres',**changes}

    def test_generated_database_name_is_not_a_connection_or_sql_channel(self):
        self.assertEqual(self.target.name,'tf_document_restore_20261015t080000z_01234567')
        malicious=trial();malicious.suffix='";drop database postgres;--'
        with self.assertRaises(FeedPgTrialError):OwnedRestoreDatabase(malicious)
        malicious.query.assert_not_called();malicious.run.assert_not_called()
        self.target.name='postgres'
        with self.assertRaises(FeedPgTrialError):self.target.create()
        self.trial.query.assert_not_called()

    def test_existing_database_refuses_without_create_or_restore(self):
        self.trial.query.return_value=output(self.identity())
        with self.assertRaises(FeedPgTrialError):self.target.create()
        self.assertEqual(self.trial.query.call_count,1)
        self.assertNotIn('create database',self.trial.query.call_args.args[0])
        self.trial.run.assert_not_called()

    def test_absence_then_create_binds_returned_exact_oid(self):
        self.trial.query.side_effect=[output(),output(),output(self.identity())]
        self.target.create();self.assertEqual(self.target.oid,18200)
        commands=[call.args[0] for call in self.trial.query.call_args_list]
        self.assertEqual(sum('create database' in sql for sql in commands),1)
        self.assertIn('template template0',commands[1])
        self.trial.run.assert_not_called()

    def test_restore_refuses_before_database_identity_is_bound(self):
        with self.assertRaises(FeedPgTrialError):self.target.query(b'invented SQL')
        self.trial.query.assert_not_called();self.trial.run.assert_not_called()

    def test_string_or_boolean_oid_is_not_coerced_to_a_database_identity(self):
        for oid in ['18200',True]:
            self.trial.query.return_value=output(self.identity(oid=oid))
            with self.assertRaises(FeedPgTrialError):self.target.current()
        self.trial.run.assert_not_called()

    def test_changed_oid_or_owner_refuses_before_restoring(self):
        self.target.oid=18200
        for changed in [self.identity(oid=18201),self.identity(owner='other')]:
            self.trial.query.return_value=output(changed)
            with self.assertRaises(FeedPgTrialError):self.target.query(b'invented SQL')
        self.trial.run.assert_not_called()

    def test_native_restore_uses_stdin_file_single_transaction_exact_owned_target(self):
        self.target.oid=18200;self.trial.query.return_value=output(self.identity())
        self.target.query(b'invented SQL',single_transaction=True)
        args=self.trial.run.call_args.args[0]
        self.assertIn('--file=-',args);self.assertIn('--single-transaction',args)
        self.assertEqual(args[args.index('-d')+1],self.target.name)
        self.assertEqual(args[args.index('exec')+2],self.trial.identity)
        self.assertEqual(self.trial.run.call_args.kwargs['payload'],b'invented SQL')
        self.assertEqual(self.trial.query.call_count,2)

    def test_database_disappearing_after_native_request_is_not_accepted(self):
        self.target.oid=18200;self.trial.query.side_effect=[output(self.identity()),output()]
        with self.assertRaisesRegex(FeedPgTrialError,'disappeared'):self.target.query(b'invented SQL')
        self.trial.run.assert_called_once()

    def test_replaced_database_after_native_request_is_not_accepted(self):
        self.target.oid=18200;self.trial.query.side_effect=[output(self.identity()),output(self.identity(oid=18201))]
        with self.assertRaises(FeedPgTrialError):self.target.query(b'invented SQL')
        self.trial.run.assert_called_once()


if __name__=='__main__':unittest.main()
