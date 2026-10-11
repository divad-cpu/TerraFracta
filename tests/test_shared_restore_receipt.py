"""Synthetic G/H source continuity and closed child metadata; no Docker or SQL."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
with patch.object(sys,'path',[str(ROOT/'scripts'),*sys.path]):
    import contact_free_shared_restore_receipt as receipt
spec=importlib.util.spec_from_file_location('existing_write_plan_fixture',ROOT/'tests/test_write_restore_plan_observation.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
NOW=fixture.NOW;DAY=fixture.DAY
ID=lambda n:'e8900000-0000-4000-8000-'+str(n).zfill(12)
def packet(at=NOW+DAY):
    old_write,latest_write,write_plan=fixture.packet();latest_write['observedAtMs']=write_plan['observedAtMs']=at
    effect=old_write['operations'][0]
    reservation={'ticket':ID(1),'operationId':effect['operationId'],'admittedAtMs':NOW,'phase':'dispatched','requestId':effect['requestId'],'target':deepcopy(effect['target'])}
    previous={'schemaVersion':1,'kind':'invented_shared_recovery_inventory','writeInventory':{**deepcopy(latest_write),'observedAtMs':NOW},'admission':{'acceptedAtMs':[],'addressBuckets':[],'reservations':[deepcopy(reservation)]}}
    latest={**deepcopy(previous),'writeInventory':deepcopy(latest_write)}
    backup={'schemaVersion':1,'kind':'invented_shared_backup_inventory','writeBackup':old_write,'sharedInventory':previous}
    plan={**deepcopy(write_plan),'kind':'planned_invented_shared_restore','latestAdmission':deepcopy(latest['admission']),'admissionHeld':True,'writerEnabled':False}
    if at>=NOW+7*DAY:plan['recordActions'][0]['payload']='remove'
    return backup,latest,plan
class SharedRestoreReceipt(unittest.TestCase):
    def checked(self,b,l,r):return receipt.check_shared_restore_plan(r,b,l,r['observedAtMs'])
    def test_valid_original_pending_and_closed_held(self):
        b,l,r=packet();self.assertTrue(self.checked(b,l,r));self.assertTrue(receipt.check_shared_restore_plan({'kind':'held'},None,None,None))
    def test_original_unknown_resolution_requires_matching_immutable_effect(self):
        b,l,r=packet();l['admission']['reservations']=[];r['latestAdmission']=deepcopy(l['admission']);self.assertTrue(self.checked(b,l,r))
        l['writeInventory']['operations']=[];r['operationActions'][0]['latestOperation']=None;self.assertFalse(self.checked(b,l,r))
    def test_expired_opaque_unknown_cannot_disappear_with_empty_custody(self):
        b,l,r=packet();b['writeBackup'].update(records=[],operations=[]);b['sharedInventory']['writeInventory'].update(records=[],operations=[]);l['writeInventory'].update(records=[],operations=[]);r.update(recordActions=[],operationActions=[])
        b['sharedInventory']['admission']['reservations']=[{'ticket':ID(2),'operationId':None,'admittedAtMs':None,'phase':'expired','requestId':None,'target':None}]
        l['admission']['reservations']=[];r['latestAdmission']=deepcopy(l['admission']);self.assertFalse(self.checked(b,l,r))
        l['admission']['reservations']=deepcopy(b['sharedInventory']['admission']['reservations']);r['latestAdmission']=deepcopy(l['admission']);self.assertTrue(self.checked(b,l,r))
    def test_same_original_bucket_never_renews_epoch_or_expiry(self):
        b,l,r=packet();prior={'key':ID(3),'epoch':NOW//900000,'expiresAtMs':(NOW//900000+2)*900000,'attempts':[NOW]};b['sharedInventory']['admission']['addressBuckets']=[prior]
        now=l['writeInventory']['observedAtMs'];l['admission']['addressBuckets']=[{**prior,'epoch':now//900000,'expiresAtMs':(now//900000+2)*900000,'attempts':[now]}];r['latestAdmission']=deepcopy(l['admission']);self.assertFalse(self.checked(b,l,r))
    def test_live_acceptance_multiplicity_cannot_disappear(self):
        b,l,r=packet(NOW+1);b['sharedInventory']['admission']['acceptedAtMs']=[NOW,NOW];l['admission']['acceptedAtMs']=[NOW];r['latestAdmission']=deepcopy(l['admission']);self.assertFalse(self.checked(b,l,r));l['admission']['acceptedAtMs']=[NOW,NOW];r['latestAdmission']=deepcopy(l['admission']);self.assertTrue(self.checked(b,l,r))
    def test_exact_acceptance_window_allows_retirement_without_renewal(self):
        b,l,r=packet(NOW+3600000);b['sharedInventory']['admission']['acceptedAtMs']=[NOW];self.assertTrue(self.checked(b,l,r))
    def test_unexpired_bucket_and_attempts_cannot_disappear(self):
        b,l,r=packet(NOW+1);bucket={'key':ID(3),'epoch':NOW//900000,'expiresAtMs':(NOW//900000+2)*900000,'attempts':[NOW]};b['sharedInventory']['admission']['addressBuckets']=[deepcopy(bucket)];self.assertFalse(self.checked(b,l,r));l['admission']['addressBuckets']=[{**bucket,'attempts':[]}];r['latestAdmission']=deepcopy(l['admission']);self.assertFalse(self.checked(b,l,r));l['admission']['addressBuckets']=[bucket];r['latestAdmission']=deepcopy(l['admission']);self.assertTrue(self.checked(b,l,r))
    def test_original_reserved_cannot_vanish_or_borrow_unrelated_effect(self):
        b,l,r=packet();old=b['sharedInventory']['admission']['reservations'][0];old.update(operationId=ID(8),phase='reserved',requestId=None,target=None);l['admission']['reservations']=[];r['latestAdmission']=deepcopy(l['admission']);self.assertFalse(self.checked(b,l,r))
    def test_phase_reversal_renewal_and_premature_reference_stripping_hold(self):
        for change in [lambda p:p.update(phase='armed'),lambda p:p.update(admittedAtMs=NOW+1),lambda p:p.update(requestId=ID(30)),lambda p:p.update(phase='expired',admittedAtMs=None,operationId=None,requestId=None,target=None)]:
            b,l,r=packet();change(l['admission']['reservations'][0]);r['latestAdmission']=deepcopy(l['admission']);self.assertFalse(self.checked(b,l,r))
    def test_private_fields_types_duplicates_and_caps_are_not_retained(self):
        for mutate in [lambda a:a.update(details='INVENTED_PRIVATE_CANARY'),lambda a:a['reservations'][0].update(details='CANARY'),lambda a:a['reservations'].append(deepcopy(a['reservations'][0])),lambda a:a.update(acceptedAtMs=[True]),lambda a:a.update(acceptedAtMs=[NOW]*61)]:
            b,l,r=packet();mutate(l['admission']);r['latestAdmission']=deepcopy(l['admission']);self.assertFalse(self.checked(b,l,r))
    def test_source_bound_inventory_and_plan_roots_are_closed(self):
        for mutate in [lambda b,l,r:r.update(writerEnabled=0),lambda b,l,r:r.update(admissionHeld=1),lambda b,l,r:b.update(schemaVersion=True),lambda b,l,r:l.update(schemaVersion=True),lambda b,l,r:b['sharedInventory']['writeInventory'].update(known=1),lambda b,l,r:b['sharedInventory']['writeInventory']['records'][0]['lifecycle'].update(receivedAtMs=NOW+1)]:
            b,l,r=packet();mutate(b,l,r);self.assertFalse(self.checked(b,l,r))
    def test_child_plan_never_borrows_only_equal_admission_from_foreign_source(self):
        b,l,r=packet();l['writeInventory']['executionId']=ID(66);self.assertFalse(self.checked(b,l,r))
    def test_original_copy_expiry_requires_historical_body_removal(self):
        b,l,r=packet(NOW+7*DAY);self.assertTrue(self.checked(b,l,r));r['recordActions'][0]['payload']='keep';self.assertFalse(self.checked(b,l,r))
    def test_boolean_epoch_expiry_and_attempt_timestamps_hold(self):
        for field,value in [('epoch',True),('expiresAtMs',True),('attempts',[True]),('attempts',[NOW+1,NOW])]:
            b,l,r=packet(NOW+1);bucket={'key':ID(3),'epoch':NOW//900000,'expiresAtMs':(NOW//900000+2)*900000,'attempts':[NOW]};bucket[field]=value;l['admission']['addressBuckets']=[bucket];r['latestAdmission']=deepcopy(l['admission']);self.assertFalse(self.checked(b,l,r))
if __name__=='__main__':unittest.main()
