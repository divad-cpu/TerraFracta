"""Resource-free phase admission for one new owned metadata-selection trial."""
import ast,json,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from scripts import rehearse_html_proposal_inventory as recipe


class HtmlProposalInventoryScopeTests(unittest.TestCase):
    def test_arguments_refuse_before_constructor_or_process(self):
        with patch.object(sys,'argv',['recipe','--target','existing']),patch.object(recipe,'FreshFeedPostgres') as constructor,patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.FeedPgTrialError):recipe.main()
        constructor.assert_not_called();process.assert_not_called()

    def test_active_trial_refuses_before_any_inherited_freeze_or_resource(self):
        for key,value in [('counter',1),('identity','existing'),('creation_attempted',True),('initializer_attempted',True)]:
            trial=SimpleNamespace(counter=0,identity=None,creation_attempted=False,initializer_attempted=False);setattr(trial,key,value)
            with self.subTest(key=key),patch.object(recipe.preparation,'freeze_preparation') as freeze,patch('subprocess.Popen') as process:
                with self.assertRaises(recipe.FeedPgTrialError):recipe.freeze_inventory(trial)
            freeze.assert_not_called();process.assert_not_called()

    def test_unknown_invented_branch_never_reads_or_stores(self):
        for value in [None,0,'known']:
            with patch.object(recipe.preparation.custody,'cold_read') as read,patch.object(recipe,'prepare_html_proposal_custody') as prepare:
                with self.assertRaises(recipe.FeedPgTrialError):recipe.add_preparation(SimpleNamespace(),None,known_head=value)
            read.assert_not_called();prepare.assert_not_called()

    def test_failed_full_source_reopen_prevents_metadata_query(self):
        from tests.test_html_proposal_custody import inputs
        source=inputs();trial=SimpleNamespace(query=lambda *a,**k:self.fail('invalid full source reached metadata query'))
        with patch.object(recipe.preparation.custody,'cold_read',return_value=(None,b'{}',source['current_receipt'],source['previous_receipt'])),patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.HtmlProposalInventoryError):recipe.lookup(trial,source['extraction_expected'],'HELD')
        process.assert_not_called()

    def test_failed_explicit_selection_cannot_reach_full_reader(self):
        independent=SimpleNamespace(intent=SimpleNamespace(canonical_metadata=json.dumps(dict(operation_id='a1000000-0000-4000-8000-000000000001')).encode()),artifact_id='b1000000-0000-4000-8000-000000000001')
        with patch.object(recipe.preparation,'cold_read') as read,patch('subprocess.Popen') as process:
            with self.assertRaises(recipe.HtmlProposalInventoryError):recipe.full_selected(SimpleNamespace(),None,independent,None,'f'*64,'EMPTY')
        read.assert_not_called();process.assert_not_called()

    def test_full_reader_mismatch_never_records_success(self):
        from tests.test_html_proposal_custody import prepared_proposal
        source=prepared_proposal();independent=SimpleNamespace(intent=source.intent,artifact_id='b1000000-0000-4000-8000-000000000001')
        calls=[]
        def check(label,value):
            calls.append((label,value))
            if value is not True:raise recipe.FeedPgTrialError('held full byte mismatch')
        trial=SimpleNamespace(check=check);reopened=SimpleNamespace(stored=SimpleNamespace(artifact_id=independent.artifact_id),result=SimpleNamespace(intent=source.intent))
        with patch.object(recipe,'select_html_proposal',return_value=independent),patch.object(recipe.preparation,'cold_read',return_value=(reopened,b'wrong',None,None,None)):
            with self.assertRaises(recipe.FeedPgTrialError):recipe.full_selected(trial,None,independent,None,'f'*64,'EMPTY')
        self.assertEqual(calls,[('EMPTY_explicit_independent_choice_full_receipt_exact',False)])

    def test_cleanup_on_frozen_source_failure_never_creates_a_target(self):
        events=[];trial=SimpleNamespace(identity=None,stop=lambda:events.append('stop'),stop_initializer=lambda:events.append('initializer'),verify_sources=lambda _:events.append('source'),record=lambda *args:events.append(args[0]))
        with patch.object(sys,'argv',['recipe']),patch.object(recipe,'FreshFeedPostgres',return_value=trial),patch.object(recipe,'freeze_inventory',side_effect=ValueError('held source')),patch('subprocess.Popen') as process:
            with self.assertRaises(ValueError):recipe.main()
        self.assertEqual(events,['HTML_INVENTORY_FAILURE','stop','initializer','source']);process.assert_not_called()

    def test_fixed_paths_phase_order_and_no_old_case_or_restore_dispatch(self):
        self.assertEqual(set(recipe.NEW_FILES),{'scripts/rehearse_html_proposal_inventory.py','tests/test_html_proposal_inventory_scope.py','workers/html_proposal_inventory.py','tests/test_html_proposal_inventory.py'})
        for name in recipe.NEW_FILES:self.assertTrue((recipe.ROOT/name).is_file())
        tree=ast.parse((recipe.ROOT/recipe.ENTRY).read_bytes());calls=[ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n,ast.Call)]
        for call in ['preparation.cases','preparation.prepare_one','preparation.custody.cases','os.getenv','os.environ.get']:self.assertNotIn(call,calls)
        self.assertFalse(any('restore' in (n.module or '') for n in ast.walk(tree) if isinstance(n,ast.ImportFrom)))
        main=ast.unparse(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main'))
        self.assertLess(main.index('freeze_inventory(trial)'),main.index('trial.create()'));self.assertLess(main.index('trial.create()'),main.index('cases(trial)'))
        freezer=ast.unparse(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='freeze_inventory'))
        self.assertEqual(freezer.count('preparation.freeze_preparation(trial)'),1)


if __name__=='__main__':unittest.main()
