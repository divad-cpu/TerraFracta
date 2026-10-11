import json
from pathlib import Path
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO
from scripts import check_public_repository as guard
from scripts.check_public_repository import allowed, inspect_entries, check_inactive, check_configurations


class PublicRepositoryBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.policy = json.loads((Path(__file__).resolve().parents[1] / 'PUBLIC_REPOSITORY_POLICY.json').read_text())

    def test_original_code_and_public_guides_are_admitted(self):
        for path in ['app/about/page.tsx','src/server/public-issue-reader.ts','workers/ssb_14059.py',
                     'fixtures/fictional_update_report.json','docs/public/DEVELOPMENT.md','LICENSE']:
            with self.subTest(path=path):
                self.assertTrue(allowed(path, self.policy))

    def test_private_material_and_traversal_are_refused(self):
        for path in ['.env','src/.env.ts','CURRENT_STATE.md','README.md','research/TF003_SOURCE_AUDIT.md',
                     'fixtures/ssb_14059_jsonstat_minimal_2024_2025.json','.local-error-log/report.json',
                     'docs/TF_PROJECT_HANDOFF_20261007.md','src/../private.ts','/src/public.ts',
                     'src\\private.ts','src/./public.ts','src/raw/source.ts','tests/tmp-preservation/record.py',
                     'raw/sample.sql','tmp-preservation/record.py']:
            with self.subTest(path=path):
                self.assertFalse(allowed(path, self.policy))

    def test_force_added_private_entries_and_links_remain_refused(self):
        self.assertEqual(inspect_entries([('100644','src/model.ts'),('120000','src/link.ts'),
            ('160000','src/submodule.ts'),('100644','research/private.sql')],self.policy),
            ['src/link.ts','src/submodule.ts','research/private.sql'])

    def test_source_flags_and_schedules_cannot_be_activated(self):
        check_inactive({'sources':[{'collection_enabled':False,'auto_publication_enabled':False,'schedule':None}]})
        for value in [{'runtime_enabled':True},{'sources':[{'publication_enabled':True}]},
                      {'schedule':'weekly'},{'collection_enabled':1}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                check_inactive(value)

    def test_actual_candidate_configuration_shapes_and_missing_flags(self):
        root = Path(__file__).resolve().parents[1]
        registry = json.loads((root / 'config/source_registry.candidate.json').read_text())
        update = json.loads((root / 'config/update_policy.candidate.json').read_text())
        check_configurations(registry, update)
        for key in ('runtime_enabled', 'publication_enabled', 'schedule_enabled', 'chat_trigger_enabled'):
            for replacement in (True, None, 0):
                with self.subTest(key=key, replacement=replacement), self.assertRaises(ValueError):
                    check_configurations(registry, {**update, key: replacement})
            missing = dict(update); del missing[key]
            with self.subTest(missing=key), self.assertRaises(ValueError):
                check_configurations(registry, missing)
        with self.assertRaises(ValueError):
            check_configurations({}, update)
        with self.assertRaises(ValueError):
            check_configurations(registry, {**update, 'active_schedule': 'weekly'})
        missing = dict(update); del missing['active_schedule']
        with self.assertRaises(ValueError):
            check_configurations(registry, missing)

    def test_staged_configuration_and_policy_are_the_checked_bytes(self):
        root = Path(__file__).resolve().parents[1]
        names = ['PUBLIC_REPOSITORY_POLICY.json', 'config/source_registry.candidate.json',
                 'config/update_policy.candidate.json', 'src/public.ts']
        identifiers = {name: format(i+1, '040x') for i, name in enumerate(names)}
        raw = b''.join(('100644 ' + identifiers[name] + ' 0\t' + name + '\0').encode() for name in names)
        objects = {identifiers[name]: (root / name).read_bytes() for name in names[:3]}
        def run_index(override):
            staged = {**objects, **override}
            def output(command, **kwargs):
                if command == ['git', 'ls-files', '--stage', '-z']:
                    return raw
                self.assertEqual(command[:3], ['git', 'cat-file', 'blob'])
                return staged[command[3]]
            with patch.object(guard.subprocess, 'check_output', side_effect=output), redirect_stdout(StringIO()):
                return guard.main()
        update = json.loads(objects[identifiers[names[2]]])
        for key, value in [('runtime_enabled', True), ('chat_trigger_enabled', True), ('active_schedule', 'weekly')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                run_index({identifiers[names[2]]: json.dumps({**update, key: value}).encode()})
        self.assertEqual(run_index({}), 0)
        policy = json.loads(objects[identifiers[names[0]]])
        policy['excludedPaths'].append('src/public.ts')
        self.assertEqual(run_index({identifiers[names[0]]: json.dumps(policy).encode()}), 1)
