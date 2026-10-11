"""No worker claim can substitute trusted native observations or approval."""
from base64 import b64encode
from copy import deepcopy
import unittest
from workers.ssb_private_collector_result import validate_private_collector_result,OPERATIONS


class PrivateCollectorResultTests(unittest.TestCase):
    def setUp(self):
        self.launch={'schemaVersion':1,'sourceFingerprint':'a'*64,'archiveSha256':'b'*64,'contextSha256':'c'*64,
            'sealedSource':True,'sealedTransportChildren':2,'repositoryCodeReopened':False}
        self.times={'metadataRetrievedAt':'2026-10-02T07:00:00+00:00','dataRetrievedAt':'2026-10-02T07:00:01+00:00'}
        self.receipts={'read_pair_checkpoint':b'{"state":"pending"}','read_closeout':b'{"state":"partial"}'}
        self.payload={'schemaVersion':1,'evidenceKind':'private_collector_pending_worker_result',**self.times,
            'canonicalManifest':'fixed-native-manifest','checkpoint':b64encode(self.receipts['read_pair_checkpoint']).decode(),
            'closeout':b64encode(self.receipts['read_closeout']).decode(),'operations':16,'completedResponseChildren':2,
            'responseKinds':['metadata','data'],
            'databaseClientPresent':False,'sourcePermissionIssued':False,'publicQualificationIssued':False,
            'publicationEnabled':False,'launchReceipt':self.launch}

    def check(self,payload=None,**changes):
        kwargs={'expected_launch_receipt':self.launch,'canonical':'fixed-native-manifest','calls':OPERATIONS,
            'failures':[],'committed_times':self.times,'committed_receipts':self.receipts};kwargs.update(changes)
        return validate_private_collector_result(self.payload if payload is None else payload,**kwargs)

    def test_only_exact_observed_native_bytes_and_closed_context_match(self):self.check()

    def test_worker_cannot_claim_permission_change_counts_or_add_raw_fields(self):
        for key,value in (('schemaVersion',True),('completedResponseChildren',2.0),('operations',16.0),
            ('sourcePermissionIssued',True),('publicQualificationIssued',True),('publicationEnabled',True),
            ('databaseClientPresent',True),('actualSourceRequests',2),('rawBody','private-canary')):
            with self.subTest(key=key),self.assertRaises(ValueError):self.check({**self.payload,key:value})
        with self.assertRaises(ValueError):self.check({**self.payload,'responseKinds':['data','metadata']})

    def test_receipt_substitution_coercion_and_missing_evidence_refuse(self):
        for key,value in (('sourceFingerprint','d'*64),('sealedSource',1),('sealedTransportChildren',2.0),
            ('repositoryCodeReopened',0),('schemaVersion',True),('extra','canary')):
            with self.subTest(key=key),self.assertRaises(ValueError):
                self.check({**self.payload,'launchReceipt':{**self.launch,key:value}})
        for changes in ({'calls':OPERATIONS[:-1]},{'calls':tuple(reversed(OPERATIONS))},{'failures':['refused']},
                {'committed_times':{}},{'committed_receipts':{}},{'expected_launch_receipt':{}}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):self.check(**changes)

    def test_changed_or_normalized_commit_bytes_manifest_and_times_refuse(self):
        for key,value in (('checkpoint',b64encode(b'{ "state": "pending" }').decode()),
            ('closeout',b64encode(b'{"state":"completed"}').decode()),('canonicalManifest','changed'),
            ('metadataRetrievedAt','2030-01-01T07:00:00+00:00')):
            with self.subTest(key=key),self.assertRaises(ValueError):self.check({**self.payload,key:value})


if __name__=='__main__':unittest.main()
