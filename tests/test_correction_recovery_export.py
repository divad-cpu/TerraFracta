from copy import deepcopy
import json
import sys
import unittest
from unittest.mock import patch
from scripts import export_invented_correction_recovery_snapshot as export


class RecoveryDisplayExportTests(unittest.TestCase):
    def setUp(self):
        self.receipt={'evidenceKind':'actual_private_invented_review_receipt_lookup','observations':4,
            'denials':sorted(export.DENIALS),'actualSourceRequests':0,'liveReviewEnabled':False,
            **dict.fromkeys(('closureReplyNotConsumed','writePrivilegeRevokedBeforeLookup','exactApplicationRowsUnchangedByLookup',
                            'historicalReceiptDidNotReopen','missingEventDidNotDispatch','crossPrincipalEventNotEnumerated'),True)}
        self.items=[]
        for label,outcome,current,historical in export.CASES:
            self.items.append({'case':label,'request':{'eventId':'private-id-canary'},'result':{'outcome':outcome,
                'recordedEvent':{'toState':historical,'eventId':'private-id-canary'} if historical else None,
                'current':{'reviewState':current,'reportedAt':'2026-10-03T07:00:00Z','events':[],'reportId':'private-id-canary'}}})
        self.check=patch.object(export,'checked_result',side_effect=lambda request,result:result)
        self.check.start();self.addCleanup(self.check.stop)

    def test_whitelist_never_copies_private_ids_bodies_or_witness_extensions(self):
        self.receipt['privateEvidenceDirectory']='/private/path-canary'
        value=export.build_snapshot(self.receipt,self.items,'2026-10-03T07:01:00Z')
        self.assertEqual(len(value['observations']),4)
        self.assertFalse(value['liveStatus'])
        for canary in ('private-id-canary','privateEvidenceDirectory','/private/path-canary','recordedEvent','request'):
            self.assertNotIn(canary,json.dumps(value))

    def test_scope_boolean_counts_and_incomplete_witness_refuse(self):
        for changed in ({'observations':True},{'actualSourceRequests':False},{'liveReviewEnabled':True},
                        {'closureReplyNotConsumed':False},{'denials':sorted(export.DENIALS)+['missing_report']}):
            with self.subTest(changed=changed),self.assertRaises(ValueError):
                export.build_snapshot({**self.receipt,**changed},self.items,'2026-10-03T07:01:00Z')

    def test_case_order_wrong_state_future_events_and_contract_failure_refuse(self):
        changed=deepcopy(self.items);changed[0]['result']['current']['reviewState']='new'
        future=deepcopy(self.items);future[0]['result']['current']['events']=[{'recordedAt':'2026-10-03T07:01:00.000001Z'}]
        for items in (self.items[::-1],self.items[:-1],changed,future):
            with self.subTest(items=items),self.assertRaises(ValueError):
                export.build_snapshot(self.receipt,items,'2026-10-03T07:01:00Z')
        with patch.object(export,'checked_result',side_effect=ValueError('Contract refused')),self.assertRaises(ValueError):
            export.build_snapshot(self.receipt,self.items,'2026-10-03T07:01:00Z')

    def test_cli_selectors_refuse_before_private_file_read(self):
        with patch.object(sys,'argv',['fixed','--real']),patch.object(export,'private_read') as read:
            with self.assertRaises(ValueError): export.main()
            read.assert_not_called()


if __name__=='__main__': unittest.main()
