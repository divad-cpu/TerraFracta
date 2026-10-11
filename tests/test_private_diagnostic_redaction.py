import json
import unittest
from scripts.private_diagnostic_redaction import sanitize_docker_metadata
from scripts.private_diagnostic_redaction import closed_native_refusal_record
from types import SimpleNamespace

class DiagnosticRedactionTests(unittest.TestCase):
    def test_closed_refusal_never_retains_echoed_sql_raw_bytes_or_credentials(self):
        response=SimpleNamespace(returncode=1,stdout='fictional-raw-canary',
            stderr="LINE 1: store_pair('66696374696f6e616c2d7261772d63616e617279'); fictional-secret-canary")
        record=closed_native_refusal_record('store_pair',response)
        for canary in ('fictional-raw-canary','66696374696f6e616c2d7261772d63616e617279','fictional-secret-canary','LINE 1'):
            self.assertNotIn(canary,record)
        self.assertEqual(json.loads(record),{'state':'refused','operation':'store_pair','exitCode':1,'nativeOutputRetained':False})
    def test_closed_refusal_does_not_even_inspect_native_output(self):
        class Response:
            returncode=1
            @property
            def stderr(self):raise AssertionError('Native output inspected')
            @property
            def stdout(self):raise AssertionError('Native output inspected')
        self.assertFalse(json.loads(closed_native_refusal_record('settle_response',Response()))['nativeOutputRetained'])
    def test_closed_refusal_rejects_freeform_selectors_and_invalid_exit_codes(self):
        for operation,code in (('private-source-canary',1),('store_pair',True),('store_pair',0),('store_pair',999)):
            with self.subTest(operation=operation,code=code),self.assertRaises(ValueError):
                closed_native_refusal_record(operation,SimpleNamespace(returncode=code))
    def test_docker_credentials_are_removed_before_log_with_identity_state_preserved(self):
        raw=json.dumps([{'Image':'sha256:fictional','State':{'Running':False},'Config':{'Env':[
          'JWT_SECRET=fictional-private-jwt','POSTGRES_PASSWORD=fictional-private-password','LANG=C','OTHER_TOKEN=fictional-private-token']}}])+'\n\n'
        safe=sanitize_docker_metadata(raw)
        for secret in ('fictional-private-jwt','fictional-private-password','fictional-private-token'):self.assertNotIn(secret,safe)
        value=json.loads(safe);self.assertFalse(value[0]['State']['Running']);self.assertEqual(value[0]['Image'],'sha256:fictional')
        self.assertEqual(value[0]['Config']['Env'],['JWT_SECRET=<omitted>','POSTGRES_PASSWORD=<omitted>','LANG=C','OTHER_TOKEN=<omitted>'])
    def test_error_suffix_and_existing_redaction_are_preserved(self):
        raw='[{"Config":{"Env":["PASSWORD=fictional-secret"]}}]\n\nFictional diagnostic error\n'
        safe=sanitize_docker_metadata(raw);self.assertTrue(safe.endswith('\n\nFictional diagnostic error\n'))
        self.assertEqual(sanitize_docker_metadata(safe),safe)
    def test_nonmetadata_and_noncredential_json_are_unchanged(self):
        for raw in ('Fictional plain startup failure\n','[]\n','{"state":"failed","fields":17}\n'):
            self.assertEqual(sanitize_docker_metadata(raw),raw)

if __name__=='__main__':unittest.main()
