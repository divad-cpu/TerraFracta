"""Shared bounded subprocess machinery for fixed sealed transport compositions.

Subclasses supply literal reviewed commands. No CLI, credential, channel,
endpoint selector, permission decision or retry is implemented by this base.
"""
import json
import os
import subprocess
from time import monotonic
from workers.bounded_worker_process import communicate_bounded
from workers.fixed_ssb_transport_broker import FixedSSBTransportBroker
from workers.ssb_14059_pair_transport import _MAX_WIRE_BYTES, _decode_capture
from workers.ssb_frozen_source import FrozenSSBSource


class SealedSSBTransportBroker(FixedSSBTransportBroker):
    def __init__(self, source):
        if type(source) is not FrozenSSBSource:
            raise ValueError('Sealed transport source refused')
        source.check()
        super().__init__()
        self.source = source
        self.response_kinds = []

    def _command(self, kind):
        raise ValueError('Sealed transport has no fixed entry')

    def _capture(self, kind, *, deadline):
        self._remaining(deadline, clock=monotonic)
        command = self._command(kind)
        self._remaining(deadline, clock=monotonic)
        process = None
        try:
            process = subprocess.Popen(command, cwd='/', env={}, close_fds=True,
                pass_fds=(self.source.descriptor,), stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self._remaining(deadline, clock=monotonic)
            packet = json.dumps({'kind': kind, 'deadline': deadline, 'parentPid': os.getpid()},
                                separators=(',', ':')).encode('ascii')
            remaining = self._remaining(deadline, clock=monotonic)
            output = communicate_bounded(process, packet, timeout=remaining,
                                         max_stdout=_MAX_WIRE_BYTES, max_stderr=1024)
        finally:
            if process is not None:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
                for name in ('stdin', 'stdout', 'stderr'):
                    stream = getattr(process, name)
                    if stream is not None and not stream.closed:
                        stream.close()
        if output.returncode or output.stderr:
            raise ValueError('Sealed response refused; no retry')
        self._remaining(deadline, clock=monotonic)
        capture = _decode_capture(kind, output.stdout)
        self._remaining(deadline, clock=monotonic)
        self.response_kinds.append(kind)
        return capture
