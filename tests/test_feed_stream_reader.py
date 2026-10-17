"""Fixed stream read routes reuse existing byte/parser contracts, without I/O."""
from dataclasses import replace
import base64
import json
import unittest
from unittest.mock import patch
from tests.test_feed_capture_reopen import fixture as feed_fixture,encode
from tests.test_document_result_reopen import fixture as document_fixture
from tests.test_feed_postgres_contract import uid
from workers.feed_capture_reopen import parse_reopened_capture,confirm_reopened_page
from workers.document_result_reopen import parse_reopened_document,confirm_reopened_document_result
from workers.document_result_contract import invented_document_result_read_statement
from workers.feed_postgres_contract import invented_pg_read_statement,HEAD,COMMIT_MARKER
from workers.feed_postgres_processing import parse_invented_pg_item_history
from workers.feed_stream_reader import (StreamReaderError,stream_feed_original_statement,stream_document_original_statement,
 stream_page_statement,stream_result_statement,stream_history_statement)


class StreamReaderTests(unittest.TestCase):
 def test_four_routes_change_only_fixed_outer_identifier(self):
  capture,_,feed,_,_=feed_fixture();result,document,_,_,_=document_fixture()
  for value,route,original,old,new in [
   (feed,stream_feed_original_statement,feed.statement,'tf_feed_reopen.original','tf_feed_runtime.feed_original'),
   (document,stream_document_original_statement,document.statement,'tf_document_reopen.original','tf_feed_runtime.document_original'),
   (capture,stream_page_statement,lambda:invented_pg_read_statement(capture),'tf_feed_rehearsal.page_receipt','tf_feed_runtime.page_receipt'),
   (result,stream_result_statement,lambda:invented_document_result_read_statement(result),'tf_feed_rehearsal.document_result_receipt','tf_feed_runtime.document_result_receipt')]:
   self.assertEqual(route(value),original().replace('select '+old+'(','select '+new+'(',1))
   self.assertIn('repeatable read read only',route(value))
   self.assertTrue(route(value).endswith('\\echo '+COMMIT_MARKER.decode()+'\n'))

 def test_history_has_only_fixed_function_and_exact_literal_arguments(self):
  capture,page,_,_,_=feed_fixture();item=page['items'][0]['item_id']
  sql=stream_history_statement(capture,item)
  self.assertTrue(sql.startswith(HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_feed_runtime.item_history("))
  self.assertIn("'"+capture.operation_id+"'::uuid,'"+item+"'::uuid,decode('"+base64.b64encode(capture.raw).decode()+"','base64')",sql)
  self.assertNotIn('from ',sql.lower());self.assertNotIn('outcomes',sql)
  self.assertTrue(sql.endswith(";commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'))

 def test_untyped_free_sql_and_subclasses_refuse(self):
  capture,_,feed,_,_=feed_fixture();result,document,_,_,_=document_fixture()
  for route,value in [(stream_feed_original_statement,feed),(stream_document_original_statement,document),(stream_page_statement,capture),(stream_result_statement,result)]:
   class Derived(type(value)):pass
   subclass=Derived(**value.__dict__)
   for bad in [None,{},'select anything();',subclass]:
    with self.assertRaises(StreamReaderError):route(bad)
  for bad in [None,{},'select anything();']:
   with self.assertRaises(StreamReaderError):stream_history_statement(bad,uid(5))

 def test_changed_or_mutable_canonical_bytes_refuse_before_decode(self):
  capture,page,feed,_,_=feed_fixture();result,document,_,_,_=document_fixture();calls=[]
  class Decoder(bytes):
   def decode(self,*args,**kwargs):calls.append(True);return '{}'
  for route,value in [(stream_feed_original_statement,feed),(stream_document_original_statement,document),(stream_page_statement,capture),(stream_result_statement,result),
    (lambda x:stream_history_statement(x,page['items'][0]['item_id']),capture)]:
   for bad in [b'{}',bytearray(value.canonical_input),memoryview(value.canonical_input),Decoder(value.canonical_input)]:
    with self.assertRaises(ValueError):route(replace(value,canonical_input=bad))
  self.assertEqual(calls,[])

 def test_history_rechecks_raw_source_and_strict_item_uuid(self):
  capture,page,_,_,_=feed_fixture();item=page['items'][0]['item_id']
  for altered in [replace(capture,raw=b'changed'),replace(capture,operation_id=uid(99)),replace(capture,stream_id=uid(99))]:
   with self.assertRaises(ValueError):stream_history_statement(altered,item)
  class String(str):pass
  for bad in [None,True,0,'',String(item),item.upper(),'bad',item+"');delete from x;--"]:
   # This fixture UUID contains no alphabetic hex, so upper() is identical.
   if type(bad) is str and bad==item:continue
   with self.assertRaises(StreamReaderError):stream_history_statement(capture,bad)

 def test_all_final_encoded_statement_limits_and_missing_route_refuse(self):
  capture,page,feed,_,_=feed_fixture();result,document,_,_,_=document_fixture()
  routes=[(stream_feed_original_statement,feed),(stream_document_original_statement,document),(stream_page_statement,capture),(stream_result_statement,result),
   (lambda x:stream_history_statement(x,page['items'][0]['item_id']),capture)]
  with patch('workers.feed_stream_reader.MAX_CAPTURE_STATEMENT',1):
   for route,value in routes:
    with self.assertRaises(StreamReaderError):route(value)
  with patch.object(type(feed),'statement',return_value='select anything();'):
   with self.assertRaises(StreamReaderError):stream_feed_original_statement(feed)

 def test_responses_still_require_full_existing_original_receipt_and_history_parsers(self):
  capture,page,request,response,at=feed_fixture()
  reopened=parse_reopened_capture(encode(response),request,observed_at=at)
  self.assertEqual(confirm_reopened_page(encode(page),reopened,observed_at=at).page.source,capture.source)
  history=encode(dict(item_id=request.item_id,page=page,outcomes=[]))
  self.assertEqual(parse_invented_pg_item_history(history,capture,item_id=request.item_id,observed_at=at).state,'pending')
  result,request,response,stored,at=document_fixture()
  reopened=parse_reopened_document(encode(response),request,observed_at=at)
  self.assertEqual(confirm_reopened_document_result(encode(stored),reopened,observed_at=at).result.snapshot.passages[0].text,'Invented original passage.')
  # A successful route or echoed original never substitutes for the final full receipt.
  altered=json.loads(encode(stored));altered['input']['snapshot']['passages'][0]['text']='changed'
  with self.assertRaises(ValueError):confirm_reopened_document_result(encode(altered),reopened,observed_at=at)


class StreamReaderTrialScopeTests(unittest.TestCase):
 def test_extra_arguments_refuse_before_any_resource(self):
  from scripts import rehearse_stream_reader as module
  with patch.object(module.sys,'argv',['trial','existing-target']),patch.object(module,'FreshFeedPostgres') as constructor:
   with self.assertRaises(module.FeedPgTrialError):module.main()
   constructor.assert_not_called()

 def test_foreign_or_fake_installer_refuses_before_queries(self):
  from types import SimpleNamespace
  from unittest.mock import Mock
  from scripts.rehearse_stream_reader import install_stream_reader,FeedPgTrialError
  from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
  trial=SimpleNamespace(query=Mock());foreign=SimpleNamespace(query=Mock())
  for roles in [OwnedRuntimeRoles(foreign),SimpleNamespace(trial=trial)]:
   with self.assertRaises(FeedPgTrialError):install_stream_reader(trial,roles)
  trial.query.assert_not_called();foreign.query.assert_not_called()

 def test_installer_only_frozen_bytes_between_identity_checks(self):
  from types import SimpleNamespace
  from unittest.mock import Mock
  from scripts.rehearse_stream_reader import install_stream_reader,FIXTURE
  from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
  events=[];trial=SimpleNamespace(frozen={FIXTURE:b'-- invented overlay\n'},query=Mock(side_effect=lambda sql:events.append(sql)))
  roles=OwnedRuntimeRoles(trial);roles.verify=Mock(side_effect=lambda:events.append('verify'))
  install_stream_reader(trial,roles)
  self.assertEqual(events,['verify',"begin;set local statement_timeout='10s';-- invented overlay\ncommit;",'verify'])

 def test_failed_case_still_stops_owned_resources_and_checks_inputs(self):
  from scripts import rehearse_stream_reader as module
  from unittest.mock import Mock
  trial=Mock();trial.identity='owned';events=[]
  trial.stop.side_effect=lambda:events.append('stop')
  trial.stop_initializer.side_effect=lambda:events.append('initializer')
  trial.verify_sources.side_effect=lambda label:events.append(label)
  trial.inspect.side_effect=lambda:events.append('inspect') or {'owned':True}
  with patch.object(module.sys,'argv',['trial']),patch.object(module,'FreshFeedPostgres',return_value=trial),patch.object(module,'freeze_all'),patch.object(module,'cases',side_effect=RuntimeError('invented')):
   with self.assertRaises(RuntimeError):module.main()
  self.assertEqual(events,['stop','initializer','FINAL_STREAM_READER','inspect'])
  self.assertTrue(any(call.args[0]=='STREAM_READER_FAILED' for call in trial.record.call_args_list))


if __name__=='__main__':unittest.main()
