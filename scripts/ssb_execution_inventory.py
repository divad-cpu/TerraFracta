"""Freeze/verify the static local SSB worker closure without executing it.

This is source/interpreter inventory, not complete OS/runtime attestation or
source permission. The Python standard library, loader and OS are not sealed.
There is no collector entry point, channel, SQL, credential or source request.
"""
import ast
from hashlib import sha256
import json
import os
from pathlib import Path
from re import fullmatch
from stat import S_IMODE, S_ISDIR, S_ISREG
import subprocess
import sys
# Keep the verifier independent of candidate worker imports. The fixed contract
# is deliberately literal; tests reconcile it with the actual transport values.
METADATA_URL='https://data.ssb.no/api/pxwebapi/v2/tables/14059/metadata?lang=en'
DATA_URL=('https://data.ssb.no/api/pxwebapi/v2/tables/14059/data?lang=en'
    '&valueCodes%5BEierStatus%5D=0'
    '&valueCodes%5BContentsCode%5D=Boutg4%2CBoutg5%2CAntHushSvar'
    '&valueCodes%5BTid%5D=2024%2C2025')
MAX_RESPONSE_BYTES=65536
PAIR_DEADLINE_SECONDS=10


def _json(raw):
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('Duplicate SSB inventory field')
            result[key]=value
        return result
    def invalid(_value):raise ValueError('Nonfinite SSB inventory field')
    return json.loads(raw,object_pairs_hook=unique,parse_constant=invalid)

ROOTS=('workers.closed_ssb_worker','workers.fixed_ssb_transport_broker','workers.ssb_frozen_runtime')
SUPPORT={'scripts/ssb_execution_inventory.py'}
INTERPRETER=Path('/usr/bin/python3.12')
CONTRACT={'table':'14059','metadataUrl':METADATA_URL,'dataUrl':DATA_URL,
    'maxBodyBytes':MAX_RESPONSE_BYTES,'sharedDeadlineSeconds':PAIR_DEADLINE_SECONDS,
    'years':['2024','2025'],'tenure':['0'],'contents':['Boutg4','Boutg5','AntHushSvar'],
    'mode':'shadow','publicationEnabled':False,'scheduleEnabled':False}
RUNTIME_SCOPE='interpreter_binary_and_version_only; standard_library_loader_and_os_not_sealed'


def digest(path):
    h=sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def closure(root):
    """AST imports only; refuse unsupported local imports instead of guessing."""
    return _closure_for(root, ROOTS)


def _closure_for(root, roots, *, verified_bytes=None):
    # Fixed trusted wrappers supply their roots. This helper is not an entry
    # selector, launch grant or importer and executes no candidate code.
    pending=list(roots)+['workers'];selected=set(SUPPORT)
    while pending:
        module=pending.pop()
        name='workers/__init__.py' if module=='workers' else module.replace('.','/')+'.py'
        if name in selected:continue
        if len(selected)>=128:raise ValueError('Static SSB source closure oversized')
        if verified_bytes is not None:
            if name not in verified_bytes:raise ValueError('Unlisted static SSB dependency refused')
            body=verified_bytes[name]
        else:
            source=root/name
            if source.is_symlink() or any(parent.is_symlink() for parent in source.parents) or not source.is_file() or source.stat().st_size>262144:
                raise ValueError('Static SSB source closure refused')
            body=source.read_bytes()
        tree=ast.parse(body);selected.add(name)
        for node in ast.walk(tree):
            if isinstance(node,ast.ImportFrom):
                if node.level or node.module is None:raise ValueError('Unsupported static SSB import')
                modules=[node.module]
                if node.module=='workers':modules=['workers.'+a.name for a in node.names]
            elif isinstance(node,ast.Import):modules=[a.name for a in node.names]
            else:
                if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id in ('__import__','exec','eval'):
                    raise ValueError('Dynamic SSB imports are not inventoried')
                continue
            for imported in modules:
                if imported=='workers' or fullmatch(r'workers\.[a-z_][a-z0-9_]*',imported):pending.append(imported)
                elif imported.split('.')[0] not in sys.stdlib_module_names or imported.split('.')[0]=='importlib':
                    raise ValueError('Uninventoried SSB dependency')
    return frozenset(selected)


def runtime_record():
    actual=INTERPRETER.resolve(strict=True)
    if not actual.is_file() or actual.stat().st_size>67108864:
        raise ValueError('Fixed interpreter unavailable')
    result=subprocess.run([str(INTERPRETER),'-I','-B','-c',
        'import json,sys;print(json.dumps({"version":sys.version,"implementation":sys.implementation.name}))'],
        cwd='/',env={},capture_output=True,timeout=2,check=False)
    if result.returncode or result.stderr or len(result.stdout)>2048:
        raise ValueError('Fixed interpreter identity refused')
    version=_json(result.stdout)
    if type(version) is not dict or set(version)!={'version','implementation'} \
            or version['implementation']!='cpython' or not version['version'].startswith('3.12.'):
        raise ValueError('Fixed interpreter identity refused')
    return {'requestedPath':str(INTERPRETER),'resolvedPath':str(actual),'sha256':digest(actual),
            **version,'inventoryScope':RUNTIME_SCOPE}


def inventory(root):
    return _inventory_for(root, ROOTS, CONTRACT)


def _inventory_for(root, roots, contract):
    files={name:digest(root/name) for name in sorted(_closure_for(root, roots))}
    result={'schemaVersion':1,'roots':list(roots),'files':files,'interpreter':runtime_record(),'contract':contract}
    return json.dumps(result,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()+b'\n'


def _private(path,*,directory):
    info=path.lstat()
    if path.is_symlink() or info.st_uid!=os.getuid() or S_IMODE(info.st_mode)!=(0o700 if directory else 0o600) \
            or (not directory and (not path.is_file() or info.st_nlink!=1)) \
            or (directory and not path.is_dir()):
        raise ValueError('Private SSB source inventory refused')


def _private_read(path,*,limit=262144):
    """Bounded stable private bytes, including the path entry, without follow."""
    descriptor=None
    try:
        if not path.is_absolute() or '..' in path.parts or any(parent.is_symlink() for parent in path.parents):raise ValueError
        descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        before=os.fstat(descriptor)
        if not S_ISREG(before.st_mode) or before.st_uid!=os.getuid() or S_IMODE(before.st_mode)!=0o600 \
                or before.st_nlink!=1 or not 0<=before.st_size<=limit:raise ValueError
        raw=os.read(descriptor,limit+1)
        stable=lambda item:(item.st_dev,item.st_ino,item.st_mode,item.st_uid,item.st_gid,
            item.st_nlink,item.st_size,item.st_mtime_ns,item.st_ctime_ns)
        if len(raw)!=before.st_size or stable(os.fstat(descriptor))!=stable(before) or stable(path.lstat())!=stable(before):raise ValueError
        return raw
    except (OSError,ValueError):
        raise ValueError('Private SSB source bytes unavailable or changed') from None
    finally:
        if descriptor is not None:os.close(descriptor)


def _private_surface(root,files):
    """Reject unexpected names before opening bodies or descending directories."""
    pending=[root];seen_files=set();seen_dirs=set();count=0
    while pending:
        with os.scandir(pending.pop()) as entries:
            for entry in entries:
                count+=1
                if count>256:raise ValueError('Private SSB source inventory oversized')
                path=Path(entry.path);relative=str(path.relative_to(root));info=entry.stat(follow_symlinks=False)
                if S_ISDIR(info.st_mode):
                    if relative not in {'workers','scripts'}:raise ValueError('Private SSB source import surface changed')
                    _private(path,directory=True);seen_dirs.add(relative);pending.append(path)
                elif S_ISREG(info.st_mode):
                    if relative not in files|{'MANIFEST.json'}:raise ValueError('Private SSB source import surface changed')
                    _private(path,directory=False);seen_files.add(relative)
                else:raise ValueError('Private SSB source import surface changed')
    if seen_files!=files|{'MANIFEST.json'} or seen_dirs!={'workers','scripts'}:
        raise ValueError('Private SSB source import surface changed')


def verify(root,expected_fingerprint):
    """Caller pins the previously reviewed digest; never derive acceptance anew."""
    return _verify_for(root, expected_fingerprint, ROOTS, CONTRACT)


def _verify_for(root,expected_fingerprint,roots,contract):
    if type(expected_fingerprint) is not str or not fullmatch('[0-9a-f]{64}',expected_fingerprint):
        raise ValueError('Private SSB source identity refused')
    _private(root,directory=True)
    if any(parent.is_symlink() for parent in root.parents):raise ValueError('Private SSB source path refused')
    manifest=root/'MANIFEST.json';_private(manifest,directory=False)
    if manifest.stat().st_size>32768:raise ValueError('Private SSB source manifest oversized')
    raw=_private_read(manifest,limit=32768)
    if sha256(raw).hexdigest()!=expected_fingerprint:raise ValueError('Private SSB source identity changed')
    payload=_json(raw)
    if type(payload) is not dict or set(payload)!={'schemaVersion','roots','files','interpreter','contract'} \
            or type(payload['schemaVersion']) is not int or payload['schemaVersion']!=1 \
            or payload['roots']!=list(roots) or type(payload['files']) is not dict \
            or json.dumps(payload['contract'],sort_keys=True,separators=(',',':'))!=json.dumps(contract,sort_keys=True,separators=(',',':')):
        raise ValueError('Private SSB source manifest refused')
    files=set(payload['files'])
    required=set(SUPPORT)|{'workers/__init__.py'}|{module.replace('.','/')+'.py' for module in roots}
    if not 3<=len(files)<=128 or not required<=files or any(
            fullmatch(r'(?:workers/[a-z_][a-z0-9_]*\.py|scripts/ssb_execution_inventory\.py)',name) is None \
            or type(payload['files'][name]) is not str or fullmatch('[0-9a-f]{64}',payload['files'][name]) is None for name in files):
        raise ValueError('Private SSB source file manifest refused')
    _private_surface(root,files)
    pinned={name:_private_read(root/name) for name in sorted(files)}
    if any(sha256(body).hexdigest()!=payload['files'][name] for name,body in pinned.items()):
        raise ValueError('Private SSB source bytes changed')
    if _closure_for(root,roots,verified_bytes=pinned)!=files:raise ValueError('Private SSB source closure changed')
    if payload['interpreter']!=runtime_record():raise ValueError('Fixed SSB interpreter changed')
    # Reopen source after the interpreter observation as well as the manifest.
    # Stable different bytes cannot retain an earlier reviewed identity.
    for name in sorted(files):
        if sha256(_private_read(root/name)).hexdigest()!=payload['files'][name]:
            raise ValueError('Private SSB source bytes changed during verification')
    _private_surface(root,files)
    if _private_read(manifest,limit=32768)!=raw:raise ValueError('Private SSB source identity changed during verification')
    return {'files':len(files),'fingerprint':expected_fingerprint,'sourceRequests':0,
            'workerExecuted':False,'completeRuntimeSealed':False}


if __name__=='__main__':
    if sys.argv[1:]:raise SystemExit(2)
    root=Path(__file__).resolve().parents[1]
    try:result=verify(root,root.name)
    except Exception:
        print('Private SSB source inventory verification blocked.',file=sys.stderr);raise SystemExit(1)
    print(json.dumps(result,sort_keys=True))
