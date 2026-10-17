"""Pure independently expected original document reopening; no database I/O."""
import base64
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import json
import unittest
from tests.test_feed_capture_reopen import fixture as feed_fixture,encode
from tests.test_document_result_contract import request as result_request,stored_shape
from tests.test_feed_postgres_contract import uid
from tests.test_document_passage_binding import AT
from workers.feed_capture_reopen import parse_reopened_capture
from workers.feed_postgres_contract import _time
from workers.document_result_reopen import (DocumentReopenError,prepare_document_reopen,parse_reopened_document,confirm_reopened_document_result)


def fixture():
 expected=result_request();_,page,feed_request,feed_response,feed_at=feed_fixture(expected.feed_capture)
 feed=parse_reopened_capture(encode(feed_response),feed_request,observed_at=feed_at)
 stored=stored_shape(expected);history=encode(dict(item_id=expected.association.feed_item_id,page=page,outcomes=[stored['outcome']]))
 at=AT+timedelta(seconds=13)
 request=prepare_document_reopen(feed,encode(page),history,binding=expected.binding,mapping=expected.mapping,association=expected.association,observed_at=at)
 response=dict(schema_version=1,kind='invented_document_reopened_original',request=json.loads(request.canonical_input),
  raw_base64=base64.b64encode(expected.document_raw).decode(),artifact_id=stored['artifact_id'],stored_at=stored['stored_at'],observed_at=_time(at+timedelta(seconds=1)))
 return expected,request,response,stored,at+timedelta(seconds=2)


class DocumentResultReopenTests(unittest.TestCase):
 def test_actual_original_reconstructs_full_existing_request_and_complete_receipt(self):
  expected,request,response,stored,at=fixture();reopened=parse_reopened_document(encode(response),request,observed_at=at)
  self.assertEqual(reopened.result_request.document_raw,expected.document_raw)
  self.assertEqual(reopened.result_request.canonical_input,expected.canonical_input)
  result=confirm_reopened_document_result(encode(stored),reopened,observed_at=at)
  self.assertEqual(result.result.snapshot.passages[0].text,'Invented original passage.')
  self.assertIn('readback_still_required',reopened.evidence_state)
  self.assertIn('repeatable read read only',request.statement())

 def test_absent_or_failed_history_does_not_invent_a_result(self):
  expected,r,v,s,at=fixture()
  for outcomes in [[],[{**s['outcome'],'state':'failed'}]]:
   history=encode(dict(item_id=expected.association.feed_item_id,page=json.loads(r.page_receipt),outcomes=outcomes))
   with self.assertRaises(DocumentReopenError):prepare_document_reopen(r.feed,r.page_receipt,history,binding=r.binding,mapping=r.mapping,association=r.association,observed_at=at)

 def test_independent_association_and_mapping_identity_are_required(self):
  e,r,v,s,at=fixture()
  for values in [dict(binding=None),dict(association=replace(r.association,feed_item_id=uid(99))),
   dict(mapping=replace(r.mapping,mapping_sha256='f'*64)),dict(mapping=replace(r.mapping,language_code='nb'))]:
   args=dict(binding=r.binding,mapping=r.mapping,association=r.association,observed_at=at);args.update(values)
   with self.assertRaises(DocumentReopenError):prepare_document_reopen(r.feed,r.page_receipt,r.history_raw,**args)

 def test_mutable_forged_context_and_changed_history_refuse_before_sql(self):
  e,r,v,s,at=fixture()
  for changed in [replace(r,canonical_input=bytearray(r.canonical_input)),replace(r,canonical_input=b'{}'),replace(r,history_raw=b'{}'),replace(r,page_receipt=b'{}')]:
   with self.assertRaises(DocumentReopenError):changed.statement()

 def test_native_response_keys_request_artifact_and_version_are_closed(self):
  e,r,v,s,at=fixture()
  for change in [lambda x:x.update(extra=True),lambda x:x.update(schema_version=True),lambda x:x.update(kind='authority'),
   lambda x:x.update(artifact_id='bad'),lambda x:x['request']['binding'].update(language_code='nb')]:
   changed=deepcopy(v);change(changed)
   with self.assertRaises(DocumentReopenError):parse_reopened_document(encode(changed),r,observed_at=at)

 def test_wrong_original_hash_base64_utf8_and_bounds_refuse(self):
  e,r,v,s,at=fixture()
  for data in ['!','',None,v['raw_base64']+'\n',base64.b64encode(b'other').decode(),base64.b64encode(b'X'*65537).decode()]:
   with self.assertRaises(DocumentReopenError):parse_reopened_document(encode({**v,'raw_base64':data}),r,observed_at=at)
  with self.assertRaises(DocumentReopenError):parse_reopened_document(b'x'*131073,r,observed_at=at)

 def test_current_binding_cannot_be_replaced_with_historical_echo(self):
  e,r,v,s,at=fixture();foreign=replace(r.binding,content_sha256='f'*64);mapping=replace(r.mapping,content_sha256='f'*64);association=replace(r.association,document_content_sha256='f'*64)
  rr=prepare_document_reopen(r.feed,r.page_receipt,r.history_raw,binding=foreign,mapping=mapping,association=association,observed_at=r.observed_at)
  # Even a matching forged request echo cannot make the old bytes match a new
  # independent digest. A real native call additionally compares stored binding.
  with self.assertRaises(DocumentReopenError):parse_reopened_document(encode({**v,'request':json.loads(rr.canonical_input)}),rr,observed_at=at)

 def test_clock_cannot_predate_processed_event_or_reopen_request(self):
  e,r,v,s,at=fixture()
  for key,bad in [('stored_at',_time(AT)),('observed_at',_time(at+timedelta(seconds=1))),('observed_at',_time(AT))]:
   with self.assertRaises(DocumentReopenError):parse_reopened_document(encode({**v,key:bad}),r,observed_at=at)
  with self.assertRaises(DocumentReopenError):parse_reopened_document(encode(v),r,observed_at=at.replace(tzinfo=None))

 def test_complete_result_must_match_artifact_time_original_mapping_and_page(self):
  e,r,v,s,at=fixture();reopened=parse_reopened_document(encode(v),r,observed_at=at)
  for change in [lambda x:x.update(artifact_id=uid(99)),lambda x:x['input']['mapping']['spans'][0].update(start=True),
   lambda x:x['input']['snapshot']['passages'][0].update(text='changed'),lambda x:x['page'].update(page_id=uid(99))]:
   changed=deepcopy(s);change(changed)
   with self.assertRaises(DocumentReopenError):confirm_reopened_document_result(encode(changed),reopened,observed_at=at)
  with self.assertRaises(DocumentReopenError):confirm_reopened_document_result(encode(s),replace(reopened,artifact_id=uid(99)),observed_at=at)

 def test_changed_exact_spans_refuse_complete_historical_result(self):
  e,r,v,s,at=fixture();mapping=replace(r.mapping,spans=(replace(r.mapping.spans[0],start=1),))
  rr=prepare_document_reopen(r.feed,r.page_receipt,r.history_raw,binding=r.binding,mapping=mapping,association=r.association,observed_at=r.observed_at)
  reopened=parse_reopened_document(encode(v),rr,observed_at=at)
  with self.assertRaises(DocumentReopenError):confirm_reopened_document_result(encode(s),reopened,observed_at=at)

if __name__=='__main__':unittest.main()
