"""Resource-free admission, source closure and cleanup of the new manual recipe."""
from pathlib import Path
from types import SimpleNamespace
import ast,importlib.metadata,json,sys,tempfile,unittest
from unittest.mock import patch
from scripts import rehearse_html_original_custody as recipe


class HtmlOriginalCustodyScopeTests(unittest.TestCase):
    def trial(self):
        root=tempfile.TemporaryDirectory();self.addCleanup(root.cleanup);proof=Path(root.name);(proof/'inputs').mkdir()
        return SimpleNamespace(counter=0,identity=None,creation_attempted=False,initializer_attempted=False,proof=proof,frozen={},source_bindings=[],record=lambda *args:None)

    def test_foreign_cli_refuses_before_constructor_or_process(self):
        with patch.object(sys,'argv',['recipe','--target','existing']),patch.object(recipe,'FreshFeedPostgres') as constructor,patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.main()
        constructor.assert_not_called();process.assert_not_called()

    def test_freezer_rejects_active_trial_before_runtime_or_any_resource(self):
        for field,value in [('counter',1),('identity','existing'),('creation_attempted',True),('initializer_attempted',True)]:
            trial=self.trial();setattr(trial,field,value)
            with self.subTest(field=field),patch.object(recipe,'_runtime_files') as runtime,patch('subprocess.Popen') as process:
                with self.assertRaises(recipe.FeedPgTrialError):recipe.freeze_html(trial)
                runtime.assert_not_called();process.assert_not_called()

    def test_missing_runtime_holds_before_freeze_or_process(self):
        trial=self.trial()
        with patch.object(recipe.metadata,'distribution',side_effect=importlib.metadata.PackageNotFoundError('fixed missing runtime')),patch('subprocess.Popen') as process:
            with self.assertRaises(importlib.metadata.PackageNotFoundError):recipe.freeze_html(trial)
        self.assertEqual(trial.frozen,{});self.assertEqual(list((trial.proof/'inputs').iterdir()),[]);process.assert_not_called()

    def test_main_failure_stops_only_owned_trial_and_checks_source(self):
        events=[];trial=SimpleNamespace(identity=None,stop=lambda:events.append('stop'),stop_initializer=lambda:events.append('initializer'),verify_sources=lambda _:events.append('source'),record=lambda *args:events.append(args[0]))
        with patch.object(sys,'argv',['recipe']),patch.object(recipe,'FreshFeedPostgres',return_value=trial),patch.object(recipe,'freeze_html',side_effect=ValueError('inert hold')),patch('subprocess.Popen') as process:
            with self.assertRaises(ValueError):recipe.main()
        self.assertEqual(events,['HTML_FAILURE','stop','initializer','source']);process.assert_not_called()

    def test_new_source_closure_names_and_fixed_inherited_profile_are_explicit(self):
        self.assertEqual(set(recipe.NEW_FILES),{'scripts/rehearse_html_original_custody.py','workers/html_original_custody.py','tests/test_html_original_custody.py','tests/fixtures/invented_html_originals.sql','tests/test_html_original_custody_scope.py'})
        for name in recipe.NEW_FILES:self.assertTrue((recipe.ROOT/name).is_file())
        tree=ast.parse((recipe.ROOT/recipe.ENTRY).read_text())
        imported={node.module for node in ast.walk(tree) if isinstance(node,ast.ImportFrom)}
        self.assertIn('scripts.rehearse_postgres_feed_journal',imported)
        self.assertIn('workers.stored_html_change',imported)
        self.assertFalse(any('restore' in (value or '') or 'owner_writer' in (value or '') for value in imported))
        calls={ast.unparse(node.func) for node in ast.walk(tree) if isinstance(node,ast.Call)}
        self.assertNotIn('os.getenv',calls);self.assertNotIn('os.environ.get',calls)
        main=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='main')
        text=ast.unparse(main)
        self.assertLess(text.index('freeze_html(trial)'),text.index('trial.create()'))
        self.assertLess(text.index('trial.create()'),text.index('cases(trial)'))
        self.assertNotIn('nominal(',text);self.assertNotIn('adversarial(',text)

    def test_schema_is_new_owner_only_and_does_not_change_feed_or_plaintext(self):
        sql=(recipe.ROOT/'tests/fixtures/invented_html_originals.sql').read_text().lower()
        self.assertEqual(sql.count('create table '),1);self.assertEqual(sql.count('create function '),3)
        self.assertIn('security invoker',sql);self.assertNotIn('security definer',sql)
        self.assertNotIn('create role',sql);self.assertNotIn('grant ',sql)
        self.assertNotIn('tf_feed_rehearsal',sql);self.assertNotIn('text/plain',sql)
        self.assertIn('alter table tf_html_rehearsal.originals enable row level security',sql)
        self.assertIn('old.raw is distinct from p_raw or old.metadata is distinct from p_metadata',sql)
        self.assertIn('metadata bytea not null',sql);self.assertIn('raw bytea not null',sql)
        self.assertIn("current_setting('transaction_isolation')<>'read committed'",sql)

    def test_profile_predicate_refuses_extra_objects_public_acl_and_missing_functions(self):
        functions=[dict(name=name,args=args,result=result,owner='postgres',definer=False,config=['search_path=pg_catalog']) for name,args,result in [('original_receipt','p_operation uuid','jsonb'),('refuse_mutation','','trigger'),('store_original','p_metadata bytea, p_raw bytea','jsonb')]]
        table=dict(name='originals',owner='postgres',rls=True,forced=False,policies=[],columns=[dict(name=name,acl='') for name in ['operation_id','artifact_id','raw','metadata','stored_at']],triggers=[dict(name='html_original_append_only',enabled='O')])
        value=dict(schema=dict(name='tf_html_rehearsal',owner='postgres'),tables=[table],functions=functions,
            objects=[dict(name=name,kind=kind,owner='postgres',persistence='p') for name,kind in [('originals','r'),('originals_artifact_id_key','i'),('originals_pkey','i')]],privileges=[dict(grantee='postgres',grantor='postgres')])
        self.assertTrue(recipe.expected_profile(value))
        for mutate in [lambda v:v['objects'].append(dict(name='foreign',kind='r',owner='postgres',persistence='p')),lambda v:v['functions'].pop(),lambda v:v['privileges'][0].update(grantee='PUBLIC'),lambda v:v['tables'][0]['columns'][0].update(acl='PUBLIC')]:
            changed=json.loads(json.dumps(value));mutate(changed)
            with self.subTest():self.assertFalse(recipe.expected_profile(changed))


if __name__=='__main__':unittest.main()
