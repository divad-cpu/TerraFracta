import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from scripts import invented_correction_recovery_cases as recovery


class RecoveryBoundaryTests(unittest.TestCase):
    def test_contract_input_and_output_stay_private_and_exact(self):
        expected={'schemaVersion':1,'evidenceKind':'checked_private_invented_recovery_contract',
                  'sourceRequests':0,'liveReviewEnabled':False}
        value={'private':'invented'}
        with patch.object(recovery,'command',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(expected))) as command:
            self.assertIs(recovery.checked_result({'eventId':'invented'},value),value)
            command.assert_called_once_with(['node','--experimental-strip-types','scripts/check_invented_correction_recovery_results.mjs'],
                data=json.dumps({'request':{'eventId':'invented'},'result':value}),timeout=5)

    def test_boolean_counts_extensions_and_failed_or_oversized_reply_refuse(self):
        expected={'schemaVersion':1,'evidenceKind':'checked_private_invented_recovery_contract',
                  'sourceRequests':0,'liveReviewEnabled':False}
        for changed in ({'schemaVersion':True},{'sourceRequests':False},{'eventId':'private-canary'},{'liveReviewEnabled':True}):
            with self.subTest(changed=changed),patch.object(recovery,'command',return_value=SimpleNamespace(returncode=0,stdout=json.dumps({**expected,**changed}))):
                with self.assertRaises(ValueError): recovery.checked_result(None,{})
        for reply in (SimpleNamespace(returncode=1,stdout=json.dumps(expected)),
                      SimpleNamespace(returncode=0,stdout=json.dumps(expected)+' '*4096)):
            with patch.object(recovery,'command',return_value=reply),self.assertRaises(ValueError): recovery.checked_result(None,{})
