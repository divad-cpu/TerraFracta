from dataclasses import replace
from datetime import timedelta
import json
import unittest
from tests.test_update_run_completion import RUN,PUBLICATION,VERSION,OTHER,NOW
from workers.update_run_completion import SURFACES
from workers.visibility_attempts import (SurfaceObservation,VisibilityAttempt,VisibilityExpectation,
 canonical_visibility_attempt,parse_visibility_attempt,evaluate_visibility_attempt,latest_visibility_attempt)

def attempt():
    return VisibilityAttempt(RUN,PUBLICATION,'b'*64,(VERSION,),NOW-timedelta(seconds=4),NOW,
      tuple(SurfaceObservation(x,'observed',NOW,PUBLICATION,'b'*64,(VERSION,)) for x in sorted(SURFACES)))
def expected():return VisibilityExpectation(RUN,PUBLICATION,'b'*64,(VERSION,),NOW-timedelta(seconds=20),NOW-timedelta(seconds=10))
def evaluate(row):return evaluate_visibility_attempt(row,expected(),current_publication_id=PUBLICATION,now=NOW+timedelta(seconds=10))

class VisibilityTests(unittest.TestCase):
    def test_complete_synthetic_matches_never_claim_runtime_visibility(self):
        result=evaluate(attempt());self.assertEqual(result.state,'matched');self.assertFalse(result.runtime_verified)
        self.assertEqual(set(result.matched_surfaces),SURFACES)
    def test_canonical_roundtrip_and_reordered_input_are_identical(self):
        original=attempt();raw=canonical_visibility_attempt(original)
        self.assertEqual(parse_visibility_attempt(raw.encode()),original)
        self.assertEqual(canonical_visibility_attempt(replace(original,observations=tuple(reversed(original.observations)))),raw)
    def test_new_partial_cannot_borrow_old_successes(self):
        old=attempt();new=replace(old,started_at=NOW,finished_at=NOW+timedelta(seconds=1),observations=())
        self.assertIs(latest_visibility_attempt((new,old)),new);self.assertEqual(evaluate(new).state,'partial')
        self.assertEqual(evaluate(new).matched_surfaces,())
    def test_one_missing_mismatched_source_or_unavailable_surface_remains_explicit(self):
        original=attempt()
        for replacement,state in ((replace(original.observations[0],source_version_ids=()),'mismatch'),
          (replace(original.observations[0],publication_id=OTHER),'mismatch'),
          (SurfaceObservation('issue','absent',NOW),'mismatch'),(SurfaceObservation('issue','unavailable',NOW),'unavailable')):
            changed=replace(original,observations=(replacement,)+original.observations[1:])
            self.assertEqual(evaluate(changed).state,state);self.assertFalse(evaluate(changed).runtime_verified)
    def test_independent_current_head_invalidates_saved_matches(self):
        result=evaluate_visibility_attempt(attempt(),expected(),current_publication_id=OTHER,now=NOW)
        self.assertEqual(result.state,'superseded')
        self.assertEqual(evaluate_visibility_attempt(attempt(),expected(),current_publication_id=None,now=NOW).state,'unavailable')
    def test_unknown_surface_duplicate_or_worker_verified_claim_rejects(self):
        for replacement in (replace(attempt().observations[0],surface='admin'),replace(attempt().observations[0],outcome='verified')):
            with self.assertRaises(ValueError):canonical_visibility_attempt(replace(attempt(),observations=(replacement,)))
        with self.assertRaises(ValueError):canonical_visibility_attempt(replace(attempt(),observations=(attempt().observations[0],)*2))
    def test_foreign_committed_context_or_preactivation_times_reject(self):
        for row in (replace(attempt(),publication_id=OTHER),replace(attempt(),expected_source_version_ids=(OTHER,)),
          replace(attempt(),started_at=NOW-timedelta(seconds=11))):
            with self.assertRaises(ValueError):evaluate(row)
    def test_long_future_naive_or_outside_observation_times_reject(self):
        for row in (replace(attempt(),started_at=NOW-timedelta(seconds=61)),replace(attempt(),finished_at=NOW-timedelta(seconds=5)),
          replace(attempt(),started_at=NOW.replace(tzinfo=None)),replace(attempt(),observations=(replace(attempt().observations[0],checked_at=NOW+timedelta(seconds=1)),))):
            with self.assertRaises(ValueError):canonical_visibility_attempt(row)
        with self.assertRaises(ValueError):evaluate_visibility_attempt(attempt(),expected(),current_publication_id=PUBLICATION,now=NOW-timedelta(seconds=1))
    def test_private_fields_duplicate_keys_scope_upgrade_or_noncanonical_bytes_reject(self):
        raw=canonical_visibility_attempt(attempt());p=json.loads(raw)
        for change in ({'scope':'rendered'},{'runtimeVerified':True},{'credential':'private'}):
            with self.assertRaises(ValueError):parse_visibility_attempt(json.dumps({**p,**change},sort_keys=True,separators=(',',':')).encode())
        for data in (raw.replace('{','{"scope":"synthetic",',1).encode(),json.dumps(p).encode(),b'x'*16385):
            with self.assertRaises(ValueError):parse_visibility_attempt(data)
    def test_equal_finished_conflicting_attempts_are_ambiguous(self):
        with self.assertRaises(ValueError):latest_visibility_attempt((attempt(),replace(attempt(),observations=())))
        self.assertEqual(latest_visibility_attempt(()),None)
        with self.assertRaises(ValueError):latest_visibility_attempt((attempt(),replace(attempt(),publication_id=OTHER)))
    def test_absent_rows_cannot_smuggle_source_identity(self):
        with self.assertRaises(ValueError):canonical_visibility_attempt(replace(attempt(),observations=(replace(attempt().observations[0],outcome='absent'),)))

if __name__=='__main__':unittest.main()
