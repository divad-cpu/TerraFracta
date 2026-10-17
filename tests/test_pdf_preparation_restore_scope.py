"""New matching-receiver resource boundaries only; never native/SQL/PDF proof."""
import base64
from contextlib import contextmanager, redirect_stdout, redirect_stderr
from dataclasses import replace
from datetime import datetime, timedelta
from hashlib import sha256
from io import StringIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import scripts.rehearse_pdf_preparation_restore as m
from workers.pdf_result_custody import _intent
from workers.pdf_proposal_custody import PdfPreparationIntent
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import _json
from workers.detached_proposal_custody import DetachedProposalParts
from workers.feed_postgres_contract import COMMIT_MARKER

PREP_OP = 'c2000000-0000-4000-8000-000000000001'
PREP_ARTIFACT = 'c2000000-0000-4000-8000-000000000003'


def inputs():
    independent = (m.ROOT / m.custody.FIXTURE).read_bytes()
    packet, expected, example = m.custody._decode(independent)
    result_intent = _intent(packet, expected)
    fixture = json.loads((m.ROOT / 'fixtures/fictional-pdf-held-preparation.json').read_bytes())
    bundle = fixture['bundle']
    parts = tuple(bundle[key].encode('utf8') for key in ('payloadJson', 'selectionJson', 'provenanceJson', 'contextJson'))
    proof = json.loads(parts[2])
    result_stored = datetime.fromisoformat(proof['artifact_stored_at'])
    result_raw = _json(dict(schema_version=1, kind='invented_pdf_result_stored',
        operation_id=expected.operation_id, artifact_id=proof['artifact']['artifact_id'],
        stored_at=_stamp(result_stored), intent_base64=base64.b64encode(result_intent).decode(),
        packet_base64=base64.b64encode(packet).decode(), intent_sha256=sha256(result_intent).hexdigest(),
        packet_sha256=sha256(packet).hexdigest(), intent_bytes=len(result_intent), packet_bytes=len(packet)))
    meta = dict(schema_version=1, kind='invented_detached_pdf_proposal_preparation', operation_id=PREP_OP,
        extraction_operation_id=proof['artifact']['operation_id'], extraction_artifact_id=proof['artifact']['artifact_id'],
        extraction_request_sha256=proof['artifact']['request_sha256'], extraction_output_sha256=proof['artifact']['output_sha256'],
        prepared_at=proof['prepared_at'], **{key: sha256(raw).hexdigest() for key, raw in zip(
            ('payload_sha256', 'selection_sha256', 'provenance_sha256', 'context_raw_sha256'), parts)})
    prep_intent = _json(meta)
    portable = _json(dict(schema_version=1, kind='invented_portable_pdf_preparation',
        intent_base64=base64.b64encode(prep_intent).decode(), **{key: base64.b64encode(raw).decode() for key, raw in zip(
            ('payload_base64', 'selection_base64', 'provenance_base64', 'context_base64'), parts)}))
    prep_stored = datetime.fromisoformat(proof['prepared_at']) + timedelta(seconds=1)
    prep_raw = _json(dict(schema_version=1, kind='invented_pdf_preparation_stored', operation_id=PREP_OP,
        artifact_id=PREP_ARTIFACT, result_operation_id=expected.operation_id, stored_at=_stamp(prep_stored),
        intent_base64=base64.b64encode(prep_intent).decode(), packet_base64=base64.b64encode(portable).decode(),
        intent_sha256=sha256(prep_intent).hexdigest(), packet_sha256=sha256(portable).hexdigest(),
        intent_bytes=len(prep_intent), packet_bytes=len(portable)))
    profile = dict(schema_owner='postgres', public_schema_grants=0, schemas=['tf_pdf_result_rehearsal'],
        tables=[dict(name=n, owner='postgres', rls=True) for n in ('preparations', 'results')],
        functions=[dict(name=n, owner='postgres', definer=False, config=['search_path=pg_catalog']) for n in (
            'preparation_receipt', 'refuse_mutation', 'refuse_preparation_mutation', 'result_receipt', 'store_preparation', 'store_result')],
        policies=0, public_table_grants=0, public_function_grants=0, result_fk=1, fk_index=1, append_only_triggers=4)
    rows = dict(results=[[expected.operation_id, proof['artifact']['artifact_id'], result_stored.isoformat(),
                         sha256(result_intent).hexdigest(), sha256(packet).hexdigest()]],
        preparations=[[PREP_OP, PREP_ARTIFACT, expected.operation_id, prep_stored.isoformat(),
                       sha256(prep_intent).hexdigest(), sha256(portable).hexdigest()]])
    archive = b'PGDMP_INVENTED_FAKE_ARCHIVE_NOT_A_NATIVE_DATABASE'
    manifest = dict(kind=m.KIND, archive_sha256=sha256(archive).hexdigest(), rows=rows)
    for key, raw in dict(archive_base64=archive, result_independent_input_base64=independent,
            result_receipt_base64=result_raw, result_intent_base64=result_intent,
            preparation_receipt_base64=prep_raw, preparation_intent_base64=prep_intent,
            profile_base64=_json(profile)).items():
        manifest[key] = base64.b64encode(raw).decode()
    return m.PdfPreparationRestoreInputs(_json(manifest)), prep_stored + timedelta(days=2), parts


class FakeTrial:
    def __init__(self, path, frame, *, restore_code=0, restore_stdout=b'', restore_stderr=b'', stop_fail=False, start_fail=False):
        self.proof = path
        self.identity = 'a' * 64
        self.frame = frame
        self.events = []
        self.records = {}
        self.restore_code = restore_code
        self.restore_stdout = restore_stdout
        self.restore_stderr = restore_stderr
        self.stop_fail = stop_fail
        self.start_fail = start_fail
        self.source_hook = lambda label: None
        self.query_hook = lambda sql, raw: raw
    def record(self, name, value):
        if name in self.records:
            raise FileExistsError
        self.records[name] = value
        self.events.append(name)
    def verify_sources(self, label):
        self.events.append(label)
        self.source_hook(label.removeprefix('PDF_PREPARATION_RESTORE_'))
    def create(self):
        self.events.append('create')
    def inspect(self):
        self.events.append('inspect')
    def run(self, argv, *, payload):
        self.events.append(('restore', argv, payload))
        return SimpleNamespace(returncode=self.restore_code, stdout=self.restore_stdout, stderr=self.restore_stderr)
    def query(self, sql):
        self.events.append(('query', sql))
        name = 'preparation_receipt_base64' if 'preparation_receipt(' in sql else 'result_receipt_base64'
        raw = self.query_hook(sql, self.frame.body[name])
        return SimpleNamespace(returncode=0, stderr=b'', stdout=raw + b'\n' + COMMIT_MARKER + b'\n')
    def stop(self):
        self.events.append('stop')
        if self.stop_fail:
            raise RuntimeError('PRIVATE_STOP')
    def start(self):
        self.events.append('start')
        if self.start_fail:
            raise RuntimeError('PRIVATE_START')
    def stop_initializer(self):
        self.events.append('initializer')


class PdfPreparationRestoreScopeTests(unittest.TestCase):
    def setUp(self):
        self.process = patch('subprocess.Popen', side_effect=AssertionError('No process'))
        self.run = patch('subprocess.run', side_effect=AssertionError('No process'))
        self.popen = self.process.start()
        self.exec = self.run.start()
        self.addCleanup(self.process.stop)
        self.addCleanup(self.run.stop)
    def tearDown(self):
        self.popen.assert_not_called()
        self.exec.assert_not_called()
    def refusal(self, action):
        with self.assertRaisesRegex(m.FeedPgTrialError, '^' + m.CODE + '$') as error:
            action()
        self.assertIsNone(error.exception.__cause__)

    @contextmanager
    def core(self):
        data, at, parts = inputs()
        def cold(raw, expected, **kwargs):
            # This is the explicit fake original-rederivation boundary only.
            # Real envelope/receipt/hash/source joins above it still execute.
            packet, stored = m._receipt(raw, expected.intent)
            return SimpleNamespace(result=SimpleNamespace(parts=DetachedProposalParts(*parts)), stored=stored)
        with patch.object(m, '_now', return_value=at), patch.object(m, 'reopen_stored_pdf_preparation', side_effect=cold) as opener:
            yield data, at, opener

    @contextmanager
    def receiver(self, **changes):
        with self.core() as (data, at, opener), TemporaryDirectory() as directory:
            frame = m._admit(data)
            trial = FakeTrial(Path(directory), frame, **changes)
            with patch.object(m, 'FreshPdfPreparationReceiver', return_value=trial) as constructor, \
                    patch.object(m.producer, 'profile', return_value=_json(frame.profile)) as profile, \
                    patch.object(m.producer, 'fingerprints', return_value=frame.rows) as rows:
                yield data, trial, opener, constructor, profile, rows

    def test_main_default_help_and_foreign_arguments_refuse_before_preflight_or_constructor(self):
        self.assertIsNone(m.OPERANDS)
        with patch.object(m, '_preflight') as preflight, patch.object(m, 'FreshPdfPreparationReceiver') as constructor:
            for args, code in (([], 2), (['--help'], 0), (['--target', 'PRIVATE'], 2), (['/tmp/PRIVATE'], 2)):
                output, error = StringIO(), StringIO()
                with redirect_stdout(output), redirect_stderr(error):
                    self.assertEqual(m.main(args), code)
                self.assertNotIn('PRIVATE', output.getvalue() + error.getvalue())
            preflight.assert_not_called()
            constructor.assert_not_called()

    def test_exact_raw_dataclass_namespace_types_and_outer_bound_refuse_without_hooks(self):
        data, _, _ = inputs()
        wrong = [None, {}, data.raw, replace(data, raw=b''), replace(data, raw=b'x' * (m.MAX_INPUT_BYTES + 1)), replace(data, raw=bytearray(data.raw))]
        extra = replace(data)
        vars(extra)['foreign'] = 'PRIVATE'
        wrong.append(extra)
        hooks = []
        class Key:
            def __hash__(self):
                hooks.append('hash')
                return 3
            def __eq__(self, other):
                hooks.append('equal')
                return False
        extra = replace(data)
        vars(extra)[Key()] = 'PRIVATE'
        hooks.clear()
        wrong.append(extra)
        with patch.object(m, 'FreshPdfPreparationReceiver') as constructor, patch.object(m, '_open') as opener:
            for value in wrong:
                self.refusal(lambda: m.run_restore(value))
            constructor.assert_not_called()
            opener.assert_not_called()
        self.assertEqual(hooks, [])

    def test_manifest_closed_json_caps_signature_hash_and_canonical_base64(self):
        data, _, _ = inputs()
        original = json.loads(data.raw)
        wrong = [b'{}', b'[]', b'\xff', b'{"kind":1,"kind":2}', b'{"x":NaN}']
        for key, value in (('kind', 'foreign'), ('archive_sha256', 'f' * 64), ('foreign', 'PRIVATE')):
            wrong.append(_json(original | {key: value}))
        for key in original:
            value = dict(original)
            del value[key]
            wrong.append(_json(value))
        for key, cap in m.LIMITS.items():
            for value in ('', '!', original[key] + '=', base64.b64encode(b'x' * (cap + 1)).decode()):
                wrong.append(_json(original | {key: value}))
        foreign_archive = b'OTHER_ARCHIVE'
        wrong.append(_json(original | dict(archive_base64=base64.b64encode(foreign_archive).decode(), archive_sha256=sha256(foreign_archive).hexdigest())))
        with patch.object(m, 'FreshPdfPreparationReceiver') as constructor, patch.object(m, '_open') as opener:
            for raw in wrong:
                self.refusal(lambda: m.run_restore(m.PdfPreparationRestoreInputs(raw)))
            constructor.assert_not_called()
            opener.assert_not_called()

    def test_source_profile_and_two_row_metadata_strict_types_and_reference_joins(self):
        data, _, _ = inputs()
        original = json.loads(data.raw)
        profile = json.loads(base64.b64decode(original['profile_base64']))
        wrong = []
        for key, value in (('policies', False), ('result_fk', True), ('public_schema_grants', False), ('foreign', 'PRIVATE')):
            wrong.append(original | dict(profile_base64=base64.b64encode(_json(profile | {key: value})).decode()))
        for key, index, value in (('results', 0, PREP_OP), ('results', 1, PREP_ARTIFACT),
                ('results', 2, True), ('results', 3, False), ('preparations', 2, PREP_OP),
                ('preparations', 3, '2026-02-30T00:00:00+00:00'), ('preparations', 5, 'f' * 64)):
            altered = json.loads(data.raw)
            altered['rows'][key][0][index] = value
            wrong.append(altered)
        for value in ({}, [], dict(results=[], preparations=[]), dict(results=[original['rows']['results'][0]] * 2, preparations=original['rows']['preparations'])):
            wrong.append(original | dict(rows=value))
        with patch.object(m, 'FreshPdfPreparationReceiver') as constructor, patch.object(m, '_open') as opener:
            for value in wrong:
                self.refusal(lambda: m.run_restore(m.PdfPreparationRestoreInputs(_json(value))))
            constructor.assert_not_called()
            opener.assert_not_called()

    def test_full_result_expected_packet_receipt_and_separate_intents_required_before_constructor(self):
        data, _, _ = inputs()
        original = json.loads(data.raw)
        wrong = []
        for key in ('result_independent_input_base64', 'result_receipt_base64', 'result_intent_base64', 'preparation_receipt_base64', 'preparation_intent_base64'):
            wrong.append(original | {key: base64.b64encode(b'{}').decode()})
        independent = json.loads(base64.b64decode(original['result_independent_input_base64']))
        independent.pop('expected')
        wrong.append(original | dict(result_independent_input_base64=base64.b64encode(_json(independent)).decode()))
        receipt = json.loads(base64.b64decode(original['result_receipt_base64']))
        receipt['packet_bytes'] = True
        wrong.append(original | dict(result_receipt_base64=base64.b64encode(_json(receipt)).decode()))
        with patch.object(m, 'FreshPdfPreparationReceiver') as constructor, patch.object(m, '_open') as opener:
            for value in wrong:
                self.refusal(lambda: m.run_restore(m.PdfPreparationRestoreInputs(_json(value))))
            constructor.assert_not_called()
            opener.assert_not_called()

    def test_one_explicit_preflight_before_constructor_uses_fresh_clock_and_captured_immutable_raw(self):
        with self.core() as (data, at, opener):
            original = data.raw
            real = opener.side_effect
            def mutate(*args, **kwargs):
                vars(data)['raw'] = b'PRIVATE'
                self.assertEqual(kwargs['observed_at'], at)
                return real(*args, **kwargs)
            opener.side_effect = mutate
            captured = m._preflight(data)
            self.assertEqual(captured.raw, original)
            self.assertEqual(data.raw, b'PRIVATE')
            self.assertEqual(opener.call_count, 1)
            self.assertEqual(repr(captured), 'PdfPreparationRestoreInputs()')
        with self.core() as (data, at, opener), patch.object(m, 'FreshPdfPreparationReceiver') as constructor:
            opener.side_effect = RuntimeError('PRIVATE_ORIGINAL_UNAVAILABLE')
            self.refusal(lambda: m.run_restore(data))
            constructor.assert_not_called()

    def test_empty_target_bootstrap_installs_no_old_feed_result_or_preparation_schema(self):
        for code, stdout, stderr, valid in ((0, b'0\n', b'', True), (0, b'1\n', b'', False),
                (1, b'0\n', b'', False), (False, b'0\n', b'', False), (0, b'0\n', b'PRIVATE', False)):
            trial = object.__new__(m.FreshPdfPreparationReceiver)
            seen, records = [], []
            trial.query = lambda sql: seen.append(sql) or SimpleNamespace(returncode=code, stdout=stdout, stderr=stderr)
            trial.record = lambda name, value: records.append((name, value))
            if valid:
                trial.bootstrap_schema()
            else:
                self.refusal(trial.bootstrap_schema)
            self.assertEqual(len(seen), 1)
            for forbidden in ('create schema', 'create table', 'store_result', 'store_preparation', 'tf_feed_rehearsal'):
                self.assertNotIn(forbidden, seen[0].lower())
            self.assertEqual(bool(records), valid)

    def test_success_fake_resource_boundary_three_distinct_openings_and_exact_owned_restart(self):
        with self.receiver() as (data, trial, opener, constructor, profile, rows):
            result = m.run_restore(data)
            self.assertEqual(result['status'], 'PASS')
            self.assertEqual((opener.call_count, profile.call_count, rows.call_count), (3, 2, 2))
            self.assertEqual(len([event for event in trial.events if type(event) is tuple and event[0] == 'query']), 4)
            restore = [event for event in trial.events if type(event) is tuple and event[0] == 'restore']
            self.assertEqual(restore, [('restore', ['docker', 'exec', '-i', 'a' * 64, m.BIN + 'pg_restore',
                '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '--exit-on-error', '--single-transaction'], trial.frame.archive)])
            self.assertNotIn('--schema=', str(restore))
            self.assertEqual(trial.events.count('stop'), 2)
            self.assertEqual(trial.events.count('start'), 1)
            self.assertLess(trial.events.index('initializer'), trial.events.index('PDF_PREPARATION_RESTORE_RESULT'))
            self.assertEqual((trial.proof / 'restore-operands/manifest.json').read_bytes(), data.raw)
            self.assertEqual((trial.proof / 'restore-operands/manifest.json').stat().st_mode & 0o777, 0o600)
            for phase in ('AFTER_RESTORE', 'AFTER_RESTART'):
                self.assertEqual((trial.proof / ('PREPARATION_RESTORED_FULL_' + phase + '.json')).read_bytes(), trial.frame.body['preparation_receipt_base64'])
                self.assertEqual((trial.proof / ('PREPARATION_RESTORED_RESULT_' + phase + '.json')).read_bytes(), trial.frame.body['result_receipt_base64'])
            for name in ('source_authenticated', 'storage_operationally_qualified', 'full_catalogue_equivalence',
                         'populated_restore_rollback_qualified', 'offhost_recovery_qualified', 'primary_changed', 'capture_executed'):
                self.assertIs(result[name], False)

    def test_native_restore_failure_stops_both_and_cannot_reach_getters_or_pass(self):
        for changes in (dict(restore_code=1), dict(restore_stdout=b'PRIVATE'), dict(restore_stderr=b'PRIVATE')):
            with self.receiver(**changes) as (data, trial, opener, constructor, profile, rows):
                self.refusal(lambda: m.run_restore(data))
                self.assertEqual(opener.call_count, 1)  # Preflight only.
                profile.assert_not_called()
                rows.assert_not_called()
                self.assertFalse(any(type(event) is tuple and event[0] == 'query' for event in trial.events))
                self.assertIn('stop', trial.events)
                self.assertIn('initializer', trial.events)
                self.assertNotIn('PDF_PREPARATION_RESTORE_RESULT', trial.records)

    def test_profile_rows_and_target_full_receipt_drift_never_adopt_target_artifact_time(self):
        for kind in ('profile', 'rows', 'prep_receipt', 'result_receipt'):
            with self.receiver() as (data, trial, opener, constructor, profile, rows):
                if kind == 'profile':
                    wrong = dict(trial.frame.profile, result_fk=True)
                    profile.return_value = _json(wrong)
                if kind == 'rows':
                    rows.return_value = dict(results=[], preparations=[])
                if kind in ('prep_receipt', 'result_receipt'):
                    def query(sql, raw):
                        match = ('preparation_receipt(' in sql) if kind == 'prep_receipt' else ('result_receipt(' in sql)
                        if match:
                            value = json.loads(raw)
                            value['artifact_id'] = PREP_OP
                            return _json(value)
                        return raw
                    trial.query_hook = query
                self.refusal(lambda: m.run_restore(data))
                self.assertEqual(opener.call_count, 1)
                self.assertIn('initializer', trial.events)
                self.assertNotIn('PDF_PREPARATION_RESTORE_RESULT', trial.records)

    def test_restart_failure_and_cleanup_failure_still_attempt_both_stops_no_false_pass(self):
        for changes in (dict(stop_fail=True), dict(start_fail=True)):
            with self.receiver(**changes) as (data, trial, opener, constructor, profile, rows):
                self.refusal(lambda: m.run_restore(data))
                self.assertIn('initializer', trial.events)
                self.assertNotIn('PDF_PREPARATION_RESTORE_RESULT', trial.records)
        with self.receiver() as (data, trial, opener, constructor, profile, rows):
            old = trial.stop
            calls = [0]
            def final_stop():
                calls[0] += 1
                old()
                if calls[0] == 2:
                    raise RuntimeError('PRIVATE_FINAL_STOP')
            trial.stop = final_stop
            self.refusal(lambda: m.run_restore(data))
            self.assertEqual(opener.call_count, 3)
            self.assertIn('initializer', trial.events)
            self.assertNotIn('PDF_PREPARATION_RESTORE_RESULT', trial.records)

    def test_source_and_raw_operand_drift_before_restore_or_after_phase_fail_closed(self):
        for phase in ('BEFORE_CREATE', 'BEFORE_RESTORE', 'AFTER_RESTORE', 'AFTER_RESTART', 'AFTER_CLEANUP'):
            with self.receiver() as (data, trial, opener, constructor, profile, rows):
                def mutate(label):
                    if label == phase:
                        (trial.proof / 'restore-operands/manifest.json').write_bytes(b'PRIVATE_TAMPER')
                trial.source_hook = mutate
                self.refusal(lambda: m.run_restore(data))
                self.assertIn('initializer', trial.events)
                self.assertNotIn('PDF_PREPARATION_RESTORE_RESULT', trial.records)
        with self.receiver() as (data, trial, opener, constructor, profile, rows):
            def changed(label):
                if label == 'BEFORE_RESTORE':
                    raise RuntimeError('PRIVATE_SOURCE_CHANGED')
            trial.source_hook = changed
            self.refusal(lambda: m.run_restore(data))
            self.assertFalse(any(type(event) is tuple and event[0] == 'restore' for event in trial.events))

    def test_constructor_reuses_parent_once_and_single_alias_aware_full_freeze(self):
        seen = []
        def parent(self):
            seen.append('parent')
        with patch.object(m.custody.FreshPdfResultPostgres, '__init__', parent), patch.object(m.producer, 'freeze_preparation') as freeze:
            trial = m.FreshPdfPreparationReceiver()
        self.assertEqual(seen, ['parent'])
        freeze.assert_called_once_with(trial, extras=(m.ENTRY, m.TEST))
        with TemporaryDirectory() as directory:
            root = Path(directory) / 'project'
            proof = Path(directory) / 'proof'
            root.mkdir()
            proof.mkdir()
            seeds = {m.producer.ENTRY, m.producer.SCHEMA, m.producer.TEST, m.ENTRY, m.TEST,
                'tests/test_pdf_preparation_postgres.py', 'workers/_pdf_text_worker.py',
                'workers/native_parent_guard.py', 'pyproject.toml', 'uv.lock'}
            for name in seeds:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'')
            (root / m.ENTRY).write_text('from pkg import leaf as alias\n')
            (root / 'pkg').mkdir()
            (root / 'pkg/__init__.py').write_text('')
            (root / 'pkg/leaf.py').write_text('from . import other\n')
            (root / 'pkg/other.py').write_text('VALUE=1\n')
            trial = SimpleNamespace(counter=0, identity=None, creation_attempted=False, initializer_attempted=False,
                frozen={}, source_bindings=[], proof=proof, record=lambda name, value: seen.append((name, value)))
            with patch.object(m.producer, 'ROOT', root):
                m.producer.freeze_preparation(trial, extras=(m.ENTRY, m.TEST))
            self.assertTrue(seeds | {'pkg/__init__.py', 'pkg/leaf.py', 'pkg/other.py'} <= set(trial.frozen))
            self.assertEqual([entry[0] for entry in seen if type(entry) is tuple], ['PDF_PREPARATION_SOURCE_BINDINGS'])
            trial.counter = 1
            with patch.object(m.producer, 'ROOT', root), self.assertRaises(m.FeedPgTrialError):
                m.producer.freeze_preparation(trial, extras=(m.ENTRY, m.TEST))

    def test_exclusive_operands_and_last_record_failures_stay_private_and_cannot_pass(self):
        with self.receiver() as (data, trial, opener, constructor, profile, rows):
            m._record_operands(trial, data)
            with self.assertRaises(FileExistsError):
                m._record_operands(trial, data)
        with self.receiver() as (data, trial, opener, constructor, profile, rows):
            old = trial.record
            def record(name, value):
                if name == 'PDF_PREPARATION_RESTORE_RESULT':
                    raise RuntimeError('PRIVATE_RECORD')
                old(name, value)
            trial.record = record
            self.refusal(lambda: m.run_restore(data))
            self.assertIn('initializer', trial.events)
        output, error = StringIO(), StringIO()
        with patch.object(m, 'OPERANDS', object()), patch.object(m, '_preflight', side_effect=RuntimeError('PRIVATE_INPUT')):
            with redirect_stdout(output), redirect_stderr(error):
                self.assertEqual(m.main([]), 1)
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(error.getvalue(), m.CODE + '\n')

    def test_recipe_and_inherited_create_use_distinct_exclusive_source_check_records(self):
        class StopBeforeCommand(Exception):
            pass
        with TemporaryDirectory() as directory:
            trial = object.__new__(m.FreshPdfPreparationReceiver)
            trial.proof = Path(directory)
            trial.frozen = {}
            trial.counter = 0
            data = m.PdfPreparationRestoreInputs(b'private invented operand')
            (trial.proof / 'restore-operands').mkdir()
            (trial.proof / 'restore-operands/manifest.json').write_bytes(data.raw)
            # Exercise actual inherited source verifier and exclusive record,
            # then actual inherited create through its first command boundary.
            m._verify(trial, data, 'BEFORE_CREATE')
            with patch.object(trial, 'run', side_effect=StopBeforeCommand) as boundary:
                with self.assertRaises(StopBeforeCommand):
                    trial.create()
            boundary.assert_called_once()
            self.assertEqual(trial.counter, 0)
            names = {path.name for path in trial.proof.glob('SOURCE_CHECK_*.json')}
            self.assertEqual(names, {'SOURCE_CHECK_PDF_PREPARATION_RESTORE_BEFORE_CREATE.json',
                'SOURCE_CHECK_BEFORE_CREATE.json'})
            for name in names:
                self.assertEqual(json.loads((trial.proof / name).read_bytes()),
                    {'exactFiles': 0, 'unchanged': True})
                self.assertEqual((trial.proof / name).stat().st_mode & 0o777, 0o600)
            self.assertEqual((trial.proof / 'restore-operands/manifest.json').read_bytes(), data.raw)



if __name__ == '__main__':
    unittest.main()
