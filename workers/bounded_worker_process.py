"""Bounded pipe I/O and cleanup for a process the caller already owns.

No executable, credentials, environment, socket capability or source approval is
selected here. The trusted caller starts its exact child. Output is limited
while reading; cancellation, timeout or overflow kills and reaps that child.
"""
from dataclasses import dataclass
from fractions import Fraction
from math import isfinite
import os
import selectors
import subprocess
import time


class BoundedWorkerError(ValueError):
    """Generic private-process failure; never expose child output or paths."""


@dataclass(frozen=True)
class WorkerOutput:
    stdout: bytes
    stderr: bytes
    returncode: int


def communicate_bounded(process, payload: bytes, *, timeout=20, max_stdout=16384, max_stderr=1024,
        max_input=16384, timeout_ceiling=30):
    # Existing callers retain thirty seconds. The fixed local review custodian
    # explicitly selects forty-five; neither ceiling is an execution grant.
    if type(max_input) is not int or not 1 <= max_input <= 294912 \
            or type(payload) is not bytes or len(payload) > max_input \
            or type(timeout_ceiling) is not int or timeout_ceiling not in (30, 45) \
            or type(timeout) not in (int, float) or not 0 < timeout <= timeout_ceiling \
            or type(max_stdout) is not int or not 1 <= max_stdout <= 131072 \
            or type(max_stderr) is not int or not 1 <= max_stderr <= 4096 \
            or any(getattr(process, name, None) is None for name in ('stdin', 'stdout', 'stderr')):
        raise BoundedWorkerError('Invalid private process configuration')
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    caps = {'stdout': max_stdout, 'stderr': max_stderr}
    sent = 0
    failed = True
    try:
        def checked_tick(previous=None):
            try:
                tick=time.monotonic()
            except Exception:
                raise BoundedWorkerError('Private process clock unavailable') from None
            try:
                valid=type(tick) in (int,float) and isfinite(tick)
            except OverflowError:
                valid=False
            if not valid or (previous is not None and tick<previous):
                raise BoundedWorkerError('Private process clock unavailable')
            return tick
        started=checked_tick()
        previous=started
        try:
            approximate_deadline=started+timeout
            valid_interval=isfinite(approximate_deadline) and approximate_deadline>started
        except OverflowError:
            valid_interval=False
        if not valid_interval:
            raise BoundedWorkerError('Private process interval unavailable')
        deadline=Fraction(started)+Fraction(timeout)
        def remaining_work():
            nonlocal previous
            tick=checked_tick(previous)
            remaining=deadline-Fraction(tick)
            if remaining<=0:
                raise BoundedWorkerError('Private process deadline reached')
            previous=tick
            return float(remaining)
        with selectors.DefaultSelector() as selector:
            for name in ('stdin', 'stdout', 'stderr'):
                stream = getattr(process, name)
                os.set_blocking(stream.fileno(), False)
                if name == 'stdin' and not payload:
                    stream.close()
                else:
                    selector.register(stream, selectors.EVENT_WRITE if name == 'stdin' else selectors.EVENT_READ, name)
            while selector.get_map():
                remaining = remaining_work()
                for key, _events in selector.select(remaining):
                    remaining_work()
                    name, stream = key.data, key.fileobj
                    if name == 'stdin':
                        count = os.write(stream.fileno(), payload[sent:sent + 4096])
                        if count <= 0:
                            raise BoundedWorkerError('Private process input unavailable')
                        sent += count
                        if sent == len(payload):
                            selector.unregister(stream)
                            stream.close()
                    else:
                        # Read at most one byte past the remaining cap. A child
                        # cannot force arbitrary allocation before size checking.
                        chunk = os.read(stream.fileno(), min(4096, caps[name] + 1 - len(buffers[name])))
                        if not chunk:
                            selector.unregister(stream)
                            stream.close()
                        else:
                            buffers[name].extend(chunk)
                            if len(buffers[name]) > caps[name]:
                                raise BoundedWorkerError('Private process output limit reached')
            remaining = remaining_work()
            process.wait(timeout=remaining)
            remaining_work()
        failed = False
        return WorkerOutput(bytes(buffers['stdout']), bytes(buffers['stderr']), process.returncode)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise BoundedWorkerError('Private process unavailable or outside its bounds') from None
    finally:
        if failed and process.poll() is None:
            process.kill()
        if process.poll() is None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                raise BoundedWorkerError('Private process cleanup unavailable') from None
        for name in ('stdin', 'stdout', 'stderr'):
            stream = getattr(process, name)
            if stream is not None and not stream.closed:
                stream.close()
