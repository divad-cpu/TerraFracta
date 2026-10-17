"""Passive projection revalidates exact custody; no native/source/provider calls."""
import base64
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest
from unittest.mock import patch
from tests.test_private_extraction_result import fixture, prepare, NOW
from tests.test_private_extraction_postgres import wire
from tests.test_private_extraction_reopen import context
from tests.test_document_result_contract import request as result_request, stored_shape
from tests.test_feed_capture_reopen import fixture as feed_fixture, encode
from tests.test_feed_postgres_contract import uid
from tests.test_document_passage_binding import AT
from workers.document_passage_binding import DocumentByteSpan
from workers.feed_capture_reopen import parse_reopened_capture
from workers.document_result_reopen import prepare_document_reopen, parse_reopened_document
from workers.reopened_document_change import prepare_reopened_document_change
from workers.passage_extraction_request import compile_extraction_request
from workers.private_extraction_postgres import prepare_private_extraction_store
from workers.private_extraction_reopen import prepare_private_extraction_reopen, parse_reopened_private_extraction
from workers.private_extraction_report import private_extraction_review_report, PrivateExtractionReportError
from workers.feed_postgres_contract import _time


def reopened(values=None):
    if values is None:
        request, raw, _ = context()
        return parse_reopened_private_extraction(raw, request, observed_at=NOW+timedelta(seconds=13))
    expected = prepare_private_extraction_store(prepare(values))
    request = prepare_private_extraction_reopen(values['current'], values['current_receipt'],
        values['previous'], values['previous_receipt'], request=values['request'],
        operation_id=values['operation_id'], maximum_output_tokens=values['maximum_output_tokens'],
        observed_at=NOW+timedelta(seconds=2))
    return parse_reopened_private_extraction(encode(wire(expected)), request,
        observed_at=NOW+timedelta(seconds=3))


def retained_passages(passages, version):
    """Build a complete valid original and stored receipt; never patch its rows."""
    raw = b'Invented unselected metadata\n'
    spans = []
    for locator, text in passages:
        body = text.encode('utf8'); start = len(raw)
        raw += body+b'\n'; spans.append(DocumentByteSpan(locator, start, start+len(body)))
    raw += b'Unselected private archive tail.'
    expected = result_request(raw=raw, spans=spans, version=uid(version), operation_id=uid(version+100))
    _, page, feed_request, feed_response, feed_at = feed_fixture(expected.feed_capture)
    feed = parse_reopened_capture(encode(feed_response), feed_request, observed_at=feed_at)
    stored = {**stored_shape(expected), 'artifact_id':uid(version+200)}
    history = encode(dict(item_id=expected.association.feed_item_id, page=page, outcomes=[stored['outcome']]))
    request = prepare_document_reopen(feed, encode(page), history, binding=expected.binding,
        mapping=expected.mapping, association=expected.association, observed_at=AT+timedelta(seconds=13))
    response = dict(schema_version=1, kind='invented_document_reopened_original',
        request=json.loads(request.canonical_input), raw_base64=base64.b64encode(raw).decode('ascii'),
        artifact_id=stored['artifact_id'], stored_at=stored['stored_at'], observed_at=_time(AT+timedelta(seconds=14)))
    return parse_reopened_document(encode(response), request, observed_at=AT+timedelta(seconds=15)), encode(stored)


def multiple_locator_values():
    same = '  Shared changed Å passage.\r\nNext line\tkept.'
    current, cr = retained_passages([('section:first',same), ('section:second',same),
        ('section:added','An added exact passage.')], 31)
    previous, pr = retained_passages([('section:first','Earlier first passage.'),
        ('section:second','Earlier second passage.')], 30)
    pair = prepare_reopened_document_change(current, cr, previous, pr, observed_at=NOW)
    request = compile_extraction_request(pair.current, pair.previous, observed_at=NOW, maximum_output_tokens=100)
    binding = current.request.binding
    output = encode(dict(schema_version=1, source_version_id=binding.source_version_id,
        source_sha256=binding.content_sha256, language_code=binding.language_code, locator='section:second',
        proposed_claim_type='condition', proposed_assertion='A private unverified assertion.', source_date_text=None))
    return dict(current=current, current_receipt=cr, previous=previous, previous_receipt=pr,
        request=request, output_raw=output, operation_id=uid(500), prepared_at=NOW,
        observed_at=NOW, maximum_output_tokens=100)


class PrivateExtractionReportTests(unittest.TestCase):
    def test_confirmed_report_retains_exact_selected_text_refs_and_distinct_times(self):
        item = reopened(); raw = private_extraction_review_report(item); report = json.loads(raw)
        self.assertIs(type(raw), bytes)
        self.assertEqual((report['kind'],report['review_state'],report['scope']),
            ('private_extraction_review_report','unverified','invented_offline_rehearsal_only'))
        self.assertEqual(report['selected_passages'][0]['text'], 'Changed exact invented passage.')
        self.assertEqual(report['selected_passages'][0]['earlier'], [dict(locator='section:one',
            text='Original exact invented passage.',text_sha256=sha256(b'Original exact invented passage.').hexdigest())])
        self.assertEqual(report['proposal']['locator'], 'section:one')
        self.assertEqual(report['proposal']['review_state'], 'unverified')
        self.assertEqual(report['artifact']['artifact_id'], item.stored.artifact_id)
        self.assertEqual(report['request']['request_sha256'], item.result.request.request_sha256)
        self.assertEqual(report['artifact']['output_sha256'], sha256(item.result.output_raw).hexdigest())
        self.assertEqual(report['prepared_at'], _time(item.result.prepared_at))
        self.assertEqual(report['artifact']['stored_at'], _time(item.stored.stored_at))
        self.assertEqual(report['observed_at'], _time(item.observed_at))
        self.assertLess(report['prepared_at'],report['artifact']['stored_at'])
        self.assertLess(report['artifact']['stored_at'],report['observed_at'])
        self.assertNotEqual(report['current']['source_version_id'], report['previous']['source_version_id'])
        self.assertEqual(report['current']['operation_id'], item.result.current.result_request.operation_id)
        self.assertEqual(report['previous']['artifact_id'], item.result.previous.artifact_id)
        self.assertNotIn('Invented metadata',raw.decode())
        self.assertNotIn('request_base64',report)
        self.assertNotIn('output_base64',report)

    def test_equal_current_group_keeps_different_previous_text_per_locator_and_explicit_new_locator(self):
        item = reopened(multiple_locator_values()); report = json.loads(private_extraction_review_report(item))
        groups = report['selected_passages'];self.assertEqual(len(groups),2)
        self.assertEqual(groups[0]['locators'], ['section:first','section:second'])
        self.assertEqual(groups[0]['text'], '  Shared changed Å passage.\r\nNext line\tkept.')
        self.assertEqual(groups[0]['text_sha256'],sha256(groups[0]['text'].encode()).hexdigest())
        self.assertEqual([(row['locator'],row['text'])for row in groups[0]['earlier']],
            [('section:first','Earlier first passage.'),('section:second','Earlier second passage.')])
        self.assertEqual(groups[1]['earlier'],[dict(locator='section:added',text=None,text_sha256=None)])
        self.assertEqual(report['proposal']['locator'],'section:second')
        self.assertNotIn('Unselected private archive tail',json.dumps(report))
        self.assertNotIn('Invented unselected metadata',json.dumps(report))

    def test_entire_mutated_artifact_proposal_and_current_or_prior_context_refuse(self):
        item=reopened()
        bad_values=[replace(item,full_receipt=b'{}'),
            replace(item,result=replace(item.result,proposal=replace(item.result.proposal,review_state='approved'))),
            replace(item,stored=replace(item.stored,artifact_id=uid(99))),
            replace(item,result=replace(item.result,output_raw=b'PRIVATE_CANARY /home/private')),
            replace(item,request=replace(item.request,current_receipt=b'{}')),
            replace(item,request=replace(item.request,previous_receipt=b'{}')),
            replace(item,request=replace(item.request,previous=None)),
            replace(item,request=replace(item.request,request=replace(item.request.request,body=b'{}')))]
        for bad in bad_values:
            with self.subTest(kind=type(bad).__name__), self.assertRaisesRegex(PrivateExtractionReportError,
                    '^private_extraction_review_report_unavailable$'):
                private_extraction_review_report(bad)

    def test_full_receipt_source_proposal_locator_and_preparation_cannot_be_changed(self):
        item=reopened(); original=json.loads(item.full_receipt)
        for mutate in [lambda value:value['input']['current_document'].update(artifact_id=uid(99)),
                lambda value:value['input']['previous_document'].update(content_sha256='f'*64),
                lambda value:value['input']['proposal'].update(locator='section:foreign'),
                lambda value:value['input'].update(prepared_at='2026-10-15T00:00:50.000000Z'),
                lambda value:value.update(output_base64=base64.b64encode(b'{}').decode('ascii'))]:
            value=deepcopy(original);mutate(value)
            with self.assertRaises(PrivateExtractionReportError):
                private_extraction_review_report(replace(item,full_receipt=encode(value)))

    def test_context_absence_remains_explicit_without_publication_or_provider_inference(self):
        report=json.loads(private_extraction_review_report(reopened()))
        self.assertEqual(report['context'],dict(current_publication='not_connected',affected_pages='not_connected',
            held_decision='not_connected',conflict_assessment='not_recorded',translation_assessment='not_recorded',
            factual_support='not_assessed',provider_usage='not_observed',actual_cost='not_observed'))
        self.assertNotIn('current_publication', report['previous'])
        self.assertNotIn('actual_cost',report['artifact'])

    def test_exact_complete_report_cap_accepts_and_one_byte_over_refuses_without_partial(self):
        item=reopened();raw=private_extraction_review_report(item)
        with patch('workers.private_extraction_report.MAX_REVIEW_REPORT_BYTES',len(raw)):
            self.assertEqual(private_extraction_review_report(item),raw)
        with patch('workers.private_extraction_report.MAX_REVIEW_REPORT_BYTES',len(raw)-1):
            with self.assertRaisesRegex(PrivateExtractionReportError,'^private_extraction_review_report_unavailable$'):
                private_extraction_review_report(item)

    def test_valid_six_hundred_emoji_scalars_and_raw_date_lf_tab_are_preserved(self):
        values=fixture();output=json.loads(values['output_raw'])
        output.update(proposed_assertion='😀'*600,source_date_text='Raw\tdate\nnot a parsed publication date')
        values['output_raw']=encode(output)
        report=json.loads(private_extraction_review_report(reopened(values)))
        self.assertEqual(report['proposal']['proposed_assertion'],'😀'*600)
        self.assertEqual(len(report['proposal']['proposed_assertion']),600)
        self.assertEqual(report['proposal']['source_date_text'],'Raw\tdate\nnot a parsed publication date')
        self.assertEqual(report['proposal']['review_state'],'unverified')

    def test_wrong_types_or_nonexact_full_receipt_are_private_before_decoder_hooks(self):
        item=reopened();calls=[]
        class Hook(bytes):
            def decode(self,*args,**kwargs):calls.append(True);return '{}'
        for bad in [None,{},b'PRIVATE_CANARY /home/private',replace(item,full_receipt=Hook(item.full_receipt)),
                replace(item,full_receipt=bytearray(item.full_receipt)),replace(item,observed_at=None)]:
            with self.assertRaisesRegex(PrivateExtractionReportError,'^private_extraction_review_report_unavailable$'):
                private_extraction_review_report(bad)
        self.assertEqual(calls,[])


if __name__=='__main__':unittest.main()
