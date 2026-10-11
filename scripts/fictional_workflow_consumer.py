"""Owned fixed fictional Node consumer: bounded frames and failure cleanup.

Only the native custodian creates it. No URL, account, command or environment
selector is accepted. No web entry imports or launches this process.
"""
import json
import math
import os
import selectors
import subprocess
import time

from scripts.captured_fictional_pipeline import ROOT, private_file

MAX_FRAME_BYTES = 65_536
FRAME_TIMEOUT_SECONDS = 30


class FixedWorkflowConsumer:
    def __init__(self, proof):
        self.proof = proof
        self.process = None
        self.selector = None
        self.pending = bytearray()
        self.consumed = False
        self.closed = False

    def __enter__(self):
        try:
            self.process = subprocess.Popen(
                ['node', '--experimental-strip-types', 'scripts/run_fictional_correction_workflow.mjs'],
                cwd=ROOT, env={'PATH': os.environ['PATH'], 'NODE_ENV': 'development'},
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, bufsize=1)
            self.selector = selectors.DefaultSelector()
            os.set_blocking(self.process.stdout.fileno(), False)
            self.selector.register(self.process.stdout, selectors.EVENT_READ)
            return self
        except BaseException:
            self.close()
            raise

    def send(self, value):
        frame = json.dumps(value) + '\n'
        if len(frame.encode()) > MAX_FRAME_BYTES:
            raise ValueError('Fixed workflow outgoing frame exceeds bounds')
        self.process.stdin.write(frame)
        self.process.stdin.flush()

    def receive(self):
        start = time.monotonic()
        if not math.isfinite(start):
            raise ValueError('Fixed workflow channel clock unavailable')
        deadline = start + FRAME_TIMEOUT_SECONDS
        while True:
            # Check time before accepting a buffered complete frame too.
            now = time.monotonic()
            remaining = deadline - now
            if not math.isfinite(now) or now < start or remaining <= 0:
                raise ValueError('Fixed workflow consumer deadline')
            end = self.pending.find(b'\n')
            if end >= 0:
                if end + 1 > MAX_FRAME_BYTES:
                    raise ValueError('Fixed workflow consumer frame exceeds bounds')
                frame = bytes(self.pending[:end])
                del self.pending[:end + 1]
                return json.loads(frame.decode('utf-8'))
            if len(self.pending) >= MAX_FRAME_BYTES:
                raise ValueError('Fixed workflow consumer frame exceeds bounds')
            if not self.selector.select(remaining):
                raise ValueError('Fixed workflow consumer deadline')
            try:
                part = os.read(self.process.stdout.fileno(), min(4096, MAX_FRAME_BYTES - len(self.pending)))
            except BlockingIOError:
                continue
            if not part:
                raise ValueError('Fixed workflow consumer channel closed')
            self.pending.extend(part)

    def finish(self):
        self.process.stdin.close()
        self.process.stdin = None
        stdout, stderr = self.process.communicate(timeout=10)
        self.consumed = True
        private_file(self.proof / 'WORKFLOW_CONSUMER_AFTER_COMPLETION.log', stdout + '\n' + stderr)
        if self.process.returncode or stdout or self.pending:
            raise ValueError('Fixed workflow consumer did not close cleanly')

    def close(self):
        if self.closed:
            return
        self.closed = True
        failures = []
        if self.process is not None and not self.consumed:
            try:
                if self.process.poll() is None:
                    self.process.terminate()
            except BaseException:
                failures.append('termination')
            try:
                stdout, stderr = self.process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    self.process.kill()
                except BaseException:
                    failures.append('kill')
                try:
                    stdout, stderr = self.process.communicate(timeout=5)
                except BaseException:
                    failures.append('reaping')
                else:
                    self.consumed = True
            except BaseException:
                # One fallback for an ordinary communicate failure; only the
                # already-owned child is affected. Every wait remains bounded.
                try:
                    if self.process.poll() is None:
                        self.process.kill()
                    stdout, stderr = self.process.communicate(timeout=5)
                except BaseException:
                    failures.append('reaping')
                else:
                    self.consumed = True
            else:
                self.consumed = True
            if self.consumed:
                try:
                    private_file(self.proof / 'WORKFLOW_CONSUMER_INTERRUPTED.log', stdout + '\n' + stderr)
                except BaseException:
                    failures.append('evidence')
            try:
                if not self.consumed or self.process.poll() is None:
                    failures.append('child still owned')
            except BaseException:
                failures.append('child status')
        # A selector failure cannot bypass child reaping, nor vice versa.
        if self.selector is not None:
            try:
                self.selector.close()
            except BaseException:
                failures.append('selector')
        if failures:
            raise RuntimeError('Fixed workflow consumer cleanup held: ' + ', '.join(failures))

    def __exit__(self, *_exception):
        self.close()
