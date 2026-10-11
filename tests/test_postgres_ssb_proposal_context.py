"""Owned local child lifecycle regressions; no database/Docker/source calls."""
import json, os, signal, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

from scripts import postgres_ssb_proposal_fixture as trial
from scripts.check_postgres_operator_audit_native import main
from scripts.fictional_trial_guard import cooperative_trial_interrupt, FictionalTrialInterrupted


class SSBProposalContextTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.proof=Path(self.directory.name)
        (self.proof/'outputs').mkdir(mode=0o700)
        self.calls=[];self.children=[];self.records=[]
        self.original_spawn=subprocess.Popen
        self.mask=signal.pthread_sigmask(signal.SIG_BLOCK, set())

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:child.kill();child.wait(timeout=5)
        self.directory.cleanup()
        self.assertEqual(signal.pthread_sigmask(signal.SIG_BLOCK, set()), self.mask)

    def run_child(self, spawn):
        with patch.object(trial.subprocess,'Popen',side_effect=spawn):
            return trial.run_owned_node('fixed','unused-fixed-path.mjs',{'invented':True},
                self.proof,lambda name,value:self.records.append((name,value)),self.calls,self.children)

    def spawn_python(self, code, kwargs):
        return self.original_spawn(['/usr/bin/env','--default-signal=TERM,INT',sys.executable,'-B','-E','-s','-c',code], **kwargs)

    def test_success_records_owned_child_without_configuration(self):
        result=self.run_child(lambda args,**kw:self.spawn_python('import json,sys;json.load(sys.stdin);print(json.dumps(dict(ok=True)))',kw))
        self.assertEqual(result,{'ok':True})
        self.assertEqual(len(self.children),1)
        self.assertTrue(self.calls[0]['childReaped'])
        self.assertEqual(self.calls[0]['exit'],0)
        started=json.loads((self.proof/'outputs/fixed-started.json').read_text())
        self.assertEqual(set(started),{'pid','parentPid','configurationRecorded'})
        self.assertIs(started['configurationRecorded'],False)

    def test_term_during_construction_is_deferred_then_reaps_actual_child(self):
        spawned=[]
        def spawn(args,**kw):
            child=self.spawn_python('import time;time.sleep(30)',kw);spawned.append(child)
            # This is the exact ownership gap: native child exists but Popen
            # has not returned to the helper. TERM must remain pending here.
            os.kill(os.getpid(),signal.SIGTERM)
            self.assertIn(signal.SIGTERM,signal.sigpending())
            return child
        with cooperative_trial_interrupt(),self.assertRaises(FictionalTrialInterrupted):self.run_child(spawn)
        self.assertEqual(self.children,spawned)
        self.assertIsNotNone(spawned[0].poll())
        self.assertTrue(self.calls[0]['childReaped'])
        self.assertFalse((self.proof/'outputs/fixed-started.json').exists())
        self.assertEqual(self.records[0][0],'OWNED_CHILD_1')

    def test_actual_executed_child_does_not_inherit_creation_signal_mask(self):
        from scripts.owned_trial_process import run_owned_trial_child
        code='import json,signal,sys;json.load(sys.stdin);print(json.dumps(dict(blocked=sorted(int(s) for s in signal.pthread_sigmask(signal.SIG_BLOCK,set())))))'
        result=run_owned_trial_child('signals',[sys.executable,'-B','-E','-s','-c',code],{'invented':True},
            self.proof,lambda name,value:self.records.append((name,value)),self.calls,self.children)
        self.assertNotIn(int(signal.SIGTERM),result['blocked'])
        self.assertNotIn(int(signal.SIGINT),result['blocked'])

    def test_construction_failure_restores_mask_without_inventing_a_child(self):
        def refused(*args,**kw):raise OSError('fixed local spawn refusal')
        with self.assertRaises(OSError):self.run_child(refused)
        self.assertEqual(self.children,[])
        self.assertEqual(self.calls,[])
        self.assertEqual(self.records,[])

    def test_malformed_or_nonzero_child_is_reaped_without_success_output(self):
        for code in ('print("invalid-json")','raise SystemExit(7)'):
            with self.subTest(code=code):
                with self.assertRaises((ValueError,AssertionError)):
                    self.run_child(lambda args,**kw:self.spawn_python(code,kw))
                self.assertTrue(self.calls[-1]['childReaped'])
                self.assertFalse((self.proof/'outputs/fixed.json').exists())
                # Each helper invocation gets its own fixed proof filename.
                (self.proof/'outputs/fixed-started.json').unlink()

    def test_ssb_mode_cannot_be_combined_before_resource_operations(self):
        for mode in ('work_proposal_only','work_proposal_pipeline_only'):
            with patch('sys.argv',['fixed-trial']),patch.object(trial.subprocess,'run') as execute:
                with self.assertRaises(AssertionError):main(ssb_proposal_only=True,**{mode:True})
                execute.assert_not_called()


if __name__=='__main__':unittest.main()
