"""Direct feed reopen input ownership; invented bytes, no native transport."""
from asyncio import CancelledError
from datetime import tzinfo,timedelta
import unittest
from tests.test_feed_capture_reopen import fixture,encode
from workers.feed_capture_reopen import (prepare_capture_reopen,parse_reopened_capture,confirm_reopened_page,FeedReopenError)
class Clock(tzinfo):
 def __init__(self,callback):self.callback=callback;self.calls=0
 def utcoffset(self,value):
  self.calls+=1
  if self.calls==1:self.callback()
  return timedelta(0)
 def dst(self,value):return timedelta(0)
def clocked(at,callback):return at.replace(tzinfo=Clock(callback))
class FeedReopenEntrySnapshotTests(unittest.TestCase):
 def test_initial_bad_request_cannot_be_repaired_during_parse(self):
  _,_,r,v,at=fixture();good=r.canonical_input;object.__setattr__(r,'canonical_input',b'{}')
  with self.assertRaises(FeedReopenError):parse_reopened_capture(encode(v),r,observed_at=clocked(at,lambda:object.__setattr__(r,'canonical_input',good)))
 def test_valid_parse_owns_request_before_caller_damage(self):
  _,_,r,v,at=fixture();raw=encode(v);expected=parse_reopened_capture(raw,r,observed_at=at)
  actual=parse_reopened_capture(raw,r,observed_at=clocked(at,lambda:object.__setattr__(r,'inventory_raw',b'{}')))
  self.assertEqual(actual,expected);self.assertIsNot(actual.request,r)
 def test_statement_preserves_initial_invalid_or_valid_canonical_input(self):
  for invalid in [True,False]:
   _,_,r,_,_=fixture();expected=r.statement();good=r.canonical_input
   if invalid:object.__setattr__(r,'canonical_input',b'{}')
   object.__setattr__(r,'inventory_observed_at',clocked(r.inventory_observed_at,lambda:object.__setattr__(r,'canonical_input',good if invalid else b'{}')))
   with self.subTest(invalid=invalid):
    if invalid:
     with self.assertRaises(FeedReopenError):r.statement()
    else:self.assertEqual(r.statement(),expected)
 def test_prepare_captures_inventory_scope_before_observation(self):
  _,_,r,_,_=fixture();expected=r
  actual=prepare_capture_reopen(r.inventory_request,r.inventory_raw,item_id=r.item_id,
   observed_at=clocked(r.inventory_observed_at,lambda:object.__setattr__(r.inventory_request.scope,'source_key','fictional-other')))
  self.assertEqual(actual.canonical_input,expected.canonical_input)
  self.assertIsNot(actual.inventory_request,r.inventory_request)
 def test_confirm_captures_complete_capture_before_nested_callback(self):
  for invalid in [True,False]:
   _,page,r,v,at=fixture();item=parse_reopened_capture(encode(v),r,observed_at=at);original=item.capture.canonical_input
   expected=confirm_reopened_page(encode(page),item,observed_at=at)
   if invalid:object.__setattr__(item.capture,'canonical_input',b'{}')
   object.__setattr__(item,'observed_at',clocked(at,lambda:object.__setattr__(item.capture,'canonical_input',original if invalid else b'{}')))
   with self.subTest(invalid=invalid):
    if invalid:
     with self.assertRaises(FeedReopenError):confirm_reopened_page(encode(page),item,observed_at=at)
    else:self.assertEqual(confirm_reopened_page(encode(page),item,observed_at=at),expected)
 def test_unknown_namespaces_and_foreign_raw_refuse_before_hooks(self):
  for mode in ['namespace','raw']:
   _,_,r,v,at=fixture();calls=[];raw=encode(v)
   if mode=='namespace':object.__setattr__(r,'foreign',object())
   else:
    class Foreign(bytes):
     def __len__(self):raise AssertionError('foreign length')
     def decode(self,*a,**k):raise AssertionError('foreign decoder')
    raw=Foreign(raw)
   with self.subTest(mode=mode):
    with self.assertRaises(FeedReopenError):parse_reopened_capture(raw,r,observed_at=clocked(at,lambda:calls.append(1)))
    self.assertEqual(calls,[])
 def test_snapshot_faults_are_fixed_and_cancel_identity_survives(self):
  for fault in [RuntimeError('PRIVATE_CANARY'),KeyboardInterrupt(),SystemExit(9),CancelledError()]:
   _,_,r,v,at=fixture()
   def fail():raise fault
   with self.subTest(fault=type(fault).__name__):
    with self.assertRaises(FeedReopenError if isinstance(fault,Exception) else type(fault)) as found:
     parse_reopened_capture(encode(v),r,observed_at=clocked(at,fail))
    if isinstance(fault,Exception):self.assertEqual(str(found.exception),'reopen_observation_unavailable')
    else:self.assertIs(found.exception,fault)
