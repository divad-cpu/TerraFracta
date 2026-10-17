"""Historical metadata is only a candidate; no raw text or trust conversion."""
from copy import deepcopy
from dataclasses import asdict,replace
from datetime import timedelta
import json
import unittest
from unittest.mock import patch
from tests.test_document_result_reopen import fixture as document_fixture
from tests.test_feed_capture_reopen import fixture as feed_fixture,encode
from tests.test_feed_postgres_contract import uid
from workers.document_result_reopen import parse_reopened_document
from workers.document_passage_binding import DocumentPassageBinding
from workers.document_result_contract import FeedDocumentAssociation
from workers.feed_postgres_contract import _time
from workers.stored_document_reference import (StoredDocumentReferenceError,HistoricalStoredDocumentReference,
 stored_document_reference_statement,parse_stored_document_reference,MAX_REFERENCE_OUTPUT)


def fixture(*,present=True):
 expected,document,response,stored,at=document_fixture();request=document.feed.request;b=expected.binding
 reference=dict(artifact_id=stored['artifact_id'],operation_id=expected.operation_id,outcome_revision=1,stored_at=stored['stored_at'],
  source_key=b.source_key,item_key=b.item_key,source_version_id=b.source_version_id,source_url=b.source_url,content_sha256=b.content_sha256,
  retrieved_at=_time(b.retrieved_at),mapping_sha256=b.mapping_sha256,language_code=b.language_code,
  feed_capture_operation_id=expected.feed_capture.operation_id,feed_stream_id=expected.feed_capture.stream_id,
  feed_page_id=stored['page']['page_id'],feed_item_id=expected.association.feed_item_id)
 value=dict(schema_version=1,kind='invented_stored_document_reference',request=json.loads(request.canonical_input),reference=reference if present else None,observed_at=_time(at))
 return request,value,at+timedelta(seconds=1)


class StoredDocumentReferenceTests(unittest.TestCase):
 def test_exact_fixed_read_route_preserves_checked_occurrence_and_context(self):
  request,_,_=fixture();sql=stored_document_reference_statement(request)
  self.assertEqual(sql,request.statement().replace('select tf_feed_reopen.original(','select tf_feed_runtime.document_reference(',1))
  self.assertIn('repeatable read read only',sql)
  self.assertTrue(sql.endswith('\\echo TF_INVENTED_FEED_COMMITTED\n'))

 def test_reference_is_closed_historical_candidate_not_binding_or_association(self):
  request,value,at=fixture();result=parse_stored_document_reference(encode(value),request,observed_at=at)
  self.assertIs(type(result.reference),HistoricalStoredDocumentReference)
  self.assertNotIsInstance(result.reference,DocumentPassageBinding);self.assertNotIsInstance(result.reference,FeedDocumentAssociation)
  self.assertEqual(result.reference.feed_item_id,request.item_id)
  self.assertIn('not_independent_trust',result.reference.evidence_state)
  self.assertNotIn('raw',asdict(result.reference));self.assertNotIn('spans',asdict(result.reference))
  self.assertNotIn('snapshot',asdict(result.reference));self.assertNotIn('binding',asdict(result.reference))

 def test_absence_is_for_exact_occurrence_not_a_first_observation_or_global_history(self):
  request,value,at=fixture(present=False);result=parse_stored_document_reference(encode(value),request,observed_at=at)
  self.assertIsNone(result.reference);self.assertEqual(result.request.item_id,request.item_id)
  self.assertEqual(result.evidence_state,'invented_single_occurrence_document_reference_only')

 def test_untyped_subclass_mutable_or_forged_request_refuses_before_sql(self):
  request,value,at=fixture();calls=[]
  class Decoder(bytes):
   def decode(self,*args,**kwargs):calls.append(True);return '{}'
  class Child(type(request)):pass
  for bad in [None,{},'select anything();',Child(**request.__dict__),replace(request,canonical_input=b'{}'),replace(request,canonical_input=bytearray(request.canonical_input)),replace(request,canonical_input=Decoder(request.canonical_input))]:
   with self.assertRaises(ValueError):stored_document_reference_statement(bad)
   with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode(value),bad,observed_at=at)
  self.assertEqual(calls,[])

 def test_outer_echo_version_kind_duplicate_keys_and_unbounded_body_refuse(self):
  request,value,at=fixture()
  for mutate in [lambda v:v.update(extra=True),lambda v:v.update(schema_version=True),lambda v:v.update(kind='trusted_source'),
   lambda v:v['request'].update(item_id=uid(99)),lambda v:v.pop('reference')]:
   changed=deepcopy(value);mutate(changed)
   with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode(changed),request,observed_at=at)
  for raw in [b'{"x":1,"x":2}',b'{"x":NaN}',b'[]',b'x'*(MAX_REFERENCE_OUTPUT+1),bytearray(encode(value))]:
   with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(raw,request,observed_at=at)

 def test_foreign_occurrence_or_feed_version_alias_cannot_be_reference(self):
  request,value,at=fixture()
  for key in ['feed_capture_operation_id','feed_stream_id','feed_page_id','feed_item_id']:
   changed=deepcopy(value);changed['reference'][key]=uid(99)
   with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode(changed),request,observed_at=at)
  changed=deepcopy(value);changed['reference']['source_version_id']=request.inventory_request.scope.collection_id
  # A different valid historical document version is a candidate, not trusted.
  self.assertEqual(parse_stored_document_reference(encode(changed),request,observed_at=at).reference.source_version_id,request.inventory_request.scope.collection_id)
  source=json.loads(request.inventory_raw)['rows'][0]['source_version_id'];changed['reference']['source_version_id']=source
  with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode(changed),request,observed_at=at)

 def test_reference_shape_types_hashes_and_individual_identity_fields_are_closed(self):
  request,value,at=fixture()
  for key,bad in [('artifact_id','bad'),('operation_id','bad'),('outcome_revision',True),('outcome_revision',0),('outcome_revision',9),
   ('source_key','actual-unapproved'),('item_key',' padded '),('source_url','http://127.0.0.1/private'),('content_sha256','f'*63),('mapping_sha256','x'*64),('language_code','invalid_language')]:
   changed=deepcopy(value);changed['reference'][key]=bad
   with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode(changed),request,observed_at=at)
  for mutate in [lambda r:r.update(raw_base64='private'),lambda r:r.update(spans=[]),lambda r:r.pop('mapping_sha256')]:
   changed=deepcopy(value);mutate(changed['reference'])
   with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode(changed),request,observed_at=at)

 def test_native_caller_retrieval_and_store_chronology_are_separate(self):
  request,value,at=fixture()
  for field,bad in [('observed_at',_time(at+timedelta(seconds=1))),('observed_at','2026-10-13T00:00:00.000000Z')]:
   with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode({**value,field:bad}),request,observed_at=at)
  for key,bad in [('stored_at',_time(at+timedelta(seconds=1))),('stored_at','2026-10-14T00:00:00.000000Z'),('retrieved_at','2026-10-13T00:00:00.000000Z')]:
   changed=deepcopy(value);changed['reference'][key]=bad
   with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode(changed),request,observed_at=at)
  with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode(value),request,observed_at=at.replace(tzinfo=None))

 def test_present_artifact_cannot_predate_confirmed_parent_page(self):
  request,value,at=fixture();feed=json.loads(request.inventory_raw)['rows'][0]
  changed=deepcopy(value)
  changed['reference']['retrieved_at']=feed['source_retrieved_at']
  from datetime import datetime
  page=datetime.fromisoformat(feed['page_stored_at'])
  changed['reference']['stored_at']=_time(page-timedelta(microseconds=1))
  with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode(changed),request,observed_at=at)
  changed['reference']['stored_at']=_time(page)
  self.assertIsNotNone(parse_stored_document_reference(encode(changed),request,observed_at=at).reference)

 def test_known_terminal_history_operation_revision_and_time_are_not_replaced(self):
  from workers.feed_capture_reopen import prepare_capture_reopen
  request,value,at=fixture();_,_,_,stored,_=document_fixture()
  inv=json.loads(request.inventory_raw);inv['rows'][0]['outcomes']=[stored['outcome']];inv['observed_at']=_time(at-timedelta(seconds=3))
  checked=prepare_capture_reopen(request.inventory_request,encode(inv),observed_at=at-timedelta(seconds=2),item_id=request.item_id)
  value['request']=json.loads(checked.canonical_input)
  self.assertIsNotNone(parse_stored_document_reference(encode(value),checked,observed_at=at).reference)
  for key,bad in [('operation_id',uid(99)),('outcome_revision',2),('stored_at','2026-10-15T00:00:10.999999Z')]:
   changed=deepcopy(value);changed['reference'][key]=bad
   with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode(changed),checked,observed_at=at)

 def test_later_processed_candidate_cannot_reuse_any_known_failed_operation(self):
  from workers.feed_capture_reopen import prepare_capture_reopen
  request,value,at=fixture();_,_,_,stored,_=document_fixture()
  inv=json.loads(request.inventory_raw)
  first={**stored['outcome'],'state':'failed','recorded_at':'2026-10-15T00:00:10.000000+00:00'}
  last={**stored['outcome'],'operation_id':uid(42),'revision':2,'state':'failed'}
  inv['rows'][0]['outcomes']=[first,last];inv['observed_at']=_time(at-timedelta(seconds=3))
  checked=prepare_capture_reopen(request.inventory_request,encode(inv),observed_at=at-timedelta(seconds=2),item_id=request.item_id)
  value['request']=json.loads(checked.canonical_input);value['reference']['outcome_revision']=3
  for known in [first['operation_id'],last['operation_id']]:
   value['reference']['operation_id']=known
   with self.assertRaises(StoredDocumentReferenceError):parse_stored_document_reference(encode(value),checked,observed_at=at)
  value['reference']['operation_id']=uid(43)
  self.assertEqual(parse_stored_document_reference(encode(value),checked,observed_at=at).reference.outcome_revision,3)

 def test_curated_refusal_never_echoes_historical_private_identity(self):
  request,value,at=fixture();value['reference']['source_key']='PRIVATE_CANARY /home/private'
  with self.assertRaises(StoredDocumentReferenceError) as caught:parse_stored_document_reference(encode(value),request,observed_at=at)
  self.assertEqual(str(caught.exception),'stored_document_reference_unavailable')


class DocumentReferenceTrialScopeTests(unittest.TestCase):
 def test_extra_arguments_refuse_before_any_resource(self):
  from scripts import rehearse_document_reference as module
  with patch.object(module.sys,'argv',['trial','existing-target']),patch.object(module,'FreshFeedPostgres') as constructor:
   with self.assertRaises(module.FeedPgTrialError):module.main()
   constructor.assert_not_called()

 def test_foreign_or_fake_installer_refuses_before_any_query(self):
  from types import SimpleNamespace
  from unittest.mock import Mock
  from scripts.rehearse_document_reference import install_reference,FeedPgTrialError
  from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
  trial=SimpleNamespace(query=Mock());foreign=SimpleNamespace(query=Mock())
  for roles in [OwnedRuntimeRoles(foreign),SimpleNamespace(trial=trial)]:
   with self.assertRaises(FeedPgTrialError):install_reference(trial,roles)
  trial.query.assert_not_called();foreign.query.assert_not_called()

 def test_installer_uses_only_frozen_fixture_between_role_verifications(self):
  from types import SimpleNamespace
  from unittest.mock import Mock
  from scripts.rehearse_document_reference import install_reference,FIXTURE
  from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
  events=[];trial=SimpleNamespace(frozen={FIXTURE:b'-- reference\n'},query=Mock(side_effect=lambda sql:events.append(sql)))
  roles=OwnedRuntimeRoles(trial);roles.verify=Mock(side_effect=lambda:events.append('verify'))
  install_reference(trial,roles)
  self.assertEqual(events,['verify',"begin;set local statement_timeout='10s';-- reference\ncommit;",'verify'])

 def test_failed_case_still_stops_both_owned_resources_and_checks_sources(self):
  from scripts import rehearse_document_reference as module
  from unittest.mock import Mock
  trial=Mock();trial.identity='owned';events=[]
  trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer')
  trial.verify_sources.side_effect=lambda label:events.append(label);trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
  with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial),patch.object(module,'freeze_all'),patch.object(module,'freeze_reference'),patch.object(module,'cases',side_effect=RuntimeError('invented')):
   with self.assertRaises(RuntimeError):module.main()
  self.assertEqual(events,['stop','initializer','FINAL_DOCUMENT_REFERENCE','inspect'])
  self.assertTrue(any(c.args[0]=='DOCUMENT_REFERENCE_FAILED' for c in trial.record.call_args_list))


if __name__=='__main__':unittest.main()
