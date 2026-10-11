"""Fixed review result composition and a separate retained operation namespace."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from tests import test_correction_review_export as fixtures
from workers.invented_operation_journal import (
    checked_execution, inspect_invented_operation, run_invented_operation, HELD, EXPECTED,
)

KIND = 'fresh_invented_correction_review_result_v2'
def expected(at):
    return {'schemaVersion':1,'evidenceKind':KIND,'recordedAt':at.isoformat(),
        'state':'completed_invented_review','privateReports':4,'requestReceipts':4,'reviewEvents':3,
        'newReports':2,'underReviewReports':1,'closedReports':1,'eventsAppendOnly':True,
        'historicalReplayDidNotReopen':True,'historyPreserved':True,
        'temporaryAccountsRetired':True,'ownedCloneStopped':True,'sourceRequests':0,'modelCalls':0,
        'realReports':0,'liveReviewEnabled':False,'publicContentChangedByReports':False}


class CorrectionReviewOperationTests(unittest.TestCase):
    def setUp(self):
        self.at = datetime(2026,10,3,5,1,tzinfo=timezone.utc)
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'review'

    def test_new_kind_is_exact_and_cannot_promote_prior_contracts(self):
        value=expected(self.at)
        self.assertEqual(checked_execution(value,expected_kind=KIND),value)
        with self.assertRaises(ValueError):checked_execution(value)
        with self.assertRaises(ValueError):checked_execution({**EXPECTED,'recordedAt':self.at.isoformat()},expected_kind=KIND)
        for key,value in (('closedReports',True),('realReports',False),('privateReports',3),
                ('ownedCloneStopped',False),('liveReviewEnabled',True),('reportId','private-canary')):
            with self.subTest(key=key),self.assertRaises(ValueError):
                checked_execution({**expected(self.at),key:value},expected_kind=KIND)

    def test_retained_review_reopens_without_rerun_and_other_kind_stays_held(self):
        calls=[]
        def runner():calls.append(1);return expected(self.at)
        first=run_invented_operation(self.root,runner,utc_now=lambda:self.at,expected_kind=KIND)
        self.assertEqual(first,{'state':'checked','result':expected(self.at)})
        before={p.name:p.read_bytes() for p in self.root.iterdir()}
        later=self.at+timedelta(days=1)
        self.assertEqual(inspect_invented_operation(self.root,now=later,expected_kind=KIND),first)
        self.assertEqual(run_invented_operation(self.root,runner,utc_now=lambda:later,expected_kind=KIND),first)
        self.assertEqual(inspect_invented_operation(self.root,now=later),HELD)
        self.assertEqual(calls,[1]);self.assertEqual({p.name:p.read_bytes() for p in self.root.iterdir()},before)

    def test_wrong_version_result_consumes_start_without_retry_or_leak(self):
        calls=[]
        def runner():calls.append(1);return {**EXPECTED,'recordedAt':self.at.isoformat(),'private':'private-canary'}
        self.assertEqual(run_invented_operation(self.root,runner,utc_now=lambda:self.at,expected_kind=KIND),HELD)
        self.assertEqual(run_invented_operation(self.root,runner,utc_now=lambda:self.at,expected_kind=KIND),HELD)
        self.assertEqual(calls,[1]);self.assertNotIn('private-canary',(self.root/'FINISH.json').read_text())

    def test_absent_review_observation_is_idle_without_creation(self):
        self.assertEqual(inspect_invented_operation(self.root,now=self.at,expected_kind=KIND),{'state':'idle'})
        self.assertFalse(self.root.exists())

    def test_supervised_result_is_separate_without_promoting_manual_v2_history(self):
        from workers.invented_operation_journal import SUPERVISED_REVIEW_KIND
        manual=expected(self.at)
        with self.assertRaises(ValueError):checked_execution(manual,expected_kind=SUPERVISED_REVIEW_KIND)
        supervised={**manual,'evidenceKind':SUPERVISED_REVIEW_KIND,'workerExitObserved':True,
            'custodianRolesRetired':True,'custodianCloneStopped':True}
        self.assertEqual(checked_execution(supervised,expected_kind=SUPERVISED_REVIEW_KIND),supervised)
        with self.assertRaises(ValueError):checked_execution(supervised,expected_kind=KIND)
        for key in ('workerExitObserved','custodianRolesRetired','custodianCloneStopped'):
            with self.subTest(key=key),self.assertRaises(ValueError):
                checked_execution({**supervised,key:False},expected_kind=SUPERVISED_REVIEW_KIND)

    def test_actual_native_receipt_uses_existing_full_history_validator(self):
        from scripts.rehearse_correction_review_display import build_execution_result
        fixture=fixtures.PrivateReviewExportTests();fixture.setUp()
        fixture.receipt['denials']=sorted(fixtures.CURRENT_DENIALS)
        fixture.receipt.update(privateEvidenceDirectory='/private-canary',password='private-canary')
        value=build_execution_result(fixture.receipt,fixture.pins)
        self.assertEqual(value,expected(self.at))
        self.assertNotIn('canary',json.dumps(value))
        for key,bad in (('candidateSha256',{}),('ownedCloneStopped',False),('privateReports',True),
                ('liveReviewEnabled',True),('denials',[])):
            with self.subTest(key=key),self.assertRaises(ValueError):
                build_execution_result({**fixture.receipt,key:bad},fixture.pins)
        malformed=deepcopy(fixture.receipt);malformed['statuses'][0]['events'][0]['recordedAt']='2026-10-03T05:00:00.0000009Z'
        with self.assertRaises(ValueError):build_execution_result(malformed,fixture.pins)

    def test_fixed_runner_is_deferred_and_stdout_failure_never_becomes_checked(self):
        from scripts.rehearse_correction_review_display import run_fixed_review_result
        from scripts import check_invented_correction_review as trial
        fixture=fixtures.PrivateReviewExportTests();fixture.setUp()
        fixture.receipt['denials']=sorted(fixtures.CURRENT_DENIALS)
        with patch.object(trial,'main',side_effect=lambda:print(json.dumps(fixture.receipt))), \
                patch('scripts.rehearse_correction_review_display.current_candidate_pins',return_value=fixture.pins):
            # A return code is part of the trusted runner's completion witness.
            with self.assertRaises(ValueError):run_fixed_review_result()
        def successful():print(json.dumps(fixture.receipt));return 0
        with patch.object(trial,'main',side_effect=successful), \
                patch('scripts.rehearse_correction_review_display.current_candidate_pins',return_value=fixture.pins):
            self.assertEqual(run_fixed_review_result(),expected(self.at))
        def duplicate():print('{"evidenceKind":"private","evidenceKind":"private"}');return 0
        with patch.object(trial,'main',side_effect=duplicate):
            with self.assertRaises(ValueError):run_fixed_review_result()


if __name__=='__main__':unittest.main()
