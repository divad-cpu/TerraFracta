"""Missing work, exact receipts and every required visibility surface."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import unittest

from workers.update_run_completion import (
    ActivationReceipt, DecisionReceipt, PlannedItem, PlannedSource, RunManifest,
    SURFACES, VisibilityReceipt, canonical_run_manifest, parse_canonical_run_manifest, reconcile_run_completion,
)


RUN = "11111111-1111-4111-8111-111111111111"
SOURCE = "22222222-2222-4222-8222-222222222222"
VERSION = "33333333-3333-4333-8333-333333333333"
DECISION = "44444444-4444-4444-8444-444444444444"
PUBLICATION = "55555555-5555-4555-8555-555555555555"
OTHER = "66666666-6666-4666-8666-666666666666"
NOW = datetime(2026, 9, 30, 16, 30, tzinfo=timezone.utc)
AT = NOW - timedelta(seconds=10)


def manifest():
    return RunManifest(RUN, "a" * 64, "publish_eligible",
        (PlannedSource("fictional-source", SOURCE, VERSION, "c" * 64),),
        (PlannedItem("fictional-item", "fictional-source", VERSION),))


def decision(disposition="eligible"):
    return DecisionReceipt(DECISION, "fictional-item", VERSION, disposition)


def activation():
    return ActivationReceipt(PUBLICATION, DECISION, "b" * 64, AT)


def visibility(outcome="matched"):
    return tuple(VisibilityReceipt(PUBLICATION, "b" * 64, surface, outcome, NOW)
                 for surface in sorted(SURFACES))


def reconcile(plan=None, decisions=(), activations=(), checks=()):
    return reconcile_run_completion(plan or manifest(), decisions, activations, checks, now=NOW)


class RunCompletionTests(unittest.TestCase):
    def test_changed_capture_binding_closes_partial_with_exact_invalid_source(self):
        result = reconcile_run_completion(manifest(), (decision("held"),), (), (), now=NOW,
                                          invalid_source_keys=("fictional-source",))
        self.assertEqual(result.run_state, "partial")
        self.assertEqual(result.invalid_source_keys, ("fictional-source",))
        self.assertEqual(result.missing_source_keys, ("fictional-source",))
        self.assertEqual(result.covered_source_keys, ())
        self.assertEqual(result.pending_item_keys, ("fictional-item",))
        for keys in (("unknown-source",), ("fictional-source", "fictional-source"), ["fictional-source"]):
            with self.assertRaises(ValueError):
                reconcile_run_completion(manifest(), (), (), (), now=NOW, invalid_source_keys=keys)

    def test_missing_item_is_explicit_and_cannot_complete(self):
        result = reconcile()
        self.assertEqual((result.run_state, result.commit_state, result.visibility_state),
                         ("partial", "none", "not_required"))
        self.assertEqual(result.pending_item_keys, ("fictional-item",))
        self.assertEqual((result.expected_items, result.decided_items), (1, 0))

    def test_resolved_holds_rejections_and_unchanged_items_complete_without_publication(self):
        for disposition in ("held", "rejected", "unchanged"):
            result = reconcile(decisions=(decision(disposition),))
            self.assertEqual((result.run_state, result.commit_state, result.visibility_state),
                             ("completed", "none", "not_required"))
            self.assertEqual(result.held_items, int(disposition == "held"))

    def test_eligible_decision_without_activation_remains_pending(self):
        result = reconcile(decisions=(decision(),))
        self.assertEqual(result.pending_item_keys, ("fictional-item",))
        self.assertEqual(result.committed_publication_ids, ())
        self.assertEqual(result.run_state, "partial")

    def test_commit_is_separate_from_visibility_and_requires_all_four_surfaces(self):
        for omitted in SURFACES:
            checks = tuple(entry for entry in visibility() if entry.surface != omitted)
            result = reconcile(decisions=(decision(),), activations=(activation(),), checks=checks)
            self.assertEqual((result.run_state, result.commit_state, result.visibility_state),
                             ("partial", "committed", "pending"))
            self.assertEqual(result.pending_visibility_publication_ids, (PUBLICATION,))
            self.assertEqual(result.visible_publication_ids, ())
        result = reconcile(decisions=(decision(),), activations=(activation(),), checks=visibility())
        self.assertEqual((result.run_state, result.commit_state, result.visibility_state),
                         ("completed", "committed", "verified"))

    def test_one_failed_surface_cannot_be_hidden_by_other_matches(self):
        for outcome in ("missing", "error", "superseded"):
            for surface in SURFACES:
                checks = tuple(replace(entry, outcome=outcome) if entry.surface == surface else entry
                               for entry in visibility())
                result = reconcile(decisions=(decision(),), activations=(activation(),), checks=checks)
                self.assertEqual(result.visibility_state, "failed")
                self.assertEqual(result.failed_visibility_publication_ids, (PUBLICATION,))
                self.assertEqual(result.run_state, "partial")

    def test_empty_checked_capture_is_covered_and_missing_capture_is_not(self):
        result = reconcile(replace(manifest(), items=()))
        self.assertEqual(result.run_state, "completed")
        missing = replace(manifest(), sources=(PlannedSource("fictional-source", SOURCE, None),), items=())
        result = reconcile(missing)
        self.assertEqual(result.covered_source_keys, ())
        self.assertEqual(result.missing_source_keys, ("fictional-source",))
        self.assertEqual(result.run_state, "partial")

    def test_equal_source_counts_cannot_substitute_a_source_or_hide_a_missing_item(self):
        plan = replace(manifest(), sources=manifest().sources + (PlannedSource("other-source", OTHER, None),))
        result = reconcile(plan, decisions=(decision("held"),))
        self.assertEqual(result.run_state, "partial")
        self.assertEqual(result.missing_source_keys, ("other-source",))
        with self.assertRaises(ValueError):
            reconcile(replace(manifest(), items=(PlannedItem("fictional-item", "other-source", VERSION),)))
        extra = replace(manifest(), items=manifest().items + (PlannedItem("other-item", "fictional-source", VERSION),))
        result = reconcile(extra, decisions=(decision(),), activations=(activation(),), checks=visibility())
        self.assertEqual((result.run_state, result.commit_state), ("partial", "partial"))
        self.assertEqual(result.pending_item_keys, ("other-item",))

    def test_duplicate_extra_and_wrongly_bound_receipts_reject(self):
        invalid = [
            ((decision(), decision()), (), ()),
            ((replace(decision(), item_key="other-item"),), (), ()),
            ((replace(decision(), source_version_id=OTHER),), (), ()),
            ((decision("held"),), (activation(),), ()),
            ((decision(),), (replace(activation(), decision_id=OTHER),), ()),
            ((decision(),), (activation(), activation()), ()),
            ((decision(),), (activation(),), visibility() + visibility()[:1]),
            ((decision(),), (activation(),), (replace(visibility()[0], publication_id=OTHER),)),
            ((decision(),), (activation(),), (replace(visibility()[0], publication_sha256="c" * 64),)),
            ((decision(),), (activation(),), (replace(visibility()[0], surface="job-success"),)),
        ]
        for decisions, activations, checks in invalid:
            with self.assertRaises(ValueError):
                reconcile(decisions=decisions, activations=activations, checks=checks)

    def test_future_naive_and_precommit_checks_reject(self):
        for instant in (NOW + timedelta(seconds=1), NOW.replace(tzinfo=None), AT - timedelta(seconds=1)):
            with self.assertRaises(ValueError):
                reconcile(decisions=(decision(),), activations=(activation(),),
                          checks=(replace(visibility()[0], checked_at=instant),))
        for instant in (NOW + timedelta(seconds=1), NOW.replace(tzinfo=None)):
            with self.assertRaises(ValueError):
                reconcile(decisions=(decision(),), activations=(replace(activation(), activated_at=instant),))

    def test_shadow_plan_cannot_carry_eligible_or_activated_work(self):
        plan = replace(manifest(), mode="shadow")
        with self.assertRaises(ValueError):
            reconcile(plan, decisions=(decision(),))
        self.assertEqual(reconcile(plan, decisions=(decision("held"),)).run_state, "completed")

    def test_manifest_identity_is_order_independent_and_changes_with_expected_work(self):
        second = PlannedSource("other-source", OTHER, None)
        plan = replace(manifest(), sources=(second,) + manifest().sources)
        reverse = replace(plan, sources=tuple(reversed(plan.sources)))
        self.assertEqual(canonical_run_manifest(plan), canonical_run_manifest(reverse))
        self.assertNotEqual(reconcile(plan).manifest_sha256, reconcile().manifest_sha256)
        self.assertEqual(reconcile(plan).manifest_sha256,
                         sha256(canonical_run_manifest(plan).encode("ascii")).hexdigest())

    def test_manifest_duplicate_wrong_version_and_limit_reject(self):
        invalid = [
            replace(manifest(), sources=()),
            replace(manifest(), sources=manifest().sources * 2),
            replace(manifest(), sources=manifest().sources + (PlannedSource("other-source", SOURCE, None),)),
            replace(manifest(), items=manifest().items * 2),
            replace(manifest(), items=(replace(manifest().items[0], source_version_id=OTHER),)),
            replace(manifest(), items=tuple(PlannedItem(f"item-{index}", "fictional-source", VERSION) for index in range(51))),
            replace(manifest(), run_id="not-a-uuid"),
            replace(manifest(), request_fingerprint="z" * 64),
        ]
        for plan in invalid:
            with self.assertRaises(ValueError):
                reconcile(plan)


if __name__ == "__main__":
    unittest.main()


class StoredManifestTests(unittest.TestCase):
    def test_exact_stored_canonical_roundtrip(self):
        data=canonical_run_manifest(manifest()).encode('ascii')
        self.assertEqual(parse_canonical_run_manifest(data),manifest())

    def test_noncanonical_duplicate_unknown_or_oversize_stored_bytes_reject(self):
        import json
        data=canonical_run_manifest(manifest()).encode('ascii')
        changed=json.loads(data);changed['rawBody']='private-test-placeholder'
        for raw in (b' '+data,data+b'\n',b'{"runId":"duplicate",'+data[1:],
                    json.dumps(changed).encode(),b' '*40961,b'\xff',b'[]'):
            with self.assertRaises(ValueError):parse_canonical_run_manifest(raw)

    def test_schema_and_nested_binding_cannot_change(self):
        import json
        original=json.loads(canonical_run_manifest(manifest()))
        for modify in (lambda p:p.update(schemaVersion=True),lambda p:p.update(sources=[]),
            lambda p:p['sources'][0].update(sourceKey='unknown'),
            lambda p:p['items'][0].update(rawBody='private-test-placeholder'),
            lambda p:p['items'][0].update(sourceVersionId=OTHER)):
            p=json.loads(json.dumps(original));modify(p)
            with self.assertRaises(ValueError):parse_canonical_run_manifest(json.dumps(p,sort_keys=True,separators=(',',':')).encode())
