"""Synthetic Linux memory-retention feasibility probe, never a collector.

Run in a disposable child. No HTTP, raw source, persistence, timer, mount or
machine setting is changed. Temporary anonymous memory and per-process flags
end on exit. This probes primitives; it does not authorize a retention redesign.
"""
import ctypes
import json
import mmap
import os
from pathlib import Path
import platform


def locked_kib():
    for line in Path('/proc/self/status').read_text().splitlines():
        if line.startswith('VmLck:'):
            return int(line.split()[1])
    raise ValueError('Missing memory-lock evidence')


def hibernate_available():
    return 'disk' in Path('/sys/power/state').read_text().split()


def probe():
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        return {'state': 'unavailable', 'reason': 'unsupported_platform', 'actualSourceRequests': 0}
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    libc.mlockall.argtypes = [ctypes.c_int]
    libc.mlockall.restype = ctypes.c_int
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    before = hibernate_available()
    descriptor = -1
    mapping = None
    result = {'evidenceKind': 'synthetic_linux_memory_retention_probe', 'actualSourceRequests': 0,
              'rawSourceBytesStored': 0, 'persistentSettingsChanged': False, 'retentionPlanAccepted': False,
              'hibernateAvailableBefore': before}
    try:
        # Linux x86_64 UAPI: __NR_memfd_secret = 447. Check installed headers
        # during review; this intentionally refuses other platforms.
        descriptor = libc.syscall(ctypes.c_long(447), ctypes.c_uint(os.O_CLOEXEC))
        if descriptor < 0:
            result.update(state='unavailable', reason='secret_memory_unavailable', errno=ctypes.get_errno())
            return result
        if libc.prctl(4, 0, 0, 0, 0) != 0 or libc.prctl(3, 0, 0, 0, 0) != 0:
            result.update(state='unavailable', reason='dump_protection_unavailable')
            return result
        if libc.mlockall(1 | 2) != 0:
            result.update(state='unavailable', reason='process_memory_lock_unavailable', errno=ctypes.get_errno())
            return result
        os.ftruncate(descriptor, mmap.PAGESIZE)
        mapping = mmap.mmap(descriptor, mmap.PAGESIZE, flags=mmap.MAP_SHARED, prot=mmap.PROT_READ | mmap.PROT_WRITE)
        sentinel = b'SYNTHETIC-NO-SOURCE-CONTENT'
        mapping[:len(sentinel)] = sentinel
        if mapping[:len(sentinel)] != sentinel:
            raise ValueError('Synthetic mapping differs')
        during = hibernate_available()
        result.update(state='primitive_probe_passed', processDumpable=False, lockedKiB=locked_kib(),
                      anonymousSecretMemoryReadback=True, descriptorInheritable=os.get_inheritable(descriptor),
                      hibernateAvailableDuring=during)
        # No synthetic memory is exported; clear the owned mapping before close.
        mapping[:] = b'\0' * mmap.PAGESIZE
        mapping.close()
        mapping = None
        os.close(descriptor)
        descriptor = -1
        result['hibernateAvailableAfter'] = hibernate_available()
        if during or os.getpid() <= 0 or result['lockedKiB'] <= 0 or result['descriptorInheritable']:
            raise ValueError('Synthetic primitive proof incomplete')
        return result
    finally:
        if mapping is not None:
            mapping[:] = b'\0' * mmap.PAGESIZE
            mapping.close()
        if descriptor >= 0:
            os.close(descriptor)


if __name__ == '__main__':
    try:
        print(json.dumps(probe(), separators=(',', ':')))
    except Exception:
        print(json.dumps({'state': 'unavailable', 'reason': 'primitive_probe_incomplete', 'actualSourceRequests': 0}))
        raise SystemExit(1)
