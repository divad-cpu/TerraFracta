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
        self.assertEqual(value[0]['Config']['Env'],['JWT_SECRET=<omitted>','POSTGRES_PASSWORD=<omitted>','LANG=<omitted>','OTHER_TOKEN=<omitted>'])
    def test_every_environment_value_is_omitted_without_a_credential_name_guess(self):
        assignments = [
            'DATABASE_URL=fictional-connection-canary',
            'CONNECTION_STRING=fictional-string-canary',
            'mixedCaseToken=fictional-mixed-canary',
            'ORDINARY_NAME=fictional-custom-canary',
            'LANG=fictional-language-canary',
            '_PRIVATE=fictional-leading-underscore-canary',
            'EMPTY=',
        ]
        raw = json.dumps({'Image': 'fictional-image', 'State': {'Running': False},
                          'Config': {'Env': assignments}})
        safe = sanitize_docker_metadata(raw)
        self.assertNotIn('canary', safe)
        value = json.loads(safe)
        self.assertEqual(value['Config']['Env'], [row.partition('=')[0] + '=<omitted>' for row in assignments])
        self.assertEqual(value['Image'], 'fictional-image')
        self.assertEqual(value['State'], {'Running': False})

    def test_malformed_environment_rows_are_completely_omitted_including_nested_values(self):
        rows = ['fictional-no-assignment-canary', '=fictional-empty-name-canary',
                'bad name=fictional-spaced-name-canary', 'bad.name=fictional-dotted-name-canary',
                'bad\nname=fictional-line-canary', 7, False, None,
                {'nested': 'fictional-object-canary'}, ['fictional-list-canary']]
        safe = sanitize_docker_metadata(json.dumps({'Config': {'Env': rows}}))
        self.assertNotIn('canary', safe)
        self.assertEqual(json.loads(safe)['Config']['Env'], ['<omitted>'] * len(rows))

    def test_nested_metadata_preserves_structure_and_omission_is_idempotent(self):
        source = [{'Image': 'fictional-image', 'State': {'ExitCode': 0, 'Running': False},
                   'Config': {'Env': ['UNKNOWN=fictional-private-canary']},
                   'Nested': [{'Env': ['INNER=fictional-inner-canary', '<omitted>']}]},
                  {'Other': {'label': 'ordinary metadata'}}]
        raw = json.dumps(source)
        before = json.loads(raw)
        safe = sanitize_docker_metadata(raw)
        self.assertEqual(source, before)
        self.assertEqual(json.loads(raw), before)
        expected = [{'Image': 'fictional-image', 'State': {'ExitCode': 0, 'Running': False},
                     'Config': {'Env': ['UNKNOWN=<omitted>']},
                     'Nested': [{'Env': ['INNER=<omitted>', '<omitted>']}]},
                    {'Other': {'label': 'ordinary metadata'}}]
        self.assertEqual(json.loads(safe), expected)
        self.assertEqual(sanitize_docker_metadata(safe), safe)

    def test_duplicate_json_keys_cannot_return_shadowed_environment_values(self):
        cases = [
            '{"Config":{"Env":["TOKEN=fictional-shadowed-canary"]},"Config":{"Env":["TOKEN=<omitted>"]}}',
            '{"Config":{"Env":["TOKEN=fictional-shadowed-canary"]},"Config":{}}',
            '{"Config":{"Env":["TOKEN=fictional-shadowed-canary"],"Env":["TOKEN=<omitted>"]}}',
            '[{"nested":{"Config":{"Env":["TOKEN=fictional-shadowed-canary"]},"Config":{}}}]',
            r'{"Config":{"Env":["TOKEN=fictional-shadowed-canary"],"\u0045nv":["TOKEN=<omitted>"]}}',
        ]
        for raw in cases:
            with self.subTest(case=cases.index(raw)):
                safe = sanitize_docker_metadata(raw)
                self.assertNotIn('canary', safe)
                self.assertEqual(json.loads(safe), json.loads(raw))
                self.assertNotEqual(safe, raw)
                self.assertEqual(sanitize_docker_metadata(safe), safe)

    def test_error_suffix_and_existing_redaction_are_preserved(self):
        raw='[{"Config":{"Env":["PASSWORD=fictional-secret"]}}]\n\nFictional diagnostic error\n'
        safe=sanitize_docker_metadata(raw);self.assertTrue(safe.endswith('\n\nFictional diagnostic error\n'))
        self.assertEqual(sanitize_docker_metadata(safe),safe)
    def test_nonmetadata_and_noncredential_json_are_unchanged(self):
        for raw in ('Fictional plain startup failure\n','[]\n','{"state":"failed","fields":17}\n'):
            self.assertEqual(sanitize_docker_metadata(raw),raw)

if __name__=='__main__':unittest.main()
