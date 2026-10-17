"""Resource-free integrity, phase and cleanup boundaries for the fixed restore."""
from dataclasses import replace
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
import json,sys,tempfile,unittest
from unittest.mock import patch
from scripts import rehearse_html_extraction_restore as recipe


class HtmlExtractionRestoreScopeTests(unittest.TestCase):
    def binding(self,raw):return recipe.ArchiveBinding('a'*64,len(raw),sha256(raw).hexdigest())

    def test_cli_refuses_before_constructor_or_process(self):
        with patch.object(sys,'argv',['recipe','--archive','foreign']),patch.object(recipe,'FreshFeedPostgres') as constructor,patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.main()
        constructor.assert_not_called();process.assert_not_called()

    def test_active_freeze_refuses_before_inherited_runtime_or_resource(self):
        for key,value in [('counter',1),('identity','existing'),('creation_attempted',True),('initializer_attempted',True)]:
            trial=SimpleNamespace(counter=0,identity=None,creation_attempted=False,initializer_attempted=False);setattr(trial,key,value)
            with self.subTest(key=key),patch.object(recipe.custody,'freeze_extraction') as inherited,patch('subprocess.Popen') as process:
                with self.assertRaises(recipe.FeedPgTrialError):recipe.freeze_restore(trial)
                inherited.assert_not_called();process.assert_not_called()

    def test_whole_archive_bytes_scope_size_hash_and_encoding_are_closed(self):
        raw=b'-- invented own archive\n';bound=self.binding(raw)
        self.assertIs(recipe.exact_archive(raw,bound),raw)
        class OtherBytes(bytes):pass
        cases=[(bytearray(raw),bound),(OtherBytes(raw),bound),(raw+b' ',bound),(raw,replace(bound,sha256='0'*64)),(raw,replace(bound,producer_identity='foreign')),
            (raw,replace(bound,bytes=True)),(raw,replace(bound,bytes=recipe.MAX_ARCHIVE+1)),(b'',self.binding(b'')),(b'\xff',self.binding(b'\xff')),(b'a\x00b',self.binding(b'a\x00b'))]
        with patch('subprocess.Popen') as process:
            for candidate,binding in cases:
                with self.subTest(candidate_type=type(candidate).__name__,size=len(candidate)):
                    with self.assertRaises(recipe.FeedPgTrialError):recipe.exact_archive(candidate,binding)
        process.assert_not_called()

    def test_export_is_own_inspected_source_two_schemas_with_owner_acl(self):
        calls=[];raw=b'-- fixed invented pg_dump\n';temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        producer=SimpleNamespace(proof=Path(temp.name),inspect=lambda:dict(id='a'*64),run=lambda argv:(calls.append(argv) or SimpleNamespace(returncode=0,stderr=b'',stdout=raw)),record=lambda *args:calls.append(args))
        binding=recipe.export_archive(producer)
        self.assertEqual(recipe.exact_archive((producer.proof/recipe.ARCHIVE_NAME).read_bytes(),binding),raw)
        argv=calls[0];self.assertEqual(argv[:3],['docker','exec','a'*64])
        self.assertEqual({arg for arg in argv if arg.startswith('--schema=')},{'--schema=tf_html_rehearsal','--schema=tf_html_extraction'})
        for forbidden in ('--no-owner','--no-acl','--data-only','--schema-only'):self.assertNotIn(forbidden,argv)
        self.assertIn('--strict-names',argv);self.assertIn('--format=p',argv)
        self.assertTrue(calls[1][1]['ownerAndAclIncluded']);self.assertFalse(calls[1][1]['externalArchiveAccepted'])

    def test_bad_export_never_creates_archive(self):
        for result in [SimpleNamespace(returncode=1,stderr=b'held',stdout=b''),SimpleNamespace(returncode=0,stderr=b'warning',stdout=b'body')]:
            temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);proof=Path(temp.name)
            producer=SimpleNamespace(proof=proof,inspect=lambda:dict(id='a'*64),run=lambda _:result)
            with self.assertRaises(recipe.FeedPgTrialError):recipe.export_archive(producer)
            self.assertFalse((proof/recipe.ARCHIVE_NAME).exists())

    def test_corruption_refuses_before_any_restore_query_after_blank_gate(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);proof=Path(temp.name);raw=b'-- own complete\n';bound=self.binding(raw)
        (proof/recipe.ARCHIVE_NAME).write_bytes(raw+b'corrupt')
        events=[];rows=dict(html=[1,2],extraction=[1],feed=[0,0,0,0]);profile=dict(safe=True,schema=dict(acl='{postgres=UC/postgres}'),tables=[dict(acl='{postgres=arwdDxtm/postgres}')])
        def check(name,value):
            self.assertTrue(value,name);events.append(name)
        producer=SimpleNamespace(proof=proof,volume='producer-volume',stop=lambda:events.append('source-stop'),inspect=lambda:dict(running=False),check=check,record=lambda *args:None)
        receiver=SimpleNamespace(identity='b'*64,volume='receiver-volume',create=lambda:events.append('receiver-create'),check=check,query=lambda *args,**kwargs:self.fail('corrupt archive reached SQL consumer'))
        with patch.object(recipe.custody,'install_extraction'),patch.object(recipe.custody,'profile',return_value=profile),patch.object(recipe.custody,'expected_profile',return_value=True),patch.object(recipe.custody.original,'expected_profile',return_value=True),patch.object(recipe.custody,'store_pair_and_result',return_value=('independent','packet-hash','receipt-hash')),patch.object(recipe.custody,'full_rows',return_value=rows),patch.object(recipe.custody.original,'roles',return_value=['roles']),patch.object(recipe,'export_archive',return_value=bound),patch.object(recipe,'blank_receiver',side_effect=lambda _:events.append('blank-gate') or True),patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.restore_cases(producer,receiver)
        self.assertLess(events.index('source-stop'),events.index('receiver-create'));self.assertLess(events.index('receiver-create'),events.index('blank-gate'));process.assert_not_called()

    def test_blank_receiver_requires_both_empty_namespaces_and_zero_feed(self):
        empty=dict(schema=None,objects=[],tables=[],functions=[],privileges=[]);calls=[]
        trial=SimpleNamespace(query=lambda _:(calls.append('query') or SimpleNamespace(stdout=b'[0,0,0,0]')))
        with patch.object(recipe.custody,'profile',return_value=empty):self.assertTrue(recipe.blank_receiver(trial))
        with patch.object(recipe.custody,'profile',side_effect=[empty,dict(empty,objects=[{'name':'foreign'}])]):self.assertFalse(recipe.blank_receiver(trial))
        self.assertEqual(calls,['query'])
        trial.query=lambda _:SimpleNamespace(stdout=b'[0,0,1,0]')
        with patch.object(recipe.custody,'profile',return_value=empty):self.assertFalse(recipe.blank_receiver(trial))

    def test_late_clean_framing_fixed_budget_and_corruption_refusal(self):
        raw=b'-- own archive\nselect 1;\n';bound=self.binding(raw)
        clean=recipe.restore_statement(raw,bound);late=recipe.restore_statement(raw,bound,late_failure=True)
        self.assertEqual(late,clean.replace('commit;\n','select 1/0;commit;\n'))
        self.assertIn('begin;\n\\o /dev/null\n'+raw.decode()+'\n'+recipe.OWNER_ACL_REPLAY+'\n\\o\n',clean)
        self.assertTrue(clean.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))
        self.assertIn("set statement_timeout='3s';set lock_timeout='1s';",clean)
        for value in (None,1,'true'):
            with self.subTest(value=value),self.assertRaises(recipe.FeedPgTrialError):recipe.restore_statement(raw,bound,late_failure=value)
        with self.assertRaises(recipe.FeedPgTrialError):recipe.restore_statement(raw+b' ',bound)
        self.assertEqual(recipe.MAX_ARCHIVE,131072)

    def test_explicit_default_acl_spelling_is_reconstructed_without_grants_inside_outer_transaction(self):
        raw=b'-- own dump intentionally omits explicit owner default ACLs\n';bound=self.binding(raw)
        statement=recipe.restore_statement(raw,bound)
        fixed=('revoke all on schema tf_html_rehearsal from public;',
            'revoke all on tf_html_rehearsal.originals from public;',
            'revoke all on schema tf_html_extraction from public;',
            'revoke all on tf_html_extraction.results from public;')
        for command in fixed:
            self.assertEqual(statement.count(command),1)
            self.assertLess(statement.index(raw.decode()),statement.index(command))
            self.assertLess(statement.index(command),statement.index(recipe.COUNTS_SQL))
        self.assertNotIn('grant ',statement.lower());self.assertLess(statement.index('begin;'),statement.index(fixed[0]))
        self.assertLess(statement.index(fixed[-1]),statement.index('commit;'))

    def test_foreign_source_acl_cannot_reach_export_or_reconstruction(self):
        def check(name,value):
            if value is not True:raise recipe.FeedPgTrialError(name)
        profile=dict(schema=dict(acl=''),tables=[dict(acl='{postgres=arwdDxtm/postgres}')])
        producer=SimpleNamespace(check=check)
        with patch.object(recipe.custody,'install_extraction'),patch.object(recipe.custody,'profile',return_value=profile),patch.object(recipe.custody,'expected_profile',return_value=True),patch.object(recipe.custody.original,'expected_profile',return_value=True),patch.object(recipe,'export_archive') as export,patch.object(recipe.custody,'store_pair_and_result') as store,patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.restore_cases(producer,SimpleNamespace())
        export.assert_not_called();store.assert_not_called();process.assert_not_called()

    def test_constructor_failure_keeps_first_trial_tracked_and_cleans_it(self):
        events=[];first=SimpleNamespace(identity=None,record=lambda *args:events.append(args[0]),stop=lambda:events.append('stop'),stop_initializer=lambda:events.append('initializer'),verify_sources=lambda _:events.append('source'))
        with patch.object(sys,'argv',['recipe']),patch.object(recipe,'FreshFeedPostgres',side_effect=[first,ValueError('second constructor held')]),patch.object(recipe,'freeze_restore') as freeze,patch('subprocess.Popen') as process:
            with self.assertRaises(ValueError):recipe.main()
        self.assertEqual(events,['HTML_RESTORE_FAILURE','stop','initializer','source']);freeze.assert_not_called();process.assert_not_called()

    def test_cleanup_attempts_both_trials_and_every_independent_step_on_failure(self):
        events=[]
        def trial(name):
            def fail():events.append(name+'-stop');raise ValueError('held cleanup')
            return SimpleNamespace(identity='a'*64,stop=fail,stop_initializer=lambda:events.append(name+'-initializer'),verify_sources=lambda _:events.append(name+'-source'),inspect=lambda:dict(running=False),record=lambda *args:events.append(name+'-record'))
        with self.assertRaises(recipe.FeedPgTrialError):recipe.close_trials([trial('source'),trial('receiver')])
        self.assertEqual(events,['receiver-stop','receiver-initializer','receiver-source','receiver-record','source-stop','source-initializer','source-source','source-record'])


if __name__=='__main__':unittest.main()
