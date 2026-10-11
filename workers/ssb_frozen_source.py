"""Sealed Linux source bytes for a trusted caller's cooperative worker.

Only the reviewed Python source archive is sealed. The executing interpreter
file is measured before candidate import; the standard library, loader and OS
retain the existing documented trust boundary. No source
permission, database credential, path selector or live launch is created here.
"""
from dataclasses import dataclass
import fcntl
from hashlib import sha256
import os
from re import fullmatch
import stat
import sys

MAX_ARCHIVE_BYTES = 4 * 1024 * 1024
REQUIRED_SEALS = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL

# This standard-library bootstrap runs before importing any candidate module.
# -I -S -B removes cwd, user/site initialization, environment configuration and
# bytecode writes. No repository directory is added to the child's import path.
BOOTSTRAP = r'''
import fcntl, hashlib, io, json, os, re, stat, sys, zipfile
try:
    if len(sys.argv) != 8 or sys.argv[1] not in ('worker', 'metadata', 'data'):
        raise ValueError
    kind, fd_text, archive_hash, source_hash, channel_text, context_hash, parent_text = sys.argv[1:]
    if not all(re.fullmatch('[0-9a-f]{64}', value) for value in (archive_hash, source_hash, context_hash)):
        raise ValueError
    if not all(re.fullmatch('[1-9][0-9]{0,9}', value) for value in (fd_text, parent_text)):
        raise ValueError
    fd, parent = int(fd_text), int(parent_text)
    if fd < 3 or not 1 < parent < 2**31 or os.getppid() != parent:
        raise ValueError
    channel = int(channel_text)
    if str(channel) != channel_text or (kind == 'worker' and (channel < 3 or channel == fd)) or (kind != 'worker' and channel != -1):
        raise ValueError
    if set(os.environ) - {'LC_CTYPE'} or ('LC_CTYPE' in os.environ and os.environ['LC_CTYPE'] != 'C.UTF-8') or not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode:
        raise ValueError
    info = os.fstat(fd)
    seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
    if not stat.S_ISREG(info.st_mode) or not 1 <= info.st_size <= 4194304 or fcntl.fcntl(fd, fcntl.F_GET_SEALS) & seals != seals:
        raise ValueError
    raw = os.pread(fd, info.st_size + 1, 0)
    if len(raw) != info.st_size or hashlib.sha256(raw).hexdigest() != archive_hash:
        raise ValueError
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = archive.infolist()
        names = [member.filename for member in members]
        if len(names) != len(set(names)) or not 3 <= len(names) <= 128 or any(member.compress_type != zipfile.ZIP_STORED or member.file_size > 262144 for member in members):
            raise ValueError
        manifest = archive.read('MANIFEST.json')
        if len(manifest) > 32768 or hashlib.sha256(manifest).hexdigest() != source_hash:
            raise ValueError
        payload = json.loads(manifest)
        files = payload['files']
        if type(files) is not dict or not files or set(names) != set(files) | {'MANIFEST.json', 'fixtures/ssb_14059_metadata_minimal_2024_2025.json', 'fixtures/ssb_14059_jsonstat_minimal_2024_2025.json'}:
            raise ValueError
        for name, expected in files.items():
            if not re.fullmatch(r'(workers/[a-z_][a-z0-9_]*\.py|scripts/ssb_execution_inventory\.py)', name) or hashlib.sha256(archive.read(name)).hexdigest() != expected:
                raise ValueError
    interpreter = payload['interpreter']
    if interpreter['requestedPath'] != '/usr/bin/python3.12' or interpreter['implementation'] != sys.implementation.name or interpreter['version'] != sys.version or not re.fullmatch('[0-9a-f]{64}', interpreter['sha256']):
        raise ValueError
    # /proc/self/exe identifies this process's executable file, including after
    # path replacement. This does not seal loaded mappings or the OS runtime.
    with open('/proc/self/exe', 'rb') as executable:
        before = os.fstat(executable.fileno())
        if not stat.S_ISREG(before.st_mode) or not 1 <= before.st_size <= 67108864:
            raise ValueError
        digest, count = hashlib.sha256(), 0
        while count <= before.st_size:
            chunk = executable.read(min(1048576, before.st_size + 1 - count))
            if not chunk:
                break
            digest.update(chunk); count += len(chunk)
        after = os.fstat(executable.fileno())
        if count != before.st_size or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or digest.hexdigest() != interpreter['sha256']:
            raise ValueError
    sys.path.insert(0, '/proc/self/fd/' + fd_text)
    from workers.ssb_frozen_runtime import frozen_main
    code = frozen_main(kind, fd, archive_hash, source_hash, channel, context_hash, parent)
except Exception:
    print('Frozen private SSB worker refused the operation.', file=sys.stderr)
    raise SystemExit(1)
raise SystemExit(code)
'''


def check_sealed(descriptor, expected_hash):
    if sys.platform != 'linux' or type(descriptor) is not int or descriptor < 3 \
            or type(expected_hash) is not str or fullmatch('[0-9a-f]{64}', expected_hash) is None:
        raise ValueError('Frozen SSB source identity refused')
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or not 1 <= info.st_size <= MAX_ARCHIVE_BYTES \
                or fcntl.fcntl(descriptor, fcntl.F_GET_SEALS) & REQUIRED_SEALS != REQUIRED_SEALS:
            raise ValueError
        raw = os.pread(descriptor, info.st_size + 1, 0)
        if len(raw) != info.st_size or sha256(raw).hexdigest() != expected_hash:
            raise ValueError
        return raw
    except (OSError, ValueError, OverflowError):
        raise ValueError('Frozen SSB source identity refused') from None


def seal_source(raw):
    """Fixed source-only memory file; caller retains ownership until close."""
    if sys.platform != 'linux' or type(raw) is not bytes or not 1 <= len(raw) <= MAX_ARCHIVE_BYTES:
        raise ValueError('Frozen SSB source unavailable')
    descriptor = None
    try:
        descriptor = os.memfd_create('terrafracta-reviewed-ssb-source', os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
        os.fchmod(descriptor, 0o600)
        written = 0
        while written < len(raw):
            count = os.write(descriptor, raw[written:])
            if count <= 0:
                raise ValueError
            written += count
        fcntl.fcntl(descriptor, fcntl.F_ADD_SEALS, REQUIRED_SEALS)
        fingerprint = sha256(raw).hexdigest()
        if check_sealed(descriptor, fingerprint) != raw:
            raise ValueError
        return descriptor, fingerprint
    except (AttributeError, OSError, ValueError):
        if descriptor is not None:
            os.close(descriptor)
        raise ValueError('Frozen SSB source unavailable') from None


@dataclass(frozen=True)
class FrozenSSBSource:
    descriptor: int
    archive_sha256: str
    source_fingerprint: str
    source_files: int

    def check(self):
        return check_sealed(self.descriptor, self.archive_sha256)

    def close(self):
        os.close(self.descriptor)


def child_command(kind, source, *, channel=-1, context_sha256, parent_pid):
    """Build a literal isolated command; no executable/module selection."""
    if type(source) is not FrozenSSBSource or kind not in ('worker', 'metadata', 'data') \
            or type(channel) is not int or (kind == 'worker' and (channel < 3 or channel == source.descriptor)) \
            or (kind != 'worker' and channel != -1) or type(parent_pid) is not int \
            or not 1 < parent_pid < 2**31 or type(context_sha256) is not str \
            or fullmatch('[0-9a-f]{64}', context_sha256) is None \
            or fullmatch('[0-9a-f]{64}', source.source_fingerprint) is None:
        raise ValueError('Frozen SSB child context refused')
    source.check()
    return ['/usr/bin/python3.12', '-I', '-S', '-B', '-c', BOOTSTRAP, kind,
            str(source.descriptor), source.archive_sha256, source.source_fingerprint,
            str(channel), context_sha256, str(parent_pid)]
