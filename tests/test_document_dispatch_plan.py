"""Actual byte/receipt comparisons and existing independent-item admission."""
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
import json
import unittest
from tests.test_document_passage_binding import AT
from tests.test_document_passage_comparison import capture
from tests.test_passage_model_plan import item,PRICE,BUDGET,LIMITS
from workers.document_passage_comparison import compare_document_passages
from workers.document_dispatch_plan import DocumentDispatchError,DocumentChangeRequest,plan_document_dispatch
from workers.passage_model_plan import PassageSourceBinding,PassageTokenLimit
from workers.passage_model_proposal import parse_changed_passage_proposal


def document(key='item-one',*,old='Old',new='New',old_time=0,new_time=1):
    current=capture(new,'new-'+key,new_time);previous=capture(old,'old-'+key,old_time)
    def keyed(value):return replace(value,document=replace(value.document,item_key=key),binding=replace(value.binding,item_key=key))
    return DocumentChangeRequest(key,keyed(current),keyed(previous))


def work(value,**changes):
    values=dict(current_sha256=value.current.document.content_sha256,previous_sha256=value.previous.document.content_sha256 if value.previous is not None else None)
    values.update(changes)
    return item(value.item_key,**values)


def token(value):
    compared=compare_document_passages(value.current,value.previous,observed_at=AT+timedelta(seconds=10))
    return PassageTokenLimit(value.item_key,compared.selection.payload_sha256,100)


def plan(items,documents,*,tokens=(),sources=None,budget=BUDGET,limits=LIMITS):
    if sources is None:sources=tuple(PassageSourceBinding(key,'source-one') for key in dict.fromkeys(i.item_key for i in items))
    return plan_document_dispatch(items,limits,documents=documents,source_bindings=sources,token_limits=tokens,
        output_token_limit_per_call=100,price=PRICE,budget=budget,observed_at=AT+timedelta(seconds=10))


class DocumentDispatchPlanTests(unittest.TestCase):
    def test_two_valid_items_keep_full_receipts_and_independent_exact_selections(self):
        a=document();b=document('second',new='Different')
        result=plan((work(a),work(b)),(a,b),tokens=(token(a),token(b)))
        self.assertEqual(result.passages.dispatch.reserved_calls,2)
        self.assertEqual([c.item_key for c in result.comparisons],['item-one','second'])
        self.assertEqual(result.comparisons[1].comparison.current.document,b.current.document)
        self.assertEqual(result.comparisons[0].comparison.previous.document,a.previous.document)
        self.assertEqual(result.comparison_refusals,())
        self.assertEqual(result.evidence_state,'offline_document_dispatch_plan_only')

    def test_one_invalid_previous_holds_only_affected_changed_item(self):
        a=document();bad=replace(a,previous=replace(a.previous,raw=b'foreign'))
        b=document('second',new='Independent')
        result=plan((work(a),work(b)),(bad,b),tokens=(token(b),))
        self.assertEqual([i.disposition for i in result.passages.dispatch.items],['held','reserved_model_candidate'])
        self.assertEqual(result.passages.dispatch.reserved_calls,1)
        self.assertEqual([c.item_key for c in result.comparisons],['second'])
        self.assertEqual([h.item_key for h in result.comparison_refusals],['item-one'])

    def test_regression_foreign_url_and_raw_current_do_not_fall_back_to_whole_source(self):
        a=document();b=document('second')
        bad_url=replace(a,current=replace(a.current,document=replace(a.current.document,source_url='https://example.org/foreign'),binding=replace(a.current.binding,source_url='https://example.org/foreign')))
        variants=[document(old_time=2,new_time=1),bad_url,replace(a,current=replace(a.current,raw=b'bad'))]
        for bad in variants:
            result=plan((work(a),work(b)),(bad,b),tokens=(token(b),))
            self.assertEqual(result.passages.dispatch.items[0].disposition,'held')
            self.assertEqual(result.passages.dispatch.items[1].disposition,'reserved_model_candidate')

    def test_outer_work_item_cannot_borrow_another_captured_document(self):
        a=document();b=document('second');bad=replace(a,current=b.current,previous=b.previous)
        result=plan((work(a),),(bad,),tokens=(replace(token(b),item_key='item-one'),))
        self.assertEqual(result.passages.dispatch.reserved_calls,0)
        self.assertEqual(len(result.comparison_refusals),1)
        self.assertEqual(result.comparisons,())

    def test_missing_document_is_held_without_losing_independent_work(self):
        a=document();b=document('second')
        result=plan((work(a),work(b)),(b,),tokens=(token(b),))
        self.assertEqual([i.disposition for i in result.passages.dispatch.items],['held','reserved_model_candidate'])
        self.assertEqual(result.comparison_refusals,())

    def test_unchanged_selected_text_reserves_no_model_capacity(self):
        a=document(old='Same',new='Same')
        # Different whole-document bytes, identical selected passage.
        old=capture('Same','old',0,prefix='old metadata\n');new=capture('Same','new',1,prefix='new metadata\n')
        a=replace(a,current=new,previous=old)
        result=plan((work(a),),(a,))
        self.assertEqual(result.passages.dispatch.reserved_calls,0)
        self.assertEqual(result.passages.dispatch.items[0].disposition,'no_model_work')
        self.assertEqual(result.passages.dispatch.resulting_budget,BUDGET)

    def test_source_rights_token_and_budget_gates_remain_authoritative(self):
        a=document()
        for denied in [work(a,source_status='candidate'),work(a,fetch_enabled=False),work(a,model_processing_allowed=False)]:
            self.assertEqual(plan((denied,),(a,),tokens=(token(a),)).passages.dispatch.reserved_calls,0)
        for sources,tokens in [((),(token(a),)),((PassageSourceBinding('item-one','foreign'),),(token(a),)),
                              (None,()),(None,(replace(token(a),payload_sha256='f'*64),))]:
            self.assertEqual(plan((work(a),),(a,),sources=sources,tokens=tokens).passages.dispatch.reserved_calls,0)
        denied_budget=replace(BUDGET,run_cap_usd=Decimal('0.00001'))
        self.assertEqual(plan((work(a),),(a,),tokens=(token(a),),budget=denied_budget).passages.dispatch.reserved_calls,0)

    def test_preexisting_unchanged_structured_source_denied_and_duplicate_decisions_survive(self):
        a=document();broken=replace(a,current=None)
        for captured,expected in [(work(a,previous_sha256=a.current.document.content_sha256),'unchanged'),
                                  (work(a,extraction_route='structured'),'deterministic'),
                                  (work(a,source_status='candidate'),'held')]:
            result=plan((captured,),(broken,))
            self.assertEqual(result.passages.dispatch.items[0].disposition,expected)
        result=plan((work(a),work(a)),(a,),tokens=(token(a),))
        self.assertEqual([v.disposition for v in result.passages.dispatch.items],['reserved_model_candidate','held'])
        self.assertEqual(result.passages.dispatch.reserved_calls,1)

    def test_scope_errors_refuse_before_partial_batch_or_proof_merging(self):
        a=document()
        for docs in [(a,a),(replace(a,item_key='foreign'),),[],(None,)]:
            with self.assertRaises(DocumentDispatchError):plan((work(a),),docs)
        with self.assertRaises(DocumentDispatchError):plan([work(a)],(a,))

    def test_bound_private_proposal_is_still_unverified_and_cannot_borrow_other_source(self):
        a=document();b=document('second',new='Other')
        result=plan((work(a),work(b)),(a,b),tokens=(token(a),token(b)))
        selected=result.comparisons[0].comparison
        payload=dict(schema_version=1,source_version_id=selected.current.snapshot.source_version_id,
            source_sha256=selected.current.snapshot.content_sha256,language_code='en',locator='section:one',
            proposed_claim_type='condition',proposed_assertion='An invented source describes a changed condition.',source_date_text=None)
        proposal=parse_changed_passage_proposal(json.dumps(payload).encode(),current=selected.current.snapshot,
            previous=selected.previous.snapshot,expected_payload_sha256=selected.selection.payload_sha256)
        self.assertEqual(proposal.review_state,'unverified')
        foreign=result.comparisons[1].comparison
        with self.assertRaises(ValueError):parse_changed_passage_proposal(json.dumps(payload).encode(),
            current=foreign.current.snapshot,previous=foreign.previous.snapshot,expected_payload_sha256=foreign.selection.payload_sha256)


if __name__=='__main__':unittest.main()
