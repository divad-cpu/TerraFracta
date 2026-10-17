"""PDF whole-issue structural review over complete invented supplied custody.

Only the named actual controls cold-open PDF originals. Structural mutation
matrices explicitly stub the already measured report boundary, never claiming
that their altered report bytes were emitted by the PDF custody producer.
"""
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta, tzinfo
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.test_pdf_proposal_custody import inputs
from tests.test_pdf_preparation_postgres import receipt as preparation_receipt, PREPARATION_ARTIFACT
from workers.pdf_proposal_custody import prepare_pdf_proposal_custody
from workers.pdf_preparation_postgres import prepare_pdf_preparation_store, prepare_pdf_preparation_reopen
from workers.pdf_preparation_review_report import pdf_preparation_review_report
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import _json
import workers.pdf_appended_issue_review as m

UID=lambda n:f'cd000000-0000-4000-8000-{n:012d}'


def fixture():
    data=inputs();initial=prepare_pdf_proposal_custody(**data)
    payload=json.loads(initial.parts.payload_raw);original=json.loads(data['context_raw'])
    snapshot=deepcopy(payload['snapshot']);snapshot.update(title='Invented older issue title',summary='Two independently invented old claims remain exact.')
    first=deepcopy(snapshot['claims'][0]);first.update(id=UID(950),assertion='An invented prior condition remains unverified.')
    first['evidence'][0].update(sourceVersionId=UID(960),url='https://example.org/prior-one',title='Invented prior source one')
    second=deepcopy(first);second.update(id=UID(951),assertion='A second invented prior condition remains unverified.')
    second['evidence'][0].update(sourceVersionId=UID(961),url='https://example.org/prior-two',title='Invented prior source two')
    snapshot['claims']=[first,second]
    baseline=dict(id=UID(940),issueId=original['issue']['issue_id'],revision=2,kind='accepted',snapshot=snapshot,dependencyManifest=dict(sourceVersionIds=[UID(960),UID(961)]))
    baseline_raw=json.dumps(baseline,ensure_ascii=False,indent=2).encode()+b'\n'
    changed_at=_stamp(data['observed_at']-timedelta(days=1))
    original['issue']['head']=dict(publication_id=baseline['id'],content_sha256=sha256(baseline_raw).hexdigest(),changed_at=changed_at)
    prepared=prepare_pdf_proposal_custody(**(data|dict(context_raw=json.dumps(original,ensure_ascii=False,indent=2).encode()+b'\n')))
    store=prepare_pdf_preparation_store(prepared);stored_at=prepared.observed_at+timedelta(seconds=1);at=stored_at+timedelta(days=2)
    raw=preparation_receipt(store,stored_at=stored_at)
    expected=prepare_pdf_preparation_reopen(intent=prepared.intent,artifact_id=PREPARATION_ARTIFACT,stored_at=stored_at,observed_at=at)
    context=dict(schema_version=1,kind='invented_append_only_issue_context',snapshot_intent=m.INTENT,
        baseline=dict(publication_id=baseline['id'],issue_id=baseline['issueId'],content_sha256=sha256(baseline_raw).hexdigest(),head_changed_at=changed_at,head_observed_at=original['issue']['observed_at']),
        page=dict(title='Explicit invented complete-issue title',summary='An independently supplied whole-issue summary requiring substantive review.',last_evidence_review_on=at.date().isoformat()),
        review=dict(conflict_coverage='not_recorded',translation=dict(display_language='en',status='unreviewed')))
    values=dict(raw=raw,expected=expected,baseline_raw=baseline_raw,context_raw=_json(context),receipt=prepared.receipt,
        extraction_expected=prepared.extraction_expected,intent_raw=prepared.intent_raw,observed_at=at)
    report=pdf_preparation_review_report(raw,expected,receipt=prepared.receipt,extraction_expected=prepared.extraction_expected,intent_raw=prepared.intent_raw,observed_at=at)
    return values,report


class PdfAppendedIssueReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.values,cls.report=fixture()

    def prepare(self,**changes):return m.prepare_pdf_appended_issue_review(**(self.values|changes))
    def refuse(self,values=None,**changes):
        with self.assertRaisesRegex(m.PdfAppendedIssueReviewError,'^pdf_appended_issue_review_unavailable$')as error:
            m.prepare_pdf_appended_issue_review(**((self.values if values is None else values)|changes))
        self.assertIsNone(error.exception.__cause__);self.assertNotIn('PRIVATE',str(error.exception))

    @contextmanager
    def actual(self):
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            child=launch(*args,**kwargs);children.append(child);return child
        with patch.object(inspector.subprocess,'Popen',side_effect=start),patch.object(m,'pdf_preparation_review_report',wraps=m.pdf_preparation_review_report)as core:
            try:yield children,core
            finally:
                for child in children:
                    self.assertIsNotNone(child.poll());self.assertTrue(all(getattr(child,k).closed for k in ('stdin','stdout','stderr')))

    def structural(self,baseline_change=None,*,transform=None):
        # Deliberate pure-structure seam: its input report is NOT a new native or
        # PDF producer receipt. Keep independent raw baseline/hash/head joins
        # coherent so duplicate/claim/source validators, rather than an earlier
        # unrelated digest failure, receive the specific adversarial grammar.
        baseline=json.loads(self.values['baseline_raw'])
        if baseline_change:baseline_change(baseline)
        raw=json.dumps(baseline,ensure_ascii=False,indent=2).encode()+b'\n'
        if transform:raw=transform(raw)
        context=json.loads(self.values['context_raw']);context['baseline']['content_sha256']=sha256(raw).hexdigest()
        report=json.loads(self.report);proof=json.loads(report['parts']['provenance_json'])
        proof['independent_context']['issue']['head']['content_sha256']=sha256(raw).hexdigest()
        report['parts']['provenance_json']=_json(proof).decode()
        return self.values|dict(baseline_raw=raw,context_raw=_json(context)),_json(report)

    def test_actual_known_base_cold_opens_each_original_once_and_preserves_all_prior_claims_order(self):
        with self.actual()as(children,core):result=self.prepare()
        self.assertEqual((len(children),core.call_count),(2,1))
        self.assertIs(type(result),m.PdfAppendedIssueReviewPreparation)
        old=json.loads(self.values['baseline_raw']);proposal=json.loads(result.proposal_raw);report=json.loads(result.candidate_report_raw)
        candidate=json.loads(report['parts']['payload_json'])['snapshot']['claims'][0]
        self.assertEqual(proposal['snapshot']['claims'],[*old['snapshot']['claims'],candidate])
        self.assertEqual(proposal['dependencyManifest']['sourceVersionIds'],[UID(960),UID(961),candidate['evidence'][0]['sourceVersionId']])
        self.assertEqual(result.baseline_raw,self.values['baseline_raw']);self.assertEqual(result.canonical_baseline_raw,_json(old));self.assertNotEqual(result.baseline_raw,result.canonical_baseline_raw)
        self.assertEqual(result.candidate_report_raw,self.report)
        proof=json.loads(result.composition_raw)
        self.assertEqual(proof['kind'],'invented_pdf_appended_issue_review');self.assertEqual(proof['snapshot_intent'],m.INTENT)
        self.assertIn('not_captured_or_publication_qualified',proof['evidence_state'])
        self.assertEqual(proof['candidate_full_receipt_sha256'],sha256(self.values['raw']).hexdigest())
        self.assertEqual(proof['candidate_report_sha256'],sha256(result.candidate_report_raw).hexdigest())
        for key,raw in [('baseline_sha256',result.baseline_raw),('canonical_baseline_sha256',result.canonical_baseline_raw),('context_raw_sha256',result.context_raw),('proposal_sha256',result.proposal_raw)]:self.assertEqual(proof[key],sha256(raw).hexdigest())
        self.assertEqual(proof['preserved_claim_sha256'],[sha256(_json(claim)).hexdigest()for claim in old['snapshot']['claims']])
        self.assertEqual(len(m.pdf_composition_parts(result)),6)

    def test_explicit_whole_page_review_fields_do_not_inherit_candidate_or_baseline(self):
        with patch.object(m,'pdf_preparation_review_report',return_value=self.report):result=self.prepare()
        proposal=json.loads(result.proposal_raw);context=json.loads(self.values['context_raw']);candidate=json.loads(json.loads(self.report)['parts']['payload_json'])
        self.assertEqual(proposal['snapshot']['title'],context['page']['title']);self.assertNotEqual(proposal['snapshot']['title'],candidate['snapshot']['title'])
        self.assertNotEqual(proposal['snapshot']['summary'],json.loads(self.values['baseline_raw'])['snapshot']['summary'])
        self.assertEqual(proposal['snapshot']['lastEvidenceReviewOn'],context['page']['last_evidence_review_on'])
        self.assertEqual(proposal['translation'],dict(displayLanguage='en',status='unreviewed'));self.assertEqual(proposal['conflictCoverage'],'not_recorded');self.assertEqual(proposal['kind'],'review_only')
        for private in ('Invented older',self.values['baseline_raw'].decode(),result.proposal_raw.decode()):self.assertNotIn(private,repr(result))
        with self.assertRaises(Exception):result.baseline_raw=b'PRIVATE'
        self.assertFalse(hasattr(result,'statement'))

    def test_raw_baseline_and_every_independent_head_witness_must_match(self):
        with patch.object(m,'pdf_preparation_review_report',return_value=self.report):
            self.refuse(baseline_raw=self.values['baseline_raw']+b' ')
            for key,value in [('publication_id',UID(999)),('issue_id',UID(999)),('content_sha256','f'*64),('head_changed_at',_stamp(self.values['observed_at'])),('head_observed_at',_stamp(self.values['observed_at']))]:
                context=json.loads(self.values['context_raw']);context['baseline'][key]=value
                with self.subTest(key=key):self.refuse(context_raw=_json(context))
            report=json.loads(self.report);proof=json.loads(report['parts']['provenance_json']);proof['independent_context']['issue']['head']=dict(publication_id=None,content_sha256=None,changed_at=None);report['parts']['provenance_json']=_json(proof).decode()
            with patch.object(m,'pdf_preparation_review_report',return_value=_json(report)):self.refuse()

    def test_baseline_duplicate_keys_types_kind_and_issue_refuse_after_independent_raw_join(self):
        changes=[lambda b:b.update(revision=True),lambda b:b.update(revision=0),lambda b:b.update(kind='review_only'),lambda b:b.update(issueId=UID(999)),lambda b:b.update(PRIVATE='x'),lambda b:b['snapshot'].update(schemaVersion=True),lambda b:b['snapshot'].update(issueSlug='foreign')]
        for change in changes:
            values,report=self.structural(change)
            with self.subTest(change=change),patch.object(m,'pdf_preparation_review_report',return_value=report):self.refuse(values)
        values,report=self.structural(transform=lambda raw:raw.replace(b'"revision": 2',b'"revision": 2, "revision": 2'))
        with patch.object(m,'pdf_preparation_review_report',return_value=report):self.refuse(values)

    def test_claim_identity_collisions_source_metadata_aliases_and_manifest_extras_refuse(self):
        claim_id=json.loads(json.loads(self.report)['parts']['payload_json'])['snapshot']['claims'][0]['id']
        for change in [lambda b:b['snapshot']['claims'][0].update(id=claim_id),lambda b:b['snapshot']['claims'][1].update(id=UID(950)),lambda b:b['dependencyManifest']['sourceVersionIds'].append(UID(999)),lambda b:b['dependencyManifest']['sourceVersionIds'].pop()]:
            values,report=self.structural(change)
            with patch.object(m,'pdf_preparation_review_report',return_value=report):self.refuse(values)
        def source_alias(b):
            b['snapshot']['claims'][1]['evidence'][0]['sourceVersionId']=UID(960);b['dependencyManifest']['sourceVersionIds']=[UID(960)]
        values,report=self.structural(source_alias)
        with patch.object(m,'pdf_preparation_review_report',return_value=report):self.refuse(values)

    def test_missing_explicit_review_conflict_or_translation_qualification_is_not_inferred(self):
        with patch.object(m,'pdf_preparation_review_report',return_value=self.report):
            for group,key in [('page','title'),('page','summary'),('page','last_evidence_review_on'),('review','conflict_coverage'),('review','translation')]:
                context=json.loads(self.values['context_raw']);del context[group][key];self.refuse(context_raw=_json(context))
            for group,key,value in [('page','last_evidence_review_on','2099-01-01'),('page','title',' padded'),('review','conflict_coverage','recorded_complete')]:
                context=json.loads(self.values['context_raw']);context[group][key]=value;self.refuse(context_raw=_json(context))
            for key,value in [('status','not_required'),('display_language','no')]:
                context=json.loads(self.values['context_raw']);context['review']['translation'][key]=value;self.refuse(context_raw=_json(context))

    def test_entry_raw_types_namespace_and_size_refuse_without_hooks_or_original_children(self):
        hooks=[]
        class Hostile(bytes):
            def __len__(self):hooks.append('len');raise RuntimeError('PRIVATE')
            def decode(self,*a,**k):hooks.append('decode');raise RuntimeError('PRIVATE')
        with patch.object(m,'pdf_preparation_review_report',side_effect=AssertionError('No report'))as core,patch('subprocess.Popen',side_effect=AssertionError('No child'))as child:
            for key,limit in [('baseline_raw',24576),('context_raw',32768)]:
                for value in (None,bytearray(self.values[key]),Hostile(self.values[key]),b'x'*(limit+1)):
                    with self.subTest(key=key):self.refuse(**{key:value})
            bad=deepcopy(self.values['expected']);vars(bad)['PRIVATE']='extra';self.refuse(expected=bad)
            self.refuse(observed_at=self.values['observed_at'].replace(tzinfo=None));core.assert_not_called();child.assert_not_called()
        self.assertEqual(hooks,[])

    def test_actual_wrong_full_receipt_and_independent_identity_never_fall_back(self):
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:
            self.refuse(raw=b'{}')
            self.refuse(expected=replace(self.values['expected'],artifact_id=UID(999)))
            self.refuse(extraction_expected=replace(self.values['extraction_expected'],previous=None))
            child.assert_not_called()

    def test_earliest_nested_UTC_cannot_repair_original_wrong_independent_selector(self):
        expected=deepcopy(self.values['expected']);vars(expected)['artifact_id']=UID(999);calls=[]
        class UTC(tzinfo):
            def utcoffset(clock,value):calls.append('offset');vars(expected)['artifact_id']=PREPARATION_ARTIFACT;return timedelta(0)
            def dst(clock,value):return timedelta(0)
        vars(expected)['stored_at']=expected.stored_at.replace(tzinfo=UTC())
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:self.refuse(expected=expected);child.assert_not_called()
        self.assertTrue(calls);self.assertEqual(expected.artifact_id,PREPARATION_ARTIFACT)

    def test_actual_first_clock_cannot_retarget_later_nested_expectations_or_private_context(self):
        values=deepcopy(self.values);expected=values['expected'];extraction=values['extraction_expected'];calls=[]
        class UTC(tzinfo):
            def utcoffset(clock,value):
                calls.append('offset');vars(expected.intent)['canonical_metadata']=b'{}';vars(extraction.current.binding)['source_version_id']=UID(999);vars(extraction.request)['request_sha256']='f'*64;return timedelta(0)
            def dst(clock,value):return timedelta(0)
        vars(expected)['stored_at']=expected.stored_at.replace(tzinfo=UTC())
        with self.actual()as(children,core):result=m.prepare_pdf_appended_issue_review(**values)
        self.assertTrue(calls);self.assertEqual((len(children),core.call_count),(2,1));self.assertEqual(result.candidate_report_raw,self.report)
        self.assertEqual(result.baseline_raw,self.values['baseline_raw']);self.assertEqual(result.context_raw,self.values['context_raw'])
        self.assertEqual(extraction.current.binding.source_version_id,UID(999))

    def test_part_and_transfer_caps_are_separate_and_no_carrier_cast_dispatch_or_private_error(self):
        with patch.object(m,'pdf_preparation_review_report',return_value=self.report):result=self.prepare()
        for name,value in [('MAX_PAYLOAD_BYTES',len(result.proposal_raw)-1),('MAX_PROOF_BYTES',len(result.composition_raw)-1),('MAX_TRANSFER_BYTES',1)]:
            with patch.object(m,name,value),patch.object(m,'pdf_preparation_review_report',return_value=self.report):self.refuse()
        with self.assertRaises(ValueError):m.pdf_composition_parts({})
        with self.assertRaises(ValueError):m.pdf_composition_parts(replace(result,proposal_raw=bytearray(result.proposal_raw)))
        for error in [ValueError('PRIVATE'),RuntimeError('PRIVATE')]:
            with patch.object(m,'pdf_preparation_review_report',side_effect=error):self.refuse()
        with patch.object(m,'pdf_preparation_review_report',return_value=self.report),patch('builtins.open',side_effect=AssertionError('No file')),patch('subprocess.Popen',side_effect=AssertionError('No process')):
            self.assertEqual(self.prepare(),result)

if __name__=='__main__':unittest.main()
