"""Historical metadata discovery never substitutes full parts or retained intent."""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import json,unittest
from tests.test_detached_proposal_report import fixture
from tests.test_private_extraction_held_proposal import encode
from tests.test_detached_proposal_custody import LATER
from tests.test_feed_postgres_contract import uid
from workers.feed_postgres_contract import _time
from workers.detached_proposal_inventory import (prepare_detached_proposal_inventory,parse_detached_proposal_inventory,DetachedProposalInventoryError)

AT=LATER+timedelta(seconds=1)
SERVER=AT+timedelta(seconds=1)
END=SERVER+timedelta(seconds=1)

def wire(request,item,*,count=1):
    meta=json.loads(item.result.intent.canonical_metadata);rows=[]
    for index in range(count):
        m=deepcopy(meta);m['operation_id']=uid(810+index)
        rows.append(dict(operation_id=m['operation_id'],artifact_id=uid(811+index),stored_at=_time(item.stored.stored_at),input=m))
    return dict(schema_version=1,kind='invented_detached_preparation_inventory',scope=json.loads(request.canonical_scope),principal='tf_feed_lab_owner',observed_at=_time(SERVER),candidates=rows)


class DetachedProposalInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.item=fixture();cls.request=prepare_detached_proposal_inventory(cls.item.result.extraction,observed_at=AT)
    def parse(self,v,**kw):return parse_detached_proposal_inventory(encode(v),self.request,observed_at=kw.get('observed_at',END))
    def test_fixed_read_scope_binds_actual_full_private_receipt_and_returns_only_metadata(self):
        sql=self.request.statement()
        self.assertIn('repeatable read read only',sql);self.assertIn('limit 51',sql);self.assertIn('tf_private_extraction.result_receipt(',sql)
        self.assertIn('extraction_full_receipt_sha256',sql);self.assertNotIn('payload_raw',sql);self.assertNotIn('context_raw,',sql)
        self.assertNotIn('Changed exact',sql);self.assertNotIn('insert ',sql);self.assertLess(len(sql.encode()),294912)
        result=self.parse(wire(self.request,self.item));self.assertEqual(result.candidates[0].intent,self.item.result.intent)
        self.assertNotIn('full_parts',result.evidence_state);self.assertNotIn('Changed exact',repr(result))
    def test_empty_many_and_exact_fifty_are_metadata_without_auto_choice(self):
        for count in (0,2,50):
            result=self.parse(wire(self.request,self.item,count=count));self.assertEqual(len(result.candidates),count)
            self.assertIn('explicit_independent_intent_required',result.evidence_state)
        with self.assertRaises(DetachedProposalInventoryError):self.parse(wire(self.request,self.item,count=51))
    def test_duplicate_operation_artifact_unsorted_and_malformed_metadata_refuse_whole(self):
        for change in [lambda x:x['candidates'][1].update(operation_id=x['candidates'][0]['operation_id']),
                lambda x:x['candidates'][1].update(artifact_id=x['candidates'][0]['artifact_id']),lambda x:x['candidates'].reverse(),
                lambda x:x['candidates'][0]['input'].update(operation_id=uid(999)),lambda x:x['candidates'][0]['input'].update(schema_version=True),
                lambda x:x['candidates'][0]['input'].update(extra='PRIVATE_CANARY'),lambda x:x['candidates'][0].update(extra=True)]:
            v=wire(self.request,self.item,count=2);change(v)
            with self.assertRaisesRegex(DetachedProposalInventoryError,'^detached_proposal_inventory_unavailable$'):self.parse(v)
    def test_foreign_artifact_request_output_or_scope_and_wrong_principal_refuse(self):
        for change in [*[lambda x,k=k:x['candidates'][0]['input'].update({k:uid(999) if k.endswith('_id') else 'f'*64}) for k in
                ('extraction_operation_id','extraction_artifact_id','extraction_request_sha256','extraction_output_sha256')],
                lambda x:x['scope'].update(extraction_full_receipt_sha256='f'*64),lambda x:x.update(principal='tf_feed_lab_observer'),lambda x:x.update(schema_version=True)]:
            v=wire(self.request,self.item);change(v)
            with self.assertRaises(DetachedProposalInventoryError):self.parse(v)
    def test_historical_and_server_times_have_exact_bounds_without_current_qualification(self):
        v=wire(self.request,self.item);v['candidates'][0]['stored_at']=_time(self.item.result.prepared_at-timedelta(microseconds=1))
        with self.assertRaises(DetachedProposalInventoryError):self.parse(v)
        for at in (AT-timedelta(microseconds=1),END+timedelta(microseconds=1)):
            v=wire(self.request,self.item);v['observed_at']=_time(at)
            with self.assertRaises(DetachedProposalInventoryError):self.parse(v)
        # Metadata may describe a newly stored row after the supplied artifact
        # observation. Selection must require a later complete artifact read.
        v=wire(self.request,self.item);v['candidates'][0]['stored_at']=_time(LATER+timedelta(microseconds=1))
        self.assertEqual(self.parse(v).candidates[0].stored_at,LATER+timedelta(microseconds=1))
    def test_invalid_full_artifact_request_mutation_and_exact_raw_types_refuse(self):
        for extraction in (None,replace(self.item.result.extraction,full_receipt=b'{}')):
            with self.assertRaises(DetachedProposalInventoryError):prepare_detached_proposal_inventory(extraction,observed_at=AT)
        bad=replace(self.request,canonical_scope=self.request.canonical_scope+b' ')
        with self.assertRaises(DetachedProposalInventoryError):bad.statement()
        for raw in (bytearray(encode(wire(self.request,self.item))),b' '*98305,b'{"schema_version":1,"schema_version":1}'):
            with self.assertRaises(DetachedProposalInventoryError):parse_detached_proposal_inventory(raw,self.request,observed_at=END)

if __name__=='__main__':unittest.main()
