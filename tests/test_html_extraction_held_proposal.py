"""HTML source correspondence never supplies absent substantive editorial trust."""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json,unittest
from unittest.mock import patch

from tests.test_html_extraction_custody import prepared,wire,encoded,cold,READ
from workers.feed_postgres_contract import _time
from workers.html_extraction_held_proposal import prepare_html_extraction_held_proposal,HtmlExtractionHeldProposalError

AT=READ+timedelta(seconds=10)
UID=lambda n:f'90000000-0000-4000-8000-{n:012d}'


def context(selected):
    result=selected.result;b=result.plan.change.current.result.document;p=result.proposal
    return dict(schema_version=1,kind='invented_detached_extraction_context',snapshot_intent='single_claim_technical_review_not_issue_replacement',
        artifact=dict(operation_id=result.operation_id,artifact_id=wire(selected)['artifact_id'],request_sha256=result.plan.request.request_sha256,output_sha256=sha256(result.output_raw).hexdigest()),
        held=dict(run_id=UID(1),decision_id=UID(2),item_key=b.item_key,source_version_id=b.source_version_id,content_sha256=b.content_sha256,locator=p.locator,
            jurisdiction_id='fictional-region',decided_at=_time(READ+timedelta(seconds=1)),disposition='held'),
        issue=dict(issue_id=UID(3),jurisdiction_id='fictional-region',jurisdiction_slug='fictional-region',issue_slug='invented-html-issue',created_at=_time(READ-timedelta(days=5)),
            observed_at=_time(READ+timedelta(seconds=2)),head=dict(publication_id=None,content_sha256=None,changed_at=None)),
        content=dict(capture_id=UID(4),claim_id=UID(5),title='Invented HTML review candidate',summary='A detached unverified technical example.',period_label='Independently supplied period',
            last_evidence_review_on=AT.date().isoformat(),review_date_basis='independently_supplied_not_inferred',publisher='Invented publisher',source_title='Invented HTML source',source_published_on=None),
        support=dict(source_version_id=b.source_version_id,content_sha256=b.content_sha256,locator=p.locator,assertion=p.proposed_assertion,claim_type=p.proposed_claim_type,relation='supports',assignment_state='proposed_only'),
        translation=dict(display_language=p.language_code,status='unreviewed'))


def prepare(selected=None,ctx=None,**changes):
    if selected is None:selected=prepared()
    if ctx is None:ctx=context(selected)
    values=dict(receipt=encoded(wire(selected)),expected=cold(selected),independent_context=encoded(ctx),
        current_receipt=selected.result.current_receipt,previous_receipt=selected.result.previous_receipt,observed_at=AT)
    values.update(changes)
    return prepare_html_extraction_held_proposal(**values)


class HtmlExtractionHeldProposalTests(unittest.TestCase):
    def test_four_exact_parts_keep_single_claim_proposed_support_and_html_provenance(self):
        selected=prepared();ctx=context(selected);raw=encoded(ctx);result=prepare(selected,ctx)
        payload=json.loads(result.payload_raw);selection=json.loads(result.selection_raw);proof=json.loads(result.provenance_raw)
        self.assertEqual(result.context_raw,raw);self.assertEqual(payload['kind'],'review_only')
        self.assertEqual(len(payload['snapshot']['claims']),1);self.assertEqual(payload['snapshot']['claims'][0]['assertion'],selected.result.proposal.proposed_assertion)
        self.assertEqual(payload['conflictCoverage'],'not_recorded');self.assertEqual(payload['translation']['status'],'unreviewed')
        self.assertIsNone(selection['basePublicationId']);self.assertEqual(selection['decisionId'],ctx['held']['decision_id'])
        self.assertEqual(proof['kind'],'detached_html_extraction_proposal')
        self.assertEqual(proof['current']['derivation_manifest_sha256'],selected.result.plan.change.current.result.derivation_manifest_sha256)
        self.assertEqual(proof['full_receipt_sha256'],sha256(encoded(wire(selected))).hexdigest())
        self.assertEqual(proof['payload_sha256'],sha256(result.payload_raw).hexdigest())
        self.assertEqual(proof['supplied_context_sha256'],sha256(raw).hexdigest());self.assertEqual(proof['independent_context'],ctx)
        self.assertEqual(proof['evidence_state'],'unverified_not_captured_no_durable_association')
        self.assertNotIn('invented source statement',repr(result));self.assertEqual(result,prepare(selected,ctx))

    def test_whitespace_in_original_context_is_retained_separately_from_canonical_hash(self):
        selected=prepared();ctx=context(selected);raw=json.dumps(ctx,indent=2).encode();result=prepare(selected,ctx,independent_context=raw)
        proof=json.loads(result.provenance_raw)
        self.assertEqual(result.context_raw,raw);self.assertNotEqual(proof['supplied_context_sha256'],proof['context_sha256'])

    def test_absent_partial_or_chosen_document_head_is_never_empty_publication_witness(self):
        selected=prepared()
        for head in [None,{},dict(publication_id=UID(9),content_sha256=None,changed_at=None)]:
            ctx=context(selected);ctx['issue']['head']=head
            with self.assertRaises(HtmlExtractionHeldProposalError):prepare(selected,ctx)
        ctx=context(selected);ctx['issue']['head']=dict(publication_id=UID(9),content_sha256='d'*64,changed_at=_time(READ-timedelta(days=1)))
        self.assertEqual(json.loads(prepare(selected,ctx).selection_raw)['basePublicationId'],UID(9))

    def test_wrong_artifact_held_original_or_issue_context_refuses_the_whole_candidate(self):
        selected=prepared()
        for section,key,value in [('artifact','operation_id',UID(9)),('artifact','artifact_id',UID(9)),('artifact','request_sha256','f'*64),('artifact','output_sha256','f'*64),
                ('held','source_version_id',UID(9)),('held','content_sha256','f'*64),('held','item_key','foreign'),('held','locator','context:one'),('held','disposition','accepted'),('issue','jurisdiction_id','foreign')]:
            ctx=context(selected);ctx[section][key]=value
            with self.subTest(section=section,key=key),self.assertRaises(HtmlExtractionHeldProposalError):prepare(selected,ctx)

    def test_no_support_translation_review_or_model_date_inference(self):
        selected=prepared()
        for section,key,value in [('support','assignment_state','verified'),('support','relation','context'),('support','assertion','Changed unverified assertion.'),
                ('support','claim_type','funding'),('support','content_sha256','f'*64),('support','locator','context:one'),('translation','status','not_required'),
                ('translation','display_language','no'),('content','review_date_basis','model_source_date'),('snapshot','intent','whole_issue_replacement')]:
            ctx=context(selected)
            if section=='snapshot':ctx['snapshot_intent']=value
            else:ctx[section][key]=value
            with self.subTest(section=section,key=key),self.assertRaises(HtmlExtractionHeldProposalError):prepare(selected,ctx)
        result=prepare(selected);self.assertIsNone(json.loads(result.payload_raw)['snapshot']['claims'][0]['evidence'][0]['sourcePublishedOn'])

    def test_store_decision_head_observation_and_publication_date_order_is_explicit(self):
        selected=prepared()
        for section,key,value in [('held','decided_at',_time(READ-timedelta(seconds=5))),('held','decided_at',_time(AT+timedelta(microseconds=1))),
                ('issue','observed_at',_time(READ)),('issue','created_at',_time(AT)),('content','last_evidence_review_on',(AT+timedelta(days=1)).date().isoformat()),
                ('content','source_published_on',(AT+timedelta(days=1)).date().isoformat())]:
            ctx=context(selected);ctx[section][key]=value
            with self.subTest(section=section,key=key),self.assertRaises(HtmlExtractionHeldProposalError):prepare(selected,ctx)

    def test_every_full_result_and_original_receipt_and_independent_intent_is_mandatory(self):
        selected=prepared()
        for key in ['receipt','current_receipt','previous_receipt']:
            for value in [None,b'{}',b'PRIVATE_CANARY']:
                with self.subTest(key=key),self.assertRaises(HtmlExtractionHeldProposalError):prepare(selected,**{key:value})
        with self.assertRaises(HtmlExtractionHeldProposalError):prepare(selected,expected=replace(cold(selected),canonical_metadata=b'{}'))

    def test_context_closed_types_duplicates_and_capacity_refuse_privately(self):
        selected=prepared();raw=encoded(context(selected))
        for value in [bytearray(raw),raw+b'{}',b'{"schema_version":1,"schema_version":1}',b'\xff',b' '*32769]:
            with self.assertRaises(HtmlExtractionHeldProposalError) as error:prepare(selected,independent_context=value)
            self.assertEqual(str(error.exception),'html_extraction_held_proposal_unavailable')
        for key,value in [('schema_version',True),('extra','PRIVATE')]:
            ctx=context(selected);ctx[key]=value
            with self.assertRaises(HtmlExtractionHeldProposalError):prepare(selected,ctx)

    def test_boundary_bom_payload_text_is_held_without_changing_original_evidence(self):
        selected=prepared()
        for key in ('title','summary','period_label','publisher','source_title'):
            for side in ('start','end'):
                ctx=context(selected);value=ctx['content'][key]
                ctx['content'][key]='\ufeff'+value if side=='start' else value+'\ufeff'
                with self.subTest(key=key,side=side),self.assertRaises(HtmlExtractionHeldProposalError):prepare(selected,ctx)
        from tests.test_html_private_extraction import prepare as extraction
        from workers.html_extraction_custody import prepare_html_extraction_store
        output=json.loads(selected.result.output_raw);output['proposed_assertion']='\ufeff'+output['proposed_assertion']
        changed=prepare_html_extraction_store(extraction(output_raw=encoded(output)))
        with self.assertRaises(HtmlExtractionHeldProposalError):prepare(changed)

    def test_interior_bom_and_raw_model_date_bom_are_preserved_outside_normalized_payload_boundaries(self):
        from tests.test_html_private_extraction import prepare as extraction
        from workers.html_extraction_custody import prepare_html_extraction_store
        selected=prepared();output=json.loads(selected.result.output_raw)
        output['proposed_assertion']='An invented \ufeff source statement remains unverified.'
        output['source_date_text']='\ufeffUnparsed raw date\ufeff'
        changed=prepare_html_extraction_store(extraction(output_raw=encoded(output)));ctx=context(changed)
        ctx['content']['title']='Invented \ufeff HTML review candidate'
        result=prepare(changed,ctx)
        self.assertEqual(json.loads(result.payload_raw)['snapshot']['claims'][0]['assertion'],output['proposed_assertion'])
        self.assertEqual(json.loads(result.provenance_raw)['source_date_text'],output['source_date_text'])
        self.assertEqual(result.context_raw,encoded(ctx))

    def test_exact_payload_and_provenance_bounds_hold_all_or_none_without_io(self):
        selected=prepared();result=prepare(selected)
        for name,raw in [('MAX_PAYLOAD_BYTES',result.payload_raw),('MAX_PROVENANCE_BYTES',result.provenance_raw)]:
            with patch('workers.html_extraction_held_proposal.'+name,len(raw)-1):
                with self.assertRaises(HtmlExtractionHeldProposalError):prepare(selected)
            with patch('workers.html_extraction_held_proposal.'+name,len(raw)),patch('subprocess.Popen',side_effect=AssertionError('no process')):
                self.assertEqual(prepare(selected),result)


if __name__=='__main__':unittest.main()
