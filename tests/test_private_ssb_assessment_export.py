"""Dated display requires matching invented custody and held trial witnesses."""
from copy import deepcopy
import json
import unittest
from scripts.export_private_ssb_assessment import build_snapshot
from tests import test_ssb_private_assessment as support


class AssessmentExportTests(unittest.TestCase):
    def setUp(self):
        helper=support.PrivateAssessmentTests();helper.setUp()
        self.record=helper.assess();b=helper.binding
        self.binding={'schemaVersion':1,'pairId':helper.pair,'metadataVersionId':helper.versions['metadata'],
            'dataVersionId':helper.versions['data'],'metadataSha256':b.metadata_sha256,'dataSha256':b.data_sha256,
            'rawAttemptId':b.attempt_id,'storedAt':b.stored_at.isoformat(),'expiresAt':b.expires_at.isoformat(),
            'metadataRetrievedAt':b.metadata_retrieved_at.isoformat(),'dataRetrievedAt':b.data_retrieved_at.isoformat()}
        self.reconciled={'state':'matched','coordinatedPrivateRoot':True,'exactHashesAndTimesMatch':True,
            'sourceRequests':0,'liveRawRootTouched':False,'physicalExpiryGuaranteed':False}
        self.native={'evidenceKind':'actual_closed_scram_ssb_format_fixture_pair','actualSourceRequests':0,
            'primaryChanged':False,'closedWorkerBoundaryVerified':True,'rawCustodyBound':True,
            'responseHashesPreprovisioned':False,'validationState':'pending','runState':'partial',
            'modelCalls':0,'publicWriterEnabled':False,'counts':{'pairs':1,'checks':2,'bindings':1,'versions':2,'manifests':1}}
        self.source={**self.native,'temporaryAccountsRetired':True,'ownedCloneStopped':True,'sealedSourceLaunch':True}

    def snapshot(self):return build_snapshot(self.record,self.binding,self.reconciled,self.native,self.source)

    def test_matching_witnesses_export_only_two_held_years_and_fixed_meanings(self):
        result=self.snapshot();encoded=json.dumps(result)
        self.assertEqual(result['candidates'],[{'year':2024,'state':'held'},{'year':2025,'state':'held'}])
        self.assertFalse(result['liveStatus']);self.assertFalse(result['publicQualificationIssued'])
        for private in (self.record['pairId'],self.record['dataSha256'],'evidenceLocators','reasonCodes','numeric_value'):
            self.assertNotIn(private,encoded)
        self.native['privatePath']='/not-for-export-canary';self.record['candidates'][0]['reasonCodes'].append('text-canary')
        self.assertNotIn('canary',json.dumps(self.snapshot()))

    def test_custody_substitution_hash_time_and_duplicate_version_refuse(self):
        for field,value in (('dataSha256','0'*64),('pairId',True),('metadataVersionId',self.binding['dataVersionId']),
            ('expiresAt',self.binding['storedAt']),('storedAt','2026-10-03T07:00:00+00:00')):
            with self.subTest(field=field):
                old=deepcopy(self.binding);self.binding[field]=value
                with self.assertRaises(ValueError):self.snapshot()
                self.binding=old

    def test_live_public_and_failed_witnesses_cannot_export_as_this_trial(self):
        for target,field,value in ((self.record,'publicationEnabled',True),(self.record,'modelCalls',False),
            (self.record,'retainedPairMatched',False),(self.native,'actualSourceRequests',False),
            (self.native,'publicWriterEnabled',True),(self.native,'runState','completed'),
            (self.source,'ownedCloneStopped',False),(self.reconciled,'sourceRequests',1),
            (self.reconciled,'physicalExpiryGuaranteed',True)):
            with self.subTest(field=field):
                old=target[field];target[field]=value
                with self.assertRaises(ValueError):self.snapshot()
                target[field]=old

    def test_counts_float_and_bool_do_not_support_a_matching_pair(self):
        for value in (True,1.0,0):
            self.native['counts']['pairs']=value
            with self.assertRaises(ValueError):self.snapshot()

    def test_candidate_values_fields_locators_and_meanings_cannot_be_redefined(self):
        original=deepcopy(self.record)
        for field,value in (('surveyYear',2024.0),('surveyYear',2025),('machineDisposition','eligible_for_public_rule'),
            ('numericCellsIncluded',True),('responseCount',123),('dataVersionId',self.binding['metadataVersionId'])):
            self.record['candidates'][0][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):self.snapshot()
            self.record=deepcopy(original)
        self.record['heldPublicMeanings'].reverse()
        with self.assertRaises(ValueError):self.snapshot()


if __name__=='__main__':unittest.main()
