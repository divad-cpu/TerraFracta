"""Read-only integrity check for the explicitly provisioned cleanup snapshot."""
from hashlib import sha256
import json
from pathlib import Path
from stat import S_IMODE
import os
import re
import sys

FILES=frozenset({'workers/ssb_14059.py','workers/ssb_14059_metadata.py',
    'workers/ssb_14059_capture.py','workers/ssb_14059_raw_store.py','workers/ssb_14059_raw_custody.py',
    'scripts/ssb_raw_retention_service.py','scripts/verify_retention_bundle.py'})


def verify(root):
    if root.is_symlink() or not root.is_dir() or root.stat().st_uid!=os.getuid() or S_IMODE(root.stat().st_mode)!=0o700:
        raise ValueError('Private snapshot integrity refused')
    entries=list(root.rglob('*'))
    if any(p.is_symlink() for p in entries) or {str(p.relative_to(root)) for p in entries if p.is_dir()}!={'workers','scripts'}:
        raise ValueError('Private snapshot integrity refused')
    if any(p.stat().st_uid!=os.getuid() or S_IMODE(p.stat().st_mode)!=0o700 for p in entries if p.is_dir()):
        raise ValueError('Private snapshot integrity refused')
    manifest=root/'MANIFEST.json'
    if root.is_symlink() or manifest.is_symlink() or manifest.stat().st_size>4096:
        raise ValueError('Private snapshot integrity refused')
    manifest_bytes=manifest.read_bytes()
    if re.fullmatch('[0-9a-f]{64}',root.name) is not None and sha256(manifest_bytes).hexdigest()!=root.name:
        raise ValueError('Private snapshot identity changed')
    def unique(pairs):
        record={}
        for key,value in pairs:
            if key in record:raise ValueError('Duplicate private snapshot field')
            record[key]=value
        return record
    payload=json.loads(manifest_bytes,object_pairs_hook=unique)
    if type(payload) is not dict or set(payload)!= {'schemaVersion','files'} or type(payload['schemaVersion']) is not int \
            or payload['schemaVersion']!=1 or type(payload['files']) is not dict or set(payload['files'])!=FILES:
        raise ValueError('Private snapshot integrity refused')
    actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
    # Bytecode is disabled by the installed service; do not allow an extra
    # module or generated cache to alter the snapshot's import surface.
    if actual!=FILES|{'MANIFEST.json'}: raise ValueError('Private snapshot integrity refused')
    for name in FILES|{'MANIFEST.json'}:
        file=root/name;info=file.lstat()
        if file.is_symlink() or not file.is_file() or info.st_uid!=os.getuid() or S_IMODE(info.st_mode)!=0o600 \
                or info.st_nlink!=1 or any(part.is_symlink() for part in (file.parent,*file.parents)):
            raise ValueError('Private snapshot integrity refused')
        if name!='MANIFEST.json' and sha256(file.read_bytes()).hexdigest()!=payload['files'][name]:
            raise ValueError('Private snapshot integrity refused')
    return True


def main():
    if sys.argv[1:]:return 2
    try:verify(Path(__file__).resolve().parents[1])
    except Exception:
        print('Private cleanup snapshot integrity check blocked.',file=sys.stderr);return 1
    return 0

if __name__=='__main__':raise SystemExit(main())
