"""New receiver causal scopes: fake resource boundaries only, no native process."""
import base64
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from dataclasses import fields, replace
from datetime import timedelta
from hashlib import sha256
from io import StringIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import scripts.rehearse_pdf_result_custody_restore as m
import workers.pdf_result_custody as custody
from workers.feed_postgres_contract import COMMIT_MARKER
from workers.passage_extraction_request import _canonical
from workers.pdf_passage_binding import _stamp

ARTIFACT = '40000000-0000-4000-8000-000000000001'


def supplied():
    # Read one retained invented input; no fixture methods or PDF producer runs.
    independent = (m.ROOT / 'fixtures/fictional-pdf-result-review-input.json').read_bytes()
    packet, expected, illustrative = m._decode(independent)
    stored = expected.prepared_at + timedelta(seconds=1)
    intent = custody._intent(packet, expected)
    receipt = dict(schema_version=1, kind=custody.RECEIPT_KIND,
        operation_id=expected.operation_id, artifact_id=ARTIFACT, stored_at=_stamp(stored),
        intent_base64=base64.b64encode(intent).decode(), packet_base64=base64.b64encode(packet).decode(),
        intent_sha256=sha256(intent).hexdigest(), packet_sha256=sha256(packet).hexdigest(),
        intent_bytes=len(intent), packet_bytes=len(packet))
    profile = dict(schemas=['tf_pdf_result_rehearsal'], schema_owner='postgres', table_owner='postgres',
        rls=True, policies=0, public_grants=0,
        functions=[dict(name=n, owner='postgres', definer=False, config=['search_path=pg_catalog'])
                   for n in ('refuse_mutation', 'result_receipt', 'store_result')])
    rows = [dict(operation_id=expected.operation_id, artifact_id=ARTIFACT,
        stored_at=stored.isoformat(), intent_sha256=sha256(intent).hexdigest(),
        packet_sha256=sha256(packet).hexdigest())]
    archive = b'PGDMP' + b'INVENTED_FAKE_ARCHIVE_NO_DATABASE'
    inputs = m.PdfCustodyRestoreInputs(archive, sha256(archive).hexdigest(), independent,
        intent, _canonical(receipt), _canonical(profile), _canonical(rows))
    return inputs, packet, expected, stored, illustrative


class FakeTrial:
    def __init__(self, path, inputs, *, code=0, stdout=b'', stderr=b'', cleanup_fail=False):
        self.proof = path; self.identity = 'a' * 64
        self.inputs = inputs; self.events = []; self.records = {}
        self.code = code; self.stdout = stdout; self.stderr = stderr; self.cleanup_fail = cleanup_fail
        self.counter = 0; self.creation_attempted = False; self.initializer_attempted = False
        self.source_hook = lambda label: None
    def record(self, name, value):
        if name in self.records: raise FileExistsError
        self.events.append(name); self.records[name] = value
    def verify_sources(self, label):
        self.events.append(label); self.source_hook(label)
    def create(self): self.events.append('create')
    def inspect(self): self.events.append('inspect'); return {'running': True}
    def run(self, args, *, payload):
        self.events.append(('restore', args, payload))
        return SimpleNamespace(returncode=self.code, stdout=self.stdout, stderr=self.stderr)
    def query(self, statement):
        self.events.append(('query', statement))
        return SimpleNamespace(returncode=0, stderr=b'', stdout=self.inputs.source_receipt+b'\n'+COMMIT_MARKER+b'\n')
    def stop(self):
        self.events.append('stop')
        if self.cleanup_fail: raise RuntimeError('PRIVATE_STOP_FAILURE')
    def stop_initializer(self): self.events.append('stop_initializer')


class PdfCustodyRestoreScopeTests(unittest.TestCase):
    @contextmanager
    def no_processes(self):
        with patch('subprocess.Popen', side_effect=AssertionError('No process')) as process, \
                patch('subprocess.run', side_effect=AssertionError('No process')) as run:
            yield
            process.assert_not_called(); run.assert_not_called()

    @contextmanager
    def supplied_core(self, inputs=None):
        data, packet, expected, stored, illustrative = supplied()
        # Preserve actual custody receipt/intent validation, replace only PDF
        # rederivation (already qualified separately; no children in this scope).
        with self.no_processes(), patch.object(m, '_now', return_value=stored+timedelta(seconds=1)), \
                patch.object(custody, 'reopen_pdf_result_packet',
                    return_value=SimpleNamespace(context=None)) as core:
            yield data if inputs is None else inputs, core

    @contextmanager
    def receiver(self, **kwargs):
        inputs, packet, expected, stored, illustrative = supplied()
        with TemporaryDirectory() as directory:
            trial = FakeTrial(Path(directory), inputs, **kwargs)
            value = json.loads(inputs.source_profile_raw)
            def observed(adapter):
                adapter.record('PDF_PROFILE', value)
                return json.loads(_canonical(value))
            with self.supplied_core(), patch.object(m, 'FreshPdfCustodyReceiver', return_value=trial) as ctor, \
                    patch.object(m, 'profile', side_effect=observed) as profile, \
                    patch.object(m, 'fingerprint', side_effect=lambda trial: json.loads(inputs.source_rows_raw)) as rows:
                yield inputs, trial, ctor, profile, rows

    def refusal(self, action):
        with self.assertRaisesRegex(m.FeedPgTrialError, '^'+m.CODE+'$') as caught:
            action()
        self.assertIsNone(caught.exception.__cause__)

    def test_default_help_and_foreign_parameters_do_not_construct_or_rederive(self):
        with self.no_processes(), patch.object(m, 'FreshPdfCustodyReceiver') as ctor, \
                patch.object(m, '_preflight') as preflight:
            for args, code in [([], 2), (['--help'], 0), (['--target', 'PRIVATE_TARGET'], 2),
                               (['/tmp/archive.dump'], 2), (['--archive'], 2)]:
                out = StringIO(); err = StringIO()
                with redirect_stdout(out), redirect_stderr(err):
                    self.assertEqual(m.main(args), code)
                self.assertNotIn('PRIVATE_TARGET', out.getvalue()+err.getvalue())
            self.assertIsNone(m.OPERANDS); ctor.assert_not_called(); preflight.assert_not_called()

    def test_caps_types_archive_signature_hash_and_closed_namespace_before_constructor(self):
        inputs, *_ = supplied()
        wrong = [None, vars(inputs), replace(inputs, archive=b'notarchive'),
                 replace(inputs, archive_sha256='f'*64), replace(inputs, archive_sha256=True)]
        for key, cap in m.LIMITS.items():
            wrong += [replace(inputs, **{key:b''}), replace(inputs, **{key:b'x'*(cap+1)}),
                      replace(inputs, **{key:bytearray(b'PRIVATE')})]
        foreign = replace(inputs); object.__setattr__(foreign, 'foreign', 'PRIVATE_EXTRA'); wrong.append(foreign)
        class UnknownKey:
            def __hash__(self): return 123
            def __eq__(self, other): raise AssertionError('No key hook')
        foreign = replace(inputs); key=UnknownKey(); vars(foreign)[key]='PRIVATE'; wrong.append(foreign)
        with self.no_processes(), patch.object(m, 'FreshPdfCustodyReceiver') as ctor, \
                patch.object(m, 'reopen_pdf_result_custody') as core:
            for bad in wrong:
                with self.subTest(type=type(bad).__name__): self.refusal(lambda:m.run_restore(bad))
            ctor.assert_not_called(); core.assert_not_called()

    def test_closed_profile_rows_duplicates_nonfinite_and_boolean_integer_aliases_refuse(self):
        inputs, *_ = supplied()
        malformed = [b'{}', b'[]', b'{"x":NaN}', b'{"rls":true,"rls":true}', b'\xff']
        cases = [replace(inputs, source_profile_raw=raw) for raw in malformed]
        for key, value in [('rls',1), ('policies',False), ('public_grants',False), ('foreign','PRIVATE')]:
            profile=json.loads(inputs.source_profile_raw);profile[key]=value
            cases.append(replace(inputs, source_profile_raw=_canonical(profile)))
        for raw in malformed+[b'[{},{}]']:
            cases.append(replace(inputs, source_rows_raw=raw))
        row=json.loads(inputs.source_rows_raw); row[0]['packet_sha256']=False
        cases.append(replace(inputs, source_rows_raw=_canonical(row)))
        with self.no_processes(), patch.object(m, 'FreshPdfCustodyReceiver') as ctor, \
                patch.object(m, 'reopen_pdf_result_custody') as core:
            for value in cases: self.refusal(lambda:m.run_restore(value))
            ctor.assert_not_called(); core.assert_not_called()

    def test_independent_expected_and_receipt_joins_refuse_before_constructor(self):
        inputs, packet, expected, stored, _ = supplied()
        value=json.loads(inputs.independent_input_raw)
        no_expected=dict(value); no_expected.pop('expected')
        changed=dict(value);changed['result_packet_base64']=base64.b64encode(packet+b' ').decode()
        cases=[replace(inputs, independent_input_raw=_canonical(no_expected)),
               replace(inputs, independent_input_raw=_canonical(changed)),
               replace(inputs, intent_raw=b'{}'), replace(inputs, source_receipt=b'{}')]
        for key, item in [('operation_id','40000000-0000-4000-8000-000000000003'),
                          ('artifact_id','40000000-0000-4000-8000-000000000002'),
                          ('packet_sha256','f'*64), ('intent_sha256','e'*64),
                          ('stored_at',(stored+timedelta(seconds=1)).isoformat())]:
            rows=json.loads(inputs.source_rows_raw); rows[0][key]=item
            cases.append(replace(inputs, source_rows_raw=_canonical(rows)))
        with self.supplied_core(), patch.object(m, 'FreshPdfCustodyReceiver') as ctor:
            for value in cases: self.refusal(lambda:m.run_restore(value))
            ctor.assert_not_called()

    def test_preflight_uses_actual_clock_not_example_future_and_copies_all_operands_before_core(self):
        inputs, packet, expected, stored, illustrative = supplied()
        at=stored+timedelta(seconds=1); self.assertNotEqual(at, illustrative)
        actual=m.reopen_pdf_result_custody; clocks=[]
        def reopen(*args, **kwargs):
            clocks.append(kwargs['observed_at'])
            object.__setattr__(inputs, 'archive', b'PRIVATE_MUTATION')
            object.__setattr__(inputs, 'intent_raw', b'PRIVATE_MUTATION')
            object.__setattr__(inputs, 'source_rows_raw', b'PRIVATE_MUTATION')
            return actual(*args, **kwargs)
        with self.supplied_core(), patch.object(m, 'reopen_pdf_result_custody', side_effect=reopen):
            captured=m._preflight(inputs)
        self.assertEqual(clocks,[at]);self.assertTrue(captured.archive.startswith(b'PGDMP'))
        self.assertNotEqual(captured.intent_raw,b'PRIVATE_MUTATION');self.assertEqual(len(json.loads(captured.source_rows_raw)),1)
        self.assertNotIn('INVENTED_FAKE_ARCHIVE',repr(captured));self.assertNotIn('base64',repr(captured))

    def test_empty_bootstrap_installs_no_feed_or_pdf_schema(self):
        for stdout, code, err, good in [(b'0\n',0,b'',True),(b'1\n',0,b'',False),
                                       (b'0\n',1,b'',False),(b'0\n',0,b'PRIVATE',False),
                                       (b'false\n',0,b'',False)]:
            trial=object.__new__(m.FreshPdfCustodyReceiver);calls=[];records=[]
            trial.query=lambda sql:(calls.append(sql) or SimpleNamespace(stdout=stdout,stderr=err,returncode=code))
            trial.record=lambda name,value:records.append((name,value))
            with self.no_processes():
                if good:trial.bootstrap_schema()
                else:self.refusal(trial.bootstrap_schema)
            self.assertEqual(len(calls),1);self.assertIn('repeatable read read only',calls[0])
            for forbidden in ['create schema','create table','store_result','tf_feed_rehearsal']:
                self.assertNotIn(forbidden,calls[0].lower())
            self.assertEqual(bool(records),good)

    def test_success_restores_only_owned_identity_and_preserves_exact_original_receipt_replay(self):
        with self.receiver() as (inputs,trial,ctor,profiles,rows):
            value=m.run_restore(inputs)
            self.assertEqual(value['status'],'PASS');self.assertEqual(profiles.call_count,2);self.assertEqual(rows.call_count,2)
            restore=[e for e in trial.events if type(e)is tuple and e[0]=='restore']
            self.assertEqual(restore,[('restore',['docker','exec','-i','a'*64,m.BIN+'pg_restore',
                '-h','/tmp','-U','postgres','-d','postgres','--exit-on-error','--single-transaction'],inputs.archive)])
            queries=[e[1] for e in trial.events if type(e)is tuple and e[0]=='query']
            self.assertEqual(len(queries),2);self.assertIn('repeatable read read only',queries[0])
            self.assertIn('read committed read write',queries[1]);self.assertIn('store_result',queries[1])
            self.assertLess(trial.events.index('stop'),trial.events.index('PDF_RESTORE_RESULT'))
            self.assertLess(trial.events.index('stop_initializer'),trial.events.index('PDF_RESTORE_RESULT'))
            self.assertEqual(value['independent_intent_refusals'],2)
            for key in ('primary_changed','source_authenticated','storage_operationally_qualified',
                        'full_catalogue_equivalence','populated_restore_rollback_qualified','offhost_recovery_qualified'):
                self.assertIs(value[key],False)
            self.assertEqual((trial.proof/'PDF_RESTORED_FULL_RECEIPT.json').read_bytes(),inputs.source_receipt)
            operands=list((trial.proof/'restore-operands').iterdir());self.assertEqual(len(operands),7)
            self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in operands))
            self.assertEqual((trial.proof/'restore-operands').stat().st_mode & 0o777,0o700)
            self.assertEqual(trial.records['PDF_RESTORE_OPERANDS'][0]['sha256'],inputs.archive_sha256)
            self.assertIn('PDF_RESTORE_AFTER_CLEANUP',trial.events)

    def test_restore_exit_stderr_stdout_failure_still_cleans_and_never_reads_or_passes(self):
        for kwargs in [dict(code=1),dict(stderr=b'PRIVATE_RESTORE_ERROR'),dict(stdout=b'PRIVATE_UNEXPECTED')]:
            with self.receiver(**kwargs) as (inputs,trial,ctor,profiles,rows):
                self.refusal(lambda:m.run_restore(inputs))
                profiles.assert_not_called();rows.assert_not_called()
                self.assertFalse(any(type(e)is tuple and e[0]=='query' for e in trial.events))
                self.assertIn('stop',trial.events);self.assertIn('stop_initializer',trial.events)
                self.assertNotIn('PDF_RESTORE_RESULT',trial.records);self.assertIn('PDF_RESTORE_FAILURE',trial.records)

    def test_cleanup_failure_never_returns_pass_and_attempts_both_stops(self):
        with self.receiver(cleanup_fail=True) as (inputs,trial,*_):
            self.refusal(lambda:m.run_restore(inputs))
            self.assertIn('stop_initializer',trial.events);self.assertNotIn('PDF_RESTORE_RESULT',trial.records)
            self.assertEqual(trial.records['PDF_RESTORE_CLEANUP'],[
                {'check':'cluster_stopped','status':'FAIL'},{'check':'initializer_stopped','status':'PASS'}])

    def test_source_or_frozen_operand_change_before_restore_refuses_and_stops(self):
        for kind in ('source','operand'):
            with self.receiver() as (inputs,trial,*_):
                def change(label):
                    if label=='PDF_RESTORE_BEFORE_ARCHIVE':
                        if kind=='source':raise ValueError('PRIVATE_SOURCE_CHANGED')
                        (trial.proof/'restore-operands'/'archive.bin').write_bytes(b'PRIVATE_TAMPER')
                trial.source_hook=change
                self.refusal(lambda:m.run_restore(inputs))
                self.assertFalse(any(type(e)is tuple and e[0]=='restore' for e in trial.events))
                self.assertIn('stop',trial.events);self.assertNotIn('PDF_RESTORE_RESULT',trial.records)

    def test_post_restore_profile_rows_receipt_and_exact_replay_must_all_match(self):
        for kind in ('profile_boolint','rows','receipt','replay'):
            with self.receiver() as (inputs,trial,ctor,profiles,rows):
                if kind=='profile_boolint':
                    wrong=json.loads(inputs.source_profile_raw);wrong['rls']=1;profiles.side_effect=None;profiles.return_value=wrong
                if kind=='rows':rows.side_effect=None;rows.return_value=[]
                if kind in ('receipt','replay'):
                    count=[0];original=trial.query
                    def query(sql):
                        count[0]+=1;result=original(sql)
                        if count[0]==(1 if kind=='receipt' else 2):result.stdout=b'{}\n'+COMMIT_MARKER+b'\n'
                        return result
                    trial.query=query
                self.refusal(lambda:m.run_restore(inputs))
                self.assertIn('stop',trial.events);self.assertNotIn('PDF_RESTORE_RESULT',trial.records)

    def test_freezer_inert_recursive_sources_and_canonical_mutation_detection(self):
        with TemporaryDirectory() as directory:
            root=Path(directory)/'project';root.mkdir();proof=Path(directory)/'proof';proof.mkdir();(proof/'inputs').mkdir()
            for name,raw in [(m.ENTRY,b'from workers.child import value\n'),(m.TEST,b'import workers.child\n'),('workers/child.py',b'value=1\n'),
                             ('workers/_pdf_text_worker.py',b'worker=1\n'),('pyproject.toml',b'[project]\nname="invented-restore"\n'),('uv.lock',b'version=1\n')]:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            records={};trial=SimpleNamespace(counter=0,identity=None,creation_attempted=False,initializer_attempted=False,
                proof=proof,frozen={},source_bindings=[],record=lambda n,v:records.setdefault(n,v))
            with self.no_processes(),patch.object(m,'ROOT',root):m.freeze_restore_sources(trial)
            self.assertEqual(set(trial.frozen),{m.ENTRY,m.TEST,'workers/child.py','workers/_pdf_text_worker.py','pyproject.toml','uv.lock'})
            self.assertEqual(len(records['PDF_RESTORE_SOURCE_BINDINGS']),6)
            for name,raw in trial.frozen.items():
                self.assertEqual((proof/'inputs'/name).read_bytes(),raw)
            trial.counter=1
            with patch.object(m,'ROOT',root):self.refusal(lambda:m.freeze_restore_sources(trial))
            trial.counter=0;(root/'workers/child.py').write_bytes(b'value=2\n')
            with patch.object(m,'ROOT',root):self.refusal(lambda:m.freeze_restore_sources(trial))

    def test_actual_source_verifier_refuses_changed_frozen_copy_without_a_process(self):
        from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres
        with TemporaryDirectory() as directory:
            root=Path(directory)/'project';root.mkdir();proof=Path(directory)/'proof';proof.mkdir()
            name='workers/fixed.py';raw=b'fixed=1\n'
            for base in (root,proof/'inputs'):
                path=base/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            records=[];trial=SimpleNamespace(proof=proof,frozen={name:raw},record=lambda n,v:records.append((n,v)))
            with self.no_processes(),patch('scripts.rehearse_postgres_feed_journal.ROOT',root):
                FreshFeedPostgres.verify_sources(trial,'BEFORE')
                (proof/'inputs'/name).write_bytes(b'fixed=2\n')
                with self.assertRaises(ValueError):FreshFeedPostgres.verify_sources(trial,'AFTER')
            self.assertEqual(len(records),1)

    def test_postcheck_operand_drift_and_final_receipt_record_failure_cannot_pass(self):
        for kind in ('drift','final_record'):
            with self.receiver() as (inputs,trial,*_):
                if kind=='drift':
                    def change(label):
                        if label=='PDF_RESTORE_AFTER_CHECKS':
                            (trial.proof/'restore-operands'/'intent_raw.bin').write_bytes(b'PRIVATE_CHANGED')
                    trial.source_hook=change
                else:
                    original=trial.record
                    def record(name,value):
                        if name=='PDF_RESTORE_RESULT':raise OSError('PRIVATE_FINAL_RECORD')
                        original(name,value)
                    trial.record=record
                self.refusal(lambda:m.run_restore(inputs))
                self.assertIn('stop',trial.events);self.assertIn('stop_initializer',trial.events)
                self.assertNotIn('PDF_RESTORE_RESULT',trial.records)

    def test_operand_recording_is_exclusive_and_failure_diagnostics_hide_private_bodies(self):
        with self.receiver() as (inputs,trial,*_):
            m._record_operands(trial,inputs)
            with self.assertRaises(FileExistsError):m._record_operands(trial,inputs)
        with self.no_processes(),patch.object(m,'_preflight',side_effect=RuntimeError('PRIVATE_ORIGINAL_AND_REQUEST')):
            out=StringIO();err=StringIO()
            with patch.object(m,'OPERANDS',object()),redirect_stdout(out),redirect_stderr(err):
                self.assertEqual(m.main([]),1)
            self.assertEqual(out.getvalue(),'');self.assertEqual(err.getvalue(),m.CODE+'\n')


if __name__ == '__main__':
    unittest.main()
