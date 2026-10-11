import json
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from scripts import check_invented_correction_queue as queue


class FixedQueueBoundaryTests(unittest.TestCase):
    def test_actor_account_and_database_are_strictly_bound(self):
        suffix='20261003060000_abcdef'
        for kind in ('writer','other'):
            args=queue.actor_args('terra_correction_queue_'+kind+'_'+suffix,'terra_successor_'+suffix)
            self.assertEqual(args[:4],['docker','exec','-i',queue.TARGET])
            self.assertIn('PGPASSFILE=/dev/null',args[-1])
        for role,database in (('postgres','terra_successor_'+suffix),
            ('terra_correction_queue_writer_'+suffix,'terra_successor_20261003060000_abcdee'),
            ('terra_correction_queue_writer_'+suffix+';other','terra_successor_'+suffix)):
            with self.subTest(role=role), self.assertRaises(ValueError): queue.actor_args(role,database)

    def test_pure_checker_receives_only_bounded_contract_packet(self):
        expected={'schemaVersion':1,'evidenceKind':'checked_private_invented_queue_contract','kind':'queue',
                  'sourceRequests':0,'liveReviewEnabled':False}
        value={'invented':'result'}
        with patch.object(queue,'command',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(expected))) as command:
            self.assertIs(queue.checked_result('queue',queue.START,value),value)
            command.assert_called_once_with(['node','--experimental-strip-types','scripts/check_invented_correction_queue_results.mjs'],
                data=json.dumps({'kind':'queue','request':queue.START,'result':value}),timeout=5)

    def test_boolean_counts_private_output_failed_or_oversized_checker_refuse(self):
        expected={'schemaVersion':1,'evidenceKind':'checked_private_invented_queue_contract','kind':'queue',
                  'sourceRequests':0,'liveReviewEnabled':False}
        for change in ({'schemaVersion':True},{'sourceRequests':False},{'details':'private-canary'},
                       {'kind':'detail'},{'liveReviewEnabled':True}):
            with self.subTest(change=change), patch.object(queue,'command',return_value=SimpleNamespace(returncode=0,stdout=json.dumps({**expected,**change}))):
                with self.assertRaises(ValueError): queue.checked_result('queue',queue.START,{})
        for result in (SimpleNamespace(returncode=1,stdout=json.dumps(expected)),
                       SimpleNamespace(returncode=0,stdout=json.dumps(expected)+' '*4096)):
            with patch.object(queue,'command',return_value=result), self.assertRaises(ValueError): queue.checked_result('queue',queue.START,{})

    def test_selectors_and_unknown_kind_cannot_dispatch(self):
        with patch.object(sys,'argv',['fixed','--real-source']), patch.object(queue,'trial') as trial:
            with self.assertRaises(ValueError): queue.main()
            trial.assert_not_called()
        with patch.object(queue,'command') as command, self.assertRaises(ValueError): queue.checked_result('other',None,{})
        command.assert_not_called()


if __name__=='__main__': unittest.main()
