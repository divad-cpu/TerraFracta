"""Whole HTML parent entry ownership; existing invented fixture functions only."""
from asyncio import CancelledError
from dataclasses import replace
import unittest

from tests.test_html_extraction_request import request, capture, output, OBSERVED
from tests.test_html_private_extraction import inputs
from tests.test_stored_html_change import context
from tests.test_plain_document_entry_snapshot import CallbackUtc
from workers.html_extraction_request import (HtmlExtractionRequestError,
    bind_html_full_request_token_limit, parse_html_extraction_proposal)
from workers.passage_extraction_request import FullRequestTokenLimit
from workers.stored_html_change import StoredHtmlChangeError, prepare_stored_html_change
from workers.html_private_extraction import (HtmlPrivateExtractionError,
    prepare_html_private_extraction, recheck_html_private_extraction)


def clocked(at, callback):
    return at.replace(tzinfo=CallbackUtc(callback))


def bind(compiled, current, proof, at=OBSERVED):
    return bind_html_full_request_token_limit(compiled,current=current,previous=None,
        observed_at=at,maximum_output_tokens=100,proof=proof)


def parse(raw, compiled, current, at=OBSERVED):
    return parse_html_extraction_proposal(raw,compiled,current=current,previous=None,
        observed_at=at,maximum_output_tokens=100)


class HtmlParentEntrySnapshotTests(unittest.TestCase):
    def test_invalid_request_entry_cannot_be_repaired_for_bind_or_parse(self):
        for mode in ['bind','parse']:
            current=capture();compiled=request(current);good=compiled.request_sha256
            raw=output(current);proof=FullRequestTokenLimit(compiled.item_key,good,200)
            object.__setattr__(compiled,'request_sha256','0'*64)
            at=clocked(OBSERVED,lambda:object.__setattr__(compiled,'request_sha256',good))
            with self.subTest(mode=mode),self.assertRaises(HtmlExtractionRequestError):
                bind(compiled,current,proof,at) if mode=='bind' else parse(raw,compiled,current,at)

    def test_valid_request_and_proof_survive_callback_damage_with_original_results(self):
        for mode in ['bind','parse']:
            current=capture();compiled=request(current);raw=output(current)
            proof=FullRequestTokenLimit(compiled.item_key,compiled.request_sha256,200)
            expected=bind(compiled,current,proof) if mode=='bind' else parse(raw,compiled,current)
            def damage():
                object.__setattr__(compiled,'body',b'FICTIONAL_PRIVATE_SUBSTITUTION')
                object.__setattr__(compiled,'selected_payload_sha256','0'*64)
                object.__setattr__(proof,'maximum_input_tokens',999)
            at=clocked(OBSERVED,damage)
            with self.subTest(mode=mode):
                actual=bind(compiled,current,proof,at) if mode=='bind' else parse(raw,compiled,current,at)
                self.assertEqual(actual,expected)

    def test_invalid_token_proof_entry_cannot_be_repaired_during_regeneration(self):
        current=capture();compiled=request(current)
        proof=FullRequestTokenLimit(compiled.item_key,compiled.request_sha256,0)
        at=clocked(OBSERVED,lambda:object.__setattr__(proof,'maximum_input_tokens',200))
        with self.assertRaises(HtmlExtractionRequestError):bind(compiled,current,proof,at)

    def test_invalid_previous_original_cannot_be_repaired_during_first_reopen(self):
        values=context();previous=values[3].document;good=previous.content_sha256
        object.__setattr__(previous,'content_sha256','0'*64)
        at=clocked(OBSERVED,lambda:object.__setattr__(previous,'content_sha256',good))
        with self.assertRaises(StoredHtmlChangeError):prepare_stored_html_change(*values,observed_at=at)

    def test_both_valid_original_expectations_are_owned_before_first_reopen_clock(self):
        values=context();expected=prepare_stored_html_change(*values,observed_at=OBSERVED)
        def damage():
            object.__setattr__(values[3].document,'source_key','fictional-foreign')
            object.__setattr__(values[1].mapping,'language_code','no')
        actual=prepare_stored_html_change(*values,observed_at=clocked(OBSERVED,damage))
        self.assertEqual(actual,expected)
        self.assertIsNot(actual.current_capture.document,values[1].document)
        self.assertIsNot(actual.previous_capture.mapping,values[3].mapping)

    def test_invalid_private_original_and_request_entries_cannot_be_repaired(self):
        for target in ['original','request']:
            values=inputs()
            owner=values['current_expected'].document if target=='original' else values['request']
            field='content_sha256' if target=='original' else 'request_sha256';good=getattr(owner,field)
            object.__setattr__(owner,field,'0'*64)
            values['observed_at']=clocked(values['observed_at'],lambda:object.__setattr__(owner,field,good))
            with self.subTest(target=target),self.assertRaises(HtmlPrivateExtractionError):prepare_html_private_extraction(**values)

    def test_valid_private_context_and_output_are_retained_in_owned_graph(self):
        values=inputs();expected=prepare_html_private_extraction(**values)
        def damage():
            object.__setattr__(values['previous_expected'].document,'source_key','fictional-foreign')
            object.__setattr__(values['request'],'body',b'FICTIONAL_PRIVATE_SUBSTITUTION')
        values['observed_at']=clocked(values['observed_at'],damage)
        actual=prepare_html_private_extraction(**values)
        self.assertEqual(actual.canonical_input,expected.canonical_input)
        self.assertEqual(actual.output_raw,expected.output_raw)
        self.assertIsNot(actual.current_expected,values['current_expected'])
        self.assertIsNot(actual.previous_expected.document,values['previous_expected'].document)

    def test_recheck_captures_canonical_plan_and_proposal_before_any_clock(self):
        for invalid in [False,True]:
            value=prepare_html_private_extraction(**inputs());canonical=value.canonical_input
            if invalid:object.__setattr__(value,'canonical_input',b'{}')
            def change():
                if invalid:object.__setattr__(value,'canonical_input',canonical)
                else:
                    object.__setattr__(value.proposal,'proposed_assertion','FICTIONAL_PRIVATE_SUBSTITUTION')
                    object.__setattr__(value.plan.request,'body',b'{}')
            object.__setattr__(value,'observed_at',clocked(value.observed_at,change))
            with self.subTest(invalid=invalid):
                if invalid:
                    with self.assertRaises(HtmlPrivateExtractionError):recheck_html_private_extraction(value)
                else:
                    checked=recheck_html_private_extraction(value)
                    self.assertEqual(checked.canonical_input,canonical)
                    self.assertIsNot(checked.plan,value.plan)
                    self.assertIsNot(checked.proposal,value.proposal)

    def test_unknown_namespaces_refuse_before_any_utc_hook(self):
        for mode in ['request','stored','private']:
            calls=[]
            if mode=='request':
                current=capture();compiled=request(current);proof=FullRequestTokenLimit(compiled.item_key,compiled.request_sha256,200)
                object.__setattr__(compiled,'foreign',object())
                call=lambda:bind(compiled,current,proof,clocked(OBSERVED,lambda:calls.append(True)))
                error=HtmlExtractionRequestError
            elif mode=='stored':
                values=context();object.__setattr__(values[3],'foreign',object())
                call=lambda:prepare_stored_html_change(*values,observed_at=clocked(OBSERVED,lambda:calls.append(True)))
                error=StoredHtmlChangeError
            else:
                values=inputs();object.__setattr__(values['request'],'foreign',object())
                values['observed_at']=clocked(values['observed_at'],lambda:calls.append(True))
                call=lambda:prepare_html_private_extraction(**values);error=HtmlPrivateExtractionError
            with self.subTest(mode=mode):
                with self.assertRaises(error):call()
                self.assertEqual(calls,[])

    def test_utc_faults_are_fixed_and_cancellation_objects_are_preserved(self):
        for mode in ['bind','parse','stored','private','recheck']:
            for kind in [RuntimeError,KeyboardInterrupt,SystemExit,CancelledError]:
                failure=kind('FICTIONAL_PRIVATE_CALLBACK')
                def fail():raise failure
                if mode in ['bind','parse']:
                    current=capture();compiled=request(current);proof=FullRequestTokenLimit(compiled.item_key,compiled.request_sha256,200);raw=output(current)
                    at=clocked(OBSERVED,fail)
                    call=(lambda:bind(compiled,current,proof,at)) if mode=='bind' else (lambda:parse(raw,compiled,current,at))
                    error=HtmlExtractionRequestError
                elif mode=='stored':
                    values=context();at=clocked(OBSERVED,fail)
                    call=lambda:prepare_stored_html_change(*values,observed_at=at);error=StoredHtmlChangeError
                else:
                    values=inputs();error=HtmlPrivateExtractionError
                    if mode=='private':
                        values['observed_at']=clocked(values['observed_at'],fail)
                        call=lambda:prepare_html_private_extraction(**values)
                    else:
                        value=prepare_html_private_extraction(**values)
                        object.__setattr__(value,'observed_at',clocked(value.observed_at,fail))
                        call=lambda:recheck_html_private_extraction(value)
                with self.subTest(mode=mode,kind=kind.__name__):
                    with self.assertRaises(error if kind is RuntimeError else kind) as caught:call()
                    if kind is RuntimeError:
                        allowed = {'bind': {'html_extraction_request_binding_mismatch', 'html_extraction_full_token_binding_mismatch'},
                            'parse': {'html_extraction_request_binding_mismatch'},
                            'stored': {'stored_html_change_unavailable'},
                            'private': {'html_private_extraction_unavailable'},
                            'recheck': {'html_private_extraction_unavailable'}}
                        self.assertIn(str(caught.exception),allowed[mode]);self.assertIsNone(caught.exception.__cause__)
                    else:self.assertIs(caught.exception,failure)


if __name__=='__main__':unittest.main()
