"""A fictional draft cannot borrow a different item's or incomplete check trace."""

from dataclasses import replace
from unittest import TestCase

from scripts.update_rehearsal import fictional_request
from workers.fictional_publication_draft import build_fictional_publication_draft
from workers.offline_update_run import rehearse_update_run


class FictionalDraftDecisionBindingTests(TestCase):
    def setUp(self):
        self.report = rehearse_update_run(fictional_request("manual"))
        self.item = self.report.items[0]

    def with_decision(self, decision):
        return replace(self.report, items=(replace(self.item, decision=decision),))

    def test_a_shadow_decision_for_another_item_cannot_supply_a_draft(self):
        decision = replace(self.item.decision, candidate_id="fictional-period-2024")
        with self.assertRaisesRegex(ValueError, "differs"):
            build_fictional_publication_draft(self.with_decision(decision))

    def test_repeated_true_checks_cannot_replace_the_nine_distinct_checks(self):
        decision = replace(self.item.decision,
                           check_trace=(("no_sensitive_data", True),) * 9)
        with self.assertRaisesRegex(ValueError, "differs"):
            build_fictional_publication_draft(self.with_decision(decision))

    def test_an_unknown_true_check_cannot_replace_a_required_check(self):
        trace = self.item.decision.check_trace[:-1] + (("invented_approval", True),)
        with self.assertRaisesRegex(ValueError, "differs"):
            build_fictional_publication_draft(self.with_decision(replace(
                self.item.decision, check_trace=trace)))

    def test_boolean_lookalikes_cannot_satisfy_the_exact_trace(self):
        trace = tuple((name, 1) for name, _ in self.item.decision.check_trace)
        with self.assertRaisesRegex(ValueError, "differs"):
            build_fictional_publication_draft(self.with_decision(replace(
                self.item.decision, check_trace=trace)))

    def test_check_order_does_not_change_the_meaning_of_a_complete_trace(self):
        trace = tuple(reversed(self.item.decision.check_trace))
        draft = build_fictional_publication_draft(self.with_decision(replace(
            self.item.decision, check_trace=trace)))
        self.assertEqual(draft["itemKey"], self.item.item_key)

    def test_both_real_generated_triggers_keep_the_exact_trace_and_item(self):
        for trigger in ("manual", "scheduled"):
            with self.subTest(trigger=trigger):
                report = rehearse_update_run(fictional_request(trigger))
                draft = build_fictional_publication_draft(report)
                self.assertEqual(draft["itemKey"], report.items[0].decision.candidate_id)
                self.assertEqual(draft["decision"]["disposition"], "shadow_only")

    def test_a_held_item_cannot_become_a_draft_with_an_unrelated_passing_decision(self):
        held = replace(self.report.items[1], decision=self.item.decision)
        self.assertEqual(held.outcome, "held")
        self.assertIsNone(build_fictional_publication_draft(replace(self.report, items=(held,))))
