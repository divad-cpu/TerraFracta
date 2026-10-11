"""Actual nested local cancellation; no database, Docker or source calls."""
import json, os, signal, subprocess, sys, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
from scripts import owned_trial_process as helper
from scripts.fictional_trial_guard import cooperative_trial_interrupt, FictionalTrialInterrupted


class OwnedNestedProcessTests(unittest.TestCase):
    def test_parent_interrupt_reaches_cooperative_child_and_reaps_grandchild(self):
        with tempfile.TemporaryDirectory() as directory:
            proof=Path(directory);(proof/'outputs').mkdir(mode=0o700)
            nested=proof/'nested';nested.mkdir(mode=0o700);(nested/'outputs').mkdir(mode=0o700)
            probe=proof/'nested-probe.py'
            probe.write_text('''import json,os,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from scripts.owned_trial_process import run_owned_trial_child
from scripts.fictional_trial_guard import cooperative_trial_interrupt
proof=Path(sys.argv[2]);children=[];calls=[]
def record(name,value):
    with (proof/(name+'.json')).open('x') as f:json.dump(value,f)
with cooperative_trial_interrupt():
    try:
        run_owned_trial_child('grandchild',[sys.executable,'-B','-E','-s','-c','import time;time.sleep(30)'],
            {},proof,record,calls,children,timeout=12)
    finally:
        record('NESTED_FINALLY',{'pid':os.getpid(),'children':calls,
            'allReaped':all(p.poll() is not None for p in children)})
''')
            original=subprocess.Popen;spawned=[];owned=[];calls=[];records=[]
            previous=signal.pthread_sigmask(signal.SIG_BLOCK,set())
            def spawn(command,**kwargs):
                child=original(command,**kwargs);spawned.append(child)
                try:
                    end=time.monotonic()+5
                    while not (nested/'outputs/grandchild-started.json').exists() and time.monotonic()<end and child.poll() is None:time.sleep(.005)
                    self.assertTrue((nested/'outputs/grandchild-started.json').exists())
                    # Parent has not yet received the process reference. Its
                    # pending TERM must unwind only after registration.
                    os.kill(os.getpid(),signal.SIGTERM)
                    self.assertIn(signal.SIGTERM,signal.sigpending())
                    return child
                except BaseException:
                    if child.poll() is None:child.kill();child.wait(timeout=5)
                    raise
            try:
                with cooperative_trial_interrupt(),patch.object(helper.subprocess,'Popen',side_effect=spawn),self.assertRaises(FictionalTrialInterrupted):
                    helper.run_owned_trial_child('nested',[sys.executable,'-B','-E','-s',str(probe),str(helper.ROOT),str(nested)],
                        {},proof,lambda name,value:records.append((name,value)),calls,owned,timeout=15,stop_wait=12)
                self.assertEqual(owned,spawned)
                self.assertTrue(calls[0]['childReaped'])
                self.assertEqual(spawned[0].returncode,1)
                ended=json.loads((nested/'NESTED_FINALLY.json').read_text())
                self.assertTrue(ended['allReaped'])
                self.assertEqual(len(ended['children']),1)
                self.assertTrue(ended['children'][0]['childReaped'])
                self.assertEqual(ended['children'][0]['exit'],-int(signal.SIGTERM))
                with self.assertRaises(ProcessLookupError):os.kill(ended['children'][0]['pid'],0)
                self.assertEqual(signal.pthread_sigmask(signal.SIG_BLOCK,set()),previous)
            finally:
                for process in spawned:
                    if process.poll() is None:process.kill();process.wait(timeout=5)


if __name__=='__main__':unittest.main()
