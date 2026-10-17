"""Resource-free lifecycle seam and terminal outcome ownership, no Docker."""
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
from types import SimpleNamespace
from pathlib import Path
from tempfile import TemporaryDirectory
from hashlib import sha256
import unittest
from unittest.mock import patch

from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres, IMAGE, LABEL
import scripts.rehearse_pdf_result_custody as m


class PdfCustodyLifecycleTests(unittest.TestCase):
    def test_commit_receipt_requires_all_native_result_fields_and_complete_marker(self):
        good = b'{}\n' + m.COMMIT_MARKER + b'\n'
        self.assertEqual(m.committed(SimpleNamespace(query=lambda statement: SimpleNamespace(stdout=good, stderr=b'', returncode=0)), 'fixed'), b'{}')
        for stdout, stderr, code in [(good, b'PRIVATE_STDERR', 0), (good, b'', 1), (b'{}\n', b'', 0)]:
            with self.assertRaises(ValueError):
                m.committed(SimpleNamespace(query=lambda statement: SimpleNamespace(stdout=stdout, stderr=stderr, returncode=code)), 'fixed')

    def test_negative_native_oracle_requires_exact_single_sqlstate_and_message(self):
        accepted = b'ERROR:  23505: invented_pdf_result_replay_conflict\nCONTEXT:  fixed invented context\nLOCATION:  fixed, fixture:1\n'
        self.assertTrue(m.matches_native_refusal(accepted, '23505', 'invented_pdf_result_replay_conflict'))
        for stderr in [b'ERROR:  42601: syntax error at or near bad\n', b'ERROR:  23505: unrelated unique constraint\n',
                       accepted + b'ERROR:  22012: division by zero\n', b'PRIVATE_FAILURE', b'x' * 4097, b'\xff']:
            self.assertFalse(m.matches_native_refusal(stderr, '23505', 'invented_pdf_result_replay_conflict'))

    def test_archive_export_uses_only_owned_identity_fixed_schema_and_preserves_exact_bytes(self):
        with TemporaryDirectory() as directory:
            events=[]; records=[]; raw=b'PGDMP' + bytes(range(256))
            trial=SimpleNamespace(identity='a'*64, proof=Path(directory), frozen={m.FIXTURE:b'invented independent input'},
                inspect=lambda: events.append('inspect'), record=lambda name,value: records.append((name,value)))
            def run(args):
                events.append('run')
                self.assertEqual(args,['docker','exec','a'*64,m.BIN+'pg_dump','-h','/tmp','-U','postgres','-d','postgres','--format=custom','--schema=tf_pdf_result_rehearsal','--no-comments'])
                return SimpleNamespace(returncode=0,stdout=raw,stderr=b'')
            trial.run=run
            with patch('subprocess.Popen',side_effect=AssertionError('No process')) as process:
                record=m.export_archive(trial);process.assert_not_called()
            self.assertEqual(events,['inspect','run']);self.assertEqual((Path(directory)/'PDF_RESULT_ARCHIVE.dump').read_bytes(),raw)
            self.assertEqual(record['sha256'],sha256(raw).hexdigest());self.assertFalse(record['restored'])
            self.assertEqual((Path(directory)/'PDF_RESULT_ARCHIVE.dump').stat().st_mode & 0o777,0o600)
            with self.assertRaises(FileExistsError):m.export_archive(trial)

    def test_archive_export_refuses_nonzero_stderr_nonarchive_and_overflow_before_adoption(self):
        for code,raw,err in [(1,b'PGDMP',b''),(0,b'PGDMP',b'PRIVATE_STDERR'),(0,b'not an archive',b''),(0,b'PGDMP'+b'x'*131072,b'')]:
            with TemporaryDirectory() as directory:
                trial=SimpleNamespace(identity='a'*64,proof=Path(directory),frozen={m.FIXTURE:b'invented'},
                    inspect=lambda:None,run=lambda args:SimpleNamespace(returncode=code,stdout=raw,stderr=err))
                with self.assertRaises(ValueError):m.export_archive(trial)
                self.assertFalse((Path(directory)/'PDF_RESULT_ARCHIVE.dump').exists())

    def test_default_bootstrap_retains_exact_feed_statement(self):
        trial=object.__new__(FreshFeedPostgres);calls=[]
        trial.frozen={'tests/fixtures/invented_feed_journal.sql':b'FIXED_FEED_BOOTSTRAP;'}
        trial.query=calls.append;trial.bootstrap_schema()
        self.assertEqual(calls,["begin;set local statement_timeout='10s';set local lock_timeout='1s';FIXED_FEED_BOOTSTRAP;commit;"])

    def test_pdf_bootstrap_uses_its_fixed_frozen_schema_and_never_adopts_feed_schema(self):
        trial=object.__new__(m.FreshPdfResultPostgres);calls=[]
        trial.frozen={m.SCHEMA:b'FIXED_PDF_BOOTSTRAP;', 'tests/fixtures/invented_feed_journal.sql':b'PRIVATE_UNRELATED_FEED;'}
        trial.query=calls.append;trial.bootstrap_schema()
        self.assertEqual(calls,["begin;set local statement_timeout='10s';set local lock_timeout='1s';FIXED_PDF_BOOTSTRAP;commit;"])

    def test_actual_create_calls_only_selected_bootstrap_after_server_version(self):
        # Substitute the existing resource/SQL boundaries; execute actual create
        # wiring without launching any process or checking an old native cluster.
        for kind, fixture, expected in [(FreshFeedPostgres,'tests/fixtures/invented_feed_journal.sql','FEED_ONLY;'),
                                       (m.FreshPdfResultPostgres,m.SCHEMA,'PDF_ONLY;')]:
            with self.subTest(kind=kind.__name__):
                trial=object.__new__(kind);trial.suffix='fixture';trial.target='fixture';trial.volume='fixture_data';trial.initializer='fixture_init'
                trial.frozen={fixture:expected.encode()};trial.creation_attempted=False;trial.initializer_attempted=False
                calls=[]
                trial.verify_sources=lambda label:calls.append(('verify',label))
                trial.record=lambda label,value:calls.append(('record',label))
                trial.stop_initializer=lambda:calls.append(('initializer_stop',None))
                trial.inspect=lambda:{'running':False}
                trial.start=lambda:calls.append(('start',None))
                def query(statement):
                    calls.append(('sql',statement));return SimpleNamespace(stdout=b'17.6\n')
                trial.query=query
                def run(args,**kwargs):
                    if args[1:3]==['image','inspect']:return SimpleNamespace(stdout=(IMAGE+'\n').encode(),stderr=b'',returncode=0)
                    if args[1:3]==['container','inspect'] or args[1:3]==['volume','inspect'] and args[-2]=='{{.Name}}':
                        return SimpleNamespace(stdout=b'',stderr=b'no such resource',returncode=1)
                    if args[1:3]==['volume','inspect']:
                        return SimpleNamespace(stdout=b'{"name":"fixture_data","labels":{"'+LABEL.encode()+b'":"fixture"}}',stderr=b'',returncode=0)
                    return SimpleNamespace(stdout=('a'*64+'\n').encode(),stderr=b'',returncode=0)
                trial.run=run
                with patch('subprocess.Popen',side_effect=AssertionError('No process'))as process:
                    trial.create();process.assert_not_called()
                sql=[value for key,value in calls if key=='sql']
                self.assertEqual(sql,['show server_version;',"begin;set local statement_timeout='10s';set local lock_timeout='1s';"+expected+'commit;'])

    def invoke(self,args,**patches):
        out=StringIO();err=StringIO()
        with redirect_stdout(out),redirect_stderr(err):code=m.main(args)
        return code,out.getvalue(),err.getvalue()

    def test_help_and_invalid_arguments_never_construct_a_trial(self):
        with patch.object(m,'FreshPdfResultPostgres',side_effect=AssertionError('No resources'))as ctor:
            self.assertEqual(self.invoke(['--help'])[0],0)
            self.assertEqual(self.invoke(['--target','PRIVATE_DATABASE']), (2,'','pdf_custody_arguments_refused\n'))
            ctor.assert_not_called()

    def trial(self,*,cleanup_fail=False):
        calls=[];records=[]
        class Trial:
            proof='/tmp/invented-custody-unit-only'
            def verify_sources(self,label):calls.append(label)
            def create(self):calls.append('create')
            def stop(self):
                calls.append('stop')
                if cleanup_fail:raise RuntimeError('PRIVATE_CLEANUP')
            def stop_initializer(self):calls.append('stop_initializer')
            def record(self,name,value):calls.append(name);records.append((name,value))
        return Trial(),calls,records

    def test_failed_case_keeps_static_diagnostic_and_still_stops_owned_resources(self):
        trial,calls,records=self.trial()
        with patch.object(m,'FreshPdfResultPostgres',return_value=trial),patch.object(m,'profile'),patch.object(m,'exercise',side_effect=RuntimeError('PRIVATE_CASE')):
            self.assertEqual(self.invoke([]),(1,'','pdf_custody_trial_unavailable\n'))
        self.assertIn('stop',calls);self.assertIn('stop_initializer',calls)
        self.assertNotIn('PDF_RESULT',calls);self.assertIn('PDF_FAILURE',calls)

    def test_cleanup_failure_cannot_print_or_record_pass_and_does_not_skip_other_cleanup(self):
        trial,calls,records=self.trial(cleanup_fail=True)
        with patch.object(m,'FreshPdfResultPostgres',return_value=trial),patch.object(m,'profile'),patch.object(m,'exercise',return_value={}):
            self.assertEqual(self.invoke([]),(1,'','pdf_custody_trial_unavailable\n'))
        self.assertIn('stop_initializer',calls);self.assertNotIn('PDF_RESULT',calls)
        checks=dict((item['check'],item['status'])for name,value in records if name=='PDF_CLEANUP'for item in value)
        self.assertEqual(checks,{'cluster_stopped':'FAIL','initializer_stopped':'PASS'})

    def test_success_is_recorded_only_after_both_owned_cleanup_checks(self):
        trial,calls,records=self.trial()
        with patch.object(m,'FreshPdfResultPostgres',return_value=trial),patch.object(m,'profile'),patch.object(m,'exercise',return_value={}):
            code,out,err=self.invoke([])
        self.assertEqual(code,0);self.assertEqual(err,'');self.assertIn('"status": "PASS"',out)
        self.assertLess(calls.index('stop'),calls.index('PDF_RESULT'));self.assertLess(calls.index('stop_initializer'),calls.index('PDF_RESULT'))
        result=dict(records)['PDF_RESULT'];self.assertTrue(result['owned_resources_stopped']);self.assertFalse(result['primary_changed'])


if __name__=='__main__':unittest.main()
