from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
import unittest
from tests.test_visibility_attempts import attempt,expected,NOW,PUBLICATION,OTHER
from workers.visibility_attempts import canonical_visibility_attempt
from workers.visibility_receipts import parse_synthetic_visibility_receipt

KEY='fictional:visibility:receipt'

def receipt(row=None):
    row=row or attempt()
    return {'schemaVersion':1,'status':'stored','attemptId':OTHER,'attemptKey':KEY,'runId':row.run_id,
      'publicationId':row.publication_id,'publicationSha256':row.publication_sha256,
      'observationsSha256':sha256(canonical_visibility_attempt(row).encode()).hexdigest(),'recordedAt':NOW.isoformat(),
      'summary':{'scope':'synthetic','runtimeVerified':False,'state':'matched',
        'matchedSurfaces':['issue','overview','search','sources'],'missingSurfaces':[],
        'mismatchedSurfaces':[],'unavailableSurfaces':[],'checkedThrough':NOW.isoformat()}}

def parse(value,*,row=None,**kwargs):
    return parse_synthetic_visibility_receipt(value if type(value) is bytes else json.dumps(value).encode(),row or attempt(),expected(),
      **{'attempt_key':KEY,'expected_status':'stored','current_publication_id':PUBLICATION,'now':NOW+timedelta(seconds=1),**kwargs})

class VisibilityReceiptTests(unittest.TestCase):
    def test_exact_synthetic_summary_is_derived_and_runtime_false(self):
        r=parse(receipt());self.assertEqual(r.evaluation.state,'matched');self.assertFalse(r.evaluation.runtime_verified)
    def test_returned_identity_key_hash_or_phase_cannot_substitute_trusted_inputs(self):
        for change in ({'attemptKey':'fictional:other'},{'runId':OTHER},{'publicationId':OTHER},
          {'publicationSha256':'a'*64},{'observationsSha256':'a'*64},{'status':'latest'},{'attemptId':'bad'}):
            with self.assertRaises(ValueError):parse({**receipt(),**change})
    def test_summary_does_not_upgrade_scope_runtime_or_borrow_old_surfaces(self):
        for change in ({'scope':'rendered'},{'runtimeVerified':True},{'runtimeVerified':0},
          {'state':'verified'},{'matchedSurfaces':['issue']},{'missingSurfaces':['search']},{'checkedThrough':(NOW+timedelta(seconds=1)).isoformat()}):
            p=receipt();p['summary'].update(change)
            with self.assertRaises(ValueError):parse(p)
        partial=replace(attempt(),observations=())
        with self.assertRaises(ValueError):parse(receipt(partial),row=partial)
    def test_new_current_head_invalidates_old_summary(self):
        for current in (None,OTHER):
            with self.assertRaises(ValueError):parse(receipt(),current_publication_id=current)
    def test_recorded_time_must_follow_attempt_and_not_be_future_or_naive(self):
        for value in ((NOW-timedelta(seconds=1)).isoformat(),(NOW+timedelta(seconds=2)).isoformat(),NOW.replace(tzinfo=None).isoformat()):
            with self.assertRaises(ValueError):parse({**receipt(),'recordedAt':value})
    def test_unknown_private_fields_duplicates_types_and_oversize_reject(self):
        p=receipt();p['summary']['credential']='fictional-private-placeholder'
        bad=(p,{**receipt(),'credential':'private'},{**receipt(),'schemaVersion':True},
          json.dumps(receipt()).replace('{','{"attemptKey":"forged",',1).encode(),b'x'*16385,b'\xff')
        for value in bad:
            with self.assertRaises(ValueError):parse(value)
    def test_ambiguous_latest_marker_cannot_be_a_success_receipt(self):
        with self.assertRaises(ValueError):parse({'schemaVersion':1,'scope':'synthetic','state':'ambiguous','runtimeVerified':False},expected_status='latest')
    def test_existing_receipt_keeps_original_recorded_time(self):
        value={**receipt(),'status':'existing'}
        result=parse(value,expected_status='existing');self.assertEqual(result.recorded_at,NOW)

if __name__=='__main__':unittest.main()
