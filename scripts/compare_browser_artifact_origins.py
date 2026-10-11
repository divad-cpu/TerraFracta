"""Private byte comparison between independently preserved audit/runtime builds.

No code evaluation or semantic mapping/identity/license attestation. Only the
exact emitted final audit annotation and terminal ASCII whitespace are removed.
Unknown or ambiguous bodies stay held. Both original private artifacts remain
required for readback; this small report is not a self-contained source bundle.
"""
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re

from scripts.artifact_notice_coverage import _canonical
from scripts.check_private_attempt_readiness import private_directory,private_read
from scripts.prepare_browser_origin_evidence import MANIFEST as AUDIT_MANIFEST,verify_browser_evidence
from scripts.prepare_local_web_candidate import MANIFEST as RUNTIME_MANIFEST,_inventory,verify_candidate
from scripts.prepare_server_notice_bundle import _exclusive,_relative,_unique

MANIFEST='BROWSER_RUNTIME_COMPARISON.json'
NORMALIZATION='Remove only final local audit map annotation; strip terminal ASCII space/tab/CR/LF from both bodies'
GUIDE=b'# Private browser/runtime byte comparison\n\nThis report requires both bound private artifacts for readback. Exact normalized code bytes associate selected runtime files with existing audit evidence. It does not prove semantic source mappings, upstream identity, complete origins, license compliance, Browser/host acceptance or release. Preserve unresolved and ambiguous files; execute no artifact code.\n'
FLAGS={'releaseCleared':False,'completeRuntimeOrigins':False,'semanticMappingsVerified':False,
    'upstreamAuthenticated':False,'legalObligationsReviewed':False,'browserExecuted':False,'hostAccepted':False}


def _json(raw):return json.loads(raw,object_pairs_hook=_unique)


def _normalized_audit(raw,suffix):
    expression=rb'(?:^|\n)//# sourceMappingURL=([A-Za-z0-9_-]+\.(?:js|css)\.map)[ \t\r\n]*$' if suffix=='.js' \
        else rb'/\*# sourceMappingURL=([A-Za-z0-9_-]+\.(?:js|css)\.map)[ \t\r\n]*\*/[ \t\r\n]*$'
    tail=raw[-512:];found=re.search(expression,tail)
    if found is None:raise ValueError('Audit annotation is unavailable')
    return raw[:len(raw)-len(tail)+found.start()].rstrip(b' \t\r\n'),found[1].decode('ascii')


def compare_origins(audit,runtime):
    """Read only both exact private inputs and derive a deterministic report."""
    audit=Path(audit);runtime=Path(runtime)
    verify_browser_evidence(audit);verify_candidate(runtime)
    audit_raw=private_read(audit/AUDIT_MANIFEST,limit=8*1024*1024)
    runtime_raw=private_read(runtime/RUNTIME_MANIFEST,limit=4*1024*1024)
    audited=_json(audit_raw);candidate=_json(runtime_raw)
    if candidate['schemaVersion']!=2:raise ValueError('Actual artifact coverage runtime required')
    trace=_json(private_read(runtime/'notice-candidates/TRACE_EVIDENCE.json',limit=4*1024*1024))
    origins={row['path']:row for row in audited['comparison']['originFiles']}
    if origins['pnpm-lock.yaml']['sha256']!=trace['lockSha256'] \
            or origins['docs/OSS_PACKAGE_INVENTORY.json']['sha256']!=trace['inventorySha256']:
        raise ValueError('Audit and runtime dependency evidence differs')
    index={}
    for row in audited['comparison']['codeMapLinks']:
        code=private_read(audit/'build/.next/static'/_relative(row['code']),limit=8*1024*1024)
        normalized,annotation=_normalized_audit(code,Path(row['code']).suffix)
        if (Path(row['code']).parent/annotation).as_posix()!=row['map'] \
                or sha256(code).hexdigest()!=row['codeSha256']:raise ValueError('Audit code binding differs')
        digest=sha256(normalized).hexdigest();index.setdefault((Path(row['code']).suffix,digest),[]).append(row)
    compared=[];noncode=[]
    for row in candidate['inventory']['entries']:
        if row['kind']!='file' or not row['path'].startswith('.next/static/'):continue
        if Path(row['path']).suffix not in {'.js','.css'}:noncode.append(row);continue
        code=private_read(runtime/_relative(row['path']),limit=8*1024*1024)
        if sha256(code).hexdigest()!=row['sha256']:raise ValueError('Runtime code binding differs')
        digest=sha256(code.rstrip(b' \t\r\n')).hexdigest();matches=index.get((Path(row['path']).suffix,digest),[])
        result={'runtimeCode':row['path'],'runtimeCodeSha256':row['sha256'],'normalizedSha256':digest,
            'state':'unique_normalized_byte_match' if len(matches)==1 else 'held_ambiguous' if matches else 'held_no_match'}
        if len(matches)==1:
            match=matches[0]
            result.update(auditCode=match['code'],auditCodeSha256=match['codeSha256'],
                auditMap=match['map'],auditMapSha256=match['mapSha256'],
                auditSourceReferences=[{'sourceIndex':source['sourceIndex'],'state':source['state']}
                    for source in audited['comparison']['sources'] if source['map']==match['map']])
        compared.append(result)
    data={'auditManifestSha256':sha256(audit_raw).hexdigest(),'runtimeManifestSha256':sha256(runtime_raw).hexdigest(),
        'auditBuildId':audited['comparison']['buildId'],'runtimeBuildId':candidate['buildId'],
        'lockSha256':trace['lockSha256'],'inventorySha256':trace['inventorySha256'],'normalization':NORMALIZATION,
        'codeComparisons':compared,'nonCodeAssets':noncode,
        'counts':{state:sum(row['state']==state for row in compared)
            for state in ('unique_normalized_byte_match','held_ambiguous','held_no_match')}}
    verify_browser_evidence(audit);verify_candidate(runtime)
    if private_read(audit/AUDIT_MANIFEST,limit=8*1024*1024)!=audit_raw \
            or private_read(runtime/RUNTIME_MANIFEST,limit=4*1024*1024)!=runtime_raw:
        raise ValueError('Comparison inputs changed')
    return data


def prepare_comparison(audit,runtime,destination):
    audit=Path(audit);runtime=Path(runtime)
    if not isinstance(destination,Path) or not destination.is_absolute() or '..' in destination.parts \
            or destination.exists() or destination.is_symlink() \
            or destination.is_relative_to(audit) or destination.is_relative_to(runtime):raise ValueError('Invalid fresh comparison destination')
    private_directory(destination.parent);data=compare_origins(audit,runtime)
    destination.mkdir(mode=0o700)
    result={'schemaVersion':1,'evidenceKind':'private_browser_runtime_byte_comparison',
        'recordedAt':datetime.now(timezone.utc).isoformat(),'comparison':data,**FLAGS}
    _exclusive(destination/'README.md',GUIDE)
    _exclusive(destination/MANIFEST,(json.dumps(result,sort_keys=True,indent=2)+'\n').encode())
    descriptor=os.open(destination,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(descriptor)
    finally:os.close(descriptor)
    return verify_comparison(destination,audit,runtime)


def verify_comparison(directory,audit,runtime):
    private_directory(directory)
    before=_inventory(directory,private=True)
    if before['directories'] or any(row['kind']!='file' for row in before['entries']) \
            or {row['path'] for row in before['entries']}!={MANIFEST,'README.md'}:raise ValueError('Comparison namespace differs')
    saved=_json(private_read(directory/MANIFEST,limit=4*1024*1024))
    if type(saved) is not dict or set(saved)!={'schemaVersion','evidenceKind','recordedAt','comparison',*FLAGS} \
            or type(saved['schemaVersion']) is not int or saved['schemaVersion']!=1 \
            or saved['evidenceKind']!='private_browser_runtime_byte_comparison' \
            or any(saved[k] is not v for k,v in FLAGS.items()) \
            or datetime.fromisoformat(saved['recordedAt']).utcoffset()!=timezone.utc.utcoffset(None) \
            or private_read(directory/'README.md',limit=4096)!=GUIDE:raise ValueError('Comparison receipt differs')
    actual=compare_origins(audit,runtime)
    if _canonical(actual)!=_canonical(saved['comparison']) or _inventory(directory,private=True)!=before:
        raise ValueError('Comparison evidence differs')
    return {'evidenceKind':'private_browser_runtime_comparison_readback','auditBuildId':actual['auditBuildId'],
        'runtimeBuildId':actual['runtimeBuildId'],'codeAssets':len(actual['codeComparisons']),
        'nonCodeAssets':len(actual['nonCodeAssets']),'counts':actual['counts'],'releaseCleared':False,
        'completeRuntimeOrigins':False,'filesExecuted':False,'originalInstallOpened':False}
