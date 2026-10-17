"""Historical preparation report over four synthetic receipts, never storage."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import base64,json,unittest
from unittest.mock import patch
from tests.test_html_proposal_postgres import request,wire,encode,cold,LATER
from tests.test_html_proposal_custody import OPERATION
from tests.test_html_extraction_custody import prepared as extraction_prepared,wire as extraction_wire,encoded as extraction_encode,cold as extraction_cold
from tests.test_html_extraction_held_proposal import context,AT,UID
from tests.test_html_private_extraction import prepare as private_extraction
from workers.html_extraction_custody import prepare_html_extraction_store
from workers.html_proposal_custody import prepare_html_proposal_custody,HtmlPreparationIntent
from workers.html_proposal_postgres import prepare_html_proposal_store
from workers.feed_postgres_contract import _time
from workers.html_preparation_review_report import html_preparation_review_report,HtmlPreparationReviewReportError,MAX_HTML_PREPARATION_REVIEW_BYTES


def inputs(selected=None):
    if selected is None:selected=request()
    p=selected.prepared
    return dict(receipt=encode(wire(selected)),expected=cold(selected),extraction_receipt=p.receipt,extraction_expected=p.extraction_expected,
        current_receipt=p.current_receipt,previous_receipt=p.previous_receipt,observed_at=LATER)


def report(selected=None,**changes):return html_preparation_review_report(**(inputs(selected)|changes))


def illustrative_selection(*,known_head=False,raw_date=None):
    extraction=extraction_prepared()
    if raw_date is not None:
        output=json.loads(extraction.result.output_raw);output['source_date_text']=raw_date
        extraction=prepare_html_extraction_store(private_extraction(output_raw=json.dumps(output).encode()))
    ctx=context(extraction)
    if known_head:ctx['issue']['head']=dict(publication_id=UID(90),content_sha256='d'*64,changed_at=_time(AT-timedelta(days=1)))
    prepared=prepare_html_proposal_custody(extraction_encode(extraction_wire(extraction)),extraction_cold(extraction),json.dumps(ctx,indent=2).encode()+b'\n',
        current_receipt=extraction.result.current_receipt,previous_receipt=extraction.result.previous_receipt,operation_id=OPERATION,observed_at=AT)
    return prepare_html_proposal_store(prepared)


class HtmlPreparationReviewReportTests(unittest.TestCase):
    def test_exact_canonical_report_keeps_typed_identity_intent_and_three_historical_parts(self):
        selected=request();values=inputs(selected);raw=html_preparation_review_report(**values);r=json.loads(raw);p=selected.prepared
        self.assertEqual(set(r),set('schema_version kind scope review_state observed_at preparation intent_json payload_json selection_json provenance_json extraction limits'.split()))
        self.assertEqual(r['kind'],'private_html_preparation_review_report');self.assertEqual(r['scope'],'invented_supplied_full_receipts_only');self.assertEqual(r['review_state'],'unverified')
        self.assertEqual(r['preparation']['operation_id'],OPERATION);self.assertEqual(r['preparation']['artifact_id'],cold(selected).artifact_id)
        self.assertEqual(r['preparation']['metadata_sha256'],sha256(p.intent.canonical_metadata).hexdigest());self.assertEqual(r['preparation']['receipt_sha256'],sha256(values['receipt']).hexdigest())
        for key,value in [('intent_json',p.intent.canonical_metadata),('payload_json',p.parts.payload_raw),('selection_json',p.parts.selection_raw),('provenance_json',p.parts.provenance_raw)]:self.assertEqual(r[key].encode(),value)
        self.assertEqual(raw,json.dumps(r,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode())
        intent=json.loads(r['intent_json'])
        for name in ('payload','selection','provenance'):self.assertEqual(sha256(r[name+'_json'].encode()).hexdigest(),intent[name+'_sha256'])
        self.assertEqual(intent['context_raw_sha256'],sha256(p.parts.context_raw).hexdigest())

    def test_historical_preparation_and_context_are_never_renewed_by_later_observation(self):
        selected=request();first=json.loads(report(selected));later=json.loads(report(selected,observed_at=LATER+timedelta(days=1)))
        self.assertEqual(first['preparation'],later['preparation'])
        self.assertEqual(first['preparation']['prepared_at'],_time(selected.prepared.observed_at))
        self.assertEqual(first['preparation']['historical_artifact_observed_at'],_time(selected.prepared.observed_at))
        for key in ('intent_json','payload_json','selection_json','provenance_json'):self.assertEqual(first[key],later[key])
        self.assertNotEqual(first['observed_at'],later['observed_at']);self.assertEqual(later['extraction']['observed_at'],later['observed_at'])
        self.assertFalse(later['limits']['current_qualification_established']);self.assertFalse(later['limits']['held_capture_observed'])

    def test_each_full_receipt_is_required_and_report_or_prebuilt_object_never_substitutes(self):
        values=inputs();projected=html_preparation_review_report(**values)
        for key in ('receipt','extraction_receipt','current_receipt','previous_receipt'):
            for operand in (None,b'{}',bytearray(values[key]),projected):
                with self.subTest(key=key),self.assertRaises(HtmlPreparationReviewReportError):report(**{key:operand})
        with self.assertRaises(HtmlPreparationReviewReportError):report(receipt=request().prepared)

    def test_changed_metadata_or_any_part_or_artifact_withholds_entire_projection(self):
        selected=request();body=wire(selected)
        for key in ('metadata_base64','payload_base64','selection_base64','provenance_base64','context_base64'):
            changed=body|{key:base64.b64encode(b'PRIVATE_CANARY').decode()}
            with self.subTest(key=key),self.assertRaises(HtmlPreparationReviewReportError):report(selected,receipt=encode(changed))
        for key,value in [('artifact_id',UID(99)),('stored_at',_time(LATER+timedelta(microseconds=1))),('extra','PRIVATE_CANARY')]:
            with self.subTest(key=key),self.assertRaises(HtmlPreparationReviewReportError):report(selected,receipt=encode(body|{key:value}))

    def test_independent_intent_identity_and_time_cannot_be_reconstructed_from_report_only(self):
        selected=request();expect=cold(selected)
        for changed in [None,{},replace(expect,artifact_id=UID(99)),replace(expect,stored_at=expect.stored_at+timedelta(microseconds=1)),
                replace(expect,intent=HtmlPreparationIntent(b'{}')),replace(expect,observed_at=LATER+timedelta(microseconds=1))]:
            with self.subTest(type=type(changed).__name__),self.assertRaises(HtmlPreparationReviewReportError):report(selected,expected=changed)
        p=selected.prepared
        for changed in [None,{},replace(p.extraction_expected,artifact_id=UID(98)),replace(p.extraction_expected,canonical_metadata=b'{}')]:
            with self.subTest(type=type(changed).__name__),self.assertRaises(HtmlPreparationReviewReportError):report(selected,extraction_expected=changed)

    def test_both_existing_and_explicit_empty_heads_stay_historical_assertions(self):
        for known in (False,True):
            selected=illustrative_selection(known_head=known);r=json.loads(report(selected));selection=json.loads(r['selection_json']);proof=json.loads(r['provenance_json'])
            self.assertEqual(selection['basePublicationId'],UID(90)if known else None)
            self.assertEqual(selection['basePublicationId'],proof['independent_context']['issue']['head']['publication_id'])
            self.assertFalse(r['limits']['current_publication_observed']);self.assertFalse(r['limits']['independent_intent_authenticated'])

    def test_unparsed_model_date_and_independent_evidence_review_date_remain_separate(self):
        date='31 December 2099 (invented raw date)';r=json.loads(report(illustrative_selection(raw_date=date)))
        payload=json.loads(r['payload_json']);proof=json.loads(r['provenance_json'])
        self.assertEqual(proof['source_date_text'],date);self.assertEqual(r['extraction']['proposal']['source_date_text'],date)
        self.assertEqual(payload['snapshot']['lastEvidenceReviewOn'],AT.date().isoformat())
        self.assertIsNone(payload['snapshot']['claims'][0]['evidence'][0]['sourcePublishedOn'])

    def test_raw_bodies_and_raw_context_spelling_are_omitted_without_hiding_canonical_context(self):
        selected=request();r=json.loads(report(selected));text=json.dumps(r)
        for key in ('raw_base64','metadata_base64','request_base64','output_base64','context_base64','context_json'):self.assertNotIn(key,text)
        self.assertTrue(all(value is False for value in r['limits'].values()));self.assertEqual(len(r['limits']),9)
        proof=json.loads(r['provenance_json']);self.assertEqual(proof['independent_context'],json.loads(selected.prepared.parts.context_raw))
        self.assertEqual(proof['supplied_context_sha256'],sha256(selected.prepared.parts.context_raw).hexdigest())
        self.assertNotIn(selected.prepared.parts.context_raw.decode(),[value for value in r.values()if isinstance(value,str)])
        self.assertEqual(r['extraction']['context']['server_authentication'],'not_established');self.assertEqual(r['extraction']['context']['publication'],'not_authorized')

    def test_non_utc_old_observation_and_private_failure_expose_no_inputs(self):
        for changes in [dict(observed_at=LATER.replace(tzinfo=None)),dict(observed_at=request().prepared.observed_at),dict(receipt=b'PRIVATE_CANARY /home/private/file')]:
            with self.subTest(changes=list(changes)),self.assertRaises(HtmlPreparationReviewReportError)as error:report(**changes)
            self.assertEqual(str(error.exception),'html_preparation_review_report_unavailable');self.assertIsNone(error.exception.__cause__)

    def test_exact_capacity_holds_without_truncation_and_no_io_or_model_is_dispatched(self):
        selected=request();raw=report(selected)
        self.assertEqual(MAX_HTML_PREPARATION_REVIEW_BYTES,524288)
        with patch('workers.html_preparation_review_report.MAX_HTML_PREPARATION_REVIEW_BYTES',len(raw)-1):
            with self.assertRaises(HtmlPreparationReviewReportError):report(selected)
        with patch('workers.html_preparation_review_report.MAX_HTML_PREPARATION_REVIEW_BYTES',len(raw)),patch('subprocess.Popen',side_effect=AssertionError('no transport')),patch('builtins.open',side_effect=AssertionError('no file')):
            self.assertEqual(report(selected),raw);self.assertEqual(report(selected),raw)


if __name__=='__main__':unittest.main()
