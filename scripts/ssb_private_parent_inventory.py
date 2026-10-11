"""Source-only review target for the trusted parent and exact private API.

AST discovery never imports candidate modules. This has no launch purpose,
channel, account, storage root or live operation. It does not widen any existing
worker inventory. The interpreter record retains its existing OS/loader limits.
"""
import ast
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import stat
import sys
from scripts.ssb_execution_inventory import _json, runtime_record

ROOTS = ('workers.private_collector_custodian', 'workers.private_admission_journal')
SUPPORT = ('scripts/ssb_private_parent_inventory.py', 'scripts/ssb_execution_inventory.py',
           'scripts/prepare_private_parent_source.py')
API = 'research/pending/TF009_private_ssb_capture_api_v2.sql'
API_SHA256 = '4041785939bc26d376da4d55e5bd1a7fee96025e548d4783b6ee85b2d1feb766'
PURPOSE = 'unselected_private_ssb_parent_api_review_only'
CONTRACT = {'purpose': PURPOSE, 'sourcePermissionIssued': False, 'workerLaunchAllowed': False,
    'nativeAccountSelected': False, 'custodianDeploymentSelected': False,
    'rawAndJournalLocationsSelected': False, 'loggingPolicySelected': False,
    'withdrawalCoordinationSelected': False, 'copyCoverageAccepted': False,
    'publicationEnabled': False, 'scheduleEnabled': False}


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode() + b'\n'


def _read(path, *, limit=262144, private=False):
    if not isinstance(path, Path) or not path.is_absolute() or '..' in path.parts \
            or any(parent.is_symlink() for parent in path.parents):
        raise ValueError('Parent source path refused')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1 \
                or before.st_mode & 0o002 or not 0 <= before.st_size <= limit \
                or (private and stat.S_IMODE(before.st_mode) != 0o600):
            raise ValueError('Parent source bytes refused')
        raw = os.read(descriptor, limit + 1)
        stable = lambda value: (value.st_dev, value.st_ino, value.st_mode, value.st_uid,
            value.st_gid, value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        if len(raw) != before.st_size or stable(os.fstat(descriptor)) != stable(before) \
                or stable(path.lstat()) != stable(before):
            raise ValueError('Parent source changed while reading')
        return raw
    finally:
        os.close(descriptor)


def _discover(read_named):
    """Traverse imports from supplied bytes without importing candidate code."""
    pending = list(ROOTS) + ['workers']; files = {}
    while pending:
        module = pending.pop()
        name = 'workers/__init__.py' if module == 'workers' else module.replace('.', '/') + '.py'
        if name in files:
            continue
        if len(files) >= 128:
            raise ValueError('Parent source closure oversized')
        raw = read_named(name)
        tree = ast.parse(raw)
        files[name] = raw
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if node.level or node.module is None or any(alias.name == '*' for alias in node.names):
                    raise ValueError('Unsupported parent source import')
                modules = [node.module]
                if node.module in ('workers', 'scripts'):
                    modules = [node.module + '.' + alias.name for alias in node.names]
            elif isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            else:
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                        and node.func.id in ('__import__', 'exec', 'eval'):
                    raise ValueError('Dynamic parent source import refused')
                continue
            for imported in modules:
                if imported == 'workers' or re.fullmatch(r'(workers|scripts)\.[a-z_][a-z0-9_]*', imported):
                    pending.append(imported)
                elif imported.split('.')[0] not in sys.stdlib_module_names or imported.split('.')[0] == 'importlib':
                    raise ValueError('Uninventoried parent dependency')
    for name in SUPPORT:
        raw = read_named(name)
        if name in files and files[name] != raw:
            raise ValueError('Parent support changed during discovery')
        files[name] = raw
    api = read_named(API)
    if sha256(api).hexdigest() != API_SHA256:
        raise ValueError('Private API candidate changed')
    files[API] = api
    if sum(map(len, files.values())) > 4 * 1024 * 1024:
        raise ValueError('Parent source packet oversized')
    return files


def source_bytes(root):
    """Discover the fixed local closure without candidate initialization.

    The existing trusted workspace uses owner-owned group-writable source.
    Those bytes may be prepared; the saved review snapshot must be 0700/0600.
    No hostile same-user/group workspace or live execution is accepted here.
    """
    if not isinstance(root, Path) or not root.is_absolute() or '..' in root.parts \
            or any(path.is_symlink() for path in (root, *root.parents)):
        raise ValueError('Parent source root refused')
    return _discover(lambda name: _read(root/name))


def _surface(root, names):
    """Check bounded names and private metadata before opening source bodies."""
    directories = {str(parent) for name in names for parent in Path(name).parents if str(parent) != '.'}
    seen_files, seen_dirs = set(), set(); pending = [root]; count = 0
    while pending:
        with os.scandir(pending.pop()) as entries:
            for entry in entries:
                count += 1
                if count > 256:
                    raise ValueError('Parent review snapshot oversized')
                path = Path(entry.path); relative = str(path.relative_to(root))
                metadata = entry.stat(follow_symlinks=False)
                if stat.S_ISDIR(metadata.st_mode):
                    if relative not in directories or metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o700:
                        raise ValueError('Private parent directory refused')
                    seen_dirs.add(relative); pending.append(path)
                elif stat.S_ISREG(metadata.st_mode):
                    if relative not in names | {'MANIFEST.json'}:
                        raise ValueError('Unexpected parent review file')
                    if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1:
                        raise ValueError('Private parent file refused')
                    seen_files.add(relative)
                else:
                    raise ValueError('Unexpected parent review entry')
    if seen_files != names | {'MANIFEST.json'} or seen_dirs != directories:
        raise ValueError('Parent review import surface changed')


def inventory(root):
    files = source_bytes(root)
    value = {'schemaVersion': 1, 'roots': list(ROOTS),
        'files': {name: sha256(raw).hexdigest() for name, raw in sorted(files.items())},
        'interpreter': runtime_record(), 'contract': CONTRACT, 'nativeApi': {'path': API, 'sha256': API_SHA256}}
    return _canonical(value)


def verify(root, reviewed_pin):
    """Verify a previously supplied digest; never derive live acceptance."""
    if type(reviewed_pin) is not str or re.fullmatch('[0-9a-f]{64}', reviewed_pin) is None:
        raise ValueError('Reviewed parent pin refused')
    if not isinstance(root, Path) or not root.is_absolute() or any(path.is_symlink() for path in (root, *root.parents)):
        raise ValueError('Private parent snapshot refused')
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError('Private parent snapshot refused')
    raw = _read(root/'MANIFEST.json', limit=32768, private=True)
    if sha256(raw).hexdigest() != reviewed_pin:
        raise ValueError('Reviewed parent identity changed')
    value = _json(raw)
    if type(value) is not dict or set(value) != {'schemaVersion', 'roots', 'files', 'interpreter', 'contract', 'nativeApi'} \
            or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 \
            or value['roots'] != list(ROOTS) or _canonical(value['contract']) != _canonical(CONTRACT) \
            or value['nativeApi'] != {'path': API, 'sha256': API_SHA256} or type(value['files']) is not dict \
            or _canonical(value) != raw:
        raise ValueError('Parent review manifest refused')
    names = set(value['files'])
    required = set(SUPPORT) | {API, 'workers/__init__.py'} | {module.replace('.', '/')+'.py' for module in ROOTS}
    if not 4 <= len(names) <= 132 or not required <= names or any(
            type(name) is not str or (name != API and re.fullmatch(r'(?:workers|scripts)/[a-z_][a-z0-9_]*\.py', name) is None)
            or type(value['files'][name]) is not str or re.fullmatch('[0-9a-f]{64}', value['files'][name]) is None
            for name in names):
        raise ValueError('Parent review file manifest refused')
    _surface(root, names)
    files = {name: _read(root/name, private=True) for name in sorted(names)}
    if any(sha256(body).hexdigest() != value['files'][name] for name, body in files.items()):
        raise ValueError('Parent review source bytes changed')
    def pinned_bytes(name):
        if name not in files:
            raise ValueError('Unlisted parent dependency refused')
        return files[name]
    if set(_discover(pinned_bytes)) != names:
        raise ValueError('Parent review source closure changed')
    if value['interpreter'] != runtime_record():
        raise ValueError('Parent review interpreter changed')
    # Reopened bytes must still match the supplied manifest. A local stable read
    # of different bytes is not evidence for the earlier reviewed fingerprint.
    for name in sorted(names):
        if sha256(_read(root/name, private=True)).hexdigest() != value['files'][name]:
            raise ValueError('Parent source changed during verification')
    _surface(root, names)
    if _read(root/'MANIFEST.json', limit=32768, private=True) != raw:
        raise ValueError('Parent review identity changed during verification')
    return {'evidenceKind': 'verified_private_parent_api_source_only', 'files': len(files),
        'fingerprint': reviewed_pin, 'sourceRequests': 0, 'candidateModulesImported': False,
        'workerExecuted': False, 'completeRuntimeSealed': False, **CONTRACT}
