"""Map local Next server traces to installed notice evidence, never clearance.

Read generated manifests, bounded package metadata/notices and native hashes.
No dependency execution, bundle extraction, private-store read or deployment.
Traces are build observations, not the selected host's shipped artifact.
"""
from hashlib import sha256
import json
import os
from pathlib import Path
import sys

from scripts.oss_inventory import _is_notice_name
from scripts.private_material_names import PRIVATE_MATERIAL_NAMES

ROOT=Path(__file__).resolve().parents[1]
FORBIDDEN=set(PRIVATE_MATERIAL_NAMES)


def _permitted(relative):
    if any(part in FORBIDDEN or part.startswith('.env') for part in relative.parts):
        raise ValueError('Private material is present in the trace evidence boundary')


def _json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>2*1024*1024:
        raise ValueError('Trace or package metadata is unavailable')
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('Duplicate metadata field')
            result[key]=value
        return result
    return json.loads(path.read_bytes(),object_pairs_hook=unique)


def _evidence(path,base):
    _permitted(path.relative_to(base))
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(base):
        raise ValueError('Notice evidence leaves its installed component')
    size=path.stat().st_size
    if size>2*1024*1024:raise ValueError('Notice evidence is unexpectedly large')
    return {'file':path.relative_to(base).as_posix(),'bytes':size,'sha256':sha256(path.read_bytes()).hexdigest()}


def _package_root(path,modules):
    parts=path.relative_to(modules).parts
    start=3 if len(parts)>3 and parts[0]=='.pnpm' and parts[2]=='node_modules' else 0
    if not parts or parts[start].startswith('.'):
        raise ValueError('Traced package has an unsupported installation layout')
    end=start+(2 if parts[start].startswith('@') else 1)
    if len(parts)<end:raise ValueError('Traced package identity is incomplete')
    return modules.joinpath(*parts[:end])


def audit_traces(root):
    root=Path(root).resolve(strict=True);build=root/'.next';modules=(root/'node_modules').resolve(strict=True)
    if not modules.is_relative_to(root) or build.is_symlink():raise ValueError('Build boundary is invalid')
    manifests=[]
    for directory,subdirs,files in os.walk(build,followlinks=False):
        current=Path(directory)
        # Canonical production traces only. Next's standalone output duplicates
        # those traces and dependencies; the copied artifact has its own check.
        if current==build:subdirs[:]=[name for name in subdirs if name not in {'dev','cache','standalone'}]
        _permitted(current.relative_to(build))
        for name in subdirs:_permitted((current/name).relative_to(build))
        if any((current/name).is_symlink() for name in subdirs):raise ValueError('Trace directory is a link')
        for name in files:
            if name.endswith('.nft.json'):
                _permitted((current/name).relative_to(build))
                manifests.append(current/name)
        if len(manifests)>128:raise ValueError('Production traces exceed bounds')
    manifests.sort()
    if not 1<=len(manifests)<=128:raise ValueError('Production traces are missing or exceed bounds')
    saved=_json(root/'docs/OSS_PACKAGE_INVENTORY.json')
    if saved['pnpm_lock_sha256']!=sha256((root/'pnpm-lock.yaml').read_bytes()).hexdigest():
        raise ValueError('Saved package inventory differs from the current lock')
    installed={(row['name'],row['version']):row for row in saved['packages']}
    traced=set();trace_rows=[];entries=0
    for manifest in manifests:
        if any(parent.is_symlink() for parent in manifest.parents if parent.is_relative_to(build)):
            raise ValueError('Trace directory is a link')
        value=_json(manifest)
        if type(value) is not dict or type(value.get('version')) is not int or value['version']!=1 \
                or type(value.get('files')) is not list \
                or len(value['files'])>5000:raise ValueError('Invalid bounded build trace')
        files=value['files']
        if any(type(name) is not str or not 1<=len(name)<=4096 or '\\' in name or '\0' in name
                or Path(name).is_absolute() for name in files) or len(set(files))!=len(files):
            raise ValueError('Invalid or duplicate trace reference')
        for name in files:
            candidate=manifest.parent/name
            if any(part in FORBIDDEN or part.startswith('.env') for part in candidate.parts):
                raise ValueError('A private reference is present in the build trace')
            try:target=candidate.resolve(strict=True)
            except OSError:raise ValueError('A trace reference is unavailable') from None
            if not target.is_relative_to(root) or any(part in FORBIDDEN or part.startswith('.env') for part in target.parts):
                raise ValueError('A trace reference leaves the permitted build boundary')
            if not target.is_file() and not target.is_dir():raise ValueError('Unsupported trace reference')
            traced.add(target)
        entries+=len(files)
        trace_rows.append({'manifest':manifest.relative_to(build).as_posix(),
            'sha256':sha256(manifest.read_bytes()).hexdigest(),'entries':len(files)})
    groups={};project_references=0
    for path in sorted(traced):
        if not path.is_relative_to(modules):
            project_references+=1;continue
        package=_package_root(path,modules)
        groups.setdefault(package,[]).append(path)
    packages=[]
    for package,paths in sorted(groups.items()):
        metadata_path=package/'package.json';metadata=_json(metadata_path)
        identity=(metadata.get('name'),metadata.get('version'))
        if identity not in installed or metadata.get('license')!=installed[identity]['declared_license']:
            raise ValueError('Traced package is absent or changed in the saved inventory')
        notices=[]
        for path in sorted(package.iterdir()):
            _permitted(path.relative_to(package))
            if not _is_notice_name(path.name):continue
            if path.is_symlink():raise ValueError('Top-level notice is a link')
            if path.is_file():notices.append(_evidence(path,package))
        if notices!=installed[identity]['top_level_notice_files']:
            raise ValueError('Traced package notices differ from the saved inventory')
        compiled={}
        native=[]
        for path in paths:
            relative=path.relative_to(package)
            if identity[0]=='next' and relative.parts[:2]==('dist','compiled') and len(relative.parts)>2:
                component=package.joinpath(*relative.parts[:3])
                if component.is_dir() and component not in compiled:
                    named=[]
                    for candidate in sorted(component.rglob('*')):
                        _permitted(candidate.relative_to(component))
                        if candidate.is_symlink():raise ValueError('Compiled component contains a link')
                        if candidate.is_file() and _is_notice_name(candidate.name):named.append(_evidence(candidate,component))
                    compiled[component]={'component':component.relative_to(package).as_posix(),
                        'candidateNoticeFiles':named,
                        'noticeFilesReferencedByTrace':sum((component/row['file']).resolve() in traced for row in named),
                        'obligationsReviewed':False}
            if path.is_file() and (path.name.endswith('.node') or '.so.' in path.name or path.name.endswith('.so')):
                digest=sha256()
                with path.open('rb') as stream:
                    for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
                native.append({'file':relative.as_posix(),'bytes':path.stat().st_size,'sha256':digest.hexdigest(),
                    'bundledLibraryObligationsReviewed':False})
        readme=[]
        if native and (package/'README.md').is_file():readme=[_evidence(package/'README.md',package)]
        packages.append({'name':identity[0],'version':identity[1],'declaredLicense':metadata['license'],
            'packageMetadataSha256':sha256(metadata_path.read_bytes()).hexdigest(),
            'uniqueTracedReferences':len(paths),'directoryReferences':sum(path.is_dir() for path in paths),
            'topLevelNoticeFiles':notices,
            'noticeFilesReferencedByTrace':sum((package/row['file']).resolve() in traced for row in notices),
            'compiledComponentCandidates':list(compiled.values()),
            'nativeFiles':native,'nativeReadmeEvidence':readme})
    return {'schemaVersion':1,'evidenceKind':'local_server_trace_notice_candidates',
        'inventorySha256':sha256((root/'docs/OSS_PACKAGE_INVENTORY.json').read_bytes()).hexdigest(),
        'lockSha256':saved['pnpm_lock_sha256'],'traces':trace_rows,'traceEntries':entries,
        'uniqueResolvedReferences':len(traced),'projectReferences':project_references,'packages':packages,
        'browserBundlesAudited':False,'chosenHostArtifactAudited':False,'directoryContentsExpanded':False,
        'licenseTextsCopied':False,'releaseCleared':False,'dependenciesExecuted':False,'privateStoresOpened':False}


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed local trace audit accepts no arguments')
    print(json.dumps(audit_traces(ROOT),indent=2));return 0


if __name__=='__main__':raise SystemExit(main())
