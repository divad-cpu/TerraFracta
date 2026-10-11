import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from scripts import check_invented_correction_recovery_concurrency as concurrency


class RecoveryWaitBoundaryTests(unittest.TestCase):
    def test_cli_selectors_refuse_before_native_dispatch(self):
        with patch.object(sys,'argv',['fixed','--live']),patch.object(concurrency,'trial') as trial:
            with self.assertRaises(ValueError):concurrency.main()
            trial.assert_not_called()

    def test_missing_wait_refuses_and_true_wait_returns(self):
        owner=lambda sql,label:'f'
        with patch.object(concurrency.time,'monotonic',side_effect=[0,0,4]),patch.object(concurrency.time,'sleep'):
            with self.assertRaises(ValueError):concurrency.wait_for(owner,'fixed','label')
        concurrency.wait_for(lambda sql,label:'t','fixed','label')

    def test_only_specific_backend_error_with_failed_exit_is_a_refusal(self):
        for code,errors in ((0,['expected']),(-1,['unrelated'])):
            selected=SimpleNamespace(until=lambda marker:(_ for _ in ()).throw(RuntimeError('ended')),
                process=SimpleNamespace(wait=lambda timeout:None,returncode=code),errors=errors)
            with self.subTest(code=code),self.assertRaises(ValueError):concurrency.refused_session(selected,'marker','expected')
        selected=SimpleNamespace(until=lambda marker:[],process=None,errors=[])
        with self.assertRaises(ValueError):concurrency.refused_session(selected,'marker','expected')


if __name__=='__main__':unittest.main()
