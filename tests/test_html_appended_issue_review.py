"""Synthetic HTML full custody plus independent exact known-base composition."""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json,unittest
from unittest.mock import patch
from tests.test_html_proposal_custody import inputs as preparation_inputs
from tests.test_html_extraction_held_proposal import AT
from tests.test_html_proposal_postgres import wire,encode,cold,LATER
from workers.html_proposal_custody import prepare_html_proposal_custody
from workers.html_proposal_postgres import prepare_html_proposal_store
from workers.feed_postgres_contract import _time
from workers.private_extraction_held_proposal import _json
from workers.html_appended_issue_review import prepare_html_appended_issue_review,html_composition_parts,HtmlAppendedIssueReviewError,HtmlAppendedIssueReviewPreparation,INTENT

UID=lambda n:f'ca000000-0000-4000-8000-{n:012d}'
OBSERVED=LATER+timedelta(seconds=1)


def fixture(*,baseline_change=None,context_change=None,baseline_transform=None,empty_head=False):
    values=preparation_inputs();initial=prepare_html_proposal_custody(**values);old=json.loads(initial.parts.payload_raw);original=json.loads(values['context_raw'])
    snapshot=deepcopy(old['snapshot']);snapshot.update(title='Invented previous issue title',summary='Two prior invented observations remain untouched.')
    first=deepcopy(snapshot['claims'][0]);first.update(id=UID(950),assertion='Invented prior observation one.')
    first['evidence'][0].update(sourceVersionId=UID(960),url='https://example.org/prior-one',title='Invented prior source one')
    second=deepcopy(first);second.update(id=UID(951),assertion='Invented prior observation two.')
    second['evidence'][0].update(sourceVersionId=UID(961),url='https://example.org/prior-two',title='Invented prior source two')
    snapshot['claims']=[first,second]
    baseline=dict(id=UID(940),issueId=original['issue']['issue_id'],revision=2,kind='accepted',snapshot=snapshot,dependencyManifest=dict(sourceVersionIds=[UID(960),UID(961)]))
    if baseline_change:baseline_change(baseline)
    raw=json.dumps(baseline,ensure_ascii=False,indent=2).encode()
    if baseline_transform:raw=baseline_transform(raw)
    if not empty_head:original['issue']['head']=dict(publication_id=baseline['id'],content_sha256=sha256(raw).hexdigest(),changed_at=_time(AT-timedelta(days=1)))
    known=prepare_html_proposal_custody(**(values|dict(context_raw=json.dumps(original,indent=2).encode()+b'\n')))
    request=prepare_html_proposal_store(known)
    supplied=dict(schema_version=1,kind='invented_append_only_issue_context',snapshot_intent=INTENT,
        baseline=dict(publication_id=baseline['id'],issue_id=baseline['issueId'],content_sha256=sha256(raw).hexdigest(),head_changed_at=_time(AT-timedelta(days=1)),head_observed_at=original['issue']['observed_at']),
        page=dict(title='Explicit whole-issue review title',summary='An independent whole-issue summary requiring substantive review.',last_evidence_review_on=AT.date().isoformat()),
        review=dict(conflict_coverage='not_recorded',translation=dict(display_language='en',status='unreviewed')))
    if context_change:context_change(supplied)
    return dict(receipt=encode(wire(request)),expected=cold(request),baseline_raw=raw,context_raw=encode(supplied),
        extraction_receipt=known.receipt,extraction_expected=known.extraction_expected,current_receipt=known.current_receipt,previous_receipt=known.previous_receipt,observed_at=OBSERVED)


class HtmlAppendedIssueReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.values=fixture()
    def prepare(self,**changes):return prepare_html_appended_issue_review(**(self.values|changes))
    def refuse(self,values=None,**changes):
        with self.assertRaisesRegex(HtmlAppendedIssueReviewError,'^html_appended_issue_review_unavailable$')as error:prepare_html_appended_issue_review(**((self.values if values is None else values)|changes))
        self.assertIsNone(error.exception.__cause__)

    def test_all_prior_claims_order_sources_and_raw_baseline_are_preserved_before_exact_candidate(self):
        result=self.prepare();baseline=json.loads(self.values['baseline_raw']);proposal=json.loads(result.proposal_raw);report=json.loads(result.candidate_report_raw)
        self.assertIs(type(result),HtmlAppendedIssueReviewPreparation)
        self.assertEqual(proposal['snapshot']['claims'][:-1],baseline['snapshot']['claims'])
        candidate=json.loads(report['payload_json'])['snapshot']['claims'][0]
        self.assertEqual(proposal['snapshot']['claims'][-1],candidate)
        self.assertEqual(proposal['dependencyManifest']['sourceVersionIds'],[UID(960),UID(961),candidate['evidence'][0]['sourceVersionId']])
        self.assertEqual(result.baseline_raw,self.values['baseline_raw']);self.assertEqual(result.canonical_baseline_raw,_json(baseline));self.assertNotEqual(result.baseline_raw,result.canonical_baseline_raw)
        self.assertIn('requires_strict_typescript_admission',result.evidence_state);self.assertNotIn('Invented prior',repr(result));self.assertEqual(result,self.prepare())

    def test_explicit_page_and_review_metadata_are_neither_candidate_nor_baseline_defaults(self):
        result=self.prepare();proposal=json.loads(result.proposal_raw);context=json.loads(self.values['context_raw']);candidate=json.loads(json.loads(result.candidate_report_raw)['payload_json'])
        self.assertEqual(proposal['snapshot']['title'],context['page']['title']);self.assertNotEqual(proposal['snapshot']['title'],candidate['snapshot']['title'])
        self.assertNotEqual(proposal['snapshot']['summary'],json.loads(self.values['baseline_raw'])['snapshot']['summary'])
        self.assertEqual(proposal['snapshot']['lastEvidenceReviewOn'],context['page']['last_evidence_review_on'])
        self.assertEqual(proposal['translation'],dict(displayLanguage='en',status='unreviewed'));self.assertEqual(proposal['conflictCoverage'],'not_recorded');self.assertEqual(proposal['kind'],'review_only')

    def test_new_proof_binds_six_parts_and_distinguishes_candidate_context_from_whole_context(self):
        result=self.prepare();proof=json.loads(result.composition_raw);report=json.loads(result.candidate_report_raw);baseline=json.loads(result.baseline_raw)
        self.assertEqual(proof['kind'],'invented_html_appended_issue_review');self.assertEqual(proof['scope'],'invented_supplied_full_receipts_only')
        self.assertEqual(proof['candidate_report_sha256'],sha256(result.candidate_report_raw).hexdigest());self.assertEqual(proof['candidate_full_receipt_sha256'],sha256(self.values['receipt']).hexdigest())
        intent=json.loads(report['intent_json'])
        self.assertEqual(proof['candidate_preparation_intent_sha256'],sha256(report['intent_json'].encode()).hexdigest())
        self.assertEqual(proof['candidate_part_sha256'],[intent[key]for key in ('payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256')])
        for key,raw in [('baseline_sha256',result.baseline_raw),('canonical_baseline_sha256',result.canonical_baseline_raw),('context_raw_sha256',result.context_raw),('proposal_sha256',result.proposal_raw)]:self.assertEqual(proof[key],sha256(raw).hexdigest())
        self.assertEqual(proof['preserved_claim_sha256'],[sha256(_json(claim)).hexdigest()for claim in baseline['snapshot']['claims']])
        self.assertEqual(proof['independent_context'],json.loads(result.context_raw));self.assertEqual(proof['snapshot_intent'],INTENT)
        self.assertNotEqual(proof['snapshot_intent'],json.loads(report['provenance_json'])['snapshot_intent'])
        self.assertIn('not_captured_or_publication_qualified',proof['evidence_state']);self.assertEqual(len(html_composition_parts(result)),6)

    def test_changed_baseline_bytes_and_each_independent_head_or_issue_witness_hold(self):
        self.refuse(baseline_raw=self.values['baseline_raw']+b' ')
        for key,value in [('publication_id',UID(999)),('issue_id',UID(999)),('content_sha256','f'*64),('head_changed_at',_time(AT)),('head_observed_at',_time(AT))]:
            context=json.loads(self.values['context_raw']);context['baseline'][key]=value
            with self.subTest(key=key):self.refuse(context_raw=encode(context))

    def test_duplicate_original_keys_revision_kind_and_issue_shape_hold_even_with_bound_raw_hash(self):
        mutations=[lambda b:b.update(revision=True),lambda b:b.update(revision=0),lambda b:b.update(kind='review_only'),lambda b:b.update(issueId=UID(99)),
            lambda b:b['snapshot'].update(schemaVersion=True),lambda b:b['snapshot'].update(issueSlug='different-issue'),lambda b:b.update(extra='PRIVATE')]
        for change in mutations:
            with self.subTest(change=change):self.refuse(fixture(baseline_change=change))
        self.refuse(fixture(baseline_transform=lambda raw:raw.replace(b'"revision": 2',b'"revision": 2, "revision": 2')))

    def test_candidate_id_collision_duplicate_prior_claim_and_source_alias_manifest_hold(self):
        claim_id=json.loads(json.loads(self.prepare().candidate_report_raw)['payload_json'])['snapshot']['claims'][0]['id']
        for change in [lambda b:b['snapshot']['claims'][0].update(id=claim_id),lambda b:b['snapshot']['claims'][1].update(id=UID(950)),
                lambda b:b['dependencyManifest']['sourceVersionIds'].append(UID(999)),lambda b:b['dependencyManifest']['sourceVersionIds'].pop()]:
            self.refuse(fixture(baseline_change=change))
        def alias(b):
            b['snapshot']['claims'][1]['evidence'][0]['sourceVersionId']=UID(960);b['dependencyManifest']['sourceVersionIds']=[UID(960)]
        self.refuse(fixture(baseline_change=alias))

    def test_identical_source_metadata_keeps_occurrences_without_duplicate_manifest_source(self):
        reference=deepcopy(json.loads(json.loads(self.prepare().candidate_report_raw)['payload_json'])['snapshot']['claims'][0]['evidence'][0])
        def same(b):b['snapshot']['claims'][0]['evidence']=[reference];b['dependencyManifest']['sourceVersionIds'][0]=reference['sourceVersionId']
        result=prepare_html_appended_issue_review(**fixture(baseline_change=same));proposal=json.loads(result.proposal_raw)
        self.assertEqual(proposal['snapshot']['claims'][0]['evidence'],proposal['snapshot']['claims'][-1]['evidence'])
        self.assertEqual(proposal['dependencyManifest']['sourceVersionIds'],[reference['sourceVersionId'],UID(961)])

    def test_prior_uuid_spelling_preserved_while_case_alias_duplicate_identity_holds(self):
        spelling='ABCDEF00-0000-4000-8000-000000000950'
        def positive(b):b['snapshot']['claims'][0]['id']=spelling
        result=prepare_html_appended_issue_review(**fixture(baseline_change=positive))
        self.assertEqual(json.loads(result.proposal_raw)['snapshot']['claims'][0]['id'],spelling)
        def alias(b):positive(b);b['snapshot']['claims'][1]['id']=spelling.lower()
        self.refuse(fixture(baseline_change=alias))

    def test_every_page_review_field_is_explicit_and_no_translation_conflict_approval_inferred(self):
        for section,key in [('page','title'),('page','summary'),('page','last_evidence_review_on'),('review','conflict_coverage'),('review','translation')]:
            context=json.loads(self.values['context_raw']);del context[section][key];self.refuse(context_raw=encode(context))
        for section,key,value in [('page','title',' padded title'),('page','last_evidence_review_on','2027-01-01'),('review','conflict_coverage','recorded_partial')]:
            context=json.loads(self.values['context_raw']);context[section][key]=value;self.refuse(context_raw=encode(context))
        for key,value in [('status','not_required'),('display_language','no')]:
            context=json.loads(self.values['context_raw']);context['review']['translation'][key]=value;self.refuse(context_raw=encode(context))

    def test_boundary_bom_is_held_without_normalizing_and_interior_bom_is_preserved(self):
        for key in ('title','summary'):
            for side in ('start','end'):
                context=json.loads(self.values['context_raw']);text=context['page'][key];context['page'][key]='\ufeff'+text if side=='start'else text+'\ufeff'
                self.refuse(context_raw=encode(context))
        context=json.loads(self.values['context_raw']);context['page']['title']='Explicit \ufeff whole title'
        self.assertEqual(json.loads(self.prepare(context_raw=encode(context)).proposal_raw)['snapshot']['title'],context['page']['title'])
        self.refuse(fixture(baseline_change=lambda b:b['snapshot']['claims'][0].update(assertion='\ufeffAn invented old assertion.')))

    def test_all_four_full_receipts_and_typed_independent_preparation_extraction_selectors_required(self):
        for field in ('receipt','extraction_receipt','current_receipt','previous_receipt'):
            for value in (None,b'{}',bytearray(self.values[field])):
                with self.subTest(field=field):self.refuse(**{field:value})
        for field in ('expected','extraction_expected'):
            for value in (None,{},replace(self.values[field],artifact_id=UID(99))):self.refuse(**{field:value})
        self.refuse(fixture(empty_head=True))

    def test_native_bytes_context_duplicates_observation_and_private_error_hold_before_hooks(self):
        hooks=[]
        class Hostile(bytes):
            def __len__(self):hooks.append('len');raise RuntimeError('PRIVATE')
            def decode(self,*args,**kwargs):hooks.append('decode');raise RuntimeError('PRIVATE')
        for value in (bytearray(self.values['baseline_raw']),Hostile(self.values['baseline_raw']),b'x'*24577):self.refuse(baseline_raw=value)
        for value in (bytearray(self.values['context_raw']),Hostile(self.values['context_raw']),b'{"schema_version":1,"schema_version":1}',b'x'*32769):self.refuse(context_raw=value)
        self.assertEqual(hooks,[]);self.refuse(observed_at=LATER-timedelta(microseconds=1));self.refuse(observed_at=OBSERVED.replace(tzinfo=None))

    def test_twenty_nine_prior_claims_fit_but_thirty_is_not_trimmed_to_make_room(self):
        def count(n):
            def apply(b):
                old=deepcopy(b['snapshot']['claims'][0]);old['assertion']='An invented old claim.';old['periodLabel']='Invented'
                b['snapshot']['claims']=[dict(deepcopy(old),id=UID(2000+i))for i in range(n)];b['dependencyManifest']['sourceVersionIds']=[UID(960)]
            return apply
        compact=lambda raw:_json(json.loads(raw))
        values=fixture(baseline_change=count(29),baseline_transform=compact);result=prepare_html_appended_issue_review(**values)
        self.assertEqual(len(json.loads(result.proposal_raw)['snapshot']['claims']),30)
        self.refuse(fixture(baseline_change=count(30),baseline_transform=compact))

    def test_six_part_payload_proof_transfer_caps_and_no_io_do_not_truncate_or_dispatch(self):
        result=self.prepare();self.assertEqual(len(html_composition_parts(result)),6)
        for name,value in [('MAX_PAYLOAD_BYTES',len(result.proposal_raw)-1),('MAX_PROOF_BYTES',len(result.composition_raw)-1),('MAX_TRANSFER_BYTES',1)]:
            with patch('workers.html_appended_issue_review.'+name,value):self.refuse()
        with patch('subprocess.Popen',side_effect=AssertionError('no process')),patch('builtins.open',side_effect=AssertionError('no file')):self.assertEqual(self.prepare(),result)
        with self.assertRaises(ValueError):html_composition_parts({})
        with self.assertRaises(ValueError):html_composition_parts(replace(result,proposal_raw=bytearray(result.proposal_raw)))


if __name__=='__main__':unittest.main()
