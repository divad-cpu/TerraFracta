"""Two mandatory retained vintages; existing selection/compile rules decide."""
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
from workers.document_result_reopen import prepare_document_reopen,parse_reopened_document
from workers.document_passage_binding import DocumentByteSpan
from workers.document_passage_comparison import compare_document_passages
from workers.passage_extraction_request import compile_extraction_request,ExtractionRequestError
from workers.reopened_document_change import prepare_reopened_document_change,ReopenedDocumentChangeError
NOW=AT+timedelta(seconds=20)


def retained(text='Same',prefix='old metadata\n',version=30):
 raw=(prefix+text+'\nUnselected.').encode()
 expected=result_request(raw=raw,version=uid(version),spans=[DocumentByteSpan('section:one',len(prefix.encode()),len((prefix+text).encode()))])
 _,page,feed_request,feed_response,feed_at=feed_fixture(expected.feed_capture)
 feed=parse_reopened_capture(encode(feed_response),feed_request,observed_at=feed_at)
 stored=stored_shape(expected);history=encode(dict(item_id=expected.association.feed_item_id,page=page,outcomes=[stored['outcome']]))
 request=prepare_document_reopen(feed,encode(page),history,binding=expected.binding,mapping=expected.mapping,association=expected.association,observed_at=AT+timedelta(seconds=13))
 response=dict(schema_version=1,kind='invented_document_reopened_original',request=json.loads(request.canonical_input),raw_base64=base64.b64encode(raw).decode(),artifact_id=stored['artifact_id'],stored_at=stored['stored_at'],observed_at=_time(AT+timedelta(seconds=14)))
 return parse_reopened_document(encode(response),request,observed_at=AT+timedelta(seconds=15)),encode(stored)


def paired(new='Same'):
 return retained(new,'longer new metadata\n',31),retained()


class ReopenedDocumentChangeTests(unittest.TestCase):
 def test_metadata_only_original_change_keeps_both_receipts_and_zero_request(self):
  (now,nr),(old,pr)=paired();change=prepare_reopened_document_change(now,nr,old,pr,observed_at=NOW)
  compared=compare_document_passages(change.current,change.previous,observed_at=NOW)
  self.assertTrue(compared.source_bytes_changed);self.assertEqual(compared.selection.state,'no_model_work')
  self.assertNotEqual(change.current.mapping.spans,change.previous.mapping.spans)
  self.assertEqual(change.current.raw,now.result_request.document_raw);self.assertEqual(change.previous.raw,old.result_request.document_raw)
  with self.assertRaises(ExtractionRequestError):compile_extraction_request(change.current,change.previous,observed_at=NOW,maximum_output_tokens=100)

 def test_changed_selected_passage_compiles_exact_current_selection_with_prior_binding(self):
  (now,nr),(old,pr)=paired('Changed');change=prepare_reopened_document_change(now,nr,old,pr,observed_at=NOW)
  compiled=compile_extraction_request(change.current,change.previous,observed_at=NOW,maximum_output_tokens=100)
  selected=json.loads(compiled.body)['selected_payload']
  self.assertEqual(selected['passages'][0]['text'],'Changed');self.assertEqual(change.previous.binding,old.request.binding)
  self.assertNotIn('metadata',str(selected));self.assertNotIn('Unselected',str(selected))

 def test_absent_invalid_or_mutable_prior_cannot_fall_back_to_first_observation(self):
  (now,nr),(old,pr)=paired('Changed')
  for before,receipt in [(None,None),(old,None),(old,b'{}'),(old,bytearray(pr)),(replace(old,result_request=replace(old.result_request,document_raw=b'bad')),pr)]:
   with self.assertRaises(ReopenedDocumentChangeError):prepare_reopened_document_change(now,nr,before,receipt,observed_at=NOW)

 def test_each_complete_receipt_identity_input_and_passage_is_required(self):
  (now,nr),(old,pr)=paired('Changed')
  for target in ['now','old']:
   for mutate in [lambda v:v.update(artifact_id=uid(99)),lambda v:v['input']['snapshot']['passages'][0].update(text='forged'),lambda v:v['outcome'].update(state='failed')]:
    value=json.loads(nr if target=='now' else pr);mutate(value)
    with self.assertRaises(ReopenedDocumentChangeError):prepare_reopened_document_change(now,encode(value) if target=='now' else nr,old,encode(value) if target=='old' else pr,observed_at=NOW)

 def test_forged_reopened_response_or_canonical_decoder_refuses(self):
  (now,nr),(old,pr)=paired('Changed');calls=[]
  class Decoder(bytes):
   def decode(self,*args,**kwargs):calls.append(True);return '{}'
  for changed in [replace(now,response_raw=b'{}'),replace(now,request=replace(now.request,canonical_input=Decoder(now.request.canonical_input))),replace(now,artifact_id=uid(99)),replace(now,result_request=replace(now.result_request,canonical_input=bytearray(now.result_request.canonical_input)))]:
   with self.assertRaises(ReopenedDocumentChangeError):prepare_reopened_document_change(changed,nr,old,pr,observed_at=NOW)
  self.assertEqual(calls,[])

 def test_closed_types_and_observation_must_confirm_both_vintages(self):
  (now,nr),(old,pr)=paired();
  for current,receipt,at in [(None,nr,NOW),(now,None,NOW),(now,memoryview(nr),NOW),(now,nr,AT),(now,nr,NOW.replace(tzinfo=None))]:
   with self.assertRaises(ReopenedDocumentChangeError):prepare_reopened_document_change(current,receipt,old,pr,observed_at=at)

 def test_reused_version_changed_bytes_follows_existing_comparison_refusal(self):
  now,nr=retained('Changed','new metadata\n',30);old,pr=retained()
  with self.assertRaises(ReopenedDocumentChangeError):prepare_reopened_document_change(now,nr,old,pr,observed_at=NOW)

 def test_refusal_does_not_echo_original_or_private_paths(self):
  (now,nr),(old,pr)=paired();bad=replace(old,result_request=replace(old.result_request,document_raw=b'PRIVATE_CANARY /home/private'))
  with self.assertRaises(ReopenedDocumentChangeError) as raised:prepare_reopened_document_change(now,nr,bad,pr,observed_at=NOW)
  self.assertEqual(str(raised.exception),'reopened_document_change_unavailable')


class ReopenedChangeTrialScopeTests(unittest.TestCase):
 def test_extra_arguments_refuse_before_any_owned_resource(self):
  from scripts import rehearse_reopened_change as module
  from unittest.mock import patch
  with patch.object(module.sys,'argv',['trial','existing-target']),patch.object(module,'FreshFeedPostgres') as constructor:
   with self.assertRaises(module.FeedPgTrialError):module.main()
   constructor.assert_not_called()

 def test_failed_case_stops_both_resources_and_checks_final_sources(self):
  from scripts import rehearse_reopened_change as module
  from unittest.mock import Mock,patch
  trial=Mock();trial.identity='owned';events=[]
  trial.stop.side_effect=lambda:events.append('stop');trial.stop_initializer.side_effect=lambda:events.append('initializer')
  trial.verify_sources.side_effect=lambda label:events.append(label);trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
  with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial),patch.object(module,'freeze_all'),patch.object(module,'freeze_change'),patch.object(module,'cases',side_effect=RuntimeError('invented')):
   with self.assertRaises(RuntimeError):module.main()
  self.assertEqual(events,['stop','initializer','FINAL_REOPENED_CHANGE','inspect'])
  self.assertTrue(any(c.args[0]=='REOPENED_CHANGE_FAILED' for c in trial.record.call_args_list))


if __name__=='__main__':unittest.main()
