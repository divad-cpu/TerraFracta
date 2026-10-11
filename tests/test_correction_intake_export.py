"""Saved invented queue counts cannot promote real intake or private details."""
from copy import deepcopy
import json
import unittest
from scripts.export_invented_correction_snapshot import build_snapshot,REQUIRED


class CorrectionIntakeExportTests(unittest.TestCase):
    def setUp(self):
        self.pin='a'*64
        self.receipt={'evidenceKind':'actual_invented_correction_intake_first_successor','candidateSha256':self.pin,
            'observedAt':'2026-10-02T18:11:56+00:00','privateReports':4,'realReports':0,'actualSourceRequests':0,
            'primaryChanged':False,'browserVerified':False,'liveIntakeEnabled':False,'contactCollected':False,
            'privacyPolicySelected':False,'temporaryAccountsRetired':True,'ownedCloneStopped':True,
            'phases':[{'phase':phase,'revision':index,'reportsAdded':2,'ordinaryWriterUsesOwnerSql':False,
                'publicContentChangedByReports':False,'denials':sorted(REQUIRED|({'stale_first_publication','old_claim_on_successor'} if index==2 else set()))}
                for index,phase in enumerate(('first','successor'),1)]}
    def checked(self):return build_snapshot(self.receipt,self.pin)
    def test_exact_dated_projection_excludes_report_details_ids_paths_and_credentials(self):
        self.receipt.update(privateEvidenceDirectory='/private-canary',password='private-canary',reportDetails='private-canary')
        result=self.checked();encoded=json.dumps(result)
        self.assertEqual([x['revision'] for x in result['editions']],[1,2])
        self.assertTrue(all(x['reviewState']=='new' for x in result['editions']))
        self.assertFalse(result['liveStatus']);self.assertNotIn('canary',encoded);self.assertNotIn(self.pin,encoded)
    def test_candidate_or_native_scope_change_cannot_look_checked(self):
        for key,value in (('candidateSha256','b'*64),('realReports',False),('privateReports',True),
            ('primaryChanged',True),('liveIntakeEnabled',True),('contactCollected',True),('temporaryAccountsRetired',False)):
            with self.subTest(key=key):
                old=self.receipt[key];self.receipt[key]=value
                with self.assertRaises(ValueError):self.checked()
                self.receipt[key]=old
    def test_missing_duplicate_or_prior_claim_refusal_is_not_a_checked_result(self):
        original=deepcopy(self.receipt)
        for label in ('current_source_withdrawn','withdrawn_source_with_matching_pin','stale_first_publication','old_claim_on_successor'):
            self.receipt=deepcopy(original);self.receipt['phases'][1]['denials'].remove(label)
            with self.subTest(label=label),self.assertRaises(ValueError):self.checked()
        self.receipt=deepcopy(original);self.receipt['phases'][0]['denials']*=2
        with self.assertRaises(ValueError):self.checked()
    def test_editions_order_counts_and_public_effects_are_exact(self):
        original=deepcopy(self.receipt)
        for key,value in (('revision','1'),('reportsAdded',True),('phase','successor'),('publicContentChangedByReports',True)):
            self.receipt=deepcopy(original);self.receipt['phases'][0][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):self.checked()
        self.receipt=deepcopy(original);self.receipt['phases'].reverse()
        with self.assertRaises(ValueError):self.checked()


if __name__=='__main__':unittest.main()
