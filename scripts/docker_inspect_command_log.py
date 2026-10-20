"""Closed diagnostic records for Docker inspect commands, never their output.

Callers keep the original subprocess result in memory for their existing checks.
This helper neither authenticates that result nor logs metadata, target names,
command arguments, stderr, stdout or their hashes. Other commands are outside
this boundary and return None for the caller's established logging path.
"""
from __future__ import annotations

import json


def docker_inspect_command_kind(command) -> str | None:
    """Classify only the fixed logical command spellings, without output access."""
    if type(command) not in (list, tuple) or len(command) < 2:
        return None
    if type(command[0]) is not str or command[0].rsplit('/', 1)[-1] != 'docker':
        return None
    if type(command[1]) is not str:
        return None
    if command[1] == 'inspect':
        kind = 'object'
    elif command[1] in ('container', 'volume', 'image') and len(command) > 2 and type(command[2]) is str and command[2] == 'inspect':
        kind = command[1]
    else:
        return None
    return kind


def docker_inspect_log_record(command, response) -> str | None:
    """Recognize the fixed local inspect spellings before any output access."""
    kind = docker_inspect_command_kind(command)
    if kind is None:
        return None
    # A malformed result must still not cause raw-output fallback. Completed
    # subprocesses normally have an exact integer returncode; unknown stays null.
    try:
        code = response.returncode
    except Exception:
        code = None
    if type(code) is not int or not -256 <= code <= 255:
        code = None
    return json.dumps({
        'evidenceKind': 'docker_inspect_command_result', 'objectKind': kind,
        'exitCode': code, 'stdoutRetained': False, 'stderrRetained': False,
        'metadataRetained': False,
    }, separators=(',', ':')) + '\n'
