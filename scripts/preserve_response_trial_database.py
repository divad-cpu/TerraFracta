"""Gracefully stop and hash-archive only this round's owned fictional DB.

Original rows, files and volume remain; no reset, deletion, source bytes,
primary change or network. Failure archives/logs are retained, never replaced.
"""
from datetime import datetime,timezone
import gzip
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
from scripts.prepare_response_reservation_trial import TRIAL,CLI
from scripts.fictional_response_backend import verify_target,CONTAINER
from scripts.private_diagnostic_redaction import sanitize_docker_metadata

IMAGE='sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453'
VOLUME='supabase_db_terrafracta-response30-20261001'
DEST=TRIAL/'database-preservation'


def run(args,name,timeout=30,allow_failure=False):
    p=subprocess.run(args,capture_output=True,timeout=timeout)
    file=DEST/(name+'.log');fd=os.open(file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'wb') as f:f.write(sanitize_docker_metadata(p.stdout.decode()).encode()+b'\n'+p.stderr)
    if p.returncode and not allow_failure:raise RuntimeError('Private preservation step failed: '+name)
    return p.stdout


def helper(command):
    return ['docker','run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--cap-add','DAC_OVERRIDE',
      '--mount','type=volume,source='+VOLUME+',target=/evidence,readonly','--entrypoint','/bin/bash',IMAGE,'-c',command]


def stopped(name):
    meta=json.loads(run(['docker','volume','inspect',VOLUME],name))[0]
    assert meta['Name']==VOLUME and meta['Labels']['com.supabase.cli.project']=='terrafracta-response30-20261001'
    assert not run(['docker','ps','--filter','volume='+VOLUME,'--format','{{.ID}}'],name+'_active').strip()


def checksums(name):
    raw=run(helper('set -e; cd /evidence; find . -type f -exec sha256sum {} +'),name)
    rows={}
    for line in raw.decode().splitlines():
        digest,path=line.split('  ',1)
        assert len(digest)==64 and path.startswith('./') and '..' not in Path(path).parts and path not in rows
        rows[path]=digest
    return raw,rows


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed preservation accepts no arguments')
    os.umask(0o077)
    assert not DEST.exists();DEST.mkdir(mode=0o700)
    audit=json.loads((TRIAL/'FINAL_DATABASE_AUDIT.json').read_text())
    assert audit['testRoleLogins']==0 and audit['maximumLifetimeCompleted'] and audit['liveRawPairs']==0
    verify_target(migration_count=34)
    meta=json.loads(run(['docker','container','inspect',CONTAINER],'owned_container'))[0]
    assert meta['Image']==IMAGE and meta['Config']['Labels']['com.supabase.cli.project']=='terrafracta-response30-20261001'
    assert [(m['Name'],m['Destination']) for m in meta['Mounts']]==[(VOLUME,'/var/lib/postgresql/data')]
    # Explicit fast PostgreSQL shutdown writes a clean control checkpoint. This
    # own stack has no remaining client work, and its evidence was read above.
    run(['docker','update','--restart=no',CONTAINER],'disable_owned_auto_restart')
    run(['docker','exec','--user','100:101',CONTAINER,'/nix/var/nix/profiles/default/bin/pg_ctl',
      '-D','/var/lib/postgresql/data','stop','-m','fast','-w','-t','10'],'graceful_postgres_stop',allow_failure=True)
    ended=json.loads(run(['docker','container','inspect',CONTAINER],'postgres_exited'))[0]
    assert not ended['State']['Running'] and ended['HostConfig']['RestartPolicy']['Name']=='no'
    run([str(CLI),'stop','--workdir',str(TRIAL)],'normal_supabase_stop')
    stopped('stopped_before')
    control=run(helper('/nix/var/nix/profiles/default/bin/pg_controldata /evidence'),'shutdown_control').decode()
    assert 'Database cluster state:               shut down' in control
    raw,hashes=checksums('source_before')
    check=DEST/'source-sha256.txt';check.write_bytes(raw);check.chmod(0o600)
    archive=DEST/(VOLUME+'.tar.gz');errors=DEST/'export-stderr.log'
    with archive.open('xb') as out,errors.open('xb') as err:
        p=subprocess.Popen(helper('set -e; cd /evidence; tar -cpf - .'),stdout=subprocess.PIPE,stderr=err)
        try:
            with gzip.GzipFile(filename='',mode='wb',compresslevel=1,fileobj=out,mtime=0) as compressed:
                for chunk in iter(lambda:p.stdout.read(1024*1024),b''):compressed.write(chunk)
        finally:p.stdout.close()
        assert p.wait(timeout=30)==0
    verified={};payload=0
    with tarfile.open(archive,'r:gz') as tar:
        for member in tar:
            assert not member.name.startswith('/') and '..' not in Path(member.name).parts
            assert member.isfile() or member.isdir()
            if member.isfile():
                key='./'+member.name.removeprefix('./');assert key in hashes and key not in verified
                f=tar.extractfile(member);h=sha256()
                with f:
                    for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
                verified[key]=h.hexdigest();payload+=member.size
    assert verified==hashes
    with gzip.open(archive,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):pass
    stopped('stopped_after');_,after=checksums('source_after');assert after==hashes
    result={'evidenceKind':'private_stopped_fictional_database_preservation','observedAt':datetime.now(timezone.utc).isoformat(),
      'volume':VOLUME,'imageId':IMAGE,'regularFilesVerified':len(hashes),'payloadBytes':payload,'compressedBytes':archive.stat().st_size,
      'archiveSha256':sha256(archive.read_bytes()).hexdigest(),'checksumsSha256':sha256(raw).hexdigest(),
      'cleanShutdown':True,'sourceHashesUnchanged':True,'originalVolumeRetained':True,'gzipCrcChecked':True,
      'actualSourceFetches':0,'liveRawStoreCopied':False,'primaryChanged':False,'restoreTestPerformedForThisNewArchive':False}
    file=DEST/'PRESERVATION_RESULT.json';file.write_text(json.dumps(result,indent=2)+'\n');file.chmod(0o600)
    print('PASS owned trial stopped cleanly and privately archived; '+str(len(hashes))+' exact payload files verified, original volume retained.')
    return 0

if __name__=='__main__':raise SystemExit(main())
