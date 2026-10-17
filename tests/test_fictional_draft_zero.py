"""Signed zero observations fit the existing unsigned fictional display."""

from dataclasses import replace
from decimal import Decimal, localcontext
from unittest import TestCase

from scripts.update_rehearsal import fictional_request
from workers.fictional_publication_draft import build_fictional_publication_draft
from workers.offline_update_run import rehearse_update_run


class FictionalDraftZeroTests(TestCase):
    def draft_for(self, value):
        report = rehearse_update_run(fictional_request("manual"))
        item = report.items[0]
        return build_fictional_publication_draft(replace(report, items=(replace(
            item, observation=replace(item.observation, value=Decimal(value))),)))

    def test_signed_zero_keeps_source_precision_in_the_existing_unsigned_display(self):
        for source, display in (("-0", "0"), ("-0.0", "0.0"), ("0", "0"), ("0.0", "0.0")):
            with self.subTest(source=source):
                draft = self.draft_for(source)
                self.assertEqual(draft["observation"]["value"], display)
                self.assertEqual(draft["publication"]["snapshot"]["claims"][0]["assertion"],
                                 f"In 2025, the fictional share was {display}%.")

    def test_positive_exponent_zero_never_expands_into_a_long_display(self):
        for source in ("0E+1000", "-0E+1000"):
            with self.subTest(source=source):
                self.assertEqual(self.draft_for(source)["observation"]["value"], "0")

    def test_zero_below_existing_display_precision_is_still_refused(self):
        for source in ("0.00", "-0.00", "0E-1000"):
            with self.subTest(source=source), self.assertRaises(ValueError):
                self.draft_for(source)

    def test_nonzero_representation_is_preserved_under_a_low_decimal_context(self):
        with localcontext() as context:
            context.prec = 1
            for source in ("27.4", "100.0", "1E+1"):
                with self.subTest(source=source):
                    self.assertEqual(self.draft_for(source)["observation"]["value"],
                                     format(Decimal(source), "f"))
