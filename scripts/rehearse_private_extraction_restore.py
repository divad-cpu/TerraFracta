"""Matching custom-archive recovery of the private invented extraction artifact.

Whole fresh cluster scope is closed. An outer gzip member bounds the whole
custom archive including its uncompressed table-of-contents metadata; strict
limited decoding stays within the existing native stdin294912/stdout131072. pg_dump/pg_restore preserve owners, object
and default ACLs, RLS, validated foreign keys and append-only trigger. Same
cluster/NOLOGIN admin simulation only; not actual login/off-host/NAS acceptance.
"""
from __future__ import annotations
import ast
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
import zlib
from uuid import uuid4
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,BIN
from scripts.rehearse_private_extraction import (freeze_all,freeze_change,freeze_reference,freeze_private,
    prepare_pair,install_private,private_profile,private_snapshot,owner_query)
from scripts.rehearse_document_reference import reference_profile
from scripts.rehearse_stream_reader import SCHEMAS
from scripts.rehearse_stream_reader_restore import private_defaults
from scripts.rehearse_collection_reader import snapshot
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase
from scripts.rehearse_feed_role_restore import restored_role_port
from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
from scripts.rehearse_complete_chain_restore import RestoredView
from workers.bounded_worker_process import WorkerOutput
from workers.feed_collection_inventory import prepare_inventory_request
from workers.retained_document_reader import read_retained_document,RetainedDocumentReadError
from workers.reopened_document_change import prepare_reopened_document_change
from workers.passage_extraction_request import compile_extraction_request
from workers.private_extraction_result import prepare_private_extraction_result
from workers.private_extraction_postgres import prepare_private_extraction_store
from workers.private_extraction_reopen import prepare_private_extraction_reopen,parse_reopened_private_extraction
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]
ALL_SCHEMAS=(*SCHEMAS,'tf_private_extraction')


def freeze_restore(trial):
    names={'scripts/rehearse_private_extraction_restore.py','workers/private_extraction_reopen.py'};queue=list(names)
    while queue:
        name=queue.pop()
        for node in ast.walk(ast.parse((ROOT/name).read_bytes())):
            if isinstance(node,ast.ImportFrom) and node.module:
                child=node.module.replace('.','/')+'.py'
                if child not in names and child not in trial.frozen and (ROOT/child).is_file():names.add(child);queue.append(child)
    rows=[]
    for name in sorted(names):
        raw=(ROOT/name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name]!=raw:raise FeedPgTrialError('Private restore dependency changed')
            continue
        path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with path.open('xb') as stream:stream.write(raw)
        path.chmod(0o600);trial.frozen[name]=raw
        row=dict(path=name,bytes=len(raw),sha256=sha256(raw).hexdigest());rows.append(row);trial.source_bindings.append(row)
    trial.record('PRIVATE_RESTORE_SOURCE_BINDINGS',rows)
    trial.record('PRIVATE_RESTORE_SCOPE',dict(customArchive=True,coreCustodianChanged=False,newGeneratedDatabaseOnly=True,
        ownerACLDefaultsPreserved=True,targetOnlyLateFault=True,actualLogin=False,offHost=False,
        modelCalls=0,sourceRequests=0,primaryChanged=False,operationalAcceptance=False))


def decode_private_archive(archive):
    """One gzip member; bounded exact custom bytes, no unbounded flush."""
    try:
        if type(archive) is not bytes or not 18<=len(archive)<=131072 or not archive.startswith(b'\x1f\x8b'):
            raise ValueError
        decoder=zlib.decompressobj(wbits=31)
        raw=decoder.decompress(archive,294913)
        if (not decoder.eof or decoder.unused_data or decoder.unconsumed_tail
                or not 5<=len(raw)<=294912 or not raw.startswith(b'PGDMP')):raise ValueError
        return raw
    except (ValueError,TypeError,zlib.error):
        raise FeedPgTrialError('Private archive bytes unavailable') from None


class OwnedPrivateArchiveRestore:
    """One fixed binary operation against one already bound new owned target."""
    def __init__(self,trial,target):
        self.trial=trial;self.target=target
        self._scope()

    def _scope(self):
        if (type(self.target) is not OwnedRestoreDatabase or self.target.trial is not self.trial
                or type(self.target.oid) is not int or self.target.oid<=0):
            raise FeedPgTrialError('Private archive restore scope unavailable')

    def restore(self,archive,*,allowed=False):
        self._scope()
        raw=decode_private_archive(archive)
        if self.target.current() is None:raise FeedPgTrialError('Private archive target unavailable')
        try:
            return self.trial.run(['docker','exec','-i',self.trial.identity,BIN+'pg_restore','-h','/tmp','-U','postgres',
                '--dbname='+self.target.name,'--single-transaction','--exit-on-error'],payload=raw,timeout=25,allowed=allowed)
        finally:
            self._scope()
            if self.target.current() is None:raise FeedPgTrialError('Private archive target unavailable')


def whole_scope(query,*,empty=False):
    value=json.loads(query("""begin isolation level repeatable read read only;select jsonb_build_object(
 'schemas',(select jsonb_agg(nspname order by nspname) from pg_namespace where nspname !~ '^pg_' and nspname<>'information_schema'),
 'publicRelations',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
 'publicFunctions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
 'extensions',(select jsonb_agg(extname order by extname) from pg_extension),
 'tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and c.relkind='r'),
 'eventTriggers',(select count(*) from pg_event_trigger));commit;""").stdout)
    expected=dict(schemas=['public'] if empty else ['public',*ALL_SCHEMAS],publicRelations=0,publicFunctions=0,
        extensions=['plpgsql'],tables=0 if empty else 10,eventTriggers=0)
    if value!=expected or any(type(value[k]) is not type(v) for k,v in expected.items()):
        raise FeedPgTrialError('Whole private restore scope unavailable')
    return value


def fault_profile(target):
    return json.loads(target.query("""select jsonb_build_object(
 'events',(select jsonb_agg(jsonb_build_object('name',e.evtname,'owner',pg_get_userbyid(e.evtowner),'enabled',e.evtenabled,'tags',e.evttags,'function',n.nspname||'.'||p.proname) order by e.evtname) from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid join pg_namespace n on n.oid=p.pronamespace),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'path',p.proconfig,'bodySHA256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'acl',p.proacl::text) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'));""").stdout)


def install_fault(target):
    if type(target) is not OwnedRestoreDatabase or type(target.oid) is not int or target.oid<=0:
        raise FeedPgTrialError('Private restore fault target unavailable')
    whole_scope(target.query,empty=True)
    body="""
begin
 if current_database() is distinct from TARGET then
  raise exception using errcode='22023',message='invented_private_restore_fault_scope_invalid'; end if;
 if exists(select 1 from pg_trigger where tgrelid=to_regclass('tf_private_extraction.results') and tgname='private_extraction_append_only' and not tgisinternal) then
  if (select count(*) from tf_private_extraction.results)<>1 or (select count(*) from tf_feed_rehearsal.document_results)<>3 then
   raise exception using errcode='22023',message='invented_private_restore_fault_stage_invalid'; end if;
  raise exception using errcode='22023',message='invented_private_restore_fault_after_populated_trigger';
 end if;
end
""".replace('TARGET',_literal(target.name))
    target.query("begin;create function public.tf_private_restore_fault() returns event_trigger language plpgsql security invoker set search_path=pg_catalog as $fault$"+body+"$fault$;revoke all on function public.tf_private_restore_fault() from public;create event trigger tf_private_restore_fault on ddl_command_end when tag in ('CREATE TRIGGER') execute function public.tf_private_restore_fault();commit;")
    profile=fault_profile(target)
    expected=dict(events=[dict(name='tf_private_restore_fault',owner='postgres',enabled='O',tags=['CREATE TRIGGER'],function='public.tf_private_restore_fault')],
        functions=[dict(name='tf_private_restore_fault',owner='postgres',definer=False,path=['search_path=pg_catalog'],bodySHA256=sha256(body.encode()).hexdigest(),acl='{postgres=X/postgres}')])
    if profile!=expected:raise FeedPgTrialError('Private restore fault identity unavailable')
    target.trial.record('PRIVATE_RESTORE_TARGET_FAULT_BOUND',profile)
    return profile


def remove_fault(target,expected):
    if type(target) is not OwnedRestoreDatabase or fault_profile(target)!=expected:
        raise FeedPgTrialError('Private restore fault identity changed')
    # Only the two exact just-created target-only fault objects, after rollback.
    target.query('begin;drop event trigger tf_private_restore_fault;drop function public.tf_private_restore_fault();commit;')
    whole_scope(target.query,empty=True)


def cold_document(controller,target,roles,inventory,expectation,label):
    if type(roles) is not OwnedRuntimeRoles or roles.trial is not target:
        raise FeedPgTrialError('Private restore reader custodian mismatch')
    calls=[]
    def query(sql):
        output=roles.query('tf_feed_lab_observer',sql,allowed=True)
        calls.append(dict(statementSHA256=sha256(sql.encode()).hexdigest(),stdoutSHA256=sha256(output.stdout).hexdigest(),returncode=output.returncode))
        controller.record(label+'_READ_'+str(len(calls)),calls[-1])
        return WorkerOutput(output.stdout,output.stderr,output.returncode)
    binding,mapping,association=expectation
    result=read_retained_document(inventory,binding=binding,mapping=mapping,association=association,query=query,
        utc_now=lambda:datetime.now(timezone.utc))
    controller.check(label+'_exact_seven_reads',len(calls)==7 and result.query_count==7 and result.reopened is not None)
    return result


def seed_one(trial):
    roles,current,previous=prepare_pair(trial);install_private(trial,roles)
    scope=current.reopened.request.feed.request.inventory_request.scope
    expectations=tuple((value.reopened.request.binding,value.reopened.request.mapping,value.reopened.request.association)
        for value in (current,previous))
    pair=prepare_reopened_document_change(current.reopened,current.full_receipt,previous.reopened,previous.full_receipt,
        observed_at=datetime.now(timezone.utc))
    request=compile_extraction_request(pair.current,pair.previous,observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
    b=current.reopened.request.binding
    output=json.dumps(dict(schema_version=1,source_version_id=b.source_version_id,source_sha256=b.content_sha256,
        language_code=b.language_code,locator='section:one',proposed_claim_type='condition',
        proposed_assertion='Changed exact Å source passage.',source_date_text=None),ensure_ascii=False,separators=(',',':')).encode()
    operation=str(uuid4());at=datetime.now(timezone.utc)
    result=prepare_private_extraction_result(current.reopened,current.full_receipt,previous.reopened,previous.full_receipt,
        request=request,output_raw=output,operation_id=operation,prepared_at=at,observed_at=at,maximum_output_tokens=100)
    store=prepare_private_extraction_store(result)
    native=owner_query(trial,roles,store.statement());raw=committed_pg_json(native.stdout,native.stderr,native.returncode)
    trial.record('PRIVATE_RESTORE_SEEDED_INTENT',dict(operationId=operation,receiptBytes=len(raw),receiptSHA256=sha256(raw).hexdigest(),
        expectedState='unverified',outputObjectRetainedByCaller=False,modelCalls=0,sourceRequests=0))
    # Return no old original, request, output, preparation timestamp, store or
    # result object. The caller keeps only independent expectations/operation.
    return roles,scope,expectations,operation,sha256(raw).hexdigest()


def cold_artifact(controller,target,roles,scope,expectations,operation,label):
    inventory=prepare_inventory_request(scope,item_limit=20)
    current=cold_document(controller,target,roles,inventory,expectations[0],label+'_CURRENT')
    previous=cold_document(controller,target,roles,inventory,expectations[1],label+'_PREVIOUS')
    pair=prepare_reopened_document_change(current.reopened,current.full_receipt,previous.reopened,previous.full_receipt,
        observed_at=datetime.now(timezone.utc))
    request=compile_extraction_request(pair.current,pair.previous,observed_at=datetime.now(timezone.utc),maximum_output_tokens=100)
    expected=prepare_private_extraction_reopen(current.reopened,current.full_receipt,previous.reopened,previous.full_receipt,
        request=request,operation_id=operation,maximum_output_tokens=100,observed_at=datetime.now(timezone.utc))
    output=owner_query(target,roles,expected.statement())
    raw=committed_pg_json(output.stdout,output.stderr,output.returncode)
    reopened=parse_reopened_private_extraction(raw,expected,observed_at=datetime.now(timezone.utc))
    controller.record(label+'_COMPLETE',dict(operationId=operation,artifactId=reopened.stored.artifact_id,
        rawBytes=len(raw),rawSHA256=sha256(raw).hexdigest(),requestSHA256=reopened.stored.request_sha256,
        outputSHA256=reopened.stored.output_sha256,reviewState=reopened.result.proposal.review_state,
        sourceCalls=0,modelCalls=0,oldOutputObjectSupplied=False))
    return reopened


def cases(trial):
    source,scope,expectations,operation,initial_receipt_sha=seed_one(trial)
    base=snapshot(trial);private=private_snapshot(trial.query)
    base_access=reference_profile(trial.query);access=private_profile(trial.query);defaults=private_defaults(trial.query)
    trial.record('PRIVATE_RESTORE_SOURCE_BASE_ACCESS',base_access);trial.record('PRIVATE_RESTORE_SOURCE_ACCESS',access)
    trial.record('PRIVATE_RESTORE_SOURCE_DEFAULTS',defaults);trial.record('PRIVATE_RESTORE_WHOLE_SCOPE',whole_scope(trial.query))
    if private['rows']!=1:raise FeedPgTrialError('Private restore single artifact unavailable')
    trial.inspect()
    trial.run(['docker','exec',trial.identity,'/bin/bash','-c','test -x /bin/gzip'])
    command=BIN+'pg_dump -h /tmp -U postgres -d postgres --format=c | /bin/gzip -c -9'
    dump=trial.run(['docker','exec',trial.identity,'/bin/bash','-o','pipefail','-c',command],timeout=20)
    if dump.stderr:raise FeedPgTrialError('Bounded private custom archive unavailable')
    archive=dump.stdout;custom=decode_private_archive(archive)
    trial.record('PRIVATE_RESTORE_CUSTOM_ARCHIVE',dict(gzipBytes=len(archive),gzipSHA256=sha256(archive).hexdigest(),
        customBytes=len(custom),customSHA256=sha256(custom).hexdigest(),singleGzipMember=True,decodedInputMaximum=294912,
        ownerACLDefaultsPreserved=True,sourceWholeScope=True,rolesRewritten=False,channelEnlarged=False))
    target=OwnedRestoreDatabase(trial);target.create();whole_scope(target.query,empty=True)
    adapter=OwnedPrivateArchiveRestore(trial,target)
    fault=install_fault(target)
    failed=adapter.restore(archive,allowed=True)
    trial.check('new_private_custom_restore_fault_after_populated_trigger',failed.returncode!=0
        and b'invented_private_restore_fault_after_populated_trigger' in failed.stderr)
    schema_count=target.query('select count(*) from pg_namespace where nspname in ('+','.join(_literal(name) for name in ALL_SCHEMAS)+');')
    trial.check('new_private_custom_restore_fault_all_seven_schemas_rolled_back',schema_count.stdout.strip()==b'0'
        and fault_profile(target)==fault)
    trial.check('new_private_failed_copy_does_not_change_source_ten_tables',snapshot(trial)==base and private_snapshot(trial.query)==private)
    remove_fault(target,fault)
    restored=adapter.restore(archive)
    trial.check('new_private_identical_custom_archive_restore_clean_success',restored.returncode==0 and not restored.stdout and not restored.stderr)
    copied=restored_role_port(source,target);view=RestoredView(trial,target)
    copied_access=private_profile(target.query);copied_base=reference_profile(target.query);copied_defaults=private_defaults(target.query)
    trial.record('PRIVATE_RESTORE_COPIED_ACCESS',copied_access);trial.record('PRIVATE_RESTORE_COPIED_BASE_ACCESS',copied_base)
    trial.record('PRIVATE_RESTORE_COPIED_DEFAULTS',copied_defaults);trial.record('PRIVATE_RESTORE_COPIED_WHOLE_SCOPE',whole_scope(target.query))
    trial.check('new_private_copy_exact_owner_acl_defaults_trigger_fk_rls_functions_rows',copied_access==access
        and copied_base==base_access and copied_defaults==defaults and snapshot(view)==base and private_snapshot(target.query)==private)
    trial.stop();trial.start();source.verify();copied.verify()
    recovered=cold_artifact(trial,target,copied,scope,expectations,operation,'COPIED_COLD')
    trial.check('new_private_cold_artifact_matches_seeded_operation_bytes_and_unverified_state',recovered.result.proposal.review_state=='unverified'
        and sha256(recovered.full_receipt).hexdigest()==initial_receipt_sha)
    stream=recovered.result.current.request.feed.capture.stream_id
    target.query('delete from tf_feed_runtime.allowed_streams where stream_id='+_literal(stream)+'::uuid;')
    before_copied_private=private_snapshot(target.query)
    try:cold_artifact(trial,target,copied,scope,expectations,operation,'COPY_REVOKED')
    except RetainedDocumentReadError as error:
        trial.check('new_private_copy_only_raw_scope_revocation_holds_before_original',str(error)=='retained_document_read_unavailable')
    else:raise FeedPgTrialError('Expected copied raw-scope hold absent')
    # The artifact is separately owner-only; revocation neither deletes it nor
    # revokes owner authority. Do not modify an append-only result as a test.
    owner=owner_query(target,copied,recovered.request.statement())
    owner_raw=committed_pg_json(owner.stdout,owner.stderr,owner.returncode)
    trial.check('new_private_copy_raw_revocation_preserves_owner_artifact_and_rows',owner_raw==recovered.full_receipt
        and private_snapshot(target.query)==before_copied_private)
    original=cold_artifact(trial,trial,source,scope,expectations,operation,'SOURCE_COLD')
    trial.check('new_private_copy_source_full_originals_request_output_receipt_equal',original.full_receipt==recovered.full_receipt
        and original.result.request.body==recovered.result.request.body and original.result.output_raw==recovered.result.output_raw
        and original.result.current.result_request.document_raw==recovered.result.current.result_request.document_raw
        and original.result.previous.result_request.document_raw==recovered.result.previous.result_request.document_raw
        and snapshot(trial)==base and private_snapshot(trial.query)==private)
    target.query('insert into tf_feed_runtime.allowed_streams values('+_literal(stream)+'::uuid);')
    trial.stop();trial.start();source.verify();copied.verify()
    final=cold_artifact(trial,target,copied,scope,expectations,operation,'COPIED_FINAL_COLD')
    final_access=private_profile(target.query);final_base=reference_profile(target.query);final_defaults=private_defaults(target.query)
    trial.record('PRIVATE_RESTORE_FINAL_ACCESS',final_access);trial.record('PRIVATE_RESTORE_FINAL_BASE_ACCESS',final_base)
    trial.record('PRIVATE_RESTORE_FINAL_DEFAULTS',final_defaults)
    trial.check('new_private_final_restart_full_receipt_all_ten_rows_profiles_exact',final.full_receipt==original.full_receipt
        and final.result.output_raw==original.result.output_raw and snapshot(view)==base and snapshot(trial)==base
        and private_snapshot(target.query)==private and private_snapshot(trial.query)==private
        and final_access==access and final_base==base_access and final_defaults==defaults)
    trial.record('PRIVATE_RESTORE_FINAL_DATABASE',target.current())
    return dict(operationId=operation,restoredDatabase=target.name,restoredOID=target.oid,archiveBytes=len(archive),
        schemas=7,tables=10,functions=25,oldOutputObjectSupplied=False,actualLogin=False,offHost=False,
        sourceRequests=0,modelCalls=0,operationalAcceptance=False)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented private restore trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_all(trial);freeze_change(trial);freeze_reference(trial);freeze_private(trial);freeze_restore(trial)
        trial.create();scope=cases(trial)
        trial.record('PRIVATE_RESTORE_RESULT',dict(state='PASS_INVENTED_PRIVATE_RESTORE',assertions=trial.assertions,
            assertionCount=len(trial.assertions),scope=scope,primaryChanged=False))
    except BaseException as error:
        trial.record('PRIVATE_RESTORE_FAILED',dict(type=type(error).__name__,message='invented_private_restore_failed'))
        raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_PRIVATE_RESTORE')
        if trial.identity is not None:trial.record('PRIVATE_RESTORE_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(proof=str(trial.proof),assertions=len(trial.assertions),state='PASS_INVENTED_PRIVATE_RESTORE',primaryChanged=False)))


if __name__=='__main__':main()
