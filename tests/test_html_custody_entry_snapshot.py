"""Pure higher HTML custody snapshots; invented receipt/SQL-string mechanics."""
from asyncio import CancelledError
from dataclasses import asdict
import unittest
from tests.test_html_extraction_custody import prepared, cold, wire, encoded, READ, STORED
from tests.test_plain_document_entry_snapshot import CallbackUtc
from workers.html_extraction_custody import (HtmlExtractionCustodyError,
    prepare_html_extraction_reopen, parse_stored_html_extraction, reopen_html_extraction)


def clocked(at,callback):return at.replace(tzinfo=CallbackUtc(callback))

def cold_args(value):
    result=value.result
    return dict(operation_id=result.operation_id,artifact_id=wire(value)['artifact_id'],
        stored_at=STORED,prepared_at=result.prepared_at,current_expected=result.current_expected,
        previous_expected=result.previous_expected,maximum_output_tokens=result.maximum_output_tokens,
        canonical_metadata=value.canonical_metadata,observed_at=READ)


def reopen(raw,expected,result,at=READ):
    return reopen_html_extraction(raw,expected,current_receipt=result.current_receipt,
        previous_receipt=result.previous_receipt,observed_at=at)


class HtmlCustodyEntrySnapshotTests(unittest.TestCase):
    def test_invalid_store_metadata_cannot_be_repaired_during_result_recheck(self):
        for mode in ['statement','read']:
            value=prepared();raw=encoded(wire(value));good=value.canonical_metadata
            object.__setattr__(value,'canonical_metadata',b'{}')
            object.__setattr__(value.result,'observed_at',clocked(value.result.observed_at,
                lambda:object.__setattr__(value,'canonical_metadata',good)))
            with self.subTest(mode=mode):
                with self.assertRaises(HtmlExtractionCustodyError):
                    value.statement() if mode=='statement' else parse_stored_html_extraction(raw,value,observed_at=READ)

    def test_valid_store_metadata_and_sql_survive_callback_damage(self):
        value=prepared();expected=value.statement()
        def damage():object.__setattr__(value,'canonical_metadata',b'FICTIONAL_PRIVATE_REPLACEMENT')
        object.__setattr__(value.result,'observed_at',clocked(value.result.observed_at,damage))
        self.assertEqual(value.statement(),expected)

    def test_stored_read_returns_owned_original_unverified_proposal(self):
        value=prepared();raw=encoded(wire(value));expected=parse_stored_html_extraction(raw,value,observed_at=READ)
        at=clocked(READ,lambda:object.__setattr__(value.result.proposal,'review_state','verified'))
        actual=parse_stored_html_extraction(raw,value,observed_at=at)
        self.assertEqual(actual.result.proposal.review_state,'unverified')
        self.assertEqual(asdict(actual),asdict(expected))
        self.assertIsNot(actual.result,value.result)
        self.assertIsNot(actual.result.proposal,value.result.proposal)

    def test_invalid_cold_original_hash_and_artifact_cannot_be_repaired_at_entry(self):
        for field in ['content_sha256','artifact_id']:
            value=prepared();args=cold_args(value)
            owner=args['previous_expected'].document if field=='content_sha256' else args['previous_expected']
            good=getattr(owner,field);bad='0'*64 if field=='content_sha256' else '90000000-0000-4000-8000-000000000001'
            object.__setattr__(owner,field,bad)
            args['stored_at']=clocked(args['stored_at'],lambda:object.__setattr__(owner,field,good))
            with self.subTest(field=field):
                with self.assertRaises(HtmlExtractionCustodyError):prepare_html_extraction_reopen(**args)

    def test_cold_read_preserves_valid_expectation_despite_later_callback_damage(self):
        value=prepared();selected=cold(value);raw=encoded(wire(value));expected=reopen(raw,selected,value.result)
        at=clocked(READ,lambda:object.__setattr__(selected,'artifact_id','90000000-0000-4000-8000-000000000001'))
        actual=reopen(raw,selected,value.result,at)
        self.assertEqual(asdict(actual),asdict(expected))
        self.assertIsNot(actual.result.current_expected,selected.current_expected)

    def test_invalid_cold_metadata_cannot_be_repaired_in_statement_or_cold_read(self):
        for mode in ['statement','read']:
            value=prepared();selected=cold(value);raw=encoded(wire(value));good=selected.canonical_metadata
            object.__setattr__(selected,'canonical_metadata',b'{}')
            object.__setattr__(selected,'observed_at',clocked(selected.observed_at,
                lambda:object.__setattr__(selected,'canonical_metadata',good)))
            with self.subTest(mode=mode):
                with self.assertRaises(HtmlExtractionCustodyError):
                    selected.statement() if mode=='statement' else reopen(raw,selected,value.result)

    def test_closed_namespaces_refuse_before_any_callback(self):
        for mode in ['store','read','cold_prepare','cold_read']:
            calls=[];value=prepared();raw=encoded(wire(value))
            if mode in ['store','read']:
                object.__setattr__(value,'foreign',object())
                object.__setattr__(value.result,'observed_at',clocked(value.result.observed_at,lambda:calls.append(True)))
                call=(lambda:value.statement()) if mode=='store' else (lambda:parse_stored_html_extraction(raw,value,observed_at=READ))
            elif mode=='cold_prepare':
                args=cold_args(value);object.__setattr__(args['previous_expected'],'foreign',object())
                args['stored_at']=clocked(args['stored_at'],lambda:calls.append(True))
                call=lambda:prepare_html_extraction_reopen(**args)
            else:
                selected=cold(value);object.__setattr__(selected,'foreign',object())
                call=lambda:reopen(raw,selected,value.result,clocked(READ,lambda:calls.append(True)))
            with self.subTest(mode=mode):
                with self.assertRaises(HtmlExtractionCustodyError):call()
                self.assertEqual(calls,[])

    def test_clock_faults_are_fixed_and_cancellation_identity_is_preserved(self):
        for mode in ['store','read','cold_prepare','cold_statement','cold_read']:
            for kind in [RuntimeError,KeyboardInterrupt,SystemExit,CancelledError]:
                value=prepared();raw=encoded(wire(value));failure=kind('FICTIONAL_PRIVATE_CALLBACK')
                def fail():raise failure
                if mode=='store':
                    object.__setattr__(value.result,'observed_at',clocked(value.result.observed_at,fail));call=value.statement
                elif mode=='read':call=lambda:parse_stored_html_extraction(raw,value,observed_at=clocked(READ,fail))
                elif mode=='cold_prepare':
                    args=cold_args(value);args['stored_at']=clocked(args['stored_at'],fail)
                    call=lambda:prepare_html_extraction_reopen(**args)
                else:
                    selected=cold(value)
                    if mode=='cold_statement':
                        object.__setattr__(selected,'observed_at',clocked(selected.observed_at,fail));call=selected.statement
                    else:call=lambda:reopen(raw,selected,value.result,clocked(READ,fail))
                with self.subTest(mode=mode,kind=kind.__name__):
                    with self.assertRaises(HtmlExtractionCustodyError if kind is RuntimeError else kind) as caught:call()
                    if kind is RuntimeError:
                        expected='html_extraction_store_unavailable' if mode=='store' else 'html_extraction_receipt_unavailable' if mode=='read' else 'html_extraction_reopen_unavailable'
                        self.assertEqual(str(caught.exception),expected);self.assertIsNone(caught.exception.__cause__)
                    else:self.assertIs(caught.exception,failure)


if __name__=='__main__':unittest.main()
