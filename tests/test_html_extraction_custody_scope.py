"""Resource-free scope and closed-source admission of the new extraction recipe."""
from pathlib import Path
from types import SimpleNamespace
from datetime import datetime,timezone
import ast,base64,json,sys,tempfile,unittest
from unittest.mock import patch
from scripts import rehearse_html_extraction_custody as recipe


class HtmlExtractionCustodyScopeTests(unittest.TestCase):
    def trial(self):
        root=tempfile.TemporaryDirectory();self.addCleanup(root.cleanup);proof=Path(root.name);(proof/'inputs').mkdir()
        return SimpleNamespace(counter=0,identity=None,creation_attempted=False,initializer_attempted=False,proof=proof,frozen={},source_bindings=[],record=lambda *args:None)

    def test_no_arguments_before_constructor_or_process(self):
        with patch.object(sys,'argv',['recipe','--target','existing']),patch.object(recipe,'FreshFeedPostgres') as constructor,patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.main()
        constructor.assert_not_called();process.assert_not_called()

    def test_active_trial_refuses_before_inherited_freeze(self):
        for field,value in [('counter',1),('identity','existing'),('creation_attempted',True),('initializer_attempted',True)]:
            trial=self.trial();setattr(trial,field,value)
            with self.subTest(field=field),patch.object(recipe.original,'freeze_html') as freezer,patch('subprocess.Popen') as process:
                with self.assertRaises(recipe.FeedPgTrialError):recipe.freeze_extraction(trial)
                freezer.assert_not_called();process.assert_not_called()

    def test_missing_runtime_holds_before_any_new_source_or_resource(self):
        trial=self.trial()
        with patch.object(recipe.original,'_runtime_files',side_effect=recipe.FeedPgTrialError('missing fixed runtime')),patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.freeze_extraction(trial)
        self.assertEqual(trial.frozen,{});process.assert_not_called()

    def test_failure_cleanup_checks_only_constructed_owned_trial(self):
        events=[];trial=SimpleNamespace(identity=None,stop=lambda:events.append('stop'),stop_initializer=lambda:events.append('initializer'),verify_sources=lambda _:events.append('source'),record=lambda *args:events.append(args[0]))
        with patch.object(sys,'argv',['recipe']),patch.object(recipe,'FreshFeedPostgres',return_value=trial),patch.object(recipe,'freeze_extraction',side_effect=ValueError('inert hold')),patch('subprocess.Popen') as process:
            with self.assertRaises(ValueError):recipe.main()
        self.assertEqual(events,['HTML_EXTRACTION_FAILURE','stop','initializer','source']);process.assert_not_called()

    def test_installation_uses_only_two_frozen_fixtures_once_in_order(self):
        calls=[];trial=SimpleNamespace(frozen={'tests/fixtures/invented_html_originals.sql':b'ORIGINAL_FIXED;','tests/fixtures/invented_html_extraction.sql':b'EXTRACTION_FIXED;'},query=calls.append)
        recipe.install_extraction(trial)
        self.assertEqual(calls,["begin;set local statement_timeout='10s';ORIGINAL_FIXED;commit;","begin;set local statement_timeout='10s';EXTRACTION_FIXED;commit;"])

    def test_source_closure_and_phase_order_have_no_old_case_or_target(self):
        self.assertEqual(set(recipe.NEW_FILES),{'scripts/rehearse_html_extraction_custody.py','tests/test_html_extraction_custody_scope.py','workers/html_extraction_custody.py','tests/test_html_extraction_custody.py','tests/fixtures/invented_html_extraction.sql'})
        for name in recipe.NEW_FILES:self.assertTrue((recipe.ROOT/name).is_file())
        tree=ast.parse((recipe.ROOT/recipe.ENTRY).read_bytes());calls=[ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n,ast.Call)]
        for name in ('original.cases','original.nominal','original.adversarial','os.getenv','os.environ.get'):self.assertNotIn(name,calls)
        imports=[n.module for n in ast.walk(tree) if isinstance(n,ast.ImportFrom)]
        self.assertFalse(any('restore' in (name or '') for name in imports))
        freezer=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='freeze_extraction')
        self.assertEqual(ast.unparse(freezer).count('original.freeze_html(trial)'),1)
        main=ast.unparse(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main'))
        self.assertLess(main.index('freeze_extraction(trial)'),main.index('trial.create()'))
        self.assertLess(main.index('trial.create()'),main.index('cases(trial)'))
        setup=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='store_pair_and_result')
        returns=[n for n in ast.walk(setup) if isinstance(n,ast.Return)]
        self.assertEqual(len(returns),1)
        self.assertEqual(ast.unparse(returns[0].value),'(expected, sha256(packet.canonical_input).hexdigest(), sha256(receipt).hexdigest())')

    def test_fixed_three_operand_statement_rejects_pipe_overflow(self):
        statement=recipe.direct(b'm',b'r',b'o')
        self.assertEqual(statement.count('decode('),3);self.assertIn('tf_html_extraction.store_result(',statement)
        self.assertIn("begin isolation level read committed read write;",statement)
        self.assertTrue(statement.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))
        with self.assertRaises(recipe.FeedPgTrialError):recipe.direct(b'm'*16384,b'r'*131072,b'o'*8193)

    def test_profile_closed_names_and_independent_expectation_serialization(self):
        trial=SimpleNamespace(query=lambda _:self.fail('foreign schema reached query'))
        with self.assertRaises(recipe.FeedPgTrialError):recipe.profile(trial,'public')
        value=recipe._json_value(dict(at=datetime(2026,10,16,tzinfo=timezone.utc),metadata=b'\x00UTF8',items=(b'a',)))
        self.assertEqual(value,dict(at='2026-10-16T00:00:00.000000Z',metadata=dict(base64=base64.b64encode(b'\x00UTF8').decode()),items=[dict(base64='YQ==')]))
        json.dumps(value)

    def test_new_schema_source_is_separate_owner_only_exact_byte_contract(self):
        source='\n'.join(line for line in (recipe.ROOT/'tests/fixtures/invented_html_extraction.sql').read_text().lower().splitlines() if not line.lstrip().startswith('--'))
        self.assertEqual(source.count('create table '),1);self.assertEqual(source.count('create function '),3)
        self.assertNotIn('create role',source);self.assertNotIn('grant ',source);self.assertNotIn('tf_feed_rehearsal',source)
        self.assertIn('references tf_html_rehearsal.originals(operation_id)',source)
        self.assertIn('metadata bytea not null',source);self.assertIn('request_raw bytea not null',source);self.assertIn('output_raw bytea not null',source)
        self.assertIn('result_receipt(p_operation uuid) returns jsonb language plpgsql volatile security invoker',source)
        self.assertIn('old.metadata<>p_metadata or old.request_raw<>p_request or old.output_raw<>p_output',source)
        self.assertIn('alter table tf_html_extraction.results enable row level security',source)


if __name__=='__main__':unittest.main()
