"""Opt-in cooperative Linux lifetime launcher for a trusted native command.

Reuse the existing creating-thread death guard, then ordinary exec in the
same owned process. No SQL, credential or worker-selected argument is added.
This is not command authentication, descendant supervision or remote rollback.
"""
import errno
import os
from pathlib import Path
import stat
import sys
import threading


def native_parent_command(command):
    if sys.platform != 'linux' or type(command) is not tuple or not 1 <= len(command) <= 24 \
            or any(type(arg) is not str or not 1 <= len(arg) <= 4096 or '\0' in arg for arg in command) \
            or not command[0].startswith('/') or not os.path.isabs(sys.executable):
        raise ValueError('Native parent lifetime unavailable')
    return (sys.executable, '-I', '-S', '-B', str(Path(__file__).resolve()),
            str(os.getpid()), str(threading.get_native_id()), *command)


def _ordinary_executable(path):
    entry = os.stat(path)
    if not stat.S_ISREG(entry.st_mode) or entry.st_mode & (stat.S_ISUID | stat.S_ISGID):
        raise ValueError
    try:
        # File capabilities or set-id exec would clear PR_SET_PDEATHSIG.
        # An unsupported inspection is held, not interpreted as no capability.
        os.getxattr(path, 'security.capability')
    except OSError as error:
        if error.errno != errno.ENODATA: raise ValueError from None
    else:
        raise ValueError


def _launch(arguments):
    if type(arguments) is not tuple or not 3 <= len(arguments) <= 26:
        raise ValueError
    parent, creator, *command = arguments
    if any(type(value) is not str or not value.isascii() or not value.isdecimal()
           or not 1 < int(value) < 2**31 for value in (parent, creator)) \
            or any(type(arg) is not str or not 1 <= len(arg) <= 4096 or '\0' in arg for arg in command) \
            or not command[0].startswith('/'):
        raise ValueError
    creator_entry = Path('/proc') / parent / 'task' / creator
    if not creator_entry.is_dir(): raise ValueError
    _ordinary_executable(command[0])
    from workers.linux_parent_lifetime import arm_parent_lifetime
    arm_parent_lifetime(int(parent))
    # A creating thread can end before registration while its process survives.
    if not creator_entry.is_dir(): raise ValueError
    os.execve(command[0], command, {})
    raise ValueError  # exec never returns on success


def main():
    try:
        if sys.platform != 'linux': raise ValueError
        _launch(tuple(sys.argv[1:]))
    except Exception:
        sys.stderr.write('Native parent lifetime unavailable\n')
        return 1


if __name__ == '__main__':
    # Isolated interpreter startup imports only this fixed trusted parent root.
    # This is trusted source, not a candidate import or an environment selector.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    raise SystemExit(main())
