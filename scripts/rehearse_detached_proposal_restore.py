"""Whole eight-schema invented preparation recovery in a fresh owned database.

Reuses the unchanged bounded custom-archive adapter. No actual login, primary
migration, off-host/NAS, credential, model/source or publication acceptance.
"""
from datetime import datetime,timezone
from hashlib import sha256
import json,os,sys
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError,BIN
from scripts.rehearse_stream_reader import freeze_all
from scripts.rehearse_reopened_change import freeze_change
from scripts.rehearse_document_reference import freeze_reference
from scripts.rehearse_private_extraction import freeze_private,owner_query
from scripts.rehearse_private_extraction_restore import (OwnedPrivateArchiveRestore,decode_private_archive,fault_profile)
from scripts.rehearse_document_result_restore import OwnedRestoreDatabase
from scripts.rehearse_feed_role_restore import restored_role_port
from scripts.rehearse_complete_chain_restore import RestoredView
from scripts.rehearse_detached_proposal import (freeze_detached,seed_preparation,cold_preparation,all_rows,all_profiles,whole_detached_scope,ALL_SCHEMAS)
from workers.retained_document_reader import RetainedDocumentReadError
from workers.detached_proposal_custody import part_bytes
from workers.detached_proposal_postgres import detached_proposal_read_statement
from workers.feed_postgres_contract import committed_pg_json
from workers.pair_native_sql import _literal


def install_fault(target):
    if type(target) is not OwnedRestoreDatabase or type(target.oid) is not int or target.oid<=0:
        raise FeedPgTrialError('Detached restore fault target unavailable')
    whole_detached_scope(target.query,empty=True)
    body="""
begin
 if current_database() is distinct from TARGET then
  raise exception using errcode='22023',message='invented_detached_restore_fault_scope_invalid';end if;
 if exists(select 1 from pg_trigger where tgrelid=to_regclass('tf_detached_proposal.preparations') and tgname='detached_preparation_append_only' and not tgisinternal) then
  if (select count(*) from tf_detached_proposal.preparations)<>1 or (select count(*) from tf_private_extraction.results)<>1
   or (select count(*) from tf_feed_rehearsal.document_results)<>3 then
   raise exception using errcode='22023',message='invented_detached_restore_fault_stage_invalid';end if;
  raise exception using errcode='22023',message='invented_detached_restore_fault_after_populated_trigger';
 end if;
end
""".replace('TARGET',_literal(target.name))
    target.query("begin;create function public.tf_detached_restore_fault() returns event_trigger language plpgsql security invoker set search_path=pg_catalog as $fault$"+body+"$fault$;revoke all on function public.tf_detached_restore_fault() from public;create event trigger tf_detached_restore_fault on ddl_command_end when tag in ('CREATE TRIGGER') execute function public.tf_detached_restore_fault();commit;")
    profile=fault_profile(target)
    expected=dict(events=[dict(name='tf_detached_restore_fault',owner='postgres',enabled='O',tags=['CREATE TRIGGER'],function='public.tf_detached_restore_fault')],
        functions=[dict(name='tf_detached_restore_fault',owner='postgres',definer=False,path=['search_path=pg_catalog'],bodySHA256=sha256(body.encode()).hexdigest(),acl='{postgres=X/postgres}')])
    if profile!=expected:raise FeedPgTrialError('Detached restore fault identity unavailable')
    target.trial.record('DETACHED_RESTORE_TARGET_FAULT_BOUND',profile);return profile


def remove_fault(target,expected):
    if type(target) is not OwnedRestoreDatabase or fault_profile(target)!=expected:
        raise FeedPgTrialError('Detached restore fault identity changed')
    # Only the two newly generated, exact bound target fault objects.
    target.query('begin;drop event trigger tf_detached_restore_fault;drop function public.tf_detached_restore_fault();commit;')
    whole_detached_scope(target.query,empty=True)


def cases(trial):
    source,scope,expectations,operation,intent,receipt_sha=seed_preparation(trial)
    rows=all_rows(trial,'DETACHED_RESTORE_SOURCE_ROWS');profiles=all_profiles(trial,'DETACHED_RESTORE_SOURCE_PROFILES')
    trial.record('DETACHED_RESTORE_SOURCE_WHOLE_SCOPE',whole_detached_scope(trial.query))
    if rows['private']['rows']!=1 or rows['preparations']['rows']!=1:raise FeedPgTrialError('Single preparation recovery source unavailable')
    trial.inspect();trial.run(['docker','exec',trial.identity,'/bin/bash','-c','test -x /bin/gzip'])
    command=BIN+'pg_dump -h /tmp -U postgres -d postgres --format=c | /bin/gzip -c -9'
    dumped=trial.run(['docker','exec',trial.identity,'/bin/bash','-o','pipefail','-c',command],timeout=20)
    if dumped.stderr:raise FeedPgTrialError('Bounded preparation archive unavailable')
    archive=dumped.stdout;custom=decode_private_archive(archive)
    trial.record('DETACHED_RESTORE_ARCHIVE',dict(gzipBytes=len(archive),gzipSHA256=sha256(archive).hexdigest(),customBytes=len(custom),customSHA256=sha256(custom).hexdigest(),
        singleGzipMember=True,decodedInputMaximum=294912,ownerACLDefaultsPreserved=True,sourceWholeScope=True,rolesRewritten=False,channelEnlarged=False))
    target=OwnedRestoreDatabase(trial);target.create();whole_detached_scope(target.query,empty=True)
    adapter=OwnedPrivateArchiveRestore(trial,target);fault=install_fault(target)
    failed=adapter.restore(archive,allowed=True)
    trial.check('detached_restore_late_populated_preparation_trigger_fault',failed.returncode!=0 and b'invented_detached_restore_fault_after_populated_trigger' in failed.stderr)
    absent=target.query('select count(*) from pg_namespace where nspname in ('+','.join(_literal(name) for name in ALL_SCHEMAS)+');')
    trial.check('detached_restore_all_eight_schemas_rolled_back',absent.stdout.strip()==b'0' and fault_profile(target)==fault)
    trial.check('detached_failed_restore_preserves_source_eleven_tables',all_rows(trial,'DETACHED_RESTORE_AFTER_FAILURE_SOURCE_ROWS')==rows)
    remove_fault(target,fault)
    restored=adapter.restore(archive)
    trial.check('detached_same_archive_clean_restore',restored.returncode==0 and not restored.stdout and not restored.stderr)
    copied=restored_role_port(source,target);view=RestoredView(trial,target)
    trial.record('DETACHED_RESTORE_COPY_WHOLE_SCOPE',whole_detached_scope(target.query))
    trial.check('detached_copy_exact_eleven_tables_profiles_defaults_triggers_fk_rls',all_rows(view,'DETACHED_RESTORE_COPY_ROWS')==rows and all_profiles(view,'DETACHED_RESTORE_COPY_PROFILES')==profiles)
    trial.stop();trial.start();source.verify();copied.verify()
    recovered=cold_preparation(trial,target,copied,scope,expectations,operation,intent,'DETACHED_RESTORE_COLD')
    trial.check('detached_cold_recovery_exact_seed_receipt',sha256(recovered.full_receipt).hexdigest()==receipt_sha)
    stream=recovered.result.extraction.result.current.request.feed.capture.stream_id
    target.query('delete from tf_feed_runtime.allowed_streams where stream_id='+_literal(stream)+'::uuid;')
    revoked_rows=all_rows(view,'DETACHED_RESTORE_REVOKED_COPY_ROWS')
    try:cold_preparation(trial,target,copied,scope,expectations,operation,intent,'DETACHED_RESTORE_REVOKED')
    except RetainedDocumentReadError as error:
        trial.check('detached_copy_raw_scope_revocation_holds_before_full_original',str(error)=='retained_document_read_unavailable')
    else:raise FeedPgTrialError('Expected detached copied raw-scope hold absent')
    out=owner_query(target,copied,detached_proposal_read_statement(intent));owner_raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
    trial.check('detached_raw_revocation_preserves_separate_owner_preparation',owner_raw==recovered.full_receipt and all_rows(view,'DETACHED_RESTORE_REVOKED_AFTER_ROWS')==revoked_rows)
    original=cold_preparation(trial,trial,source,scope,expectations,operation,intent,'DETACHED_RESTORE_SOURCE_COLD')
    trial.check('detached_source_copy_four_parts_original_context_and_private_receipts_exact',part_bytes(original.result.parts)==part_bytes(recovered.result.parts)
        and original.full_receipt==recovered.full_receipt and original.result.extraction.full_receipt==recovered.result.extraction.full_receipt
        and original.result.extraction.result.current.result_request.document_raw==recovered.result.extraction.result.current.result_request.document_raw
        and original.result.extraction.result.previous.result_request.document_raw==recovered.result.extraction.result.previous.result_request.document_raw
        and all_rows(trial,'DETACHED_RESTORE_UNCHANGED_SOURCE_ROWS')==rows)
    target.query('insert into tf_feed_runtime.allowed_streams values('+_literal(stream)+'::uuid);')
    del recovered,original,owner_raw
    trial.stop();trial.start();source.verify();copied.verify()
    final=cold_preparation(trial,target,copied,scope,expectations,operation,intent,'DETACHED_RESTORE_FINAL_COLD')
    trial.check('detached_final_restart_receipt_and_all_source_copy_data_profiles_exact',sha256(final.full_receipt).hexdigest()==receipt_sha
        and all_rows(view,'DETACHED_RESTORE_FINAL_COPY_ROWS')==rows and all_rows(trial,'DETACHED_RESTORE_FINAL_SOURCE_ROWS')==rows
        and all_profiles(view,'DETACHED_RESTORE_FINAL_COPY_PROFILES')==profiles and all_profiles(trial,'DETACHED_RESTORE_FINAL_SOURCE_PROFILES')==profiles)
    whole_detached_scope(target.query);whole_detached_scope(trial.query)
    trial.record('DETACHED_RESTORE_FINAL_DATABASE',target.current())
    return dict(operationId=operation,restoredDatabase=target.name,restoredOID=target.oid,archiveBytes=len(archive),schemas=8,tables=11,functions=28,
        oldContextOrPartsSupplied=False,actualHeldCapture=False,actualLogin=False,offHost=False,sourceRequests=0,modelCalls=0,operationalAcceptance=False)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented detached restore trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_all(trial);freeze_change(trial);freeze_reference(trial);freeze_private(trial);freeze_detached(trial,extra=('scripts/rehearse_detached_proposal_restore.py',))
        trial.create();scope=cases(trial)
        trial.record('DETACHED_RESTORE_RESULT',dict(state='PASS_INVENTED_DETACHED_RESTORE',assertions=trial.assertions,assertionCount=len(trial.assertions),scope=scope,primaryChanged=False))
    except BaseException as error:
        trial.record('DETACHED_RESTORE_FAILED',dict(type=type(error).__name__,message='invented_detached_restore_failed'));raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL_DETACHED_RESTORE')
        if trial.identity is not None:trial.record('DETACHED_RESTORE_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(state='PASS_INVENTED_DETACHED_RESTORE',proof=str(trial.proof),assertions=len(trial.assertions),primaryChanged=False)))

if __name__=='__main__':main()
