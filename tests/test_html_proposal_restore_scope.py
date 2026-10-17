"""Resource-free three-schema recovery composition; no archive SQL executed."""
from pathlib import Path
from types import SimpleNamespace
from hashlib import sha256
import ast,json,sys,tempfile,unittest
from unittest.mock import patch
from scripts import rehearse_html_proposal_restore as recipe


class HtmlProposalRestoreScopeTests(unittest.TestCase):
    def binding(self,raw):return recipe.ArchiveBinding('a'*64,len(raw),sha256(raw).hexdigest())
    def temp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup);return Path(temporary.name)

    def test_no_cli_target_or_archive_before_constructor(self):
        with patch.object(sys,'argv',['recipe','--archive','foreign']),patch.object(recipe,'FreshFeedPostgres') as constructor,patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.main()
        constructor.assert_not_called();process.assert_not_called()

    def test_active_freezer_holds_before_one_inherited_freeze(self):
        for key,value in [('counter',1),('identity','existing'),('creation_attempted',True),('initializer_attempted',True)]:
            trial=SimpleNamespace(counter=0,identity=None,creation_attempted=False,initializer_attempted=False);setattr(trial,key,value)
            with self.subTest(key=key),patch.object(recipe.preparation,'freeze_preparation') as inherited,patch('subprocess.Popen') as process:
                with self.assertRaises(recipe.FeedPgTrialError):recipe.freeze_restore(trial)
                inherited.assert_not_called();process.assert_not_called()

    def test_three_schema_export_retains_owners_acls_and_own_archive_binding(self):
        raw=b'-- own fixed three schema dump\n';calls=[];proof=self.temp()
        producer=SimpleNamespace(proof=proof,inspect=lambda:dict(id='a'*64),run=lambda argv:(calls.append(argv)or SimpleNamespace(returncode=0,stderr=b'',stdout=raw)),record=lambda *args:calls.append(args))
        bound=recipe.export_archive(producer);self.assertEqual(recipe.exact_archive((proof/recipe.ARCHIVE_NAME).read_bytes(),bound),raw)
        argv=calls[0];self.assertEqual(argv[:3],['docker','exec','a'*64])
        self.assertEqual({s for s in argv if s.startswith('--schema=')},{'--schema=tf_html_rehearsal','--schema=tf_html_extraction','--schema=tf_html_preparation'})
        for flag in ('--no-owner','--no-acl','--data-only','--schema-only'):self.assertNotIn(flag,argv)
        self.assertEqual(calls[1][1]['schemas'],list(recipe.SCHEMAS));self.assertTrue(calls[1][1]['ownerAndAclIncluded']);self.assertFalse(calls[1][1]['externalArchiveAccepted'])

    def test_failed_or_oversized_export_never_writes_archive(self):
        for result in [SimpleNamespace(returncode=1,stderr=b'held',stdout=b''),SimpleNamespace(returncode=0,stderr=b'warning',stdout=b'body'),SimpleNamespace(returncode=0,stderr=b'',stdout=b'x'*131073)]:
            proof=self.temp();producer=SimpleNamespace(proof=proof,inspect=lambda:dict(id='a'*64),run=lambda _:result)
            with self.assertRaises(recipe.FeedPgTrialError):recipe.export_archive(producer)
            self.assertFalse((proof/recipe.ARCHIVE_NAME).exists())

    def test_exact_six_revoke_spellings_inside_outer_transaction_before_counts(self):
        raw=b'-- own source dump\n';sql=recipe.restore_statement(raw,self.binding(raw))
        commands=('revoke all on schema tf_html_rehearsal from public;','revoke all on tf_html_rehearsal.originals from public;',
            'revoke all on schema tf_html_extraction from public;','revoke all on tf_html_extraction.results from public;',
            'revoke all on schema tf_html_preparation from public;','revoke all on tf_html_preparation.preparations from public;')
        self.assertEqual(sql.lower().count('revoke all '),6);self.assertNotIn('grant ',sql.lower())
        for command in commands:
            self.assertEqual(sql.count(command),1);self.assertLess(sql.index('begin;'),sql.index(command));self.assertLess(sql.index(raw.decode()),sql.index(command));self.assertLess(sql.index(command),sql.index(recipe.COUNTS_SQL));self.assertLess(sql.index(command),sql.index('commit;'))
        late=recipe.restore_statement(raw,self.binding(raw),late_failure=True)
        self.assertEqual(late,sql.replace('commit;\n','select 1/0;commit;\n'));self.assertTrue(sql.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))
        self.assertIn("set statement_timeout='3s';set lock_timeout='1s';",sql)
        self.assertIs(recipe.exact_archive,recipe.safety.exact_archive);self.assertEqual(recipe.MAX_ARCHIVE,131072)
        with self.assertRaises(recipe.FeedPgTrialError):recipe.restore_statement(raw+b'changed',self.binding(raw))
        with self.assertRaises(recipe.FeedPgTrialError):recipe.restore_statement(raw,self.binding(raw),late_failure=1)

    def test_foreign_source_acl_holds_before_minimal_seed_or_export(self):
        def check(label,condition):
            if condition is not True:raise recipe.FeedPgTrialError(label)
        profile=dict(schema=dict(acl=''),tables=[dict(acl='{postgres=arwdDxtm/postgres}')]);producer=SimpleNamespace(check=check)
        with patch.object(recipe.preparation,'profile',return_value=profile),patch.object(recipe.preparation.custody.original,'roles',return_value=[]),patch.object(recipe.preparation,'install_preparation'),patch.object(recipe.preparation.custody.original,'expected_profile',return_value=True),patch.object(recipe.preparation.custody,'expected_profile',return_value=True),patch.object(recipe.preparation,'expected_profile',return_value=True),patch.object(recipe.preparation,'prepare_one') as prepare,patch.object(recipe,'export_archive') as export,patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.restore_cases(producer,SimpleNamespace())
        prepare.assert_not_called();export.assert_not_called();process.assert_not_called()

    def test_corrupt_archive_never_reaches_consumer_after_source_stop_new_receiver_blank_gate(self):
        raw=b'-- own archive\n';binding=self.binding(raw);proof=self.temp();(proof/recipe.ARCHIVE_NAME).write_bytes(raw+b'corrupt');events=[]
        profile=dict(schema=dict(acl='{postgres=UC/postgres}'),tables=[dict(acl='{postgres=arwdDxtm/postgres}')]);rows=dict(feed=[0,0,0,0],html=[1,2],extraction=[1],preparation=[1])
        def check(label,condition):self.assertTrue(condition,label);events.append(label)
        producer=SimpleNamespace(proof=proof,volume='source-volume',stop=lambda:events.append('source-stop'),inspect=lambda:dict(running=False),check=check,record=lambda *args:None)
        receiver=SimpleNamespace(volume='receiver-volume',identity='b'*64,create=lambda:events.append('receiver-create'),check=check,query=lambda *args,**kwargs:self.fail('corrupt SQL consumed'))
        with patch.object(recipe.preparation,'profile',return_value=profile),patch.object(recipe.preparation.custody.original,'roles',return_value=[]),patch.object(recipe.preparation,'install_preparation'),patch.object(recipe.preparation.custody.original,'expected_profile',return_value=True),patch.object(recipe.preparation.custody,'expected_profile',return_value=True),patch.object(recipe.preparation,'expected_profile',return_value=True),patch.object(recipe.preparation,'prepare_one',return_value=('prep-selector','extraction-selector','fullsha')),patch.object(recipe.preparation,'full_rows',return_value=rows),patch.object(recipe,'export_archive',return_value=binding),patch.object(recipe,'blank_receiver',side_effect=lambda _:events.append('three-absent-gate')or True),patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.restore_cases(producer,receiver)
        self.assertLess(events.index('source-stop'),events.index('receiver-create'));self.assertLess(events.index('receiver-create'),events.index('three-absent-gate'));process.assert_not_called()

    def test_receiver_requires_all_three_absent_namespaces_and_empty_feed(self):
        empty=dict(schema=None,objects=[],tables=[],functions=[],privileges=[]);calls=[];trial=SimpleNamespace(query=lambda _:(calls.append('feed-query')or SimpleNamespace(stdout=b'[0,0,0,0]')))
        with patch.object(recipe.preparation,'profile',return_value=empty)as profiles:self.assertTrue(recipe.blank_receiver(trial));self.assertEqual([call.args[1]for call in profiles.call_args_list],list(recipe.SCHEMAS))
        with patch.object(recipe.preparation,'profile',side_effect=[empty,empty,dict(empty,objects=[{'name':'foreign'}])]):self.assertFalse(recipe.blank_receiver(trial))
        self.assertEqual(calls,['feed-query']);trial.query=lambda _:SimpleNamespace(stdout=b'[0,1,0,0]')
        with patch.object(recipe.preparation,'profile',return_value=empty):self.assertFalse(recipe.blank_receiver(trial))

    def test_cleanup_failure_still_attempts_both_new_trials_and_source_checks(self):
        events=[]
        def trial(name):
            def stop():events.append(name+'-stop');raise ValueError('fixed cleanup hold')
            return SimpleNamespace(identity=None,stop=stop,stop_initializer=lambda:events.append(name+'-initializer'),verify_sources=lambda _:events.append(name+'-source'),record=lambda *args:events.append(name+'-failure'))
        with patch.object(sys,'argv',['recipe']),patch.object(recipe,'FreshFeedPostgres',side_effect=[trial('producer'),trial('receiver')]),patch.object(recipe,'freeze_restore',side_effect=ValueError('inert freeze hold')),patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.main()
        self.assertEqual(events,['producer-failure','receiver-failure','receiver-stop','receiver-initializer','receiver-source','producer-stop','producer-initializer','producer-source']);process.assert_not_called()

    def test_second_constructor_failure_tracks_and_cleans_first_before_any_freeze(self):
        events=[];trial=SimpleNamespace(identity=None,stop=lambda:events.append('stop'),stop_initializer=lambda:events.append('initializer'),verify_sources=lambda _:events.append('source'),record=lambda *args:events.append('failure'))
        with patch.object(sys,'argv',['recipe']),patch.object(recipe,'FreshFeedPostgres',side_effect=[trial,ValueError('held constructor')]),patch.object(recipe,'freeze_restore')as freeze,patch('subprocess.Popen')as process:
            with self.assertRaises(ValueError):recipe.main()
        self.assertEqual(events,['failure','stop','initializer','source']);freeze.assert_not_called();process.assert_not_called()

    def test_freeze_and_setup_reuse_only_minimal_helpers_no_old_cases_or_env_targets(self):
        self.assertEqual(set(recipe.NEW_FILES),{'scripts/rehearse_html_proposal_restore.py','tests/test_html_proposal_restore_scope.py'})
        for name in recipe.NEW_FILES:self.assertTrue((recipe.ROOT/name).is_file())
        tree=ast.parse((recipe.ROOT/recipe.ENTRY).read_bytes());calls=[ast.unparse(node.func)for node in ast.walk(tree)if isinstance(node,ast.Call)]
        for forbidden in ('preparation.cases','safety.restore_cases','safety.freeze_restore','os.getenv','os.environ.get'):self.assertNotIn(forbidden,calls)
        self.assertIn('preparation.prepare_one',calls);self.assertIn('preparation.cold_read',calls)
        freezer=ast.unparse(next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='freeze_restore'));self.assertEqual(freezer.count('preparation.freeze_preparation(trial)'),1)
        main=ast.unparse(next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='main'));self.assertLess(main.index('freeze_restore(producer)'),main.index('producer.create()'));self.assertLess(main.index('freeze_restore(receiver)'),main.index('producer.create()'))


if __name__=='__main__':unittest.main()
