"""Causal entry-clock mutation regressions across three typed offline planners."""
from dataclasses import replace
from datetime import tzinfo, timedelta
from decimal import Decimal
import unittest

from tests.test_document_dispatch_plan import document as plain_document, work as plain_work, token as plain_token
from tests.test_document_passage_binding import AT
from tests.test_html_dispatch_plan import document as html_document, work as html_work, token as html_token
from tests.test_html_passage_comparison import OBSERVED
from tests.test_pdf_dispatch_plan import document as pdf_document, work as pdf_work, token as pdf_token
from tests.test_pdf_passage_comparison import NOW
from tests.test_passage_model_plan import PRICE, BUDGET, LIMITS
from workers.document_dispatch_plan import plan_document_dispatch
from workers.html_dispatch_plan import plan_html_dispatch
from workers.pdf_dispatch_plan import plan_pdf_dispatch
from workers.passage_model_plan import PassageSourceBinding

class MutatingUtc(tzinfo):
    def __init__(self, callback): self.callback = callback; self.calls = 0
    def utcoffset(self, value):
        self.calls += 1
        if self.calls == 1: self.callback()
        return timedelta(0)
    def dst(self, value): return timedelta(0)
    def tzname(self, value): return 'UTC'

FORMATS = {
    'plain': (plain_document, plain_work, plain_token, plan_document_dispatch, AT + timedelta(seconds=10), 'source-one'),
    'html': (html_document, html_work, html_token, plan_html_dispatch, OBSERVED, 'fictional-html'),
    'pdf': (pdf_document, pdf_work, pdf_token, plan_pdf_dispatch, NOW, 'invented-pdf'),
}

class DispatchEntrySnapshotTests(unittest.TestCase):
    def check(self, kind, mode):
        document, work, token, planner, at, source_key = FORMATS[kind]
        value = document(); proof = token(value)
        item = work(value, **({'source_status': 'candidate'} if mode == 'source' else
                            {'model_processing_allowed': False} if mode == 'rights' else {}))
        budget = replace(BUDGET, run_cap_usd=Decimal(0)) if mode == 'budget' else replace(BUDGET)
        limits = replace(LIMITS, max_model_items=0) if mode == 'routing' else replace(LIMITS)
        proof = replace(proof, maximum_input_tokens=None) if mode == 'tokens' else replace(proof)
        source = PassageSourceBinding(value.item_key, 'unbound-source' if mode == 'binding' else source_key)
        targets = {
            'source': (item, 'source_status', 'approved'),
            'rights': (item, 'model_processing_allowed', True),
            'budget': (budget, 'run_cap_usd', BUDGET.run_cap_usd),
            'routing': (limits, 'max_model_items', LIMITS.max_model_items),
            'tokens': (proof, 'maximum_input_tokens', 200),
            'binding': (source, 'source_key', source_key),
        }
        target, field, replacement = targets[mode]
        before = getattr(target, field)
        zone = MutatingUtc(lambda: target.__dict__.__setitem__(field, replacement))
        result = planner((item,), limits, documents=(value,), source_bindings=(source,), token_limits=(proof,),
            output_token_limit_per_call=100, price=replace(PRICE), budget=budget, observed_at=at.replace(tzinfo=zone))
        self.assertGreater(zone.calls, 0, 'Custom UTC remains supported')
        self.assertEqual(getattr(target, field), replacement, 'The accepted callback actually ran')
        self.assertNotEqual(before, replacement)
        self.assertEqual(result.passages.dispatch.reserved_calls, 0, (kind, mode))
        self.assertNotEqual(result.passages.dispatch.items[0].disposition, 'reserved_model_candidate')

class NestedDispatchSnapshotTests(unittest.TestCase):
    def check_pair(self, kind):
        document, work, token, planner, at, source_key = FORMATS[kind]
        a = document(); b = document('second')
        valid_previous = b.previous
        bad_previous = replace(valid_previous, raw=b'PRIVATE_INVALID_PRIOR')
        b = replace(b, previous=bad_previous)
        # Capture the outer work hashes before the malicious clock mutates any
        # original reference. b's original invalid raw remains independently bad.
        a_item, b_item = work(a), work(b)
        proof = token(a)
        zone = MutatingUtc(lambda: object.__setattr__(b, 'previous', valid_previous))
        result = planner((a_item, b_item), replace(LIMITS), documents=(a, b),
            source_bindings=(PassageSourceBinding(a.item_key, source_key), PassageSourceBinding(b.item_key, source_key)),
            token_limits=(proof,), output_token_limit_per_call=100, price=replace(PRICE), budget=replace(BUDGET),
            observed_at=at.replace(tzinfo=zone))
        self.assertGreater(zone.calls, 0)
        self.assertIs(b.previous, valid_previous)
        self.assertEqual([row.item_key for row in result.comparisons], [a.item_key])
        self.assertEqual([row.item_key for row in result.comparison_refusals], ['second'])
        self.assertEqual(result.passages.dispatch.reserved_calls, 1)

    def test_unknown_metaclass_and_deepcopy_hooks_are_never_executed(self):
        from workers.dispatch_input_snapshot import freeze_input, DispatchSnapshotError
        calls = []
        class Meta(type):
            def __eq__(self, other): calls.append('equality'); return True
        class Foreign(metaclass=Meta):
            def __deepcopy__(self, memo): calls.append('deepcopy'); return self
        with self.assertRaises(DispatchSnapshotError): freeze_input(Foreign(), (PassageSourceBinding,))
        self.assertEqual(calls, [])
        from workers.dispatch_input_snapshot import scalar_record
        with self.assertRaises(DispatchSnapshotError):
            scalar_record(PassageSourceBinding('item', Foreign()), PassageSourceBinding)
        self.assertEqual(calls, [])

    def test_snapshot_components_are_copied_before_timezone_validation(self):
        from workers.dispatch_input_snapshot import freeze_input, thaw_input
        original = PassageSourceBinding('original-item', 'original-source')
        zone = MutatingUtc(lambda: original.__dict__.__setitem__('source_key', 'rewritten'))
        value = (original, NOW.replace(tzinfo=zone))
        frozen = freeze_input(value, (PassageSourceBinding,))
        self.assertEqual(zone.calls, 0)
        copied, when = thaw_input(frozen)
        self.assertEqual(zone.calls, 1)
        self.assertEqual(original.source_key, 'rewritten')
        self.assertEqual(copied.source_key, 'original-source')
        self.assertEqual(when, NOW)
        self.assertIsNot(when.tzinfo, zone)

for kind in FORMATS:
    def nested(self, kind=kind): self.check_pair(kind)
    setattr(NestedDispatchSnapshotTests, 'test_' + kind + '_all_pairs_captured_before_clock_callback', nested)

for kind in FORMATS:
    for mode in ('source', 'rights', 'budget', 'routing', 'tokens', 'binding'):
        def case(self, kind=kind, mode=mode): self.check(kind, mode)
        setattr(DispatchEntrySnapshotTests, 'test_' + kind + '_' + mode + '_captured_before_clock_callback', case)

class DispatchOuterClockTests(unittest.TestCase):
    def check_clock(self, kind, bad):
        from workers.document_dispatch_plan import DocumentDispatchError
        from workers.html_dispatch_plan import HtmlDispatchError
        from workers.pdf_dispatch_plan import PdfDispatchError
        planner = FORMATS[kind][3]
        error = {'plain': DocumentDispatchError, 'html': HtmlDispatchError, 'pdf': PdfDispatchError}[kind]
        with self.assertRaises(error):
            planner((), replace(LIMITS), documents=(), source_bindings=(), token_limits=(),
                output_token_limit_per_call=100, price=replace(PRICE), budget=replace(BUDGET), observed_at=bad)

for kind in FORMATS:
    for label, bad in [('none', None), ('string', '2026-10-17T09:00:00.000000Z')]:
        def clock(self, kind=kind, bad=bad): self.check_clock(kind, bad)
        setattr(DispatchOuterClockTests, 'test_' + kind + '_outer_clock_' + label + '_refused_before_empty_result', clock)

if __name__ == '__main__': unittest.main()

