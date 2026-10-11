"""Synthetic closed supplemental receipt observations; no actual native command."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('retained_shared_tests',HERE/'test_shared_request_receipt.py')
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
with patch.object(sys,'path',[str(HERE.parent/'scripts'),*sys.path]):
    import contact_free_body_ownership_receipt as decoder

def packet(phase='first'):
    value=old.packet(phase);value['evidenceKind']='invented_native_body_ownership_request'
    value['assertions'] += [{'label':label,'pass':True} for label in sorted(decoder.LABELS[phase])]
    return value
class ClosedBodyOwnershipReceipt(unittest.TestCase):
    def decode(self,value,phase='first'):return decoder.decode_body_ownership_receipt(json.dumps(value),old.CONTAINER,phase)
    def test_both_complete_phase_contracts_detach(self):
        for phase in ['first','replacement']:
            p=packet(phase);result=self.decode(p,phase);self.assertEqual(result,p)
            p['assertions'][-1]['pass']=False;self.assertTrue(result['assertions'][-1]['pass'])
    def test_missing_duplicate_and_wrong_phase_supplement_hold(self):
        for alter in [lambda p:p['assertions'].pop(),lambda p:p['assertions'].append(deepcopy(p['assertions'][-1])),lambda p:p['assertions'][-1].update(label='ownership_PRIVATE_CANARY')]:
            p=packet();alter(p);self.assertIsNone(self.decode(p))
        p=packet('replacement');p['assertions'].append({'label':'ownership_cap_retired_before_sql_release','pass':True});self.assertIsNone(self.decode(p,'replacement'))
    def test_supplemental_failures_must_match_one_closed_failed_witness(self):
        p=packet();label=p['assertions'][-1]['label'];p.update(completed=False,failureLabel=label);self.assertIsNone(self.decode(p))
        p['assertions'][-1]['pass']=False;self.assertEqual(self.decode(p),p)
        p['failureLabel']=None;self.assertIsNone(self.decode(p))
    def test_private_nested_data_and_nonboolean_status_hold(self):
        for alter in [lambda p:p.update(details='INVENTED_PRIVATE_CANARY'),lambda p:p['assertions'][-1].update(details='INVENTED_PRIVATE_CANARY'),lambda p:p['assertions'][-1].update(**{'pass':1})]:
            p=packet();alter(p);self.assertIsNone(self.decode(p))
    def test_old_base_authority_and_command_gates_still_apply(self):
        for alter in [lambda p:p.update(hostAuthenticationVerified=True),lambda p:p['commands'][1]['command'].__setitem__(5,'primary'),lambda p:p.update(completed=1),lambda p:p.update(ticket='INVENTED_PRIVATE_CANARY')]:
            p=packet();alter(p);self.assertIsNone(self.decode(p))
    def test_duplicate_aliases_nonobjects_and_byte_caps_hold(self):
        for text in ['null','[]','{"evidenceKind":"invented_native_body_ownership_request","evidence\\u004bind":"private"}','"'+'🙂'*40000+'"']:
            self.assertIsNone(decoder.decode_body_ownership_receipt(text,old.CONTAINER,'first'))
if __name__=='__main__':unittest.main()
