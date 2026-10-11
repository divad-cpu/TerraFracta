"""Execution versions are exact trusted choices; history is never upgraded."""
from datetime import datetime,timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from workers.invented_operation_journal import (EXPECTED,RETAINED_EXPECTED,LEGACY_KIND,RETAINED_KIND,
    HELD,checked_execution,run_invented_operation,inspect_invented_operation)


class RetainedOperationJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.now=datetime(2026,10,2,18,tzinfo=timezone.utc)
    def result(self,kind):
        return {**(RETAINED_EXPECTED if kind==RETAINED_KIND else EXPECTED),'recordedAt':self.now.isoformat()}
    def start(self,directory,kind):
        return run_invented_operation(directory,lambda:self.result(kind),utc_now=lambda:self.now,expected_kind=kind)
    def test_correct_version_is_retained_and_repeats_never_run(self):
        root=self.base/'new';expected=self.start(root,RETAINED_KIND)
        self.assertEqual(expected['state'],'checked');before={p.name:p.read_bytes() for p in root.iterdir()}
        self.assertEqual(inspect_invented_operation(root,now=self.now,expected_kind=RETAINED_KIND),expected)
        self.assertEqual(inspect_invented_operation(root,now=self.now),HELD)
        with patch('builtins.print'):
            self.assertEqual(run_invented_operation(root,lambda:self.fail('retained attempt restarted'),
                utc_now=lambda:self.now,expected_kind=RETAINED_KIND),expected)
        self.assertEqual({p.name:p.read_bytes() for p in root.iterdir()},before)
    def test_legacy_history_is_not_promoted_and_new_namespace_preserves_bytes(self):
        old=self.base/'old';self.assertEqual(self.start(old,LEGACY_KIND)['state'],'checked')
        before={p.name:p.read_bytes() for p in old.iterdir()}
        self.assertEqual(inspect_invented_operation(old,now=self.now,expected_kind=RETAINED_KIND),HELD)
        self.assertEqual(self.start(self.base/'new',RETAINED_KIND)['state'],'checked')
        self.assertEqual({p.name:p.read_bytes() for p in old.iterdir()},before)
    def test_wrong_version_consumes_only_once_and_stays_held(self):
        root=self.base/'wrong'
        status=run_invented_operation(root,lambda:self.result(LEGACY_KIND),utc_now=lambda:self.now,expected_kind=RETAINED_KIND)
        self.assertEqual(status,HELD)
        self.assertEqual(run_invented_operation(root,lambda:self.fail('held attempt restarted'),
            utc_now=lambda:self.now,expected_kind=RETAINED_KIND),HELD)
    def test_unsupported_contract_refuses_before_directory_or_runner(self):
        root=self.base/'bad'
        for unknown in ('unknown',None,True):
            self.assertEqual(run_invented_operation(root,lambda:self.fail('invalid version ran'),expected_kind=unknown),HELD)
            self.assertEqual(inspect_invented_operation(root,expected_kind=unknown),HELD)
        self.assertFalse(root.exists())
    def test_mixed_missing_false_and_private_retained_fields_refuse(self):
        fixed=self.result(RETAINED_KIND)
        checked_execution(fixed,expected_kind=RETAINED_KIND)
        for changed in ({k:v for k,v in fixed.items() if k!='retainedStoreTransaction'},
            {**fixed,'retainedStoreTransaction':False},{**fixed,'retainedStoreTransaction':1},
            {**fixed,'rawRoot':'private-canary'},{**fixed,'evidenceKind':LEGACY_KIND}):
            with self.assertRaises(ValueError):checked_execution(changed,expected_kind=RETAINED_KIND)
        with self.assertRaises(ValueError):checked_execution(fixed)


if __name__=='__main__':unittest.main()
