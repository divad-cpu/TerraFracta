"""Manual new-target-only HTML original custody; dispatch after separate review.

No CLI/env target, source, network, provider, primary, grant or publication route.
The unchanged fresh custodian installs four unseeded feed baseline tables only.
"""
from __future__ import annotations
import ast,base64
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import importlib.metadata as metadata
import json,os,stat,sys,sysconfig
from pathlib import Path
from uuid import uuid4

from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json
from workers.html_passage_binding import HtmlDocumentReceipt,HtmlPassageBinding,HtmlSelectionMap,HtmlElementSelection
from workers.html_original_custody import (prepare_html_original,parse_stored_html_original,prepare_html_original_reopen,reopen_html_original,HtmlOriginalCustodyError)
from workers.pair_native_sql import _literal
from workers.stored_html_change import compile_stored_html_request
from workers.html_private_extraction import prepare_html_private_extraction,recheck_html_private_extraction

ROOT=Path(__file__).resolve().parents[1]
ENTRY='scripts/rehearse_html_original_custody.py'
NEW_FILES=(ENTRY,'workers/html_original_custody.py','tests/test_html_original_custody.py','tests/fixtures/invented_html_originals.sql','tests/test_html_original_custody_scope.py')


def _read(path):
    for part in [path,*path.parents]:
        if part.is_symlink():raise FeedPgTrialError('Frozen source symlink refused')
    def identity(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    before=path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size>1024*1024:raise FeedPgTrialError('Frozen source bound refused')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        if identity(os.fstat(fd))!=identity(before):raise FeedPgTrialError('Frozen source changed')
        with os.fdopen(fd,'rb',closefd=False) as stream:body=stream.read(before.st_size+1)
        if identity(os.fstat(fd))!=identity(before) or identity(path.stat())!=identity(before) or len(body)!=before.st_size:
            raise FeedPgTrialError('Frozen source changed')
        return body
    finally:os.close(fd)


def _runtime_files():
    files=[]
    for name,version,package in [('feedparser','6.0.14','feedparser'),('feedparser-sgmllib','2.1.0','feedparser_sgmllib')]:
        dist=metadata.distribution(name)
        if dist.version!=version or not dist.files:raise FeedPgTrialError('Locked parser runtime missing')
        notices=0
        for item in sorted(dist.files,key=str):
            parts=Path(str(item)).parts
            if not parts or '..' in parts or Path(str(item)).is_absolute() or not (parts[0]==package or parts[0].startswith(package+'-') and parts[0].endswith('.dist-info')):
                raise FeedPgTrialError('Locked parser source scope refused')
            path=Path(dist.locate_file(item));body=_read(path);notices+=int(path.name=='LICENSE')
            files.append(('packages/'+str(item),path,body))
        if not notices:raise FeedPgTrialError('Locked parser notices missing')
    stdlib=Path(sysconfig.get_path('stdlib'))
    for name in ('html/parser.py','html/__init__.py','html/entities.py','_markupbase.py','LICENSE.txt'):
        path=stdlib/name;files.append(('stdlib/'+name,path,_read(path)))
    return files


def freeze_html(trial):
    if trial.counter!=0 or trial.identity is not None or trial.creation_attempted or trial.initializer_attempted:
        raise FeedPgTrialError('Freeze must precede all resource commands')
    runtime=_runtime_files() # missing runtime holds before create or resource query
    names=set(NEW_FILES)|{'workers/stored_html_change.py','tests/test_stored_html_change.py','workers/html_private_extraction.py','tests/test_html_private_extraction.py'};pending=list(names)
    while pending:
        name=pending.pop();body=_read(ROOT/name)
        if name.endswith('.py'):
            for node in ast.walk(ast.parse(body)):
                modules=[node.module] if isinstance(node,ast.ImportFrom) and node.module else [n.name for n in node.names] if isinstance(node,ast.Import) else []
                for module in modules:
                    child=module.replace('.','/')+'.py'
                    if (ROOT/child).is_file() and child not in names:
                        names.add(child);pending.append(child)
    rows=[]
    for name in sorted(names):
        body=_read(ROOT/name)
        if name in trial.frozen:
            if trial.frozen[name]!=body:raise FeedPgTrialError('Previously frozen source changed')
            continue
        dest=trial.proof/'inputs'/name;dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with dest.open('xb') as stream:stream.write(body)
        dest.chmod(0o600);trial.frozen[name]=body;rows.append(dict(path=name,bytes=len(body),sha256=sha256(body).hexdigest()))
    runtime_rows=[]
    for name,path,body in runtime:
        dest=trial.proof/'inputs/runtime'/name;dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with dest.open('xb') as stream:stream.write(body)
        dest.chmod(0o600);runtime_rows.append(dict(path=str(path),frozen=str(dest.relative_to(trial.proof)),bytes=len(body),sha256=sha256(body).hexdigest()))
    trial.html_runtime=runtime_rows
    trial.source_bindings.extend(rows);trial.record('HTML_SOURCE_BINDINGS',rows);trial.record('HTML_RUNTIME_BINDINGS',runtime_rows)
    binary=Path(sys.executable).resolve(strict=True)
    trial.record('HTML_RUNTIME_BINARY',dict(path=str(binary),bytes=binary.stat().st_size,sha256=sha256(binary.read_bytes()).hexdigest(),copied=False,version=sys.version))
    verify_runtime(trial,'BEFORE_CREATE')


def verify_runtime(trial,label):
    for row in trial.html_runtime:
        body=_read(Path(row['path']));frozen=_read(trial.proof/row['frozen'])
        if body!=frozen or len(body)!=row['bytes'] or sha256(body).hexdigest()!=row['sha256']:raise FeedPgTrialError('HTML runtime source changed')
    trial.record('HTML_RUNTIME_CHECK_'+label,dict(files=len(trial.html_runtime),unchanged=True))


PROFILE_SQL="""select jsonb_build_object(
 'schema',(select jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',coalesce(nspacl::text,'')) from pg_namespace where nspname=SCHEMA),
 'objects',coalesce((select jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'persistence',c.relpersistence) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=SCHEMA),'[]'::jsonb),
 'tables',coalesce((select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,'acl',coalesce(c.relacl::text,''),
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'acl',coalesce(a.attacl::text,''),'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'kind',contype,'validated',convalidated,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid=c.oid),
 'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,'roles',polroles::text,'qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polname),'[]'::jsonb) from pg_policy where polrelid=c.oid),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) order by tgname),'[]'::jsonb) from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=SCHEMA and c.relkind='r'),'[]'::jsonb),
 'functions',coalesce((select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',coalesce(p.proacl::text,''),'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=SCHEMA),'[]'::jsonb),
 'privileges',coalesce((select jsonb_agg(v order by v::text) from (
 select jsonb_build_object('kind','schema','name',n.nspname,'grantee',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable) v from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x where n.nspname=SCHEMA
 union all select jsonb_build_object('kind','table','name',c.relname,'grantee',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x where n.nspname=SCHEMA and c.relkind='r'
 union all select jsonb_build_object('kind','function','name',p.proname,'grantee',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where n.nspname=SCHEMA) q),'[]'::jsonb));"""
ROLES_SQL="""select jsonb_build_object('roles',(select jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createrole',rolcreaterole,'createdb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypassrls',rolbypassrls,'limit',rolconnlimit,'validuntil',rolvaliduntil) order by rolname) from pg_roles),'members',(select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option) order by roleid,member),'[]'::jsonb) from pg_auth_members),'defaults',(select coalesce(jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(defaclrole),'schema',coalesce(nspname,''),'kind',defaclobjtype,'acl',defaclacl::text) order by defaclrole,defaclnamespace,defaclobjtype),'[]'::jsonb) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace));"""


def profile(trial,schema):
    if schema not in ('tf_feed_rehearsal','tf_html_rehearsal'):raise FeedPgTrialError('Fixed schema only')
    return json.loads(trial.query("begin isolation level repeatable read read only;"+PROFILE_SQL.replace('SCHEMA',_literal(schema))+'commit;').stdout)


def roles(trial):return json.loads(trial.query('begin isolation level repeatable read read only;'+ROLES_SQL+'commit;').stdout)
def rows(trial):
    return json.loads(trial.query("begin isolation level repeatable read read only;select jsonb_build_object('feed',(select jsonb_build_array((select count(*) from tf_feed_rehearsal.streams),(select count(*) from tf_feed_rehearsal.pages),(select count(*) from tf_feed_rehearsal.items),(select count(*) from tf_feed_rehearsal.outcomes))),'html',(select coalesce(jsonb_agg(jsonb_build_object('operation_id',operation_id,'artifact_id',artifact_id,'raw_sha256',encode(sha256(raw),'hex'),'metadata_sha256',encode(sha256(metadata),'hex'),'stored_at',stored_at) order by operation_id),'[]'::jsonb) from tf_html_rehearsal.originals));commit;").stdout)


def expected_profile(value):
    if value['schema']['name']!='tf_html_rehearsal' or value['schema']['owner']!='postgres' or len(value['tables'])!=1:return False
    table=value['tables'][0]
    if (table['name']!='originals' or table['owner']!='postgres' or not table['rls'] or table['forced'] or table['policies']!=[]
        or any(c['acl'] for c in table['columns'])
        or [(r['name'],r['kind'],r['owner'],r['persistence']) for r in value['objects']]!=[('originals','r','postgres','p'),('originals_artifact_id_key','i','postgres','p'),('originals_pkey','i','postgres','p')]
        or [c['name'] for c in table['columns']]!=['operation_id','artifact_id','raw','metadata','stored_at']
        or len(table['triggers'])!=1 or table['triggers'][0]['name']!='html_original_append_only' or table['triggers'][0]['enabled']!='O'):return False
    expected={'original_receipt':('p_operation uuid','jsonb'),'refuse_mutation':('','trigger'),'store_original':('p_metadata bytea, p_raw bytea','jsonb')}
    return (len(value['functions'])==3 and {f['name'] for f in value['functions']}==set(expected)
        and all((f['args'],f['result'])==expected[f['name']] and f['owner']=='postgres' and not f['definer'] and f['config']==['search_path=pg_catalog'] for f in value['functions'])
        and bool(value['privileges']) and all(r['grantee']==r['grantor']=='postgres' for r in value['privileges']))


def prepare_example(text,*,version=None,operation=None):
    raw=('<!DOCTYPE html><article id="chosen"><p>'+text+'</p><script>OMITTED</script></article>').encode();digest=sha256(raw).hexdigest();version=version or str(uuid4())
    at=datetime(2026,10,16,tzinfo=timezone.utc);url='https://example.org/invented-html.html';recipe=sha256(b'invented HTML chosen article recipe v1').hexdigest()
    document=HtmlDocumentReceipt('fictional-html','item-one',version,url,digest,at)
    binding=HtmlPassageBinding('fictional-html','item-one',version,url,digest,recipe,'en',at)
    mapping=HtmlSelectionMap(version,digest,recipe,'en',(HtmlElementSelection('article:one','chosen'),))
    return prepare_html_original(raw,document,binding=binding,mapping=mapping,operation_id=operation or str(uuid4()),prepared_at=datetime.now(timezone.utc),observed_at=datetime.now(timezone.utc))


def committed(trial,statement):
    result=trial.query(statement)
    return committed_pg_json(result.stdout,result.stderr,result.returncode)


def _direct(metadata_raw,original):
    return HEAD+"set time zone 'UTC';begin isolation level read committed read write;select tf_html_rehearsal.store_original(decode("+_literal(base64.b64encode(metadata_raw).decode())+",'base64'),decode("+_literal(base64.b64encode(original).decode())+",'base64'));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def cases(trial):
    feed=profile(trial,'tf_feed_rehearsal');principal=roles(trial)
    fixture=trial.frozen['tests/fixtures/invented_html_originals.sql'].decode()
    trial.query("begin;set local statement_timeout='10s';"+fixture+'commit;')
    html=profile(trial,'tf_html_rehearsal');trial.record('HTML_INSTALLED_PROFILE',html)
    trial.check('new_schema_exact_owner_inventory',expected_profile(html))
    trial.check('empty_feed_and_html',rows(trial)==dict(feed=[0,0,0,0],html=[]))
    previous=prepare_example('Earlier invented Å wording.');current=prepare_example('Revised invented Å &amp; exact wording.')
    records=[]
    for label,request in [('previous',previous),('current',current)]:
        receipt=committed(trial,request.statement());stored=parse_stored_html_original(receipt,request,observed_at=datetime.now(timezone.utc))
        (trial.proof/('HTML_'+label.upper()+'_FULL_RECEIPT.json')).write_bytes(receipt)
        replay=committed(trial,request.statement());trial.check(label+'_exact_committed_replay',replay==receipt)
        records.append((request,stored,receipt))
    trial.check('two_originals_no_feed_processing',len(rows(trial)['html'])==2 and rows(trial)['feed']==[0,0,0,0])
    baseline=rows(trial)
    conflict=prepare_example('Conflicting invented raw.',version=current.document.source_version_id,operation=current.intent.operation_id)
    failure=trial.query(conflict.statement(),allowed=True)
    trial.check('full_bytes_operation_conflict',failure.returncode!=0 and b'invented_html_operation_conflict' in failure.stderr and rows(trial)==baseline)
    for label,mutate in [('foreign_scope',lambda v:v['document'].update(source_url='https://foreign.example/one')),
                         ('raw_span_hash',lambda v:None),('span_bound',lambda v:None)]:
        target=prepare_example('New held invented operation.');value=json.loads(target.intent.canonical_metadata)
        if label!='foreign_scope':
            manifest=json.loads(value['derivation_manifest_json']);manifest['spans'][0].update(raw_sha256='0'*64) if label=='raw_span_hash' else manifest['spans'][0].update(end=len(target.raw)+1)
            value['derivation_manifest_json']=json.dumps(manifest,sort_keys=True,separators=(',',':'),ensure_ascii=False);value['derivation_manifest_sha256']=sha256(value['derivation_manifest_json'].encode()).hexdigest()
        else:mutate(value)
        failure=trial.query(_direct(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode(),target.raw),allowed=True)
        trial.check(label+'_native_refused_without_effect',failure.returncode!=0 and rows(trial)==baseline)
    target=prepare_example('Altered complete original bytes.')
    failure=trial.query(_direct(target.intent.canonical_metadata,target.raw+b'changed'),allowed=True)
    trial.check('complete_original_hash_refused_without_effect',failure.returncode!=0 and rows(trial)==baseline)
    for action in ('update tf_html_rehearsal.originals set raw=raw','delete from tf_html_rehearsal.originals'):
        failed=trial.query(HEAD+'begin;'+action+';commit;',allowed=True)
        trial.check('append_only_'+action.split()[0],failed.returncode!=0 and b'invented_html_append_only' in failed.stderr and rows(trial)==baseline)
    late=prepare_example('Rollback visible invented original.')
    injected=late.statement().replace('commit;\n',"select jsonb_build_object('late_visible',(select count(*) from tf_html_rehearsal.originals where operation_id="+_literal(late.intent.operation_id)+"::uuid));select 1/0;commit;\n")
    failed=trial.query(injected,allowed=True);lines=failed.stdout.splitlines()
    trial.check('late_visible_before_outer_transaction_fault',failed.returncode!=0 and len(lines)==2 and json.loads(lines[1])=={'late_visible':1})
    try:committed_pg_json(failed.stdout,failed.stderr,failed.returncode)
    except ValueError:trial.check('failed_outer_transaction_receipt_withheld',True)
    else:trial.check('failed_outer_transaction_receipt_withheld',False)
    trial.check('late_rollback_no_row',rows(trial)==baseline)
    expected=[]
    for request,stored,receipt in records:
        expected.append(prepare_html_original_reopen(intent=request.intent,document=request.document,binding=request.binding,mapping=request.mapping,
            artifact_id=stored.artifact_id,stored_at=stored.stored_at,observed_at=datetime.now(timezone.utc)))
    trial.stop();trial.start();cold=[]
    for (request,stored,receipt),independent in zip(records,expected,strict=True):
        full=committed(trial,independent.statement());reopened=reopen_html_original(full,independent,observed_at=datetime.now(timezone.utc))
        trial.check('cold_full_original_'+request.intent.operation_id,full==receipt and reopened.raw==request.raw and reopened.canonical_metadata==request.intent.canonical_metadata and reopened.result==stored.result)
        cold.append(full)
    composed=compile_stored_html_request(cold[1],expected[1],cold[0],expected[0],observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
    trial.check('cold_retained_pair_compiles_without_plaintext_cast',composed.change.current.raw==current.raw and composed.change.previous.raw==previous.raw and composed.change.comparison.selection.state=='ready' and composed.request.request_sha256==sha256(composed.request.body).hexdigest())
    trial.record('HTML_COLD_REQUEST_BINDING',dict(request_sha256=composed.request.request_sha256,selected_payload_sha256=composed.request.selected_payload_sha256,maximum_output_tokens=100,providerCalls=0))
    invented_output=json.dumps(dict(schema_version=1,source_version_id=current.document.source_version_id,
        source_sha256=current.document.content_sha256,locator='article:one',proposed_claim_type='condition',
        proposed_assertion='An invented source statement remains unverified.',source_date_text=None,language_code='en')).encode()
    prepared_at=datetime.now(timezone.utc)
    packet=prepare_html_private_extraction(cold[1],expected[1],cold[0],expected[0],request=composed.request,
        output_raw=invented_output,operation_id=str(uuid4()),prepared_at=prepared_at,observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
    checked=recheck_html_private_extraction(packet)
    packet_value=json.loads(packet.canonical_input)
    trial.check('cold_retained_request_output_unverified_unstored',checked==packet and packet.proposal.review_state=='unverified'
        and base64.b64decode(packet_value['request_base64'],validate=True)==composed.request.body
        and base64.b64decode(packet_value['output_base64'],validate=True)==invented_output
        and packet.evidence_state=='invented_retained_html_exact_request_output_unverified_unstored')
    (trial.proof/'HTML_UNSTORED_PRIVATE_PACKET.json').write_bytes(packet.canonical_input)
    trial.record('HTML_UNSTORED_OUTPUT_BINDING',dict(canonical_sha256=sha256(packet.canonical_input).hexdigest(),
        output_sha256=sha256(invented_output).hexdigest(),providerCalls=0,extractionStored=False))
    trial.check('full_native_profiles_and_rows_unchanged',profile(trial,'tf_html_rehearsal')==html and profile(trial,'tf_feed_rehearsal')==feed and roles(trial)==principal and rows(trial)==baseline)
    trial.record('HTML_FINAL_ROWS',baseline)
    return dict(storedOriginals=2,feedProcessed=0,sourceRequests=0,modelCalls=0,sourcePermissionIssued=False,publicationEnabled=False,semanticDerivationVerifiedBySql=False,ordinaryRestartOnly=True)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed HTML custody trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_html(trial);trial.create();result=cases(trial)
        trial.record('HTML_RESULT',dict(state='PASS_BOUNDED_INVENTED_HTML_ORIGINAL_CUSTODY',assertions=trial.assertions,**result))
    except BaseException as error:
        trial.record('HTML_FAILURE',dict(state='held',exceptionClass=type(error).__name__,preserved=True));raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:
                trial.verify_sources('HTML_FINAL')
                if hasattr(trial,'html_runtime'):verify_runtime(trial,'FINAL')
        if trial.identity is not None:trial.record('HTML_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(proof=str(trial.proof),assertions=len(trial.assertions),state='PASS_BOUNDED_INVENTED_HTML_ORIGINAL_CUSTODY',primaryChanged=False)))


if __name__=='__main__':main()
