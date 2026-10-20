"""Higher preparation parents own exact invented intent/parts before clock hooks."""
from asyncio import CancelledError
from dataclasses import asdict
import unittest
from tests.test_html_proposal_custody import inputs,prepared_proposal,STORED,LATER
from tests.test_html_proposal_postgres import request,wire,encode,cold,reopen as reopen_fixture
from tests.test_plain_document_entry_snapshot import CallbackUtc
from workers.html_proposal_custody import (HtmlProposalCustodyError,prepare_html_proposal_custody,
    recheck_prepared_html_proposal,reobserve_html_proposal)
from workers.html_proposal_postgres import (HtmlProposalPostgresError,prepare_html_proposal_store,
    parse_stored_html_proposal,prepare_html_preparation_reopen)
from workers.detached_proposal_custody import part_bytes


def clocked(at,callback):return at.replace(tzinfo=CallbackUtc(callback))

def reobserve(p,*,stored_at=STORED,observed_at=LATER):
    return reobserve_html_proposal(p.receipt,p.extraction_expected,p.parts,p.intent,
        current_receipt=p.current_receipt,previous_receipt=p.previous_receipt,
        stored_at=stored_at,observed_at=observed_at)


class HtmlPreparationEntrySnapshotTests(unittest.TestCase):
    def test_invalid_extraction_artifact_cannot_be_repaired_at_preparation_entry(self):
        values=inputs();owner=values['extraction_expected'];good=owner.artifact_id
        object.__setattr__(owner,'artifact_id','90000000-0000-4000-8000-000000000001')
        values['observed_at']=clocked(values['observed_at'],lambda:object.__setattr__(owner,'artifact_id',good))
        with self.assertRaises(HtmlProposalCustodyError):prepare_html_proposal_custody(**values)

    def test_valid_preparation_retains_parts_and_owned_selector_under_later_damage(self):
        values=inputs();expected=prepare_html_proposal_custody(**values);original=part_bytes(expected.parts)
        owner=values['extraction_expected']
        values['observed_at']=clocked(values['observed_at'],lambda:object.__setattr__(owner,'artifact_id','90000000-0000-4000-8000-000000000001'))
        actual=prepare_html_proposal_custody(**values)
        self.assertEqual(part_bytes(actual.parts),original);self.assertEqual(actual.intent,expected.intent)
        self.assertIsNot(actual.extraction_expected,owner)

    def test_recheck_owns_parts_and_intent_before_nested_preparation_clock(self):
        for target in ['parts','intent']:
            p=prepared_proposal();expected=asdict(p)
            def damage():
                owner=p.parts if target=='parts' else p.intent
                field='payload_raw' if target=='parts' else 'canonical_metadata'
                object.__setattr__(owner,field,b'FICTIONAL_PRIVATE_SUBSTITUTION')
            object.__setattr__(p,'observed_at',clocked(p.observed_at,damage))
            with self.subTest(target=target):
                actual=recheck_prepared_html_proposal(p)
                self.assertEqual(asdict(actual),expected);self.assertIsNot(actual.parts,p.parts);self.assertIsNot(actual.intent,p.intent)

    def test_reobservation_owns_parts_and_original_selector_before_first_clock(self):
        for invalid in [True,False]:
            p=prepared_proposal();expected=asdict(reobserve(p));good=p.extraction_expected.artifact_id
            if invalid:object.__setattr__(p.extraction_expected,'artifact_id','90000000-0000-4000-8000-000000000001')
            def change():
                if invalid:object.__setattr__(p.extraction_expected,'artifact_id',good)
                else:object.__setattr__(p.parts,'payload_raw',b'FICTIONAL_PRIVATE_SUBSTITUTION')
            with self.subTest(invalid=invalid):
                if invalid:
                    with self.assertRaises(HtmlProposalCustodyError):reobserve(p,stored_at=clocked(STORED,change))
                else:
                    actual=reobserve(p,stored_at=clocked(STORED,change))
                    self.assertEqual(asdict(actual),expected);self.assertIsNot(actual.parts,p.parts)

    def test_invalid_selected_preparation_artifact_cannot_be_repaired_at_cold_read(self):
        stored=request();selected=cold(stored);raw=encode(wire(stored));good=selected.artifact_id
        object.__setattr__(selected,'artifact_id','90000000-0000-4000-8000-000000000001')
        at=clocked(LATER,lambda:object.__setattr__(selected,'artifact_id',good))
        with self.assertRaises(HtmlProposalPostgresError):reopen_fixture(raw,selected,stored,observed_at=at)

    def test_cold_statement_and_full_read_use_owned_intent_and_artifact(self):
        for mode in ['statement','read']:
            stored=request();selected=cold(stored);raw=encode(wire(stored))
            expected=selected.statement() if mode=='statement' else asdict(reopen_fixture(raw,selected,stored))
            def damage():object.__setattr__(selected.intent,'canonical_metadata',b'FICTIONAL_PRIVATE_SUBSTITUTION')
            with self.subTest(mode=mode):
                if mode=='statement':
                    object.__setattr__(selected,'observed_at',clocked(selected.observed_at,damage));self.assertEqual(selected.statement(),expected)
                else:self.assertEqual(asdict(reopen_fixture(raw,selected,stored,observed_at=clocked(LATER,damage))),expected)

    def test_store_sql_and_warm_read_use_owned_prepared_context(self):
        for mode in ['statement','read']:
            with self.subTest(mode=mode):
                stored=request();raw=encode(wire(stored));baseline=stored.statement() if mode=='statement' else parse_stored_html_proposal(raw,stored,observed_at=LATER)
                if mode=='statement':
                    def damage():object.__setattr__(stored.prepared.intent,'canonical_metadata',b'FICTIONAL_PRIVATE_SUBSTITUTION')
                    object.__setattr__(stored.prepared,'observed_at',clocked(stored.prepared.observed_at,damage))
                    self.assertEqual(stored.statement(),baseline)
                else:
                    owner=stored.prepared.extraction_expected;good=owner.artifact_id
                    object.__setattr__(owner,'artifact_id','90000000-0000-4000-8000-000000000001')
                    object.__setattr__(stored.prepared,'observed_at',clocked(stored.prepared.observed_at,
                        lambda:object.__setattr__(owner,'artifact_id',good)))
                    with self.assertRaises(HtmlProposalPostgresError):parse_stored_html_proposal(raw,stored,observed_at=LATER)

    def test_unknown_namespaces_refuse_before_clock_hooks(self):
        for mode in ['prepare','recheck','reobserve','cold_read']:
            calls=[]
            if mode=='prepare':
                values=inputs();object.__setattr__(values['extraction_expected'],'foreign',object())
                values['observed_at']=clocked(values['observed_at'],lambda:calls.append(True));call=lambda:prepare_html_proposal_custody(**values)
            elif mode in ['recheck','reobserve']:
                p=prepared_proposal();object.__setattr__(p.parts,'foreign',object())
                if mode=='recheck':
                    object.__setattr__(p,'observed_at',clocked(p.observed_at,lambda:calls.append(True)));call=lambda:recheck_prepared_html_proposal(p)
                else:call=lambda:reobserve(p,stored_at=clocked(STORED,lambda:calls.append(True)))
            else:
                stored=request();selected=cold(stored);raw=encode(wire(stored));object.__setattr__(selected,'foreign',object())
                call=lambda:reopen_fixture(raw,selected,stored,observed_at=clocked(LATER,lambda:calls.append(True)))
            with self.subTest(mode=mode):
                with self.assertRaises(HtmlProposalCustodyError if mode!='cold_read' else HtmlProposalPostgresError):call()
                self.assertEqual(calls,[])

    def test_clock_faults_are_fixed_and_cancellation_keeps_exact_identity(self):
        for mode in ['prepare','recheck','reobserve','store','cold_prepare','cold_read']:
            for kind in [RuntimeError,KeyboardInterrupt,SystemExit,CancelledError]:
                failure=kind('FICTIONAL_PRIVATE_CALLBACK')
                def fail():raise failure
                if mode=='prepare':
                    values=inputs();values['observed_at']=clocked(values['observed_at'],fail);call=lambda:prepare_html_proposal_custody(**values)
                elif mode in ['recheck','store','reobserve']:
                    p=prepared_proposal()
                    if mode=='reobserve':call=lambda:reobserve(p,stored_at=clocked(STORED,fail))
                    else:
                        object.__setattr__(p,'observed_at',clocked(p.observed_at,fail))
                        call=(lambda:recheck_prepared_html_proposal(p)) if mode=='recheck' else (lambda:prepare_html_proposal_store(p))
                elif mode=='cold_prepare':
                    stored=request();p=stored.prepared
                    call=lambda:prepare_html_preparation_reopen(intent=p.intent,artifact_id=wire(stored)['artifact_id'],stored_at=clocked(STORED,fail),observed_at=LATER)
                else:
                    stored=request();selected=cold(stored);raw=encode(wire(stored))
                    call=lambda:reopen_fixture(raw,selected,stored,observed_at=clocked(LATER,fail))
                error=HtmlProposalCustodyError if mode in ['prepare','recheck','reobserve'] else HtmlProposalPostgresError
                with self.subTest(mode=mode,kind=kind.__name__):
                    with self.assertRaises(error if kind is RuntimeError else kind) as caught:call()
                    if kind is RuntimeError:
                        expected={'prepare':'html_proposal_preparation_unavailable','recheck':'html_proposal_preparation_unavailable','reobserve':'html_proposal_reobservation_unavailable','store':'html_proposal_store_unavailable','cold_prepare':'html_proposal_read_unavailable','cold_read':'html_proposal_reopened_result_unavailable'}
                        self.assertEqual(str(caught.exception),expected[mode]);self.assertIsNone(caught.exception.__cause__)
                    else:self.assertIs(caught.exception,failure)


if __name__=='__main__':unittest.main()
