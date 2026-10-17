"""Three pure native-entry scope guards; private files/resources not needed."""
import unittest
from unittest.mock import Mock,patch
from scripts import rehearse_restricted_private_extraction_reader as module


class RestrictedPrivateExtractionScopeTests(unittest.TestCase):
    def test_extra_arguments_refuse_before_custodian(self):
        with patch.object(module.sys,'argv',['trial','existing-target']),patch.object(module,'FreshFeedPostgres')as make:
            with self.assertRaises(module.FeedPgTrialError):module.main()
            make.assert_not_called()
    def test_snapshots_have_only_fixed_ten_or_eleven_tables_in_one_read_transaction(self):
        for include,count in[(False,10),(True,11)]:
            sql=module.row_statement(include)
            self.assertEqual(sql.count('begin isolation level repeatable read read only;'),1);self.assertEqual(sql.count('commit;'),1);self.assertEqual(sql.count(' union all '),count-1);self.assertNotIn('insert ',sql);self.assertNotIn('update ',sql)
        for wrong in [None,1,'tf_private_extraction.results;delete from x']:
            with self.assertRaises(module.FeedPgTrialError):module.row_statement(wrong)
    def test_failure_stops_both_owned_resources_and_checks_sources(self):
        trial=Mock();trial.identity='owned';events=[];trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer');trial.verify_sources.side_effect=events.append;trial.inspect.return_value=dict(owned=True)
        with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial),patch.object(module,'freeze_all'),patch.object(module,'freeze_change'),patch.object(module,'freeze_reference'),patch.object(module,'freeze_private'),patch.object(module,'freeze_reader'),patch.object(module,'cases',side_effect=RuntimeError('invented')):
            with self.assertRaises(RuntimeError):module.main()
        self.assertEqual(events,['stop','initializer','FINAL_RESTRICTED_PRIVATE']);trial.create.assert_called_once();trial.inspect.assert_called_once();self.assertTrue(any(c.args[0]=='RESTRICTED_PRIVATE_FAILED'for c in trial.record.call_args_list))

if __name__=='__main__':unittest.main()
