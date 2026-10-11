"""Unconnected fixed HTTPS transport candidate using reviewed sealed bytes.

This has no CLI, native scope, source approval, raw root, collector writer,
schedule or publication. The future trusted caller must confirm source/dispatch
authority before calling the broker. Tests never give a valid HTTP startup to
the actual child. Invented and private-source archives are distinct purposes.
"""
from hashlib import sha256
from io import BytesIO
import json
import os
from re import fullmatch
from zipfile import ZipFile

from workers.linux_parent_lifetime import arm_parent_lifetime
from workers.ssb_14059_pair_transport import _serve_child
from workers.ssb_14059_transport import fetch_ssb_14059_once
from workers.ssb_frozen_source import FrozenSSBSource
from workers.ssb_sealed_transport import SealedSSBTransportBroker

CONTRACT_SHA256 = '250c48fef4492ccdfc0b666bb770f3f55df6b01bc08a453daa1a09449ed3ccc2'
ROOTS = ['workers.ssb_frozen_private_transport']

# Independent standard-library validation precedes importing candidate modules.
# Only metadata/data are accepted; there is no worker/channel or purpose flag.
BOOTSTRAP = r'''
import fcntl,hashlib,io,json,os,re,stat,sys,zipfile
try:
    if len(sys.argv)!=6 or sys.argv[1] not in ('metadata','data'):
        raise ValueError
    kind,fd_text,archive_hash,source_hash,parent_text=sys.argv[1:]
    if not all(re.fullmatch('[0-9a-f]{64}',x) for x in (archive_hash,source_hash)) or not all(re.fullmatch('[1-9][0-9]{0,9}',x) for x in (fd_text,parent_text)):
        raise ValueError
    fd,parent=int(fd_text),int(parent_text)
    if fd<3 or not 1<parent<2**31 or os.getppid()!=parent or set(os.environ)-{'LC_CTYPE'} or ('LC_CTYPE' in os.environ and os.environ['LC_CTYPE']!='C.UTF-8') or not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode:
        raise ValueError
    info=os.fstat(fd);seals=fcntl.F_SEAL_WRITE|fcntl.F_SEAL_GROW|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_SEAL
    if not stat.S_ISREG(info.st_mode) or not 1<=info.st_size<=4194304 or fcntl.fcntl(fd,fcntl.F_GET_SEALS)&seals!=seals:
        raise ValueError
    raw=os.pread(fd,info.st_size+1,0)
    if len(raw)!=info.st_size or hashlib.sha256(raw).hexdigest()!=archive_hash:
        raise ValueError
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members=archive.infolist();names=[m.filename for m in members]
        if len(names)!=len(set(names)) or not 3<=len(names)<=128 or any(m.compress_type!=zipfile.ZIP_STORED or m.file_size>262144 for m in members):
            raise ValueError
        manifest=archive.read('MANIFEST.json')
        if len(manifest)>32768 or hashlib.sha256(manifest).hexdigest()!=source_hash:
            raise ValueError
        payload=json.loads(manifest);files=payload['files']
        contract_hash=hashlib.sha256(json.dumps(payload['contract'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
        if payload['roots']!=['workers.ssb_frozen_private_transport'] or contract_hash!='250c48fef4492ccdfc0b666bb770f3f55df6b01bc08a453daa1a09449ed3ccc2' or type(files) is not dict or not files or set(names)!=set(files)|{'MANIFEST.json'}:
            raise ValueError
        for name,expected in files.items():
            if not re.fullmatch(r'(workers/[a-z_][a-z0-9_]*\.py|scripts/ssb_execution_inventory\.py)',name) or hashlib.sha256(archive.read(name)).hexdigest()!=expected:
                raise ValueError
    interpreter=payload['interpreter']
    if interpreter['requestedPath']!='/usr/bin/python3.12' or interpreter['implementation']!=sys.implementation.name or interpreter['version']!=sys.version or not re.fullmatch('[0-9a-f]{64}',interpreter['sha256']):
        raise ValueError
    with open('/proc/self/exe','rb') as executable:
        before=os.fstat(executable.fileno())
        if not stat.S_ISREG(before.st_mode) or not 1<=before.st_size<=67108864:
            raise ValueError
        digest,count=hashlib.sha256(),0
        while count<=before.st_size:
            chunk=executable.read(min(1048576,before.st_size+1-count))
            if not chunk:break
            digest.update(chunk);count+=len(chunk)
        after=os.fstat(executable.fileno())
        if count!=before.st_size or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns) or digest.hexdigest()!=interpreter['sha256']:
            raise ValueError
    sys.path.insert(0,'/proc/self/fd/'+fd_text)
    from workers.ssb_frozen_private_transport import private_transport_main
    code=private_transport_main(kind,fd,archive_hash,source_hash,parent)
except Exception:
    print('Frozen private transport candidate refused the operation.',file=sys.stderr)
    raise SystemExit(1)
raise SystemExit(code)
'''


def check_private_transport_source(source):
    if type(source) is not FrozenSSBSource:
        raise ValueError('Private transport source refused')
    with ZipFile(BytesIO(source.check())) as archive:
        raw = archive.read('MANIFEST.json')
        value = json.loads(raw)
        contract_hash = sha256(json.dumps(value['contract'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        if sha256(raw).hexdigest() != source.source_fingerprint or value['roots'] != ROOTS \
                or contract_hash != CONTRACT_SHA256 \
                or set(archive.namelist()) != set(value['files']) | {'MANIFEST.json'}:
            raise ValueError('Private transport source purpose changed')
    return value


def private_child_command(kind, source, *, parent_pid):
    if type(kind) is not str or kind not in ('metadata', 'data') \
            or type(parent_pid) is not int or not 1 < parent_pid < 2**31 \
            or type(source) is not FrozenSSBSource \
            or type(source.source_fingerprint) is not str \
            or fullmatch('[0-9a-f]{64}', source.source_fingerprint) is None:
        raise ValueError('Private transport startup refused')
    check_private_transport_source(source)
    return ['/usr/bin/python3.12', '-I', '-S', '-B', '-c', BOOTSTRAP, kind,
            str(source.descriptor), source.archive_sha256, source.source_fingerprint, str(parent_pid)]


class FrozenPrivateTransportBroker(SealedSSBTransportBroker):
    def __init__(self, source):
        check_private_transport_source(source)
        super().__init__(source)

    def _command(self, kind):
        return private_child_command(kind, self.source, parent_pid=os.getpid())


def private_transport_main(kind, descriptor, archive_hash, source_hash, parent_pid):
    arm_parent_lifetime(parent_pid)
    source = FrozenSSBSource(descriptor, archive_hash, source_hash, 0)
    check_private_transport_source(source)
    return _serve_child(['--single-response-child', kind], fetch_ssb_14059_once)
