"""Install the reviewed two-unit private cleanup candidate from an owner terminal.

Requires ordinary administrator authentication in that terminal. No password is
read by Python or printed, stored or sent to Codex. Refuses conflicting existing
units; never removes a bundle, raw history, source data or existing settings.
"""
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

from scripts.prepare_raw_retention_bundle import BUNDLE_PARENT,BASE,service_text,TIMER
from scripts.verify_retention_bundle import verify

NAMES=('terrafracta-ssb-raw-retention.service','terrafracta-ssb-raw-retention.timer')
# Fixed privileged file destinations. Payload cannot select another pathname,
# executable, account or extra unit. Both files are checked before any write.
ROOT_INSTALL=r'''
import json,os,stat,sys
from pathlib import Path
p=json.loads(sys.stdin.buffer.read(12289))
names=('terrafracta-ssb-raw-retention.service','terrafracta-ssb-raw-retention.timer')
if type(p) is not dict or set(p)!=set(names) or any(type(p[n]) is not str or len(p[n].encode())>4096 for n in names):
 raise SystemExit('Invalid fixed cleanup installation payload')
base=Path('/etc/systemd/system')
for name in names:
 target=base/name
 if target.exists() or target.is_symlink():
  info=target.lstat()
  if target.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or target.read_bytes()!=p[name].encode():
   raise SystemExit('Existing cleanup unit differs; preserve it and review locally')
for name in names:
 target=base/name
 if not target.exists():
  fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
  with os.fdopen(fd,'wb') as handle:
   handle.write(p[name].encode());handle.flush();os.fsync(handle.fileno())
fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY)
os.fsync(fd);os.close(fd)
'''


def checked_candidate(proof):
    if not isinstance(proof,Path) or not proof.is_absolute() or '..' in proof.parts or not proof.is_relative_to(BASE) \
            or any(p.is_symlink() for p in (proof,*proof.parents)):
        raise ValueError('Invalid private prepared candidate')
    info=proof.stat()
    if not proof.is_dir() or info.st_uid!=os.getuid() or info.st_mode&0o777!=0o700:
        raise ValueError('Invalid private prepared candidate')
    record=proof/'PREPARE_RESULT.json'
    if record.is_symlink() or record.stat().st_size>4096:raise ValueError('Invalid private prepared result')
    payload=json.loads(record.read_bytes());fingerprint=payload['snapshotSha256']
    if type(fingerprint) is not str or re.fullmatch('[0-9a-f]{64}',fingerprint) is None \
            or payload['installed'] is not False or type(payload['actualSourceRequests']) is not int or payload['actualSourceRequests']!=0:
        raise ValueError('Invalid private prepared result')
    snapshot=proof/'snapshot';verify(snapshot)
    if sha256((snapshot/'MANIFEST.json').read_bytes()).hexdigest()!=fingerprint:
        raise ValueError('Prepared snapshot fingerprint changed')
    bundle=BUNDLE_PARENT/fingerprint
    expected={NAMES[0]:service_text(bundle),NAMES[1]:TIMER}
    for name in NAMES:
        file=proof/name
        if file.is_symlink() or file.stat().st_size>4096 or file.read_bytes()!=expected[name].encode():
            raise ValueError('Prepared cleanup unit changed')
    return snapshot,bundle,expected


def main():
    if len(sys.argv)!=2 or os.getuid()!=1000:
        print('Run as the project owner with the exact prepared private directory.',file=sys.stderr);return 2
    try:snapshot,bundle,units=checked_candidate(Path(sys.argv[1]))
    except Exception:
        print('Prepared cleanup candidate failed its integrity checks.',file=sys.stderr);return 1
    # Authenticate before creating a persistent snapshot. The terminal owns
    # the password prompt; this program never accepts or stores the password.
    auth=subprocess.run(['sudo','-v'],check=False)
    if auth.returncode:return auth.returncode
    try:
        for part in (BUNDLE_PARENT,*BUNDLE_PARENT.parents):
            if part.is_symlink():raise ValueError('Private snapshot parent is a symlink')
        BUNDLE_PARENT.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        BUNDLE_PARENT.mkdir(mode=0o700,exist_ok=True)
        for part in (BUNDLE_PARENT,BUNDLE_PARENT.parent):
            info=part.stat()
            if info.st_uid!=os.getuid() or info.st_mode&0o777!=0o700:
                raise ValueError('Private snapshot parent is not private')
        if bundle.exists():verify(bundle)
        else:shutil.copytree(snapshot,bundle,copy_function=shutil.copy2);verify(bundle)
        if sha256((bundle/'MANIFEST.json').read_bytes()).hexdigest()!=bundle.name:
            raise ValueError('Installed snapshot differs from prepared fingerprint')
        subprocess.run(['sudo','-n','/usr/bin/python3.12','-I','-c',ROOT_INSTALL],
            input=json.dumps(units,separators=(',',':')).encode(),check=True)
        subprocess.run(['sudo','-n','/usr/bin/systemctl','daemon-reload'],check=True)
        subprocess.run(['sudo','-n','/usr/bin/systemctl','enable','--now',NAMES[1]],check=True)
        subprocess.run(['sudo','-n','/usr/bin/systemctl','start',NAMES[0]],check=True)
        subprocess.run(['/usr/bin/systemctl','show',NAMES[0],'-p','Result','-p','ExecMainStatus'],check=True)
        subprocess.run(['/usr/bin/systemctl','show',NAMES[1],'-p','ActiveState','-p','NextElapseUSecRealtime'],check=True)
    except Exception:
        print('Cleanup installation incomplete; preserve its files and inspect the two named units locally.',file=sys.stderr);return 1
    print('Private cleanup installed. No source collection or publication enabled.')
    return 0

if __name__=='__main__':raise SystemExit(main())
