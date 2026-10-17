"""Structural append preparation keeps exact baseline/candidate; TS owns admission."""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json,unittest
from unittest.mock import patch
from tests.test_private_extraction_report import reopened
from tests.test_private_extraction_held_proposal import context,encode,AT
from tests.test_detached_proposal_custody import fresh_extraction,LATER
from tests.test_detached_proposal_postgres import wire
from tests.test_feed_postgres_contract import uid
from workers.private_extraction_held_proposal import prepare_private_extraction_held_proposal,_json
from workers.detached_proposal_custody import prepare_detached_proposal_custody
from workers.detached_proposal_postgres import prepare_detached_proposal_store,parse_reopened_detached_proposal
from workers.feed_postgres_contract import _time
from workers.appended_issue_review import prepare_appended_issue_review,composition_parts,AppendedIssueReviewError,INTENT
OBSERVED=LATER+timedelta(seconds=2)


def fixture(*,baseline_change=None,context_change=None,baseline_transform=None):
    old=reopened();ctx=context(old);original=json.loads(prepare_private_extraction_held_proposal(old,encode(ctx),observed_at=AT).payload_raw)
    snapshot=deepcopy(original['snapshot']);snapshot.update(title='Invented existing issue title',summary='Two preserved invented baseline statements.')
    first=deepcopy(snapshot['claims'][0]);first.update(id=uid(950),assertion='Invented existing observation one.')
    first['evidence'][0].update(sourceVersionId=uid(960),url='https://example.org/existing-one',title='Invented existing source one')
    second=deepcopy(first);second.update(id=uid(951),assertion='Invented existing observation two.')
    second['evidence'][0].update(sourceVersionId=uid(961),url='https://example.org/existing-two',title='Invented existing source two')
    snapshot['claims']=[first,second]
    baseline=dict(id=uid(940),issueId=ctx['issue']['issue_id'],revision=2,kind='accepted',snapshot=snapshot,dependencyManifest=dict(sourceVersionIds=[uid(960),uid(961)]))
    if baseline_change:baseline_change(baseline)
    # Noncanonical original formatting deliberately remains byte-bound.
    raw=json.dumps(baseline,ensure_ascii=False,indent=2).encode()
    if baseline_transform:raw=baseline_transform(raw)
    ctx['issue']['head']=dict(publication_id=baseline['id'],content_sha256=sha256(raw).hexdigest(),changed_at=_time(AT-timedelta(days=1)))
    prepared=prepare_detached_proposal_custody(old,encode(ctx),operation_id=uid(810),observed_at=AT)
    stored=encode(wire(prepare_detached_proposal_store(prepared)));fresh=fresh_extraction(old)
    candidate=parse_reopened_detached_proposal(stored,prepared.intent,fresh,observed_at=LATER+timedelta(seconds=1))
    supplied=dict(schema_version=1,kind='invented_append_only_issue_context',snapshot_intent=INTENT,
        baseline=dict(publication_id=baseline['id'],issue_id=baseline['issueId'],content_sha256=sha256(raw).hexdigest(),head_changed_at=ctx['issue']['head']['changed_at'],head_observed_at=ctx['issue']['observed_at']),
        page=dict(title='Explicit whole-issue review title',summary='Explicit supplied summary requiring semantic review, not inferred from a candidate.',last_evidence_review_on=AT.date().isoformat()),
        review=dict(conflict_coverage='not_recorded',translation=dict(display_language='en',status='unreviewed')))
    if context_change:context_change(supplied)
    return candidate,raw,encode(supplied)


class AppendedIssueReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.candidate,cls.base,cls.context=fixture()
    def prepare(self,**kw):return prepare_appended_issue_review(kw.get('candidate',self.candidate),kw.get('baseline',self.base),kw.get('context',self.context),observed_at=kw.get('observed_at',OBSERVED))
    def refuse(self,**kw):
        with self.assertRaisesRegex(AppendedIssueReviewError,'^appended_issue_review_unavailable$'):self.prepare(**kw)
    def test_append_preserves_every_baseline_claim_order_source_and_exact_candidate(self):
        result=self.prepare();baseline=json.loads(self.base);proposal=json.loads(result.proposal_raw)
        self.assertEqual(proposal['snapshot']['claims'][:-1],baseline['snapshot']['claims'])
        self.assertEqual(proposal['snapshot']['claims'][-1],json.loads(self.candidate.result.parts.payload_raw)['snapshot']['claims'][0])
        self.assertEqual(proposal['dependencyManifest']['sourceVersionIds'],[uid(960),uid(961),self.candidate.result.extraction.result.current.request.binding.source_version_id])
        self.assertEqual(result.baseline_raw,self.base);self.assertNotEqual(result.canonical_baseline_raw,self.base)
        self.assertEqual(result.canonical_baseline_raw,_json(baseline));self.assertIn('requires_strict_typescript_admission',result.evidence_state)
        self.assertNotIn('Invented',repr(result));self.assertEqual(result,self.prepare())
    def test_explicit_wholepage_metadata_and_review_state_are_not_inferred_from_single_candidate(self):
        result=self.prepare();proposal=json.loads(result.proposal_raw);ctx=json.loads(self.context);old=json.loads(self.candidate.result.parts.payload_raw)
        self.assertEqual(proposal['snapshot']['title'],ctx['page']['title']);self.assertNotEqual(proposal['snapshot']['title'],old['snapshot']['title'])
        self.assertEqual(proposal['snapshot']['summary'],ctx['page']['summary']);self.assertEqual(proposal['translation'],dict(displayLanguage='en',status='unreviewed'))
        self.assertEqual(proposal['conflictCoverage'],'not_recorded');self.assertEqual(proposal['kind'],'review_only')
    def test_new_proof_binds_old_parts_untouched_baseline_raw_and_new_payload_separately(self):
        result=self.prepare();proof=json.loads(result.composition_raw)
        self.assertEqual(proof['candidate_part_sha256'],[sha256(x).hexdigest() for x in (self.candidate.result.parts.payload_raw,self.candidate.result.parts.selection_raw,self.candidate.result.parts.provenance_raw,self.candidate.result.parts.context_raw)])
        self.assertEqual(proof['baseline_sha256'],sha256(self.base).hexdigest());self.assertEqual(proof['canonical_baseline_sha256'],sha256(result.canonical_baseline_raw).hexdigest())
        self.assertEqual(proof['proposal_sha256'],sha256(result.proposal_raw).hexdigest());self.assertEqual(proof['independent_context'],json.loads(self.context))
        self.assertNotEqual(proof['snapshot_intent'],json.loads(self.candidate.result.parts.provenance_raw)['snapshot_intent'])
        self.assertEqual(json.loads(result.candidate_report_raw)['parts']['provenance_json'].encode(),self.candidate.result.parts.provenance_raw)
    def test_changed_original_baseline_bytes_or_independent_head_identity_refuse(self):
        self.refuse(baseline=self.base+b' ')
        for key,value in [('publication_id',uid(999)),('issue_id',uid(999)),('content_sha256','f'*64),('head_changed_at',_time(AT)),('head_observed_at',_time(AT))]:
            ctx=json.loads(self.context);ctx['baseline'][key]=value;self.refuse(context=encode(ctx))
    def test_missing_explicit_page_or_review_metadata_cannot_be_filled_from_baseline(self):
        for section,key in [('page','title'),('page','summary'),('page','last_evidence_review_on'),('review','conflict_coverage'),('review','translation')]:
            ctx=json.loads(self.context);del ctx[section][key];self.refuse(context=encode(ctx))
    def test_translation_conflict_and_future_review_cannot_be_promoted(self):
        for section,key,value in [('review','conflict_coverage','recorded_partial'),('page','last_evidence_review_on','2027-01-01'),('page','title',' padded title')]:
            ctx=json.loads(self.context);ctx[section][key]=value;self.refuse(context=encode(ctx))
        for key,value in [('status','not_required'),('display_language','no')]:
            ctx=json.loads(self.context);ctx['review']['translation'][key]=value;self.refuse(context=encode(ctx))
    def test_primitive_bytes_duplicate_keys_and_context_extra_fields_refuse_before_hooks(self):
        hooks=[]
        class Hostile(bytes):
            def __len__(self):hooks.append('len');raise RuntimeError('PRIVATE')
            def decode(self,*args,**kw):hooks.append('decode');raise RuntimeError('PRIVATE')
        for raw in (bytearray(self.base),Hostile(self.base),b' '*24577):self.refuse(baseline=raw)
        for raw in (bytearray(self.context),Hostile(self.context),b'{"schema_version":1,"schema_version":1}',b' '*32769):self.refuse(context=raw)
        ctx=json.loads(self.context);ctx['extra']='PRIVATE';self.refuse(context=encode(ctx));self.assertEqual(hooks,[])
    def test_known_empty_head_or_missing_full_custody_is_not_a_baseline(self):
        from tests.test_detached_proposal_report import fixture as empty
        self.refuse(candidate=empty());self.refuse(candidate=replace(self.candidate,full_receipt=b'{}'));self.refuse(candidate=None)
    def test_candidate_claim_collision_and_source_alias_or_extra_manifest_refuse(self):
        for mutate in [lambda b:b['snapshot']['claims'][0].update(id=uid(704)),lambda b:b['snapshot']['claims'][1].update(id=uid(950)),
                lambda b:b['dependencyManifest']['sourceVersionIds'].append(uid(999)),lambda b:b['dependencyManifest']['sourceVersionIds'].pop()]:
            candidate,raw,ctx=fixture(baseline_change=mutate);self.refuse(candidate=candidate,baseline=raw,context=ctx)
    def test_inconsistent_same_version_source_metadata_refuses_without_collapsing_occurrences(self):
        def mutate(b):b['snapshot']['claims'][1]['evidence'][0]['sourceVersionId']=uid(960);b['dependencyManifest']['sourceVersionIds']=[uid(960)]
        candidate,raw,ctx=fixture(baseline_change=mutate);self.refuse(candidate=candidate,baseline=raw,context=ctx)
    def test_payload_and_sixpart_transfer_caps_refuse_instead_of_truncating(self):
        result=self.prepare();self.assertEqual(len(composition_parts(result)),6)
        with patch('workers.appended_issue_review.MAX_PAYLOAD_BYTES',len(result.proposal_raw)-1):self.refuse()
        with patch('workers.appended_issue_review.MAX_TRANSFER_BYTES',1):self.refuse()
    def test_valid_baseline_uuid_spelling_is_preserved_and_case_alias_collision_is_refused(self):
        upper='ABCDEF00-0000-4000-8000-000000000960'
        def positive(b):
            b['snapshot']['claims'][0]['id']='ABCDEF00-0000-4000-8000-000000000950'
            b['snapshot']['claims'][0]['evidence'][0]['sourceVersionId']=upper
            b['dependencyManifest']['sourceVersionIds'][0]=upper
        candidate,raw,ctx=fixture(baseline_change=positive)
        result=self.prepare(candidate=candidate,baseline=raw,context=ctx)
        self.assertEqual(json.loads(result.proposal_raw)['snapshot']['claims'][0]['id'],'ABCDEF00-0000-4000-8000-000000000950')
        self.assertEqual(json.loads(result.proposal_raw)['dependencyManifest']['sourceVersionIds'][0],upper)
        def negative(b):
            positive(b);b['snapshot']['claims'][1]['id']=b['snapshot']['claims'][0]['id'].lower()
        candidate,raw,ctx=fixture(baseline_change=negative);self.refuse(candidate=candidate,baseline=raw,context=ctx)

    def test_duplicate_original_baseline_keys_refuse_even_with_matching_witnessed_raw_hash(self):
        candidate,raw,ctx=fixture(baseline_transform=lambda raw:raw.replace(b'"revision": 2',b'"revision": 2, "revision": 2'))
        self.assertEqual(json.loads(ctx)['baseline']['content_sha256'],sha256(raw).hexdigest())
        self.refuse(candidate=candidate,baseline=raw,context=ctx)

    def test_same_exact_source_metadata_preserves_occurrences_without_duplicate_manifest_entry(self):
        ref=deepcopy(json.loads(self.candidate.result.parts.payload_raw)['snapshot']['claims'][0]['evidence'][0])
        def mutate(b):
            b['snapshot']['claims'][0]['evidence']=[ref]
            b['dependencyManifest']['sourceVersionIds'][0]=ref['sourceVersionId']
        candidate,raw,ctx=fixture(baseline_change=mutate)
        result=self.prepare(candidate=candidate,baseline=raw,context=ctx);p=json.loads(result.proposal_raw)
        self.assertEqual(p['dependencyManifest']['sourceVersionIds'],[ref['sourceVersionId'],uid(961)])
        self.assertEqual(p['snapshot']['claims'][0]['evidence'],p['snapshot']['claims'][-1]['evidence'])

    def test_twenty_nine_baseline_claims_fit_and_thirty_never_discards_one_to_make_room(self):
        def mutate(count):
            def apply(b):
                first=deepcopy(b['snapshot']['claims'][0]);first['assertion']='An invented baseline claim.';first['periodLabel']='Invented'
                b['snapshot']['claims']=[{**deepcopy(first),'id':uid(2000+i)} for i in range(count)]
                b['dependencyManifest']['sourceVersionIds']=[uid(960)]
            return apply
        compact=lambda raw:_json(json.loads(raw))
        candidate,raw,ctx=fixture(baseline_change=mutate(29),baseline_transform=compact)
        result=self.prepare(candidate=candidate,baseline=raw,context=ctx)
        self.assertEqual(len(json.loads(result.proposal_raw)['snapshot']['claims']),30)
        candidate,raw,ctx=fixture(baseline_change=mutate(30),baseline_transform=compact);self.refuse(candidate=candidate,baseline=raw,context=ctx)

    def test_full_artifact_and_composition_observations_are_not_rewound(self):
        self.refuse(observed_at=self.candidate.observed_at-timedelta(microseconds=1));self.refuse(observed_at=OBSERVED.replace(tzinfo=None))
        self.assertEqual(json.loads(self.prepare().composition_raw)['observed_at'],_time(OBSERVED))

if __name__=='__main__':unittest.main()
