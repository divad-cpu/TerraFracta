"""Private compiler/source/notice evidence for the opt-in local audit build.

Only the emitted flat-v3 Turbopack format is supported. Map annotations are
local data, never URLs to fetch. Content matches are not license clearance.
No server, Browser, dependency evaluation or original-source download.
"""
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import posixpath
import re
import secrets
import sys

from scripts.artifact_notice_coverage import _canonical,_notice_names
from scripts.audit_traced_open_source import ROOT,_package_root,_permitted
from scripts.check_private_attempt_readiness import private_directory,private_read
from scripts.prepare_local_web_candidate import _body,_inventory,_required_file
from scripts.prepare_server_notice_bundle import BASE,_exclusive,_private_parents,_relative,_unique

MANIFEST='BROWSER_ORIGIN_MANIFEST.json'
MAX_BYTES=64*1024*1024
MAX_FILES=1024
PROJECT='turbopack:///[project]/'
GUIDE=(b'# Private browser origin evidence\n\n'
    b'Exact compiler output, original source witnesses and available notice files from one '
    b'opt-in local audit build. This includes source code and stays owner-private. Do not '
    b'execute this evidence or distribute it as a runtime. Source-map links are never fetched. '
    b'Direct and installed-map embedded content matches are distinct from unresolved virtual '
    b'or generated sources. A match proves this recorded comparison, not upstream authentication, '
    b'complete license compliance, Browser/host acceptance or the origin of another build.\n')
FLAGS={'releaseCleared':False,'browserExecuted':False,'hostAccepted':False,
    'allModuleOriginsResolved':False,'legalObligationsReviewed':False,
    'dependenciesExecuted':False,'externalRequests':False}


def _json(raw):
    return json.loads(raw,object_pairs_hook=_unique)


def _map(raw):
    value=_json(raw)
    if type(value) is not dict or type(value.get('version')) is not int or value['version']!=3 \
            or 'sections' in value or value.get('sourceRoot','') not in ('',None) \
            or type(value.get('sources')) is not list or len(value['sources'])>2048 \
            or any(type(s) is not str or not 1<=len(s)<=4096 for s in value['sources']) \
            or type(value.get('mappings')) is not str:
        raise ValueError('Unsupported bounded compiler map')
    contents=value.get('sourcesContent',[None]*len(value['sources']))
    if type(contents) is not list or len(contents)!=len(value['sources']) \
            or any(s is not None and type(s) is not str for s in contents):
        raise ValueError('Invalid compiler source contents')
    return value,contents


def _annotation(raw,suffix):
    """Recognize only the fixed emitted final comment, not general JS/CSS."""
    expression=rb'(?:^|\n)//# sourceMappingURL=([A-Za-z0-9_-]+\.(?:js|css)\.map)\s*$' if suffix=='.js' \
        else rb'/\*# sourceMappingURL=([A-Za-z0-9_-]+\.(?:js|css)\.map)\s*\*/\s*$'
    found=re.search(expression,raw[-512:])
    if found:return found[1].decode('ascii')
    if b'sourceMappingURL=' in raw[-512:]:raise ValueError('Unsupported or external source-map annotation')
    return None


def derive_browser_origins(root,build):
    """Return a deterministic comparison and the exact bounded source witnesses."""
    root=Path(root);build=Path(build)
    configuration=_json(_body(_required_file(build,'.next/required-server-files.json')))['config']
    if configuration.get('output')!='standalone' or configuration.get('productionBrowserSourceMaps') is not True \
            or configuration.get('env')!={}:raise ValueError('Explicit private audit build required')
    build_id=_body(_required_file(build,'.next/BUILD_ID')).decode().strip()
    if re.fullmatch(r'[A-Za-z0-9_-]{1,128}',build_id) is None:raise ValueError('Invalid audit build identity')
    static=build/'.next/static';before=_inventory(static)
    if len(before['entries'])>MAX_FILES or before['bytes']>MAX_BYTES \
            or any(r['kind']!='file' for r in before['entries']):raise ValueError('Browser evidence exceeds bounds or contains links')
    source_bodies={};packages={};component_names=set();rows=[];links=[];unmapped=[]
    def source(relative):
        path=_relative(relative);_permitted(path)
        body=_body(_required_file(root,path))
        if len(body)>8*1024*1024:raise ValueError('Original source exceeds bounds')
        old=source_bodies.setdefault(path.as_posix(),body)
        if old!=body:raise ValueError('Original source changed')
        if len(source_bodies)>MAX_FILES or sum(map(len,source_bodies.values()))>MAX_BYTES:
            raise ValueError('Original source witnesses exceed bounds')
        return body
    inventory=_json(source('docs/OSS_PACKAGE_INVENTORY.json'))
    if inventory['pnpm_lock_sha256']!=sha256(source('pnpm-lock.yaml')).hexdigest():raise ValueError('Source lock differs from inventory')
    installed={(r['name'],r['version']):r['declared_license'] for r in inventory['packages']}
    def package(relative):
        path=root/_relative(relative);directory=_package_root(path,root/'node_modules')
        name=directory.relative_to(root).as_posix();raw=source(name+'/package.json');meta=_json(raw)
        expected=directory.name
        if directory.parent.name.startswith('@'):expected=directory.parent.name+'/'+expected
        if type(meta) is not dict or type(meta.get('name')) is not str or meta['name']!=expected \
                or re.fullmatch(r'(?:@[a-z0-9._-]+/)?[a-z0-9._-]+',meta['name']) is None \
                or type(meta.get('version')) is not str or not 1<=len(meta['version'])<=128 \
                or type(meta.get('license')) is not str or not 1<=len(meta['license'])<=256 \
                or (meta['name'],meta['version']) not in installed \
                or meta.get('license')!=installed[(meta['name'],meta['version'])]:
            raise ValueError('Source-map package differs from installed inventory')
        owner={'root':name,'name':meta['name'],'version':meta['version'],'declaredLicense':meta['license'],
            'metadataSha256':sha256(raw).hexdigest()}
        if name in packages and packages[name]!=owner:raise ValueError('Package identity changed')
        packages[name]=owner
        remainder=path.relative_to(directory)
        if remainder.parts[:2]==('dist','compiled') and len(remainder.parts)>3:
            width=4 if remainder.parts[2].startswith('@') else 3
            component_names.add((name,Path(*remainder.parts[:width]).as_posix()))
        return name,directory,path
    by_name={r['path']:r for r in before['entries']}
    for file in before['entries']:
        code_name=file['path'];suffix=Path(code_name).suffix
        if suffix not in {'.js','.css'}:continue
        code=_body(_required_file(static,code_name))
        if len(code)!=file['bytes'] or sha256(code).hexdigest()!=file['sha256']:raise ValueError('Browser code changed')
        annotation=_annotation(code,suffix)
        if annotation is None:unmapped.append(code_name);continue
        map_name=(Path(code_name).parent/annotation).as_posix()
        if map_name not in by_name:raise ValueError('Linked compiler map missing')
        raw=_body(_required_file(static,map_name));expected=by_name[map_name]
        if len(raw)!=expected['bytes'] or sha256(raw).hexdigest()!=expected['sha256']:raise ValueError('Compiler map changed')
        value,contents=_map(raw)
        links.append({'code':code_name,'codeSha256':file['sha256'],'map':map_name,'mapSha256':expected['sha256']})
        for index,(name,content) in enumerate(zip(value['sources'],contents)):
            relative=name.removeprefix(PROJECT) if name.startswith(PROJECT) else None
            path=None;generated=None
            # Missing contents cannot exempt a recognized identity from privacy.
            if relative is not None:
                if 'turbopack:' in relative:
                    generated=re.fullmatch(r'(.+\.json)\.\[json\]\.cjs/turbopack:///(.+)',relative)
                    if generated is None or generated[1]!=generated[2]:raise ValueError('Unsupported generated source identity')
                    path=_relative(generated[1])
                else:path=_relative(relative)
                _permitted(path)
            record={'map':map_name,'sourceIndex':index,'sourceName':name,
                'contentSha256':sha256(content.encode()).hexdigest() if content is not None else None}
            if content is None:record['state']='missing_source_content'
            elif not name.startswith(PROJECT):record['state']='unresolved_virtual_or_other_source'
            else:
                # JSON loader identities are generated modules, not disk paths.
                if generated is not None:
                    record['state']='unresolved_generated_source';rows.append(record);continue
                owner=None;directory=None;original=root/path
                if relative.startswith('node_modules/'):owner,directory,original=package(relative)
                if original.is_file():
                    original_raw=source(relative)
                    if original_raw!=content.encode():raise ValueError('Current source content differs from compiler evidence')
                    record.update(state='direct_source_match',witness=relative)
                elif owner and packages[owner]['name']=='next' and original.is_relative_to(directory/'src'):
                    installed_map=directory/'dist'/original.relative_to(directory/'src')
                    installed_map=installed_map.with_suffix('.js.map')
                    witness=installed_map.relative_to(root).as_posix()
                    if not installed_map.is_file():record['state']='unresolved_missing_installed_map'
                    else:
                        upstream,upstream_contents=_map(source(witness));matches=[]
                        for upstream_index,(upstream_name,upstream_body) in enumerate(zip(upstream['sources'],upstream_contents)):
                            if not upstream_name or '\\' in upstream_name or '://' in upstream_name or Path(upstream_name).is_absolute():
                                continue
                            resolved=posixpath.normpath((installed_map.parent/ upstream_name).as_posix())
                            if Path(resolved)==original and upstream_body==content:matches.append(upstream_index)
                        if len(matches)!=1:raise ValueError('Installed map does not uniquely bind original content')
                        record.update(state='embedded_installed_map_match',witness=witness,installedSourceIndex=matches[0])
                else:record['state']='unresolved_missing_source_file'
                if owner:record['packageRoot']=owner
            rows.append(record)
    if not links:raise ValueError('No linked compiler maps available')
    notices=[];namespace=[]
    for owner in sorted(packages):
        directory=root/_relative(owner)
        selections=[(None,_notice_names(directory))]
        selections.extend((component,_notice_names(directory,component))
            for package_root,component in sorted(component_names) if package_root==owner)
        names=sorted({name for _,selected in selections for name in selected})
        for name in names:
            relative=owner+'/'+name;raw=source(relative)
            notices.append({'packageRoot':owner,'upstreamFile':name,'witness':relative,
                'bytes':len(raw),'sha256':sha256(raw).hexdigest()})
        namespace.extend((owner,component,names) for component,names in selections)
    if _inventory(static)!=before or any(source(p)!=body for p,body in list(source_bodies.items())) \
            or any(_notice_names(root/_relative(owner),component)!=names for owner,component,names in namespace):
        raise ValueError('Source or browser namespace changed during comparison')
    states={state:sum(r['state']==state for r in rows) for state in sorted({r['state'] for r in rows})}
    data={'buildId':build_id,'staticInventory':before,'codeMapLinks':links,
        'codeAssetsWithoutMap':unmapped,'sources':rows,'sourceStates':states,
        'packages':[packages[p] for p in sorted(packages)],
        'compiledComponents':[{'packageRoot':owner,'component':component} for owner,component in sorted(component_names)],
        'noticeFiles':notices,'originFiles':[{'path':p,'bytes':len(body),'sha256':sha256(body).hexdigest()}
            for p,body in sorted(source_bodies.items())]}
    return data,source_bodies


def prepare_browser_evidence(root,destination):
    root=Path(root).resolve(strict=True);private_directory(destination.parent)
    if not isinstance(destination,Path) or not destination.is_absolute() or '..' in destination.parts \
            or destination.is_relative_to(root) or destination.exists() or destination.is_symlink():raise ValueError('Invalid fresh browser evidence destination')
    data,bodies=derive_browser_origins(root,root)
    destination.mkdir(mode=0o700)
    for name,body in bodies.items():
        relative=Path('origins')/_relative(name);_private_parents(destination,relative.parent);_exclusive(destination/relative,body)
    build_names=['.next/BUILD_ID','.next/required-server-files.json']+['.next/static/'+r['path'] for r in data['staticInventory']['entries']]
    build_rows=[]
    for name in build_names:
        body=_body(_required_file(root,name));relative=Path('build')/_relative(name)
        _private_parents(destination,relative.parent);_exclusive(destination/relative,body)
        build_rows.append({'path':name,'bytes':len(body),'sha256':sha256(body).hexdigest()})
    observed,_=derive_browser_origins(root,root)
    reopened,_=derive_browser_origins(destination/'origins',destination/'build')
    if observed!=data or reopened!=data:raise ValueError('Browser/source evidence changed during exact copy')
    result={'schemaVersion':1,'evidenceKind':'private_browser_origin_and_notice_evidence',
        'recordedAt':datetime.now(timezone.utc).isoformat(),'comparison':data,'buildFiles':build_rows,**FLAGS}
    _exclusive(destination/'README.md',GUIDE)
    _exclusive(destination/MANIFEST,(json.dumps(result,sort_keys=True,indent=2)+'\n').encode())
    fd=os.open(destination,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
    return verify_browser_evidence(destination)


def verify_browser_evidence(directory):
    try:
        private_directory(directory)
        saved=_json(private_read(directory/MANIFEST,limit=8*1024*1024))
        keys={'schemaVersion','evidenceKind','recordedAt','comparison','buildFiles'}|set(FLAGS)
        if type(saved) is not dict or set(saved)!=keys or type(saved['schemaVersion']) is not int or saved['schemaVersion']!=1 \
                or saved['evidenceKind']!='private_browser_origin_and_notice_evidence' \
                or any(saved[k] is not v for k,v in FLAGS.items()):raise ValueError
        date=datetime.fromisoformat(saved['recordedAt'])
        if date.utcoffset()!=timezone.utc.utcoffset(None):raise ValueError
        all_files=_inventory(directory,private=True);expected={MANIFEST,'README.md'}
        for prefix,rows in [('origins',saved['comparison']['originFiles']),('build',saved['buildFiles'])]:
            for row in rows:
                if type(row) is not dict or set(row)!={'path','bytes','sha256'} or type(row['bytes']) is not int:raise ValueError
                path=_relative(row['path']);name=(Path(prefix)/path).as_posix()
                if name in expected:raise ValueError
                expected.add(name);body=private_read(directory/name,limit=8*1024*1024)
                if len(body)!=row['bytes'] or sha256(body).hexdigest()!=row['sha256']:raise ValueError
        allowed_dirs={'.'}
        for name in expected:allowed_dirs.update(str(p) for p in _relative(name).parents)
        if {r['path'] for r in all_files['entries']}!=expected or set(all_files['directories'])!=allowed_dirs-{'.'} \
                or any(r['kind']!='file' for r in all_files['entries']) \
                or private_read(directory/'README.md',limit=4096)!=GUIDE:raise ValueError
        actual,_=derive_browser_origins(directory/'origins',directory/'build')
        if _canonical(actual)!=_canonical(saved['comparison']):raise ValueError
        if _inventory(directory,private=True)!=all_files:raise ValueError
        return {'evidenceKind':'private_browser_origin_exact_readback','buildId':actual['buildId'],
            'staticFiles':len(actual['staticInventory']['entries']),'linkedMaps':len(actual['codeMapLinks']),
            'sourceEntries':len(actual['sources']),'sourceStates':actual['sourceStates'],
            'packages':len(actual['packages']),'noticeFiles':len(actual['noticeFiles']),
            'originFiles':len(actual['originFiles']),'codeAssetsWithoutMap':len(actual['codeAssetsWithoutMap']),
            'exactCopiedBytesMatch':True,'originalInstallOpened':False,'releaseCleared':False}
    except (OSError,ValueError,TypeError,KeyError,AttributeError):
        raise ValueError('Browser origin evidence refused; retain partial or original files') from None


def main():
    if sys.argv[1:]:raise ValueError('Fixed private browser evidence preparation accepts no arguments')
    destination=BASE/('browser-origin-evidence-'+datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')+'_'+secrets.token_hex(3))
    result=prepare_browser_evidence(ROOT,destination)
    print(json.dumps({'directory':str(destination),**result},indent=2));return 0


if __name__=='__main__':raise SystemExit(main())
