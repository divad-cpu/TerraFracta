"""Fixed four-part storage/read contracts; actual SQL is a separate rehearsal."""
import base64,json,unittest
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from unittest.mock import patch
from tests.test_detached_proposal_custody import STORED,LATER,fresh_extraction
from tests.test_private_extraction_report import reopened
from tests.test_private_extraction_held_proposal import context,encode,AT
from tests.test_feed_postgres_contract import uid
from workers.feed_postgres_contract import _time,COMMIT_MARKER
from workers.detached_proposal_custody import prepare_detached_proposal_custody
from workers.detached_proposal_postgres import (prepare_detached_proposal_store,parse_stored_detached_proposal,
 parse_reopened_detached_proposal,detached_proposal_read_statement,DetachedProposalPostgresError)

def wire(request):
 p=request.prepared
 return dict(schema_version=1,kind='invented_detached_preparation_stored',operation_id=uid(810),artifact_id=uid(811),stored_at=_time(STORED),
  input=json.loads(p.intent.canonical_metadata),payload_base64=base64.b64encode(p.parts.payload_raw).decode(),
  selection_base64=base64.b64encode(p.parts.selection_raw).decode(),provenance_base64=base64.b64encode(p.parts.provenance_raw).decode(),
  context_base64=base64.b64encode(p.parts.context_raw).decode())

class DetachedProposalPostgresTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.old=reopened();cls.prepared=prepare_detached_proposal_custody(cls.old,encode(context(cls.old)),operation_id=uid(810),observed_at=AT)
  cls.request=prepare_detached_proposal_store(cls.prepared);cls.raw=encode(wire(cls.request));cls.fresh=fresh_extraction(cls.old)
 def test_fixed_store_and_read_routes_carry_exact_parts_no_plain_source_or_commands(self):
  sql=self.request.statement();self.assertIn('select tf_detached_proposal.store_preparation(',sql);self.assertEqual(sql.count("decode("),4)
  for raw in (self.prepared.parts.payload_raw,self.prepared.parts.selection_raw,self.prepared.parts.provenance_raw,self.prepared.parts.context_raw):self.assertIn(base64.b64encode(raw).decode(),sql)
  self.assertNotIn('Changed exact invented passage.',sql);self.assertTrue(sql.endswith('\\echo '+COMMIT_MARKER.decode()+'\n'));self.assertLess(len(sql.encode()),294912)
  read=detached_proposal_read_statement(self.prepared.intent);self.assertIn('repeatable read read only',read);self.assertIn('preparation_receipt(',read);self.assertNotIn('store_preparation',read)
 def test_warm_exact_acknowledgement_is_separate_from_cold_observation(self):
  stored=parse_stored_detached_proposal(self.raw,self.request,observed_at=STORED+timedelta(seconds=1));self.assertEqual(stored.operation_id,uid(810));self.assertEqual(stored.artifact_id,uid(811));self.assertEqual(stored.stored_at,STORED)
  self.assertIn('not_held_capture',stored.evidence_state)
  with self.assertRaises(DetachedProposalPostgresError):parse_reopened_detached_proposal(self.raw,self.prepared.intent,self.old,observed_at=LATER)
 def test_cold_receipt_readmits_new_four_parts_and_fresh_full_private_artifact(self):
  result=parse_reopened_detached_proposal(self.raw,self.prepared.intent,self.fresh,observed_at=LATER+timedelta(seconds=1))
  self.assertEqual(result.full_receipt,self.raw);self.assertEqual(result.result.parts,self.prepared.parts);self.assertEqual(result.result.prepared_at,AT)
  self.assertEqual(result.result.extraction.observed_at,LATER);self.assertEqual(result.stored.artifact_id,uid(811));self.assertIn('not_current_qualification',result.evidence_state)
 def test_changed_metadata_scope_or_any_part_refuses_without_partial_return(self):
  for change in [lambda x:x.update(operation_id=uid(899)),lambda x:x.update(artifact_id='bad'),lambda x:x['input'].update(provenance_sha256='f'*64),
   *[lambda x,k=k:x.update({k:base64.b64encode(b'{}').decode()}) for k in ('payload_base64','selection_base64','provenance_base64','context_base64')]]:
   v=wire(self.request);change(v)
   with self.subTest(mutation=repr(change)),self.assertRaisesRegex(DetachedProposalPostgresError,'^detached_proposal_reopened_result_unavailable$'):
    parse_reopened_detached_proposal(encode(v),self.prepared.intent,self.fresh,observed_at=LATER+timedelta(seconds=1))
 def test_closed_types_duplicate_fields_base64_aliases_and_overscope_refuse(self):
  for change in [lambda x:x.update(schema_version=True),lambda x:x.update(extra='PRIVATE'),lambda x:x.update(input=[]),
   lambda x:x.update(context_base64='AA==\n'),lambda x:x.update(context_base64='A==='),lambda x:x.update(context_base64='A'*50000),
   lambda x:x.update(payload_base64=42),lambda x:x.update(stored_at='0000-01-01T00:00:00.000000Z')]:
   v=wire(self.request);change(v)
   with self.assertRaises(DetachedProposalPostgresError):parse_reopened_detached_proposal(encode(v),self.prepared.intent,self.fresh,observed_at=LATER+timedelta(seconds=1))
  for raw in (bytearray(self.raw),self.raw+b'{}',b'{"schema_version":1,"schema_version":1}',b' '*131073):
   with self.assertRaises(DetachedProposalPostgresError):parse_stored_detached_proposal(raw,self.request,observed_at=LATER)
 def test_output_capacity_exact_conservative_floor_and_one_byte_lower_refuse(self):
  # Independent native envelope fixture, same ASCII identities/time widths.
  floor=len(json.dumps(wire(self.request),sort_keys=True,ensure_ascii=False,separators=(',',':')).encode())+4096
  with patch('workers.detached_proposal_postgres.MAX_CAPTURE_OUTPUT',floor):self.assertEqual(prepare_detached_proposal_store(self.prepared).prepared.parts,self.prepared.parts)
  with patch('workers.detached_proposal_postgres.MAX_CAPTURE_OUTPUT',floor-1):
   with self.assertRaisesRegex(DetachedProposalPostgresError,'^detached_proposal_store_unavailable$'):prepare_detached_proposal_store(self.prepared)
 def test_statement_capacity_refuses_before_sql_transport_and_mutated_request_refuses(self):
  with patch('workers.detached_proposal_postgres.MAX_CAPTURE_STATEMENT',20):
   with self.assertRaisesRegex(DetachedProposalPostgresError,'^detached_proposal_store_unavailable$'):self.request.statement()
  bad=replace(self.request,prepared=replace(self.prepared,parts=replace(self.prepared.parts,context_raw=b'{}')))
  with self.assertRaisesRegex(DetachedProposalPostgresError,'^detached_proposal_store_unavailable$'):bad.statement()
 def test_receipt_chronology_fails_whole_and_never_promotes_to_capture(self):
  for at in (AT-timedelta(microseconds=1),LATER+timedelta(seconds=2)):
   v=wire(self.request);v['stored_at']=_time(at)
   with self.assertRaises(DetachedProposalPostgresError):parse_reopened_detached_proposal(encode(v),self.prepared.intent,self.fresh,observed_at=LATER+timedelta(seconds=1))
  with self.assertRaises(DetachedProposalPostgresError):parse_stored_detached_proposal(self.raw,self.request,observed_at=AT)
 def test_builtin_byte_guards_precede_hostile_hooks(self):
  class Hostile(bytes):
   def __len__(self):raise RuntimeError('PRIVATE')
   def decode(self,*args,**kw):raise RuntimeError('PRIVATE')
  with self.assertRaisesRegex(DetachedProposalPostgresError,'^detached_proposal_reopened_result_unavailable$'):
   parse_reopened_detached_proposal(Hostile(self.raw),self.prepared.intent,self.fresh,observed_at=LATER+timedelta(seconds=1))
