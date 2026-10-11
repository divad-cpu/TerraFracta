"""Synthetic two-phase receipts; zero native command/database execution."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
SOURCE=Path(__file__).resolve().parents[1]/'scripts/contact_free_combined_write_receipt.py'
spec=importlib.util.spec_from_file_location('closed_shared_receipt',SOURCE);decoder=importlib.util.module_from_spec(spec)
with patch.object(sys,'path',[str(SOURCE.parent),*sys.path]):spec.loader.exec_module(decoder)
CONTAINER='terrafracta_write_node_20261008t120219z_ae916a76'
TICKET='e7600000-0000-4000-8000-000000000001'

def packet(phase='first'):
    inspect=['docker','--host','unix:///var/run/docker.sock','inspect',CONTAINER,'--format',decoder.INSPECT_FORMAT]
    sql=['docker','--host','unix:///var/run/docker.sock','exec','-i',CONTAINER,decoder.BIN+'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']
    return {'schemaVersion':1,'evidenceKind':'invented_native_combined_write_chain','phase':phase,'completed':True,'failureLabel':None,
            'assertions':[{'label':label,'pass':True} for label in sorted(decoder.EXPECTED[phase])],
            'commands':[{'command':command,'exitCode':0,'timedOut':False} for command in [inspect,sql]],
            'ticket':TICKET if phase=='first' else None,'proofOwnerVerified':True,'primaryDatabaseTouched':False,
            'actualSourceRequests':0,'liveIntakeEnabled':False,'hostAuthenticationVerified':False,'actualServiceRestartVerified':False}

class ClosedSharedWorkerReceipt(unittest.TestCase):
    def decode(self,p,phase='first'):return decoder.decode_combined_write_receipt(json.dumps(p),CONTAINER,phase)
    def test_both_complete_phase_contracts_are_detached(self):
        for phase in ['first','replacement']:
            p=packet(phase);result=self.decode(p,phase);self.assertEqual(result,p)
            p['commands'][0]['command'][4]='foreign';self.assertEqual(result['commands'][0]['command'][4],CONTAINER)
    def test_each_required_boolean_is_typed_and_live_claims_refused(self):
        for key in ['completed','proofOwnerVerified','primaryDatabaseTouched','liveIntakeEnabled','hostAuthenticationVerified','actualServiceRestartVerified']:
            for value in [0,1,None,'false',[]]:
                p=packet();p[key]=value;self.assertIsNone(self.decode(p))
        for key in ['primaryDatabaseTouched','liveIntakeEnabled','hostAuthenticationVerified','actualServiceRestartVerified']:
            p=packet();p[key]=True;self.assertIsNone(self.decode(p))
    def test_complete_phase_requires_its_owned_uuid_ticket(self):
        for value in [None,'CANARY','e7600000-0000-0000-0000-000000000001',1,{},TICKET.upper()]:
            p=packet();p['ticket']=value;self.assertIsNone(self.decode(p))
        p=packet('replacement');p['ticket']=TICKET;self.assertIsNone(self.decode(p,'replacement'))
    def test_phase_cannot_relabel_missing_or_foreign_witnesses(self):
        for value in [None,'replacement','CANARY',1]:
            p=packet();p['phase']=value;self.assertIsNone(self.decode(p))
        p=packet();p['assertions'][0]['label']='replacement_body_unread';self.assertIsNone(self.decode(p))
    def test_missing_duplicate_unknown_and_typed_assertions_hold(self):
        for alter in [lambda p:p['assertions'].pop(),lambda p:p['assertions'].append(deepcopy(p['assertions'][0])),lambda p:p['assertions'][0].update(label='CANARY'),lambda p:p['assertions'][0].update(**{'pass':1})]:
            p=packet();alter(p);self.assertIsNone(self.decode(p))
    def test_nested_private_or_extra_output_never_returned(self):
        for location in ['root','assertion','command']:
            p=packet();(p if location=='root' else p['assertions'][0] if location=='assertion' else p['commands'][0])['details']='INVENTED_PRIVATE_CANARY';self.assertIsNone(self.decode(p))
        p=packet();p['failureLabel']='INVENTED_PRIVATE_CANARY';self.assertIsNone(self.decode(p))
    def test_complete_receipt_requires_owned_inspect_and_sql_commands(self):
        for select in [[],[packet()['commands'][0]],[packet()['commands'][1]],list(reversed(packet()['commands']))]:
            p=packet();p['commands']=select;self.assertIsNone(self.decode(p))
        for index,value in [(2,'tcp://foreign'),(5,'primary'),(6,'/host/secret')]:
            p=packet();p['commands'][1]['command'][index]=value;self.assertIsNone(self.decode(p))
    def test_command_status_types_and_failures_cannot_complete(self):
        for field,value in [('exitCode',False),('exitCode',None),('exitCode',1),('exitCode',256),('timedOut',0),('timedOut',True)]:
            p=packet();p['commands'][0][field]=value;self.assertIsNone(self.decode(p))
    def test_early_unverified_held_phase_has_no_actions(self):
        p=packet();p.update(phase=None,completed=False,proofOwnerVerified=False,assertions=[],commands=[],ticket=None)
        self.assertEqual(self.decode(p),p)
        p['commands']=packet()['commands'];self.assertIsNone(self.decode(p))
    def test_curated_partial_failure_is_kept_without_completing(self):
        p=packet();label=p['assertions'][0]['label'];p.update(completed=False,assertions=[{'label':label,'pass':False}],failureLabel=label,ticket=None)
        self.assertEqual(self.decode(p),p);p['failureLabel']=None;self.assertIsNone(self.decode(p))
    def test_nonobjects_duplicate_escaped_fields_and_byte_cap_hold(self):
        for text in ['null','[]','{}','{"schemaVersion":1,"schema\\u0056ersion":1}','INVENTED_PRIVATE_CANARY'+'x'*131072,'"'+'🙂'*40000+'"']:
            self.assertIsNone(decoder.decode_combined_write_receipt(text,CONTAINER,'first'))
    def test_integer_fields_do_not_accept_boolean_aliases(self):
        for key,value in [('schemaVersion',True),('actualSourceRequests',False),('actualSourceRequests',1)]:
            p=packet();p[key]=value;self.assertIsNone(self.decode(p))
if __name__=='__main__':unittest.main()
