"""Pure reopening contract checks; native proof is a separate invented trial."""
import base64
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import json
import unittest
from unittest.mock import patch
from tests.test_feed_postgres_contract import context,native_shape,uid
from tests.test_feed_collection_inventory import AT
from workers.feed_postgres_contract import _time,MAX_CAPTURE_OUTPUT
from workers.feed_window_lineage import InventedCollectionScope
from workers.feed_collection_inventory import prepare_inventory_request
from workers.feed_capture_reopen import (FeedReopenError,prepare_capture_reopen,parse_reopened_capture,confirm_reopened_page)


def fixture(context_override=None):
 c=context_override or context();p=native_shape(c);at=c.source.retrieved_at+timedelta(seconds=3)
 scope=InventedCollectionScope(uid(40),c.source.source_key,c.source.feed_url,c.format)
 request=prepare_inventory_request(scope,item_limit=1)
 cut=dict(window_revision=1,stream_id=c.stream_id,stream_revision=1,page_id=p['page_id'],page_stored_at=p['stored_at'],window_recorded_at=p['stored_at'])
 row=dict(window_revision=1,page_revision=1,position=1,stream_id=c.stream_id,page_id=p['page_id'],capture_operation_id=c.operation_id,
  item_id=p['items'][0]['item_id'],source_version_id=c.source.source_version_id,source_sha256=c.source.content_sha256,feed_url=c.source.feed_url,
  page_stored_at=p['stored_at'],source_retrieved_at=_time(c.source.retrieved_at),format=c.format,parser_identity=json.loads(c.canonical_input)['parser_identity'],
  locator=p['items'][0]['locator'],entry_id=p['items'][0]['entry_id'],held_reason=None,base_state='pending',outcomes=[])
 inv=dict(schema_version=1,kind='invented_collection_inventory_page',request=json.loads(request.canonical_input),cut=cut,rows=[row],has_more=False,next_cursor=None,observed_at=_time(at))
 reopen=prepare_capture_reopen(request,encode(inv),observed_at=at,item_id=row['item_id'])
 envelope=dict(schema_version=1,kind='invented_feed_reopened_original',request=json.loads(reopen.canonical_input),raw_base64=base64.b64encode(c.raw).decode(),
  source=p['source'],format=c.format,parser_identity=p['parser_identity'],allowed_next_url=c.allowed_next_url,expected_revision=c.expected_revision,
  stored_at=p['stored_at'],observed_at=_time(at+timedelta(seconds=1)))
 return c,p,reopen,envelope,at+timedelta(seconds=2)

def encode(v):return json.dumps(v,ensure_ascii=True,separators=(',',':')).encode()


class FeedCaptureReopenTests(unittest.TestCase):
 def test_reconstruct_exact_original_capture_without_preknown_context_argument(self):
  c,p,request,value,at=fixture();reopened=parse_reopened_capture(encode(value),request,observed_at=at)
  self.assertEqual(reopened.capture,c)
  self.assertEqual(confirm_reopened_page(encode(p),reopened,observed_at=at).items[0].item_state_record_id,request.item_id)
  self.assertIn('current_history_still_required',reopened.evidence_state)
  self.assertIn('repeatable read read only',request.statement())

 def test_selection_requires_reparsed_inventory_and_present_exact_item(self):
  c,p,r,v,at=fixture()
  for bad in [uid(99),'bad',None]:
   with self.assertRaises(FeedReopenError):prepare_capture_reopen(r.inventory_request,r.inventory_raw,observed_at=at,item_id=bad)
  changed=json.loads(r.inventory_raw);changed['rows'][0]['source_sha256']='bad'
  with self.assertRaises(FeedReopenError):prepare_capture_reopen(r.inventory_request,encode(changed),observed_at=at,item_id=r.item_id)

 def test_forged_request_bytes_and_caller_context_refuse_before_sql(self):
  c,p,r,v,at=fixture()
  for request in [replace(r,canonical_input=bytearray(r.canonical_input)),replace(r,canonical_input=memoryview(r.canonical_input)),replace(r,canonical_input=b'{}'),replace(r,inventory_raw=b'{}'),replace(r,item_id=uid(99)),replace(r,inventory_observed_at=at.replace(tzinfo=None))]:
   with self.assertRaises(FeedReopenError):request.statement()

 def test_complete_response_shape_echo_version_parser_revision_are_closed(self):
  c,p,r,v,at=fixture()
  for change in [lambda x:x.update(extra=True),lambda x:x.update(schema_version=True),lambda x:x.update(kind='authority'),
    lambda x:x['request'].update(item_id=uid(99)),lambda x:x.update(parser_identity='latest'),lambda x:x.update(format='html'),
    lambda x:x.update(expected_revision=True),lambda x:x.update(expected_revision=1)]:
   changed=deepcopy(v);change(changed)
   with self.assertRaises(FeedReopenError):parse_reopened_capture(encode(changed),r,observed_at=at)

 def test_original_bytes_base64_hash_and_size_must_match(self):
  c,p,r,v,at=fixture()
  for raw in ['!',None,'',v['raw_base64']+'\n',base64.b64encode(b'broken').decode(),base64.b64encode(b'x'*65537).decode()]:
   changed={**v,'raw_base64':raw}
   with self.assertRaises(FeedReopenError):parse_reopened_capture(encode(changed),r,observed_at=at)
  with self.assertRaises(FeedReopenError):parse_reopened_capture(b' '* (MAX_CAPTURE_OUTPUT+1),r,observed_at=at)

 def test_exact_source_binding_does_not_adopt_changed_identity_or_retrieval(self):
  c,p,r,v,at=fixture()
  for key,bad in [('source_key','fictional-other'),('source_version_id',uid(99)),('content_sha256','b'*64),('feed_url','https://example.org/feed.xml?x=2'),('retrieved_at',_time(at))]:
   changed=deepcopy(v);changed['source'][key]=bad
   with self.assertRaises(FeedReopenError):parse_reopened_capture(encode(changed),r,observed_at=at)

 def test_native_and_caller_clock_cannot_precede_inventory_or_exceed_observation(self):
  c,p,r,v,at=fixture()
  for key,bad in [('stored_at',_time(at)),('observed_at',_time(at+timedelta(seconds=1))),('observed_at',_time(at-timedelta(seconds=3)))]:
   with self.assertRaises(FeedReopenError):parse_reopened_capture(encode({**v,key:bad}),r,observed_at=at)
  with self.assertRaises(FeedReopenError):parse_reopened_capture(encode(v),r,observed_at=at.replace(tzinfo=None))

 def test_changed_inventory_locator_or_entry_identity_refuses_original_reparse(self):
  c,p,r,v,at=fixture()
  for key,bad in [('entry_id','different'),('locator','feed-entry:2')]:
   inv=json.loads(r.inventory_raw);inv['rows'][0][key]=bad
   with self.assertRaises(FeedReopenError):
    rr=prepare_capture_reopen(r.inventory_request,encode(inv),observed_at=r.inventory_observed_at,item_id=r.item_id)
    parse_reopened_capture(encode({**v,'request':json.loads(rr.canonical_input)}),rr,observed_at=at)

 def test_whole_stored_page_still_required_before_processing_and_forgery_refuses(self):
  c,p,r,v,at=fixture();reopened=parse_reopened_capture(encode(v),r,observed_at=at)
  for change in [lambda x:x.update(page_id=uid(99)),lambda x:x['items'][0].update(item_id=uid(99)),lambda x:x['items'][0]['metadata'].update(title='changed')]:
   changed=deepcopy(p);change(changed)
   with self.assertRaises(FeedReopenError):confirm_reopened_page(encode(changed),reopened,observed_at=at)
  with self.assertRaises(FeedReopenError):confirm_reopened_page(encode(p),replace(reopened,capture=replace(c,raw=b'bad')),observed_at=at)
  with self.assertRaises(FeedReopenError):confirm_reopened_page(encode(p),reopened,observed_at=at-timedelta(seconds=1))

 def test_no_echoed_private_response_data_in_generic_refusal(self):
  c,p,r,v,at=fixture();v['source']['source_key']='PRIVATE_CANARY /home/private'
  with self.assertRaises(FeedReopenError) as caught:parse_reopened_capture(encode(v),r,observed_at=at)
  self.assertNotIn('PRIVATE_CANARY',str(caught.exception))

 def test_statement_bound_applies_after_literal_encoding(self):
  c,p,r,v,at=fixture()
  self.assertLess(len(r.statement().encode()),8192)
  with patch('workers.feed_capture_reopen._literal',return_value="'"+'x'*8192+"'"):
   with self.assertRaises(FeedReopenError):r.statement()


class FeedReopenTrialScopeTests(unittest.TestCase):
 def test_extra_arguments_refuse_before_any_custodian_or_resource(self):
  from scripts import rehearse_feed_reopen as module
  with patch.object(module.sys,'argv',['trial','existing-target']),patch.object(module,'FreshFeedPostgres') as constructor:
   with self.assertRaises(module.FeedPgTrialError):module.main()
   constructor.assert_not_called()

 def test_failed_case_still_stops_both_owned_resources_and_checks_final_sources(self):
  from scripts import rehearse_feed_reopen as module
  from unittest.mock import Mock
  trial=Mock();trial.identity='owned';trial.frozen={module.WINDOW_FIXTURE:b'',module.INVENTORY_FIXTURE:b'',module.FIXTURE:b''}
  events=[]
  trial.stop.side_effect=lambda:events.append('stop')
  trial.stop_initializer.side_effect=lambda:events.append('initializer')
  trial.verify_sources.side_effect=lambda label:events.append(label)
  trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
  with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial),patch.object(module,'freeze_windows'),patch.object(module,'freeze_inventory'),patch.object(module,'freeze_reopen'),patch.object(module,'cases',side_effect=RuntimeError('invented')):
   with self.assertRaises(RuntimeError):module.main()
  self.assertEqual(events,['stop','initializer','FINAL_REOPEN','inspect'])
  self.assertTrue(any(call.args[0]=='TRIAL_FAILED' for call in trial.record.call_args_list))

if __name__=='__main__':unittest.main()
