"""Synthetic source-bound metadata decoder cases; no native command or database."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest
SOURCE=Path(__file__).resolve().parents[1]/'scripts/contact_free_write_recovery_trial.py'
spec=importlib.util.spec_from_file_location('write_restore_observation',SOURCE);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
NOW=1791453600000;DAY=86400000
def packet():
    target={'issueId':'e8700000-0000-4000-8000-000000000005','publicationId':'e8700000-0000-4000-8000-000000000006','revision':1,'jurisdictionSlug':'norway','issueSlug':'invented-only','claimId':None}
    record={'lifecycle':{'schemaVersion':1,'reportId':'e8700000-0000-4000-8000-000000000001','receivedAtMs':NOW,'closedAtMs':None,'erasedAtMs':None,'eraseReason':None},'requestId':'e8700000-0000-4000-8000-000000000002','target':target,'closedReason':None,'reviewerId':None,'version':1}
    op={'operationId':'e8700000-0000-4000-8000-000000000003','executionId':'e8700000-0000-4000-8000-000000000004','requestId':record['requestId'],'target':record['target'],'admittedAtMs':NOW,'expiresAtMs':NOW+180*DAY,'state':'recorded','reportId':record['lifecycle']['reportId'],'inserted':True}
    backup={'schemaVersion':1,'kind':'invented_write_backup_inventory','executionId':op['executionId'],'copiedAtMs':NOW,'records':[{'record':deepcopy(record),'hasPayload':True}],'operations':[deepcopy(op)]}
    latest={'schemaVersion':1,'kind':'invented_write_latest_inventory','executionId':op['executionId'],'complete':True,'known':True,'observedAtMs':NOW+DAY,'records':[deepcopy(record)],'operations':[deepcopy(op)]}
    result={'kind':'planned_invented_write_recovery','executionId':op['executionId'],'observedAtMs':NOW+DAY,'recordActions':[{'reportId':record['lifecycle']['reportId'],'backupVersion':1,'latestRecord':deepcopy(record),'payload':'keep'}],'operationActions':[{'operationId':op['operationId'],'backupOperation':deepcopy(op),'latestOperation':deepcopy(op)}]}
    return backup,latest,result
class WriteRestorePlanObservation(unittest.TestCase):
    def test_valid_plan_and_closed_held_are_accepted(self):
        b,l,r=packet();self.assertTrue(module.check_write_plan(r,b,l,NOW+DAY));self.assertTrue(module.check_write_plan({'kind':'held'},b,None,NOW+DAY))
    def test_private_root_nested_and_held_extras_are_rejected(self):
        for alter in [lambda r:r.update(details='INVENTED_PRIVATE_CANARY'),lambda r:r['recordActions'][0].update(details='INVENTED_PRIVATE_CANARY'),lambda r:r['operationActions'][0]['latestOperation'].update(details='INVENTED_PRIVATE_CANARY')]:
            b,l,r=packet();alter(r);self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY))
        self.assertFalse(module.check_write_plan({'kind':'held','details':'INVENTED_PRIVATE_CANARY'},*packet()[:2],NOW+DAY))
    def test_missing_duplicate_and_reassigned_actions_rejected(self):
        for alter in [lambda r:r['recordActions'].clear(),lambda r:r['recordActions'].append(deepcopy(r['recordActions'][0])),lambda r:r['operationActions'][0].update(operationId='foreign'),lambda r:r['operationActions'][0]['backupOperation'].update(inserted=False)]:
            b,l,r=packet();alter(r);self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY))
    def test_boolean_aliases_and_changed_original_utc_rejected(self):
        for alter in [lambda r:r.update(observedAtMs=True),lambda r:r['recordActions'][0].update(backupVersion=True),lambda r:r['recordActions'][0]['latestRecord'].update(version=True),lambda r:r['operationActions'][0]['latestOperation'].update(admittedAtMs=NOW+1)]:
            b,l,r=packet();alter(r);self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY))
    def test_exact_original_copy_expiry_requires_text_removal(self):
        b,l,r=packet();r['observedAtMs']=NOW+7*DAY;l['observedAtMs']=NOW+7*DAY;self.assertFalse(module.check_write_plan(r,b,l,NOW+7*DAY));r['recordActions'][0]['payload']='remove';self.assertTrue(module.check_write_plan(r,b,l,NOW+7*DAY))
    def test_newer_erasure_and_version_cannot_keep_historical_text(self):
        b,l,r=packet();record=l['records'][0];record['version']=2;record['lifecycle'].update(erasedAtMs=NOW+DAY,eraseReason='reporter_request');r['recordActions'][0]['latestRecord']=deepcopy(record)
        self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY));r['recordActions'][0]['payload']='remove';self.assertTrue(module.check_write_plan(r,b,l,NOW+DAY))
    def test_held_incomplete_foreign_or_stale_latest_context_cannot_qualify_planned_output(self):
        for field,value in [('known',False),('complete',False),('known',1),('complete',1),('executionId','foreign'),('observedAtMs',NOW+DAY+1),('observedAtMs',True),('schemaVersion',True)]:
            b,l,r=packet();l[field]=value;self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY))
    def test_source_matched_original_effect_or_received_epoch_changes_are_held(self):
        b,l,r=packet();l['operations'][0]['inserted']=False;r['operationActions'][0]['latestOperation']=deepcopy(l['operations'][0]);self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY))
        b,l,r=packet();l['records'][0]['lifecycle']['receivedAtMs']+=1;r['recordActions'][0]['latestRecord']=deepcopy(l['records'][0]);self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY))
    def test_source_matched_boolean_version_and_close_after_erasure_are_held(self):
        b,l,r=packet();l['records'][0]['version']=True;r['recordActions'][0]['latestRecord']=deepcopy(l['records'][0]);self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY))
        b,l,r=packet();p=l['records'][0];p.update(version=2,closedReason='corrected',reviewerId='e8700000-0000-4000-8000-000000000009');p['lifecycle'].update(erasedAtMs=NOW+1,eraseReason='reporter_request',closedAtMs=NOW+2);r['recordActions'][0].update(latestRecord=deepcopy(p),payload='remove');self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY))
    def test_empty_inventory_still_requires_closed_original_execution_and_roots(self):
        b,l,r=packet();b.update(records=[],operations=[]);l.update(records=[],operations=[]);r.update(recordActions=[],operationActions=[])
        self.assertTrue(module.check_write_plan(r,b,l,NOW+DAY))
        b['executionId']=l['executionId']=r['executionId']='INVENTED_PRIVATE_CANARY';self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY))
    def test_source_matched_nested_private_metadata_cannot_qualify_a_plan(self):
        b,l,r=packet();l['records'][0]['target']['details']='INVENTED_PRIVATE_CANARY';r['recordActions'][0]['latestRecord']=deepcopy(l['records'][0]);self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY))
    def test_exact_original_record_and_operation_expiry_requires_null_latest_actions(self):
        b,l,r=packet();cutoff=NOW+180*DAY;l['observedAtMs']=r['observedAtMs']=cutoff;r['recordActions'][0].update(latestRecord=None,payload='remove');r['operationActions'][0]['latestOperation']=None
        self.assertTrue(module.check_write_plan(r,b,l,cutoff))
        r['recordActions'][0]['latestRecord']=deepcopy(l['records'][0]);r['operationActions'][0]['latestOperation']=deepcopy(l['operations'][0]);self.assertFalse(module.check_write_plan(r,b,l,cutoff))
    def test_unbacked_latest_record_requires_nonnull_original_request_identity(self):
        b,l,r=packet();b.update(records=[],operations=[]);l['operations']=[];l['records'][0]['requestId']=None;r['operationActions']=[];r['recordActions'][0].update(backupVersion=None,latestRecord=deepcopy(l['records'][0]),payload='remove');self.assertFalse(module.check_write_plan(r,b,l,NOW+DAY))
if __name__=='__main__':unittest.main()
