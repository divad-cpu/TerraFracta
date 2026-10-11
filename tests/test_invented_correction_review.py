import json
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from scripts import check_invented_correction_review as review


class PrivateReviewerBoundaryTests(unittest.TestCase):
    def test_account_and_database_suffix_must_match_before_transport(self):
        suffix = '20261003060000_abcdef'
        args = review.reviewer_args('terra_correction_review_' + suffix, 'terra_successor_' + suffix)
        self.assertEqual(args[:4], ['docker','exec','-i',review.TARGET])
        self.assertIn('IFS= read -r PGPASSWORD', args[-1])
        for role, database in (('postgres','terra_successor_' + suffix),
            ('terra_correction_review_' + suffix,'terra_successor_20261003060000_abcdee'),
            ('terra_correction_review_' + suffix + ';other','terra_successor_' + suffix)):
            with self.subTest(role=role), self.assertRaises(ValueError): review.reviewer_args(role,database)

    def test_pure_contract_command_contains_no_account_database_or_credential(self):
        result = {'sample': 'invented'}
        expected = {'schemaVersion':1,'evidenceKind':'checked_private_invented_correction_contract',
                    'kind':'status','sourceRequests':0,'liveIntakeEnabled':False}
        with patch.object(review,'command',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(expected))) as command:
            self.assertIs(review.checked_result('status',None,result), result)
            command.assert_called_once_with(['node','--experimental-strip-types','scripts/check_invented_correction_results.mjs'],
                data=json.dumps({'kind':'status','request':None,'result':result}),timeout=5)

    def test_ambiguous_boolean_counts_extra_fields_wrong_kind_failed_or_oversized_reply_refuse(self):
        expected = {'schemaVersion':1,'evidenceKind':'checked_private_invented_correction_contract',
                    'kind':'status','sourceRequests':0,'liveIntakeEnabled':False}
        values = [{**expected,**change} for change in ({'schemaVersion':True},{'sourceRequests':False},
                  {'privateBody':'canary'},{'kind':'review'},{'liveIntakeEnabled':True})]
        for value in values:
            with self.subTest(value=value), patch.object(review,'command',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(value))):
                with self.assertRaises(ValueError): review.checked_result('status',None,{})
        for output in (SimpleNamespace(returncode=1,stdout=json.dumps(expected)),
                       SimpleNamespace(returncode=0,stdout=json.dumps(expected) + ' '*4096)):
            with patch.object(review,'command',return_value=output), self.assertRaises(ValueError): review.checked_result('status',None,{})

    def test_unknown_contract_kind_and_command_line_selector_cannot_dispatch(self):
        with patch.object(review,'command') as command, self.assertRaises(ValueError): review.checked_result('other',None,{})
        command.assert_not_called()
        with patch.object(sys,'argv',['fixed','--live']), patch.object(review,'trial') as trial:
            with self.assertRaises(ValueError): review.main()
            trial.assert_not_called()


if __name__ == '__main__': unittest.main()
