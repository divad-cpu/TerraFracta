"""Pure original HTML custody entry ownership; no database statement execution."""
from asyncio import CancelledError
from dataclasses import asdict
from datetime import timedelta
import unittest
from tests.test_html_original_custody import request,raw_wire,cold,AT,ART
from tests.test_plain_document_entry_snapshot import CallbackUtc
from workers.html_original_custody import (HtmlOriginalCustodyError,prepare_html_original,
    prepare_html_original_reopen,parse_stored_html_original,reopen_html_original)


def clocked(at,callback):return at.replace(tzinfo=CallbackUtc(callback))

def prepare_args(value):
    return dict(raw=value.raw,document=value.document,binding=value.binding,mapping=value.mapping,
        operation_id=value.intent.operation_id,prepared_at=value.intent.prepared_at,observed_at=value.observed_at)

def cold_args(value):
    return dict(intent=value.intent,document=value.document,binding=value.binding,mapping=value.mapping,
        artifact_id=ART,stored_at=AT+timedelta(seconds=3,microseconds=4),observed_at=AT+timedelta(seconds=4))


class HtmlOriginalEntrySnapshotTests(unittest.TestCase):
    def test_invalid_original_hash_cannot_be_repaired_by_preparation_clock(self):
        value=request();args=prepare_args(value);good=value.document.content_sha256
        object.__setattr__(value.document,'content_sha256','0'*64)
        args['prepared_at']=clocked(args['prepared_at'],lambda:object.__setattr__(value.document,'content_sha256',good))
        with self.assertRaises(HtmlOriginalCustodyError):prepare_html_original(**args)

    def test_valid_preparation_keeps_exact_metadata_and_owned_source(self):
        value=request();args=prepare_args(value)
        args['prepared_at']=clocked(args['prepared_at'],lambda:object.__setattr__(value.document,'source_key','fictional-foreign'))
        result=prepare_html_original(**args)
        self.assertEqual(result.intent.canonical_metadata,value.intent.canonical_metadata)
        self.assertEqual(result.document.source_key,'fictional-html')
        self.assertIsNot(result.document,value.document);self.assertIsNot(result.mapping,value.mapping)

    def test_invalid_prebuilt_intent_cannot_be_repaired_during_statement_or_read(self):
        for mode in ['statement','read']:
            value=request();raw=raw_wire(value);good=value.intent.canonical_metadata
            object.__setattr__(value.intent,'canonical_metadata',b'{}')
            object.__setattr__(value.intent,'prepared_at',clocked(value.intent.prepared_at,
                lambda:object.__setattr__(value.intent,'canonical_metadata',good)))
            with self.subTest(mode=mode):
                with self.assertRaises(HtmlOriginalCustodyError):
                    value.statement() if mode=='statement' else parse_stored_html_original(raw,value,observed_at=AT+timedelta(seconds=4))

    def test_warm_read_retains_checked_original_under_later_mapping_damage(self):
        value=request();raw=raw_wire(value);at=AT+timedelta(seconds=4)
        expected=parse_stored_html_original(raw,value,observed_at=at)
        actual=parse_stored_html_original(raw,value,observed_at=clocked(at,
            lambda:object.__setattr__(value.mapping,'language_code','no')))
        self.assertEqual(asdict(actual),asdict(expected));self.assertIsNot(actual.result.document,value.document)
        self.assertEqual(actual.result.snapshot.language_code,'en')

    def test_cold_source_assertion_cannot_be_repaired_by_intent_clock(self):
        for field in ['content_sha256','source_key']:
            value=request();args=cold_args(value);good=getattr(value.document,field)
            object.__setattr__(value.document,field,'0'*64 if field=='content_sha256' else 'fictional-foreign')
            object.__setattr__(value.intent,'prepared_at',clocked(value.intent.prepared_at,
                lambda:object.__setattr__(value.document,field,good)))
            with self.subTest(field=field):
                with self.assertRaises(HtmlOriginalCustodyError):prepare_html_original_reopen(**args)

    def test_cold_statement_and_reopen_use_original_checked_expectation(self):
        for mode in ['statement','read']:
            value=request();selected=cold(value);raw=raw_wire(value)
            expected=selected.statement() if mode=='statement' else reopen_html_original(raw,selected,observed_at=AT+timedelta(seconds=5))
            def damage():object.__setattr__(selected,'artifact_id','90000000-0000-4000-8000-000000000001')
            with self.subTest(mode=mode):
                if mode=='statement':
                    object.__setattr__(selected,'observed_at',clocked(selected.observed_at,damage));actual=selected.statement()
                    self.assertEqual(actual,expected)
                else:
                    actual=reopen_html_original(raw,selected,observed_at=clocked(AT+timedelta(seconds=5),damage))
                    self.assertEqual(asdict(actual),asdict(expected));self.assertIsNot(actual.result.document,selected.document)

    def test_unknown_namespaces_refuse_before_utc_callbacks(self):
        for mode in ['prepare','statement','read','cold_prepare','cold_read']:
            value=request();raw=raw_wire(value);calls=[]
            if mode=='prepare':
                args=prepare_args(value);object.__setattr__(value.mapping,'foreign',object())
                args['prepared_at']=clocked(args['prepared_at'],lambda:calls.append(True));call=lambda:prepare_html_original(**args)
            elif mode=='statement':
                object.__setattr__(value,'foreign',object())
                object.__setattr__(value.intent,'prepared_at',clocked(value.intent.prepared_at,lambda:calls.append(True)));call=value.statement
            elif mode=='read':
                object.__setattr__(value,'foreign',object())
                call=lambda:parse_stored_html_original(raw,value,observed_at=clocked(AT+timedelta(seconds=4),lambda:calls.append(True)))
            elif mode=='cold_prepare':
                args=cold_args(value);object.__setattr__(value.mapping,'foreign',object())
                args['stored_at']=clocked(args['stored_at'],lambda:calls.append(True));call=lambda:prepare_html_original_reopen(**args)
            else:
                selected=cold(value);object.__setattr__(selected,'foreign',object())
                call=lambda:reopen_html_original(raw,selected,observed_at=clocked(AT+timedelta(seconds=5),lambda:calls.append(True)))
            with self.subTest(mode=mode):
                with self.assertRaises(HtmlOriginalCustodyError):call()
                self.assertEqual(calls,[])

    def test_custom_utc_faults_are_fixed_and_cancellation_keeps_identity(self):
        for mode in ['prepare','statement','read','cold_prepare','cold_statement','cold_read']:
            for kind in [RuntimeError,KeyboardInterrupt,SystemExit,CancelledError]:
                value=request();raw=raw_wire(value);failure=kind('FICTIONAL_PRIVATE_CALLBACK')
                def fail():raise failure
                if mode=='prepare':
                    args=prepare_args(value);args['prepared_at']=clocked(args['prepared_at'],fail);call=lambda:prepare_html_original(**args)
                elif mode=='statement':
                    object.__setattr__(value.intent,'prepared_at',clocked(value.intent.prepared_at,fail));call=value.statement
                elif mode=='read':call=lambda:parse_stored_html_original(raw,value,observed_at=clocked(AT+timedelta(seconds=4),fail))
                elif mode=='cold_prepare':
                    args=cold_args(value);args['stored_at']=clocked(args['stored_at'],fail);call=lambda:prepare_html_original_reopen(**args)
                else:
                    selected=cold(value)
                    if mode=='cold_statement':
                        object.__setattr__(selected,'observed_at',clocked(selected.observed_at,fail));call=selected.statement
                    else:call=lambda:reopen_html_original(raw,selected,observed_at=clocked(AT+timedelta(seconds=5),fail))
                with self.subTest(mode=mode,kind=kind.__name__):
                    with self.assertRaises(HtmlOriginalCustodyError if kind is RuntimeError else kind) as caught:call()
                    if kind is RuntimeError:
                        expected='html_original_input_unavailable' if mode in ['prepare','statement'] else 'html_original_receipt_unavailable' if mode=='read' else 'html_original_reopen_unavailable'
                        self.assertEqual(str(caught.exception),expected);self.assertIsNone(caught.exception.__cause__)
                    else:self.assertIs(caught.exception,failure)


if __name__=='__main__':unittest.main()
