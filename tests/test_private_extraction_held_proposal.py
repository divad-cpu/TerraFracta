"""Detached preparation never supplies missing editorial or operational trust."""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json,unittest
from unittest.mock import patch
from tests.test_private_extraction_report import reopened
from tests.test_private_extraction_result import fixture,NOW
from tests.test_feed_postgres_contract import uid
from workers.feed_postgres_contract import _time
from workers.private_extraction_held_proposal import prepare_private_extraction_held_proposal,PrivateExtractionHeldProposalError
AT=NOW+timedelta(seconds=30)
def encode(value):return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
def context(item):
 r=item.result;b=r.current.request.binding
 return dict(schema_version=1,kind='invented_detached_extraction_context',snapshot_intent='single_claim_technical_review_not_issue_replacement',artifact=dict(operation_id=item.stored.operation_id,
  artifact_id=item.stored.artifact_id,request_sha256=r.request.request_sha256,output_sha256=sha256(r.output_raw).hexdigest()),
  held=dict(run_id=uid(700),decision_id=uid(701),item_key=b.item_key,source_version_id=b.source_version_id,
   content_sha256=b.content_sha256,locator=r.proposal.locator,jurisdiction_id='fictional-region',
   decided_at=_time(NOW+timedelta(seconds=20)),disposition='held'),
  issue=dict(issue_id=uid(702),jurisdiction_id='fictional-region',jurisdiction_slug='fictional-region',issue_slug='invented-issue',
   created_at=_time(NOW-timedelta(days=10)),observed_at=_time(NOW+timedelta(seconds=25)),
   head=dict(publication_id=None,content_sha256=None,changed_at=None)),
  content=dict(capture_id=uid(703),claim_id=uid(704),title='Private invented review candidate',summary='A detached unverified technical example.',
   period_label='Explicitly supplied period, not parsed from model date text',last_evidence_review_on=NOW.date().isoformat(),
   review_date_basis='independently_supplied_not_inferred',publisher='Invented publisher',source_title='Invented exact passage',source_published_on=None),
  support=dict(source_version_id=b.source_version_id,content_sha256=b.content_sha256,locator=r.proposal.locator,
   assertion=r.proposal.proposed_assertion,claim_type=r.proposal.proposed_claim_type,relation='supports',assignment_state='proposed_only'),
  translation=dict(display_language=r.proposal.language_code,status='unreviewed'))
def prepare(item,ctx):return prepare_private_extraction_held_proposal(item,encode(ctx),observed_at=AT)

class DetachedExtractionProposalTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.item=reopened();cls.ctx=context(cls.item)
 def refuse(self,item,ctx):
  with self.assertRaisesRegex(PrivateExtractionHeldProposalError,'^private_extraction_held_proposal_unavailable$'):prepare(item,ctx)
 def test_exact_detached_payload_selection_and_companion_are_deterministic(self):
  result=prepare(self.item,self.ctx);self.assertEqual(result,prepare(self.item,self.ctx))
  p=json.loads(result.payload_raw);s=json.loads(result.selection_raw);v=json.loads(result.provenance_raw)
  self.assertEqual(p['kind'],'review_only');self.assertEqual(p['snapshot']['claims'][0]['assertion'],self.item.result.proposal.proposed_assertion)
  self.assertEqual(p['snapshot']['claims'][0]['evidence'][0]['relation'],'supports')
  self.assertEqual(p['dependencyManifest']['sourceVersionIds'],[self.item.result.current.request.binding.source_version_id])
  self.assertIsNone(s['basePublicationId']);self.assertEqual(s['decisionId'],self.ctx['held']['decision_id'])
  self.assertEqual(v['payload_sha256'],sha256(result.payload_raw).hexdigest());self.assertEqual(v['selection_sha256'],sha256(result.selection_raw).hexdigest())
  self.assertEqual(v['independent_context'],self.ctx);self.assertNotIn('Changed exact',repr(result))
  self.assertEqual(v['artifact'],self.ctx['artifact']);self.assertEqual(v['previous']['artifact_id'],self.item.result.previous.artifact_id)
  self.assertEqual(v['evidence_state'],'unverified_not_captured_no_durable_association');self.assertNotIn('actual_cost',p)
 def test_missing_or_partial_head_is_not_witnessed_empty_head(self):
  for head in [None,{},dict(publication_id=uid(799),content_sha256=None,changed_at=None),dict(publication_id=None,content_sha256='a'*64,changed_at=None)]:
   ctx=deepcopy(self.ctx);ctx['issue']['head']=head;self.refuse(self.item,ctx)
 def test_explicit_known_head_is_distinct_from_previous_document(self):
  ctx=deepcopy(self.ctx);ctx['issue']['head']=dict(publication_id=uid(710),content_sha256='e'*64,changed_at=_time(NOW-timedelta(days=1)))
  result=prepare(self.item,ctx);self.assertEqual(json.loads(result.selection_raw)['basePublicationId'],uid(710))
  self.assertNotEqual(uid(710),self.item.result.previous.artifact_id)
 def test_foreign_artifact_or_held_source_context_refuses_whole_preparation(self):
  for section,key,value in [('artifact','operation_id',uid(799)),('artifact','artifact_id',uid(799)),('artifact','request_sha256','f'*64),
   ('artifact','output_sha256','f'*64),('held','item_key','foreign'),('held','source_version_id',uid(799)),
   ('held','content_sha256','f'*64),('held','locator','foreign'),('held','disposition','published'),('issue','jurisdiction_id','foreign')]:
   ctx=deepcopy(self.ctx);ctx[section][key]=value
   with self.subTest(section=section,key=key):self.refuse(self.item,ctx)
 def test_missing_or_mismatched_proposed_support_is_never_inferred(self):
  ctx=deepcopy(self.ctx);ctx['support']=None;self.refuse(self.item,ctx)
  for key,value in [('relation','context'),('assignment_state','verified'),('assertion','Different candidate wording.'),('claim_type','funding'),
   ('source_version_id',self.item.result.previous.request.binding.source_version_id),('content_sha256','f'*64),('locator','missing')]:
   ctx=deepcopy(self.ctx);ctx['support'][key]=value
   with self.subTest(key=key):self.refuse(self.item,ctx)
 def test_future_reversed_head_decision_and_observation_times_refuse(self):
  for section,key,value in [('held','decided_at',_time(NOW)),('held','decided_at',_time(AT+timedelta(microseconds=1))),
   ('issue','observed_at',_time(NOW)),('issue','observed_at',_time(AT+timedelta(microseconds=1))),('issue','created_at',_time(AT))]:
   ctx=deepcopy(self.ctx);ctx[section][key]=value
   with self.subTest(section=section,key=key):self.refuse(self.item,ctx)
  with self.assertRaises(PrivateExtractionHeldProposalError):prepare_private_extraction_held_proposal(self.item,encode(self.ctx),observed_at=self.item.observed_at-timedelta(microseconds=1))
 def test_mutated_full_receipt_or_missing_prior_cannot_be_replaced_by_report(self):
  for bad in [None,{},replace(self.item,full_receipt=b'{}'),replace(self.item,request=replace(self.item.request,previous=None)),
   replace(self.item,result=replace(self.item.result,output_raw=b'PRIVATE /home/secret'))]:self.refuse(bad,self.ctx)
 def test_closed_builtin_context_bytes_duplicate_keys_and_limits(self):
  raw=encode(self.ctx)
  class Hostile(bytes):
   def __len__(self):raise RuntimeError('PRIVATE')
  for body in [bytearray(raw),Hostile(raw),raw+b'{}',b'{"schema_version":1,"schema_version":1}',b'\xff',b' '*32769]:
   with self.subTest(kind=type(body)),self.assertRaisesRegex(PrivateExtractionHeldProposalError,'^private_extraction_held_proposal_unavailable$'):
    prepare_private_extraction_held_proposal(self.item,body,observed_at=AT)
  ctx=deepcopy(self.ctx);ctx['extra']='not allowed';self.refuse(self.item,ctx)
  ctx=deepcopy(self.ctx);ctx['schema_version']=True;self.refuse(self.item,ctx)
 def test_raw_model_date_and_unreviewed_translation_never_become_reviewed_metadata(self):
  values=fixture();output=json.loads(values['output_raw']);output['source_date_text']='Raw date text\n\tstill unparsed';values['output_raw']=encode(output)
  item=reopened(values);ctx=context(item);result=prepare(item,ctx);p=json.loads(result.payload_raw);v=json.loads(result.provenance_raw)
  self.assertEqual(v['source_date_text'],output['source_date_text']);self.assertIsNone(p['snapshot']['claims'][0]['evidence'][0]['sourcePublishedOn'])
  self.assertEqual(p['snapshot']['claims'][0]['periodLabel'],ctx['content']['period_label']);self.assertEqual(p['translation']['status'],'unreviewed')
  ctx['translation']['status']='not_required';self.refuse(item,ctx)
  ctx=deepcopy(self.ctx);ctx['content']['review_date_basis']='technical_preparation_time';self.refuse(self.item,ctx)
 def test_six_hundred_emoji_assertion_is_exact_and_not_trimmed(self):
  values=fixture();out=json.loads(values['output_raw']);out['proposed_assertion']='🙂'*600;values['output_raw']=encode(out)
  item=reopened(values);ctx=context(item);p=json.loads(prepare(item,ctx).payload_raw)
  self.assertEqual(p['snapshot']['claims'][0]['assertion'],'🙂'*600)
 def test_whole_payload_exact_byte_limit_and_one_byte_over_refuse(self):
  result=prepare(self.item,self.ctx)
  with patch('workers.private_extraction_held_proposal.MAX_PAYLOAD_BYTES',len(result.payload_raw)):
   self.assertEqual(prepare(self.item,self.ctx),result)
  with patch('workers.private_extraction_held_proposal.MAX_PAYLOAD_BYTES',len(result.payload_raw)-1):self.refuse(self.item,self.ctx)

 def test_explicit_single_claim_intent_is_required_and_preserved_for_nonempty_head(self):
  for value in (None,'whole_issue_replacement'):
   ctx=deepcopy(self.ctx)
   if value is None:ctx.pop('snapshot_intent')
   else:ctx['snapshot_intent']=value
   self.refuse(self.item,ctx)
  ctx=deepcopy(self.ctx);ctx['issue']['head']=dict(publication_id=uid(710),content_sha256='e'*64,changed_at=_time(NOW-timedelta(days=1)))
  result=prepare(self.item,ctx);proof=json.loads(result.provenance_raw)
  self.assertEqual(proof['snapshot_intent'],'single_claim_technical_review_not_issue_replacement')
  self.assertEqual(proof['independent_context']['snapshot_intent'],proof['snapshot_intent'])
  self.assertEqual(json.loads(result.selection_raw)['basePublicationId'],uid(710))
  self.assertNotIn('snapshot_intent',json.loads(result.payload_raw))
