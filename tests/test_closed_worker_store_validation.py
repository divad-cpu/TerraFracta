"""Independent custodian validation of unknown bytes before the native writer."""
import base64
from dataclasses import replace
from datetime import timedelta
import json
import unittest

from scripts.run_closed_pair_channel_trial import validate_store_capture
from tests import test_reserved_ssb_capture as capture_support
from tests.test_reserved_ssb_capture import contexts
from tests.test_ssb_pair_processing import META,DATA
from workers.ssb_14059_context_manifest import build_ssb_context_manifest
from workers.update_run_completion import canonical_run_manifest


class ClosedWorkerStoreValidationTests(unittest.TestCase):
    def setUp(self):
        support=capture_support.ReservedSSBTests();support.setUp();metadata,data=support.pair()
        self.requests=dict(zip(('metadata','data'),contexts(),strict=True));self.versions={'metadata':META,'data':DATA}
        self.checkpoints={kind:{'reservation':value.receipt.reservation,'dispatch':value.receipt.dispatch,'settlement':value.receipt.settlement}
            for kind,value in (('metadata',metadata),('data',data))}
        self.canonical=canonical_run_manifest(build_ssb_context_manifest(*contexts(),metadata,data,META,DATA).manifest)
        self.args={kind:base64.b64encode(value.capture.body).decode() for kind,value in (('metadata',metadata),('data',data))}
        self.args.update(metadataRetrievedAt=metadata.capture.retrieved_at.isoformat(),dataRetrievedAt=data.capture.retrieved_at.isoformat(),manifest=self.canonical)

    def validate(self,args,**options):
        return validate_store_capture(args,options.get('requests',self.requests),self.versions,options.get('checkpoints',self.checkpoints))

    def test_unknown_but_semantically_checked_bytes_match_independent_native_receipts(self):
        result=self.validate(self.args)
        self.assertEqual(canonical_run_manifest(result.manifest),self.canonical)
        self.assertEqual(result.attention_reasons,('first_response_pair',))
        self.assertEqual(result.manifest.mode,'shadow')

    def test_changed_valid_body_bad_shape_or_changed_manifest_never_reaches_native_store(self):
        body=json.loads(base64.b64decode(self.args['data']));body['value'][0]=7.7
        changed=json.dumps(body,separators=(',',':')).encode()
        malformed=json.loads(base64.b64decode(self.args['data']));malformed['size']=[True,3,2]
        for changes in ({'data':base64.b64encode(changed).decode()},
                        {'data':base64.b64encode(json.dumps(malformed).encode()).decode()},
                        {'manifest':'{}'},{'sql':'select 1'},{'data':base64.b64encode(b'{broken').decode()}):
            with self.subTest(changes=tuple(changes)),self.assertRaises(ValueError): self.validate({**self.args,**changes})

    def test_future_capture_missing_measurement_or_substituted_native_hash_refuses(self):
        settlement=self.checkpoints['data']['settlement']
        checkpoints={kind:dict(value) for kind,value in self.checkpoints.items()}
        checkpoints['data']['settlement']=replace(settlement,content_sha256='0'*64)
        with self.assertRaises(ValueError):self.validate(self.args,checkpoints=checkpoints)
        late=(settlement.settled_at+timedelta(seconds=1)).isoformat()
        with self.assertRaises(ValueError):self.validate({**self.args,'dataRetrievedAt':late})
        with self.assertRaises((KeyError,ValueError)):self.validate(self.args,checkpoints={'metadata':self.checkpoints['metadata'],'data':{}})

    def test_roles_reservation_chronology_and_registration_cannot_be_relabelled(self):
        altered={kind:dict(value) for kind,value in self.checkpoints.items()}
        altered['data']['dispatch']=replace(altered['data']['dispatch'],reservation_id=META)
        with self.assertRaises(ValueError):self.validate(self.args,checkpoints=altered)
        altered_requests={**self.requests,'data':replace(self.requests['data'],registration_id=self.requests['metadata'].registration_id)}
        with self.assertRaises(ValueError):self.validate(self.args,requests=altered_requests)
        earlier=(self.checkpoints['metadata']['reservation'].reserved_at-timedelta(seconds=1)).isoformat()
        with self.assertRaises(ValueError):self.validate({**self.args,'metadataRetrievedAt':earlier})

if __name__=='__main__':unittest.main()
