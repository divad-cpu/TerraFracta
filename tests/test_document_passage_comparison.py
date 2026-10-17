"""Receipt-preserving offline current/previous comparison and planner seam."""
from dataclasses import replace
from datetime import timedelta
import json
import unittest
from tests.test_document_passage_binding import inputs,AT
from tests.test_passage_model_plan import item,plan
from workers.document_passage_binding import DocumentByteSpan,bind_document_passages
from workers.document_passage_comparison import (
    DocumentPassageCapture,DocumentComparisonError,compare_document_passages,
)
from workers.passage_model_plan import PassageSourceBinding,PassageTokenLimit


def capture(text='Current',version='new',seconds=1,prefix='',locator='section:one'):
    raw=(prefix+text).encode();values=inputs(raw,[DocumentByteSpan(locator,len(prefix.encode()),len(raw))],version)
    at=AT+timedelta(seconds=seconds)
    return DocumentPassageCapture(raw,replace(values['document'],retrieved_at=at),replace(values['binding'],retrieved_at=at),values['mapping'])


def compare(current=None,previous=None):return compare_document_passages(capture() if current is None else current,previous,observed_at=AT+timedelta(seconds=10))


class DocumentPassageComparisonTests(unittest.TestCase):
    def test_first_observation_retains_complete_binding_and_existing_selection(self):
        current=capture();result=compare(current)
        self.assertIsNone(result.previous);self.assertIsNone(result.source_bytes_changed)
        self.assertEqual(result.current.document,current.document)
        self.assertEqual(result.current.spans,current.mapping.spans)
        self.assertEqual(result.change.current,result.current.snapshot)
        self.assertIsNone(result.change.previous);self.assertEqual(result.selection.state,'ready')
        self.assertEqual(result.evidence_state,'offline_original_document_comparison_only')

    def test_current_and_previous_bytes_receipts_and_snapshots_stay_distinct(self):
        old=capture('Old','old',0);new=capture('New','new',1)
        result=compare(new,old)
        self.assertEqual(result.previous.document,old.document)
        self.assertEqual(result.current.document,new.document)
        self.assertTrue(result.source_bytes_changed)
        self.assertEqual(result.change.previous,result.previous.snapshot)
        self.assertEqual(json.loads(result.selection.payload)['passages'][0]['text'],'New')

    def test_regressing_retrieval_is_held_even_when_each_capture_is_valid(self):
        old=capture('Old','old',2);new=capture('New','new',1)
        for value in [old,new]:bind_document_passages(value.raw,value.document,binding=value.binding,mapping=value.mapping,observed_at=AT+timedelta(seconds=10))
        with self.assertRaises(DocumentComparisonError):compare(new,old)

    def test_equal_retrieval_observations_remain_allowed_without_publication_order_claim(self):
        result=compare(capture('New','new',1),capture('Old','old',1))
        self.assertEqual(result.selection.state,'ready')
        self.assertEqual(result.current.document.retrieved_at,result.previous.document.retrieved_at)

    def test_changed_url_item_or_source_requires_identity_review_even_with_matching_proof(self):
        old=capture('Old','old',0);new=capture('New','new',1)
        for field,value in [('source_url','https://example.org/changed'),('source_key','other'),('item_key','other')]:
            changed=replace(new,document=replace(new.document,**{field:value}),binding=replace(new.binding,**{field:value}))
            with self.assertRaises(DocumentComparisonError):compare(changed,old)

    def test_invalid_previous_never_falls_back_to_first_observation(self):
        good=capture();old=capture('Old','old',0)
        for bad in [replace(old,raw=None),replace(old,document=None),replace(old,binding=None),replace(old,mapping=None),
                    replace(old,raw=b'foreign'),{},old.document]:
            with self.assertRaises(DocumentComparisonError):compare(good,bad)

    def test_prebuilt_bound_objects_or_snapshots_cannot_skip_raw_rebinding(self):
        c=capture();bound=bind_document_passages(c.raw,c.document,binding=c.binding,mapping=c.mapping,observed_at=AT+timedelta(seconds=10))
        for value in [bound,bound.snapshot,replace(c,raw=b'foreign')]:
            with self.assertRaises(DocumentComparisonError):compare_document_passages(value,observed_at=AT+timedelta(seconds=10))

    def test_future_or_naive_observation_and_invalid_current_refuse(self):
        old=capture('Old','old',0)
        for new in [capture(seconds=11),replace(capture(),raw=b'bad'),replace(capture(),binding=None)]:
            with self.assertRaises(DocumentComparisonError):compare(new,old)
        with self.assertRaises(DocumentComparisonError):compare_document_passages(capture(),old,observed_at=AT.replace(tzinfo=None))

    def test_metadata_and_byte_offset_changes_keep_exact_passage_skip(self):
        old=capture('Same','old',0,prefix='old metadata\n');new=capture('Same','new',1,prefix='longer new metadata\n')
        result=compare(new,old)
        self.assertTrue(result.source_bytes_changed)
        self.assertNotEqual(result.current.spans,result.previous.spans)
        self.assertEqual(result.selection.state,'no_model_work')
        self.assertEqual(result.selection.unchanged_locators,('section:one',))
        self.assertIsNone(result.selection.payload)

    def test_removed_or_moved_passage_stays_held_with_both_vintages_available(self):
        old=capture('Original','old',0)
        for new in [replace(capture('Unselected','new',1),mapping=replace(capture('Unselected','new',1).mapping,spans=())),
                    capture('Original','new',1,prefix='metadata\n',locator='moved')]:
            result=compare(new,old);self.assertEqual(result.selection.state,'held')
            self.assertEqual(result.selection.removed_locators,('section:one',));self.assertIsNotNone(result.previous)
            self.assertIsNone(result.selection.payload)

    def test_recipe_language_and_reused_version_failures_follow_existing_contract(self):
        old=capture('Old','old',0);new=capture('New','new',1)
        for field,value in [('mapping_sha256','d'*64),('language_code','no')]:
            changed=replace(new,binding=replace(new.binding,**{field:value}),mapping=replace(new.mapping,**{field:value}))
            with self.assertRaises(DocumentComparisonError):compare(changed,old)
        with self.assertRaises(DocumentComparisonError):compare(capture('New','old',1),old)

    def test_existing_dispatch_rights_source_token_and_no_paid_skip_rules_remain(self):
        result=compare(capture('New','new',1),capture('Old','old',0))
        captured=item(current_sha256=result.current.document.content_sha256,previous_sha256=result.previous.document.content_sha256)
        token=PassageTokenLimit('item-one',result.selection.payload_sha256,100)
        self.assertEqual(plan((captured,),(result.change,),(token,)).dispatch.reserved_calls,1)
        for denied in [replace(captured,source_status='candidate'),replace(captured,model_processing_allowed=False)]:
            self.assertEqual(plan((denied,),(result.change,),(token,)).dispatch.reserved_calls,0)
        self.assertEqual(plan((captured,),(result.change,),(token,),source_bindings=()).dispatch.reserved_calls,0)
        self.assertEqual(plan((captured,),(result.change,),()).dispatch.reserved_calls,0)
        same=compare(capture('Same','new',1,prefix='new\n'),capture('Same','old',0,prefix='old\n'))
        work=item(current_sha256=same.current.document.content_sha256,previous_sha256=same.previous.document.content_sha256)
        self.assertEqual(plan((work,),(same.change,),()).dispatch.reserved_calls,0)

    def test_curated_refusal_does_not_echo_document_or_private_path(self):
        bad=replace(capture(),raw=b'PRIVATE_CANARY /home/private/file')
        with self.assertRaises(DocumentComparisonError) as raised:compare(bad)
        self.assertNotIn('PRIVATE_CANARY',str(raised.exception));self.assertNotIn('/home/',str(raised.exception))


if __name__=='__main__':unittest.main()
