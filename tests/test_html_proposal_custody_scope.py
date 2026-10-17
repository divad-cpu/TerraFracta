"""Resource-free fixed-target/source/runtime and new preparation bridge bounds."""
from pathlib import Path
from types import SimpleNamespace
import ast,json,sys,tempfile,unittest
from unittest.mock import patch
from scripts import rehearse_html_proposal_custody as recipe


class HtmlProposalCustodyScopeTests(unittest.TestCase):
    def trial(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup);proof=Path(temporary.name);(proof/'inputs').mkdir()
        return SimpleNamespace(counter=0,identity=None,creation_attempted=False,initializer_attempted=False,proof=proof,frozen={},source_bindings=[],record=lambda *args:None)

    def test_cli_rejects_before_any_constructor_or_process(self):
        with patch.object(sys,'argv',['recipe','--target','existing']),patch.object(recipe,'FreshFeedPostgres') as constructor,patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.main()
        constructor.assert_not_called();process.assert_not_called()

    def test_active_freeze_rejects_before_inherited_runtime_or_resource(self):
        for key,value in [('counter',1),('identity','existing'),('creation_attempted',True),('initializer_attempted',True)]:
            trial=self.trial();setattr(trial,key,value)
            with self.subTest(key=key),patch.object(recipe.custody,'freeze_extraction') as inherited,patch('subprocess.Popen') as process:
                with self.assertRaises(recipe.FeedPgTrialError):recipe.freeze_preparation(trial)
                inherited.assert_not_called();process.assert_not_called()

    def test_missing_fixed_runtime_holds_before_new_source_or_any_resource(self):
        trial=self.trial()
        with patch.object(recipe.custody.original,'_runtime_files',side_effect=recipe.FeedPgTrialError('missing runtime')),patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.freeze_preparation(trial)
        self.assertEqual(trial.frozen,{});process.assert_not_called()

    def test_fixed_five_operand_pipe_has_exact_byte_and_count_limits(self):
        values=(b'm',b'p',b's',b'v',b'c');sql=recipe.direct(values)
        self.assertEqual(sql.count('decode('),5);self.assertIn('tf_html_preparation.store_preparation(',sql)
        self.assertIn("set statement_timeout='3s';set lock_timeout='1s';",sql)
        self.assertIn('begin isolation level read committed read write;',sql);self.assertTrue(sql.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))
        for value in [list(values),values[:-1],values+(b'extra',),(b'',*values[1:]),(bytearray(b'm'),*values[1:]),(b'x'*4097,*values[1:]),(*values[:-1],b'x'*32769)]:
            with self.subTest(type=type(value).__name__),self.assertRaises(recipe.FeedPgTrialError):recipe.direct(value)

    def test_context_is_explicit_invented_input_not_extracted_output_or_real_head(self):
        source=SimpleNamespace(item_key='independent-item',source_version_id='10000000-0000-4000-8000-000000000001',content_sha256='a'*64)
        expected=SimpleNamespace(current_expected=SimpleNamespace(document=source,binding=SimpleNamespace(language_code='en')),operation_id='20000000-0000-4000-8000-000000000001',artifact_id='30000000-0000-4000-8000-000000000001',canonical_metadata=json.dumps(dict(request_sha256='b'*64,output_sha256='c'*64,proposal=dict(proposed_assertion='DO_NOT_INFER_SUPPORT',proposed_claim_type='funding'))).encode())
        context=recipe.invented_context(expected)
        self.assertEqual(context['held']['item_key'],source.item_key);self.assertEqual(context['support']['source_version_id'],source.source_version_id)
        self.assertEqual(context['support']['assertion'],'An invented source statement remains unverified.');self.assertEqual(context['support']['claim_type'],'condition')
        self.assertEqual(context['support']['assignment_state'],'proposed_only');self.assertEqual(context['issue']['head'],dict(publication_id=None,content_sha256=None,changed_at=None))
        self.assertEqual(context['content']['review_date_basis'],'independently_supplied_not_inferred');self.assertIsNone(context['content']['source_published_on'])
        self.assertNotIn('DO_NOT_INFER_SUPPORT',json.dumps(context))

    def test_cold_bridge_obtains_four_fresh_receipts_before_whole_reobservation(self):
        events=[];expected=SimpleNamespace(statement=lambda:'FIXED_PREPARATION_GETTER');extraction_expected=object();trial=object();returned=object()
        def source_read(*args):events.append('three-source-result-getters');return object(),b'EXTRACTION',b'CURRENT',b'PREVIOUS'
        def preparation_read(*args):events.append('fourth-preparation-getter');return b'PREPARATION'
        def reopen(raw,selected,**values):
            events.append('whole-reobservation');self.assertEqual(raw,b'PREPARATION');self.assertIs(selected,expected)
            self.assertEqual((values['extraction_receipt'],values['current_receipt'],values['previous_receipt']),(b'EXTRACTION',b'CURRENT',b'PREVIOUS'))
            self.assertIs(values['extraction_expected'],extraction_expected);return returned
        with patch.object(recipe.custody,'cold_read',side_effect=source_read),patch.object(recipe.custody.original,'committed',side_effect=preparation_read),patch.object(recipe,'reopen_stored_html_proposal',side_effect=reopen),patch('subprocess.Popen') as process:
            self.assertEqual(recipe.cold_read(trial,expected,extraction_expected),(returned,b'PREPARATION',b'EXTRACTION',b'CURRENT',b'PREVIOUS'))
        self.assertEqual(events,['three-source-result-getters','fourth-preparation-getter','whole-reobservation']);process.assert_not_called()

    def test_setup_installs_prerequisites_then_new_frozen_fixture_once(self):
        events=[];trial=SimpleNamespace(frozen={'tests/fixtures/invented_html_preparation.sql':b'FIXED_NEW_FIXTURE;'},query=lambda sql:events.append(sql))
        with patch.object(recipe.custody,'install_extraction',side_effect=lambda _:events.append('original-plus-result')):recipe.install_preparation(trial)
        self.assertEqual(events,['original-plus-result',"begin;set local statement_timeout='10s';FIXED_NEW_FIXTURE;commit;"])

    def test_source_closure_and_main_order_exclude_restore_old_cases_and_env_targets(self):
        self.assertEqual(set(recipe.NEW_FILES),{'scripts/rehearse_html_proposal_custody.py','tests/test_html_proposal_custody_scope.py','workers/html_proposal_custody.py','tests/test_html_proposal_custody.py','workers/html_proposal_postgres.py','tests/test_html_proposal_postgres.py','tests/fixtures/invented_html_preparation.sql'})
        for name in recipe.NEW_FILES:self.assertTrue((recipe.ROOT/name).is_file())
        tree=ast.parse((recipe.ROOT/recipe.ENTRY).read_bytes());calls=[ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n,ast.Call)]
        for forbidden in ('custody.cases','custody.original.cases','os.getenv','os.environ.get'):self.assertNotIn(forbidden,calls)
        imports=[n.module for n in ast.walk(tree) if isinstance(n,ast.ImportFrom)];self.assertFalse(any('restore' in (name or '') for name in imports))
        freezer=ast.unparse(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='freeze_preparation'));self.assertEqual(freezer.count('custody.freeze_extraction(trial)'),1)
        main=ast.unparse(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main'));self.assertLess(main.index('freeze_preparation(trial)'),main.index('trial.create()'))
        setup=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='prepare_one');returns=[n for n in ast.walk(setup) if isinstance(n,ast.Return)]
        self.assertEqual(len(returns),1);self.assertEqual(ast.unparse(returns[0].value),'(expected, extraction_expected, sha256(receipt).hexdigest())')

    def test_failure_cleanup_stops_owned_trial_and_checks_all_source_bindings(self):
        events=[];trial=SimpleNamespace(identity=None,record=lambda *args:events.append(args[0]),stop=lambda:events.append('stop'),stop_initializer=lambda:events.append('initializer'),verify_sources=lambda _:events.append('source'))
        with patch.object(sys,'argv',['recipe']),patch.object(recipe,'FreshFeedPostgres',return_value=trial),patch.object(recipe,'freeze_preparation',side_effect=ValueError('fixed inert hold')),patch('subprocess.Popen') as process:
            with self.assertRaises(ValueError):recipe.main()
        self.assertEqual(events,['HTML_PREPARATION_FAILURE','stop','initializer','source']);process.assert_not_called()

    def test_profile_closed_schema_and_no_extra_objects_public_grants_or_policies(self):
        trial=SimpleNamespace(query=lambda _:self.fail('foreign schema reached query'))
        with self.assertRaises(recipe.FeedPgTrialError):recipe.profile(trial,'public')
        expected=[('preparation_receipt','p_operation uuid','jsonb'),('refuse_mutation','','trigger'),('store_preparation','p_metadata bytea, p_payload bytea, p_selection bytea, p_provenance bytea, p_context bytea','jsonb')]
        table=dict(name='preparations',owner='postgres',rls=True,forced=False,policies=[],columns=[dict(name=name,acl='',notnull=True)for name in ['operation_id','artifact_id','extraction_operation_id','metadata','payload_raw','selection_raw','provenance_raw','context_raw','stored_at']],constraints=[dict(kind=kind,validated=True)for kind in ['c']*11+['f','p','u']],triggers=[dict(name='detached_preparation_append_only',enabled='O')])
        value=dict(schema=dict(name='tf_html_preparation',owner='postgres'),tables=[table],objects=[dict(name=name,kind=kind,owner='postgres',persistence='p')for name,kind in [('preparations','r'),('preparations_artifact_id_key','i'),('preparations_pkey','i')]],functions=[dict(name=name,args=args,result=result,owner='postgres',definer=False,volatility='v',config=['search_path=pg_catalog'])for name,args,result in expected],privileges=[dict(grantee='postgres',grantor='postgres')])
        self.assertTrue(recipe.expected_profile(value))
        for mutate in [lambda v:v['objects'].append(dict(name='foreign',kind='r',owner='postgres',persistence='p')),lambda v:v['privileges'][0].update(grantee='PUBLIC'),lambda v:v['tables'][0]['policies'].append({'name':'foreign'}),lambda v:v['functions'].pop(),lambda v:v['tables'][0]['constraints'].pop()]:
            altered=json.loads(json.dumps(value));mutate(altered)
            with self.subTest():self.assertFalse(recipe.expected_profile(altered))


if __name__=='__main__':unittest.main()
