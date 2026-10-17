"""Invented HTML vintages; no network, service, storage or model invocation."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest

from tests.test_html_passage_binding import inputs, AT
from tests.test_passage_model_plan import item, plan
from workers.html_passage_binding import HtmlElementSelection, bind_html_passages
from workers.html_passage_comparison import (
    HtmlComparisonError, HtmlPassageCapture, compare_html_passages,
)
from workers.passage_model_plan import PassageSourceBinding, PassageTokenLimit

OBSERVED = AT + timedelta(seconds=10)


def capture(text='New wording', version='new', seconds=1, prefix='', element_id='chosen'):
    raw = (prefix + f'<article id="{element_id}"><p>{text}</p></article>').encode()
    values = inputs(raw, (HtmlElementSelection('article:one', element_id),), version)
    when = AT + timedelta(seconds=seconds)
    return HtmlPassageCapture(raw, replace(values['document'], retrieved_at=when),
        replace(values['binding'], retrieved_at=when), values['mapping'])


def compare(current=None, previous=None):
    return compare_html_passages(capture() if current is None else current, previous, observed_at=OBSERVED)


class HtmlPassageComparisonTests(unittest.TestCase):
    def test_first_observation_retains_original_and_derived_identities(self):
        current = capture(); result = compare(current)
        self.assertIsNone(result.previous); self.assertIsNone(result.source_bytes_changed)
        self.assertEqual(result.current.document, current.document)
        self.assertEqual(result.change.current, result.current.snapshot)
        self.assertIsNone(result.change.previous)
        self.assertEqual(result.current.snapshot.content_sha256, sha256(current.raw).hexdigest())
        self.assertNotEqual(result.current.snapshot.content_sha256, result.current.spans[0].derived_text_sha256)
        self.assertEqual(result.selection.state, 'ready')
        self.assertEqual(result.evidence_state, 'offline_html_selected_text_comparison_only')

    def test_changed_selected_text_retains_both_complete_vintages(self):
        old = capture('Old wording', 'old', 0); new = capture()
        result = compare(new, old)
        self.assertTrue(result.source_bytes_changed)
        self.assertEqual(result.previous.document, old.document)
        self.assertEqual(result.current.document, new.document)
        self.assertNotEqual(result.previous.derivation_manifest_sha256, result.current.derivation_manifest_sha256)
        self.assertEqual(result.change.previous, result.previous.snapshot)
        payload = json.loads(result.selection.payload)
        self.assertEqual(payload['content_sha256'], sha256(new.raw).hexdigest())
        self.assertEqual(payload['passages'][0]['text'], 'New wording')
        self.assertEqual(payload['passages'][0]['locators'], ['article:one'])

    def test_markup_only_and_unselected_changes_skip_only_selected_text(self):
        old = capture('Same wording', 'old', 0, '<nav>Old navigation</nav>')
        new = capture('Same <em>wording</em>', 'new', 1, '<nav>Changed navigation</nav>\r\n')
        result = compare(new, old)
        self.assertTrue(result.source_bytes_changed)
        self.assertNotEqual(result.current.spans, result.previous.spans)
        self.assertEqual(result.selection.state, 'no_model_work')
        self.assertEqual(result.selection.reason_code, 'source_changed_passages_unchanged')
        self.assertEqual(result.selection.unchanged_locators, ('article:one',))
        self.assertIsNone(result.selection.payload)
        self.assertEqual(result.current.coverage, 'selected_elements_parsed_text_only')

    def test_exact_same_capture_does_not_schedule_new_model_work(self):
        current = capture(); result = compare(current, current)
        self.assertFalse(result.source_bytes_changed)
        self.assertEqual(result.selection.reason_code, 'passages_unchanged')

    def test_invalid_prior_never_downgrades_to_first_observation(self):
        old = capture('Old wording', 'old', 0)
        for invalid in [replace(old, raw=b'foreign'), replace(old, document=None),
                        replace(old, binding=None), replace(old, mapping=None), {}, old.document]:
            with self.subTest(invalid=type(invalid).__name__), self.assertRaises(HtmlComparisonError):
                compare(capture(), invalid)

    def test_prebuilt_derived_result_cannot_skip_original_rebinding(self):
        current = capture()
        bound = bind_html_passages(current.raw, current.document, binding=current.binding,
                                   mapping=current.mapping, observed_at=OBSERVED)
        for invalid in [bound, bound.snapshot, replace(current, raw=b'foreign')]:
            with self.assertRaises(HtmlComparisonError): compare(invalid)

    def test_missing_duplicate_or_nested_chosen_elements_hold_the_entire_comparison(self):
        old = capture('Old wording', 'old', 0)
        for raw in [b'<article id="missing">PRIVATE</article>',
                    b'<p id="chosen">One</p><p id="chosen">Two</p>',
                    b'<article id="chosen"><p id="inner">Nested</p></article>']:
            current = capture()
            digest = sha256(raw).hexdigest()
            mapping = replace(current.mapping, content_sha256=digest)
            if b'inner' in raw:
                mapping = replace(mapping, selections=(HtmlElementSelection('article:one', 'chosen'), HtmlElementSelection('inner', 'inner')))
            current = replace(current, raw=raw, document=replace(current.document, content_sha256=digest),
                binding=replace(current.binding, content_sha256=digest), mapping=mapping)
            with self.assertRaises(HtmlComparisonError): compare(current, old)

    def test_element_identity_cannot_silently_move_under_the_same_recipe(self):
        old = capture('Old wording', 'old', 0)
        for element in ['replacement', 'other']:
            with self.assertRaises(HtmlComparisonError): compare(capture(element_id=element), old)

    def test_receipt_scope_recipe_language_version_and_retrieval_conflicts_hold(self):
        old = capture('Old wording', 'old', 0); current = capture()
        for key, value in [('source_url', 'https://example.org/changed.html'), ('source_key', 'other'), ('item_key', 'other')]:
            changed = replace(current, document=replace(current.document, **{key: value}),
                binding=replace(current.binding, **{key: value}))
            with self.assertRaises(HtmlComparisonError): compare(changed, old)
        for key, value in [('mapping_sha256', 'd'*64), ('language_code', 'no')]:
            changed = replace(current, binding=replace(current.binding, **{key: value}), mapping=replace(current.mapping, **{key: value}))
            with self.assertRaises(HtmlComparisonError): compare(changed, old)
        for changed in [capture(version='old'), capture(seconds=-1), capture(seconds=11)]:
            with self.assertRaises(HtmlComparisonError): compare(changed, old)
        with self.assertRaises(HtmlComparisonError):
            compare_html_passages(current, old, observed_at=OBSERVED.replace(tzinfo=None))

    def test_existing_planner_retains_rights_source_token_and_skip_gates(self):
        result = compare(capture(), capture('Old wording', 'old', 0))
        work = item(current_sha256=result.current.document.content_sha256, previous_sha256=result.previous.document.content_sha256)
        token = PassageTokenLimit('item-one', result.selection.payload_sha256, 100)
        sources = (PassageSourceBinding('item-one', 'fictional-html'),)
        self.assertEqual(plan((work,), (result.change,), (token,), source_bindings=sources).dispatch.reserved_calls, 1)
        for denied in [replace(work, source_status='candidate'), replace(work, model_processing_allowed=False)]:
            self.assertEqual(plan((denied,), (result.change,), (token,), source_bindings=sources).dispatch.reserved_calls, 0)
        self.assertEqual(plan((work,), (result.change,), (token,), source_bindings=()).dispatch.reserved_calls, 0)
        self.assertEqual(plan((work,), (result.change,), (), source_bindings=sources).dispatch.reserved_calls, 0)
        same = compare(capture('Same', 'new', 1, '<nav>new</nav>'), capture('Same', 'old', 0, '<nav>old</nav>'))
        unchanged = item(current_sha256=same.current.document.content_sha256, previous_sha256=same.previous.document.content_sha256)
        self.assertEqual(plan((unchanged,), (same.change,), (), source_bindings=sources).dispatch.reserved_calls, 0)

    def test_refusal_does_not_disclose_original_canary(self):
        with self.assertRaises(HtmlComparisonError) as error:
            compare(replace(capture(), raw=b'PRIVATE_CANARY /home/private/file'))
        self.assertEqual(str(error.exception), 'html_comparison_unavailable')


if __name__ == '__main__': unittest.main()
