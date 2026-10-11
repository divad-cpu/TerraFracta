"""The public trial fixture never exports private controls or unverified data."""
from copy import deepcopy
import json
from pathlib import Path
import unittest
from scripts.export_fictional_pipeline_snapshot import build_snapshot
from scripts.captured_fictional_pipeline import PROOF


# Offline tests use a tiny retained export-proof subset rather than private
# machine paths. Source data and the expected outcome are entirely fictional.
class ExportBoundaryTests(unittest.TestCase):
    def proof(self):
        public = json.loads((Path(__file__).resolve().parents[1]/'fixtures/fictional_pipeline_snapshot.json').read_text())
        cases = []
        for entry in public['cases']:
            cases.append({'caseKey':entry['caseKey'],'finishedAt':entry['finishedAt'],'streamOpens':1,
                'runId':'private-test-placeholder','database':'private-test-placeholder','events':[],
                'counts':{**dict.fromkeys(('runs','reservations','dispatches','settlements','checks','manifests','closeouts'),1),
                    'decisions':entry['decidedItems'],'activations':entry['storedFacts'],'chargedBytes':entry['measuredBytes']},
                'summary':{'runState':entry['runState'],'commitState':entry['commitState'],'visibilityState':entry['visibilityState'],
                    'expectedItems':1,'decidedItems':entry['decidedItems'],'heldItems':entry['heldItems'],'pendingItemKeys':['fictional-item'] if entry['pendingItems'] else [],
                    'visiblePublicationIds':[],'dueSourceKeys':['fictional-source'],'coveredSourceKeys':['fictional-source'],
                    'missingSourceKeys':[],'invalidSourceKeys':[]}})
        fact=public['fact']; cases[0]['checkedProjection']={'lastEvidenceReviewOn':fact['lastEvidenceReviewOn'],
            'claims':[{'type':'condition','assertion':fact['assertion'],'periodLabel':fact['periodLabel'],
                'evidence':[{'publisher':fact['publisher'],'title':fact['title'],'url':fact['url'],'locator':fact['locator'],'retrievedAt':fact['retrievedAt']}]}]}
        cases.append({'caseKey':'inconsistent_display','deniedBeforeCommit':True,'activations':0,'activeHeads':0,'closeouts':0})
        return {'evidenceKind':'actual_owner_capture_to_processing','network':'none','actualSourceFetches':0,
            'primaryChanged':False,'authenticatedRuntimeAccepted':False,'runtimeVisibilityVerified':False,
            'observedAt':public['recordedAt'],'cases':cases}

    def test_exact_saved_cases_export_no_control_identifiers(self):
        result=build_snapshot(self.proof()); encoded=json.dumps(result)
        self.assertEqual(len(result['cases']),3)
        for field in ('runId','workClaimId','database','reservationId','private-test-placeholder'):
            self.assertNotIn(field,encoded)

    def test_runtime_or_materialized_source_substitution_cannot_export(self):
        for field,value in (('actualSourceFetches',1),('primaryChanged',True),
            ('authenticatedRuntimeAccepted',True),('runtimeVisibilityVerified',True)):
            proof=self.proof(); proof[field]=value
            with self.assertRaises(ValueError):build_snapshot(proof)
        proof=self.proof();proof['cases'][0]['checkedProjection']['claims'][0]['evidence'][0]['url']='https://example.org/other'
        with self.assertRaises(ValueError):build_snapshot(proof)

    def test_incomplete_duplicated_or_wrong_count_evidence_cannot_export(self):
        for mutation in (lambda p:p['cases'].pop(),lambda p:p['cases'].append(deepcopy(p['cases'][0])),
            lambda p:p['cases'][0]['counts'].update(dispatches=2),lambda p:p['cases'][0]['counts'].update(decisions=True)):
            proof=self.proof();mutation(proof)
            with self.assertRaises(ValueError):build_snapshot(proof)

    def test_private_unknown_fields_are_ignored_without_being_exported(self):
        proof=self.proof();proof['ownerCredential']='private-test-placeholder'
        proof['cases'][0]['rawBody']='private-test-placeholder'
        self.assertNotIn('private-test-placeholder',json.dumps(build_snapshot(proof)))


if __name__=='__main__':unittest.main()
