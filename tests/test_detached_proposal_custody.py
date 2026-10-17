"""Historical preparation bytes and fresh observation remain distinct."""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json,unittest
from tests.test_private_extraction_report import reopened
from tests.test_private_extraction_held_proposal import context,encode,AT
from tests.test_private_extraction_result import NOW
from tests.test_feed_postgres_contract import uid
from workers.document_result_reopen import parse_reopened_document
from workers.private_extraction_reopen import prepare_private_extraction_reopen,parse_reopened_private_extraction
from workers.private_extraction_held_proposal import prepare_private_extraction_held_proposal,_json
from workers.feed_postgres_contract import _time
from workers.detached_proposal_custody import (DetachedProposalParts,DetachedPreparationIntent,
 prepare_detached_proposal_custody,recheck_prepared_detached_proposal,reobserve_detached_proposal,DetachedProposalCustodyError)
STORED=AT+timedelta(seconds=1)
LATER=AT+timedelta(seconds=20)

def fresh_extraction(item,*,at=LATER):
 docs=[]
 for old in (item.result.current,item.result.previous):
  req=replace(old.request,observed_at=at-timedelta(seconds=4));wire=json.loads(old.response_raw)
  wire['observed_at']=_time(at-timedelta(seconds=3))
  docs.append(parse_reopened_document(encode(wire),req,observed_at=at-timedelta(seconds=2)))
 req=prepare_private_extraction_reopen(docs[0],item.result.current_receipt,docs[1],item.result.previous_receipt,
  request=item.result.request,operation_id=item.stored.operation_id,maximum_output_tokens=item.result.maximum_output_tokens,observed_at=at-timedelta(seconds=1))
 return parse_reopened_private_extraction(item.full_receipt,req,observed_at=at)

def intent_for(parts,original):
 v=json.loads(original.canonical_metadata)
 for key,raw in zip(('payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256'),
  (parts.payload_raw,parts.selection_raw,parts.provenance_raw,parts.context_raw)):v[key]=sha256(raw).hexdigest()
 return DetachedPreparationIntent(_json(v))

class DetachedProposalCustodyTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.initial=reopened();cls.raw=encode(context(cls.initial));cls.prepared=prepare_detached_proposal_custody(cls.initial,cls.raw,operation_id=uid(810),observed_at=AT)
  cls.fresh=fresh_extraction(cls.initial)
 def reobserve(self,parts=None,intent=None,**kw):
  return reobserve_detached_proposal(kw.pop('extraction',self.fresh),parts or self.prepared.parts,intent or self.prepared.intent,
   stored_at=kw.pop('stored_at',STORED),observed_at=kw.pop('observed_at',LATER+timedelta(seconds=1)),**kw)
 def refuse(self,parts=None,intent=None,**kw):
  with self.assertRaisesRegex(DetachedProposalCustodyError,'^detached_proposal_reobservation_unavailable$'):self.reobserve(parts,intent,**kw)
 def test_four_exact_parts_and_fingerprint_are_deterministic_private_and_unverified(self):
  p=self.prepared;again=prepare_detached_proposal_custody(self.initial,self.raw,operation_id=uid(810),observed_at=AT)
  self.assertEqual(p,again);self.assertEqual(p.parts.context_raw,self.raw);self.assertNotEqual(self.raw,_json(json.loads(self.raw)))
  v=json.loads(p.intent.canonical_metadata)
  for field,raw in [('payload_sha256',p.parts.payload_raw),('selection_sha256',p.parts.selection_raw),('provenance_sha256',p.parts.provenance_raw),('context_raw_sha256',self.raw)]:self.assertEqual(v[field],sha256(raw).hexdigest())
  self.assertNotIn('Changed exact',repr(p));self.assertNotIn('proposed',repr(p.parts));self.assertIn('not_held_capture',p.evidence_state)
  self.assertEqual(recheck_prepared_detached_proposal(p),p)
 def test_old_naive_regeneration_changes_only_two_observations_not_historical_bytes(self):
  a=self.prepared.parts;b=prepare_private_extraction_held_proposal(self.fresh,self.raw,observed_at=LATER+timedelta(seconds=1))
  self.assertEqual((a.payload_raw,a.selection_raw),(b.payload_raw,b.selection_raw));x=json.loads(a.provenance_raw);y=json.loads(b.provenance_raw)
  self.assertEqual({k for k in x if x[k]!=y[k]},{'prepared_at','artifact_observed_at'})
  self.assertNotEqual(a.provenance_raw,b.provenance_raw)
 def test_historical_bytes_reopen_against_fresh_full_artifact_without_rewinding(self):
  value=self.reobserve();self.assertEqual(value.parts,self.prepared.parts);self.assertEqual(value.prepared_at,AT)
  self.assertEqual(value.historical_artifact_observed_at,self.initial.observed_at);self.assertEqual(value.extraction.observed_at,LATER)
  self.assertEqual(value.observed_at,LATER+timedelta(seconds=1));self.assertEqual(value.stored_at,STORED)
  self.assertIn('not_current_qualification',value.evidence_state)
 def test_original_context_spelling_cannot_be_replaced_by_canonical_equivalent(self):
  p=self.prepared.parts;changed=replace(p,context_raw=_json(json.loads(self.raw)))
  self.refuse(changed);self.refuse(changed,intent_for(changed,self.prepared.intent))
 def test_changed_parts_or_fingerprints_refuse_whole_result(self):
  for field in ('payload_raw','selection_raw','provenance_raw','context_raw'):
   with self.subTest(field=field):self.refuse(replace(self.prepared.parts,**{field:b'{}'}))
  v=json.loads(self.prepared.intent.canonical_metadata);v['extraction_artifact_id']=uid(899);self.refuse(intent=DetachedPreparationIntent(_json(v)))
 def test_closed_canonical_intent_duplicate_keys_and_primitive_types(self):
  raw=self.prepared.intent.canonical_metadata;v=json.loads(raw)
  for mutate in [lambda v:v.update(schema_version=True),lambda v:v.update(extra='PRIVATE'),lambda v:v.update(operation_id=42),lambda v:v.update(prepared_at='0000-01-01T00:00:00.000000Z')]:
   d=deepcopy(v);mutate(d);self.refuse(intent=DetachedPreparationIntent(_json(d)))
  for invalid in (raw+b' ',b'{"schema_version":1,"schema_version":1}',bytearray(raw)):
   self.refuse(intent=DetachedPreparationIntent(invalid))
 def test_exact_builtin_part_guards_run_before_user_hooks(self):
  class Hostile(bytes):
   def __len__(self):raise RuntimeError('PRIVATE')
   def __eq__(self,other):raise RuntimeError('PRIVATE')
   def decode(self,*a,**kw):raise RuntimeError('PRIVATE')
  for field in ('payload_raw','selection_raw','provenance_raw','context_raw'):
   self.refuse(replace(self.prepared.parts,**{field:Hostile(b'{}')}))
   self.refuse(replace(self.prepared.parts,**{field:bytearray(b'{}')}))
 def test_mutated_full_extraction_and_missing_originals_refuse(self):
  for bad in (None,replace(self.fresh,full_receipt=b'{}'),replace(self.fresh,request=replace(self.fresh.request,previous=None))):self.refuse(extraction=bad)
 def test_old_artifact_or_future_and_reversed_observations_refuse(self):
  self.refuse(extraction=self.initial)
  for value in (None,STORED.replace(tzinfo=None),AT-timedelta(microseconds=1),LATER+timedelta(microseconds=1)):
   with self.subTest(stored=value):self.refuse(stored_at=value)
  self.refuse(observed_at=LATER-timedelta(microseconds=1));self.refuse(observed_at=LATER.replace(tzinfo=None))
  proof=json.loads(self.prepared.parts.provenance_raw);proof['artifact_observed_at']=_time(AT+timedelta(microseconds=1))
  parts=replace(self.prepared.parts,provenance_raw=_json(proof));self.refuse(parts,intent_for(parts,self.prepared.intent))
 def test_context_dates_cannot_be_laundered_by_later_regeneration(self):
  for section,key in [('held','decided_at'),('issue','observed_at')]:
   ctx=json.loads(self.raw);ctx[section][key]=_time(AT+timedelta(seconds=3))
   if section=='held':ctx['issue']['observed_at']=_time(AT+timedelta(seconds=4))
   raw=encode(ctx);new=prepare_private_extraction_held_proposal(self.fresh,raw,observed_at=LATER+timedelta(seconds=1));proof=json.loads(new.provenance_raw)
   proof['prepared_at']=_time(AT);proof['artifact_observed_at']=_time(self.initial.observed_at)
   parts=DetachedProposalParts(new.payload_raw,new.selection_raw,_json(proof),raw)
   self.refuse(parts,intent_for(parts,self.prepared.intent))
 def test_unchanged_provenance_fields_are_type_exact_not_python_boolean_aliases(self):
  proof=json.loads(self.prepared.parts.provenance_raw);proof['schema_version']=True
  parts=replace(self.prepared.parts,provenance_raw=_json(proof));self.refuse(parts,intent_for(parts,self.prepared.intent))
 def test_recheck_prepared_rejects_mutated_parts_metadata_or_evidence_label(self):
  p=self.prepared
  for bad in (None,replace(p,parts=replace(p.parts,context_raw=b'{}')),replace(p,evidence_state='approved'),replace(p,observed_at=NOW)):
   with self.assertRaisesRegex(DetachedProposalCustodyError,'^detached_proposal_preparation_unavailable$'):recheck_prepared_detached_proposal(bad)

 def test_returned_full_extraction_is_reparsed_not_an_unconfirmed_supplied_shadow(self):
  from workers.private_extraction_result import PrivateExtractionResult
  class Shadow:
   calls=0
   def __eq__(self,other):Shadow.calls+=1;return True
  bad=replace(self.fresh,result=Shadow());value=self.reobserve(extraction=bad)
  self.assertIs(type(value.extraction.result),PrivateExtractionResult);self.assertIsNot(value.extraction,bad)
  self.assertEqual(value.parts,self.prepared.parts)
  initial=replace(self.initial,result=Shadow())
  p=prepare_detached_proposal_custody(initial,self.raw,operation_id=uid(810),observed_at=AT)
  self.assertIs(type(p.extraction.result),PrivateExtractionResult);self.assertEqual(p.parts,self.prepared.parts)
  self.assertEqual(Shadow.calls,0)
