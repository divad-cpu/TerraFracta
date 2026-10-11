"""Keep a cooperative Linux request child within its creating thread lifetime.

Called after strict startup parsing and before any source opening. Kernel
SIGKILL follows death of the thread that created the child; parent PID checks
before/after registration close the already-dead-parent race. This does not
seal libc/OS, authenticate the caller or isolate hostile same-user code.
"""
import ctypes
import os
import signal
import sys


def arm_parent_lifetime(expected_pid):
    if sys.platform != 'linux' or type(expected_pid) is not int or not 1 < expected_pid < 2**31 \
            or os.getppid() != expected_pid:
        raise ValueError('Fixed request parent lifetime unavailable')
    try:
        prctl = ctypes.CDLL(None, use_errno=True).prctl
        prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
        prctl.restype = ctypes.c_int
        # PR_SET_PDEATHSIG = 1. Fixed signal; no caller-selected process/signal.
        if prctl(1, signal.SIGKILL, 0, 0, 0) != 0 or os.getppid() != expected_pid:
            raise ValueError
    except (AttributeError, OSError, ValueError):
        raise ValueError('Fixed request parent lifetime unavailable') from None
