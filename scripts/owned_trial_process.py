"""Bounded stdin-only children for owned local test harnesses.

The caller supplies a fixed command, private evidence location and shared
ownership list. This supplies no runtime command selection or authority.
GNU env resets only TERM/INT inherited from the brief parent creation mask;
the executed child's own cooperative handler can then drain its descendants.
"""
import json, os, signal, subprocess
from scripts.captured_fictional_pipeline import ROOT, private_file


def run_owned_trial_child(name, command, value, proof, record, calls, owned_children,
        *, timeout=12, stop_wait=5):
    process = None
    try:
        previous = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT})
        try:
            process = subprocess.Popen(['/usr/bin/env', '--default-signal=TERM,INT', *command], cwd=ROOT,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            process._terra_stop_wait = stop_wait
            owned_children.append(process)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous)
        private_file(proof/'outputs'/(name+'-started.json'), json.dumps({
            'pid':process.pid, 'parentPid':os.getpid(), 'configurationRecorded':False})+'\n')
        raw, _ = process.communicate(json.dumps(value), timeout=timeout)
        assert process.returncode == 0 and len(raw) <= 262144
        result = json.loads(raw)
        private_file(proof/'outputs'/(name+'.json'), json.dumps(result, indent=2)+'\n')
        return result
    finally:
        if process is not None:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=stop_wait)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
            if process.stdin is not None:process.stdin.close()
            if process.stdout is not None:process.stdout.close()
            calls.append({'name':name, 'pid':process.pid, 'exit':process.returncode,
                'childReaped':process.poll() is not None})
            record('OWNED_CHILD_'+str(len(calls)), calls[-1])
            assert process.poll() is not None
