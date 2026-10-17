"""Resource-free new preparation lifecycle contracts; no native old replay."""
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from io import StringIO
from contextlib import redirect_stderr
import json,unittest
from unittest.mock import patch
import scripts.rehearse_pdf_preparation_custody as m


class PdfPreparationCustodyScopeTests(unittest.TestCase):
    def test_arguments_refuse_before_constructor_or_resources(self):
        with patch.object(m.sys,'argv',['trial','existing-target']),patch.object(m,'FreshPdfPreparation')as ctor,redirect_stderr(StringIO()):
            self.assertEqual(m.main(),2);ctor.assert_not_called()
    def test_bootstrap_installs_only_exact_two_declared_frozen_ddls(self):
        trial=object.__new__(m.FreshPdfPreparation);trial.frozen={m.custody.SCHEMA:b'OLD_RESULT;',m.SCHEMA:b'NEW_PREPARATION;','tests/fixtures/invented_feed_journal.sql':b'UNRELATED;'};seen=[];trial.query=seen.append;trial.bootstrap_schema()
        self.assertEqual(seen,["begin;set local statement_timeout='10s';set local lock_timeout='1s';OLD_RESULT;NEW_PREPARATION;commit;"])
    def test_source_closure_captures_aliases_relative_modules_and_package_initializers(self):
        with TemporaryDirectory()as directory:
            root=Path(directory);(root/'pkg').mkdir();(root/'pkg/deeper').mkdir()
            values={'entry.py':'from pkg import module as alias\n','pkg/__init__.py':'','pkg/module.py':'from .deeper import leaf\n','pkg/deeper/__init__.py':'','pkg/deeper/leaf.py':'from .. import other\n','pkg/other.py':'VALUE=1\n'}
            for name,text in values.items():(root/name).write_text(text)
            with patch.object(m,'ROOT',root):self.assertEqual(m.project_closure({'entry.py'}),set(values))
    def test_noncanonical_source_seeds_refuse_before_external_read(self):
        for path in ['../PRIVATE','/PRIVATE','x/../PRIVATE']:
            with self.assertRaises(ValueError):m.project_closure({path})
    def test_freeze_requires_pre_resource_phase(self):
        for changes in [dict(counter=1),dict(identity='owned'),dict(creation_attempted=True),dict(initializer_attempted=True)]:
            data=dict(counter=0,identity=None,creation_attempted=False,initializer_attempted=False);data.update(changes)
            with patch.object(m,'project_closure',side_effect=AssertionError('No sourcewalk'))as walk:
                with self.assertRaises(m.custody.FeedPgTrialError):m.freeze_preparation(SimpleNamespace(**data))
                walk.assert_not_called()
    def test_freeze_binds_string_worker_parent_guard_lock_and_own_sources(self):
        with TemporaryDirectory()as directory:
            root=Path(directory);rows=[]
            trial=SimpleNamespace(counter=0,identity=None,creation_attempted=False,initializer_attempted=False,frozen={},proof=root,source_bindings=[],record=lambda name,value:rows.append((name,value)))
            with patch('subprocess.Popen',side_effect=AssertionError('No resources'))as child:m.freeze_preparation(trial);child.assert_not_called()
            for name in [m.ENTRY,m.SCHEMA,m.TEST,'workers/_pdf_text_worker.py','workers/native_parent_guard.py','pyproject.toml','uv.lock','workers/pdf_preparation_postgres.py']:
                self.assertIn(name,trial.frozen);self.assertEqual((root/'inputs'/name).read_bytes(),(m.ROOT/name).read_bytes());self.assertEqual((root/'inputs'/name).stat().st_mode&0o777,0o600)
            self.assertEqual(rows[0][0],'PDF_PREPARATION_SOURCE_BINDINGS');self.assertEqual(len(trial.source_bindings),len(trial.frozen))
    def test_direct_store_uses_only_two_encoded_operands_and_fixed_transaction(self):
        value=m.direct(b"PRIVATE';drop schema public;--",b'portable')
        self.assertIn('begin isolation level read committed read write;select tf_pdf_result_rehearsal.store_preparation(decode(',value)
        self.assertNotIn('drop schema',value);self.assertTrue(value.endswith('commit;\n\\echo '+m.COMMIT_MARKER.decode()+'\n'))
        with self.assertRaises(ValueError):m.direct(b'x'*294912,b'p')
    def test_negative_oracle_requires_nonzero_exact_error_absent_commit_and_both_rows_unchanged(self):
        before={'results':[['original']],'preparations':[['original']]};error=b'ERROR:  23505: invented_pdf_preparation_replay_conflict\n'
        def trial(code=1,stderr=error,stdout=b''):
            return SimpleNamespace(query=lambda *a,**kw:SimpleNamespace(returncode=code,stderr=stderr,stdout=stdout))
        with patch.object(m,'fingerprints',return_value=before):
            self.assertEqual(m.refusal(trial(),'fixed','23505','invented_pdf_preparation_replay_conflict',before)['rowsUnchanged'],True)
            for t in [trial(code=0),trial(stderr=b'ERROR:  42601: syntax error\n'),trial(stdout=m.COMMIT_MARKER)]:
                with self.assertRaises(m.custody.FeedPgTrialError):m.refusal(t,'fixed','23505','invented_pdf_preparation_replay_conflict',before)
        with patch.object(m,'fingerprints',return_value={'results':[['changed']],'preparations':[['original']]}):
            with self.assertRaises(m.custody.FeedPgTrialError):m.refusal(trial(),'fixed','23505','invented_pdf_preparation_replay_conflict',before)
    def test_failed_lifecycle_stops_both_and_checks_final_frozen_sources(self):
        events=[];trial=SimpleNamespace(proof=Path('/tmp/invented-preparation-proof'),verify_sources=lambda label:events.append(label),create=lambda:events.append('create'),stop=lambda:events.append('stop'),stop_initializer=lambda:events.append('initializer'),record=lambda *a:None)
        with patch.object(m.sys,'argv',['trial']),patch.object(m,'FreshPdfPreparation',return_value=trial),patch.object(m,'profile',side_effect=ValueError('PRIVATE')),redirect_stderr(StringIO()):self.assertEqual(m.main(),1)
        self.assertEqual(events,['PREPARATION_BEFORE','create','stop','initializer','PREPARATION_FINAL'])
    def test_no_default_existing_target_or_native_input_selector(self):
        source=(m.ROOT/m.ENTRY).read_text();self.assertNotIn('DATABASE_URL',source);self.assertNotIn('os.environ',source);self.assertNotIn('argparse',source)
        ddl=(m.ROOT/m.SCHEMA).read_text();self.assertNotIn('create schema',ddl.lower());self.assertNotIn('drop ',ddl.lower());self.assertNotIn('security definer',ddl.lower())
        self.assertIn('references tf_pdf_result_rehearsal.results(operation_id)',ddl);self.assertIn('create index pdf_preparation_result_idx',ddl)
    def test_fresh_context_keeps_support_independent_of_untrusted_result_body(self):
        from datetime import datetime,timezone
        binding=SimpleNamespace(item_key='invented-item',source_version_id='invented-version',content_sha256='f'*64)
        expected=SimpleNamespace(operation_id='invented-result',request=SimpleNamespace(request_sha256='a'*64),output_sha256='b'*64,current=SimpleNamespace(binding=binding))
        at=datetime(2026,10,17,14,tzinfo=timezone.utc);ctx=m.context(expected,json.dumps(dict(artifact_id='new-native-identity',proposal='UNTRUSTED_MODEL_COMMAND')).encode(),at)
        self.assertEqual(ctx['artifact']['artifact_id'],'new-native-identity');self.assertEqual(ctx['support']['assignment_state'],'proposed_only');self.assertNotIn('UNTRUSTED_MODEL_COMMAND',json.dumps(ctx))
        self.assertEqual(ctx['support']['assertion'],'An entirely invented condition requires independent editorial verification.')
        self.assertIsNone(ctx['issue']['head']['publication_id']);self.assertEqual(ctx['content']['review_date_basis'],'independently_supplied_not_inferred')

if __name__=='__main__':unittest.main()
