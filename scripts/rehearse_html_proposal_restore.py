"""Fixed fresh-producer/fresh-receiver recovery of invented HTML preparation.

Own-source three-schema dump only. No existing/remote archive, primary target,
roles, credentials, off-host claim, schema normalization or publication route.
"""
from __future__ import annotations
import ast,json,os,sys
from hashlib import sha256
from scripts import rehearse_html_proposal_custody as preparation
from scripts import rehearse_html_extraction_restore as safety
from scripts.rehearse_postgres_feed_journal import BIN
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json
from workers.html_proposal_custody import intent_metadata

ROOT=preparation.ROOT
ENTRY='scripts/rehearse_html_proposal_restore.py'
NEW_FILES=(ENTRY,'tests/test_html_proposal_restore_scope.py')
FreshFeedPostgres=preparation.FreshFeedPostgres
FeedPgTrialError=preparation.FeedPgTrialError
ArchiveBinding=safety.ArchiveBinding
exact_archive=safety.exact_archive
close_trials=safety.close_trials
MAX_ARCHIVE=safety.MAX_ARCHIVE
ARCHIVE_NAME='HTML_PREPARATION_ARCHIVE.sql'
SCHEMAS=('tf_html_rehearsal','tf_html_extraction','tf_html_preparation')
# Recreate only the source's explicit owner-default raw ACL spellings. The source
# must prove these six exact owner-only ACLs before export. No privilege is added.
OWNER_ACL_REPLAY=('revoke all on schema tf_html_rehearsal from public;'
    'revoke all on tf_html_rehearsal.originals from public;'
    'revoke all on schema tf_html_extraction from public;'
    'revoke all on tf_html_extraction.results from public;'
    'revoke all on schema tf_html_preparation from public;'
    'revoke all on tf_html_preparation.preparations from public;')
COUNTS_SQL="select jsonb_build_object('originals',(select count(*) from tf_html_rehearsal.originals),'results',(select count(*) from tf_html_extraction.results),'preparations',(select count(*) from tf_html_preparation.preparations));"
COUNTS=dict(originals=2,results=1,preparations=1)


def freeze_restore(trial):
    if trial.counter!=0 or trial.identity is not None or trial.creation_attempted or trial.initializer_attempted:
        raise FeedPgTrialError('Preparation restore freeze must precede all resource commands')
    preparation.freeze_preparation(trial) # one unchanged inherited runtime freeze
    names=set(NEW_FILES);pending=list(names)
    while pending:
        name=pending.pop();body=preparation.custody.original._read(ROOT/name)
        if name.endswith('.py'):
            for node in ast.walk(ast.parse(body)):
                modules=[node.module] if isinstance(node,ast.ImportFrom) and node.module else [n.name for n in node.names] if isinstance(node,ast.Import) else []
                for module in modules:
                    child=module.replace('.','/')+'.py'
                    if (ROOT/child).is_file() and child not in names:names.add(child);pending.append(child)
    rows=[]
    for name in sorted(names):
        body=preparation.custody.original._read(ROOT/name)
        if name in trial.frozen:
            if trial.frozen[name]!=body:raise FeedPgTrialError('Frozen source changed')
            continue
        target=trial.proof/'inputs'/name;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with target.open('xb') as stream:stream.write(body)
        target.chmod(0o600);trial.frozen[name]=body;rows.append(dict(path=name,bytes=len(body),sha256=sha256(body).hexdigest()))
    trial.source_bindings.extend(rows);trial.record('HTML_PREPARATION_RESTORE_SOURCE_BINDINGS',rows)


def export_archive(producer):
    identity=producer.inspect()['id']
    result=producer.run(['docker','exec',identity,BIN+'pg_dump','-h','/tmp','-U','postgres','-d','postgres',
        '--format=p','--schema=tf_html_rehearsal','--schema=tf_html_extraction','--schema=tf_html_preparation',
        '--strict-names','--no-comments','--no-security-labels'])
    if result.returncode!=0 or result.stderr:raise FeedPgTrialError('Own-source preparation archive export unconfirmed')
    binding=ArchiveBinding(identity,len(result.stdout),sha256(result.stdout).hexdigest());raw=exact_archive(result.stdout,binding)
    target=producer.proof/ARCHIVE_NAME
    with target.open('xb') as stream:stream.write(raw)
    target.chmod(0o600)
    if exact_archive(preparation.custody.original._read(target),binding)!=raw:raise FeedPgTrialError('Archive full readback changed')
    producer.record('HTML_PREPARATION_RESTORE_ARCHIVE_BINDING',dict(producerIdentity=identity,bytes=binding.bytes,sha256=binding.sha256,
        schemas=list(SCHEMAS),format='plain',ownerAndAclIncluded=True,externalArchiveAccepted=False,maximumArchiveBytes=MAX_ARCHIVE))
    return binding


def restore_statement(raw,binding,*,late_failure=False):
    raw=exact_archive(raw,binding)
    if type(late_failure) is not bool:raise FeedPgTrialError('Fixed preparation restore phase refused')
    sql=HEAD+"set time zone 'UTC';begin;\n\\o /dev/null\n"+raw.decode('utf8')+'\n'+OWNER_ACL_REPLAY+'\n\\o\n'+COUNTS_SQL
    if late_failure:sql+='select 1/0;'
    sql+='commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'
    if len(sql.encode())>294912:raise FeedPgTrialError('Fixed preparation restore pipe bound refused')
    return sql


def blank_receiver(trial):
    profiles={schema:preparation.profile(trial,schema) for schema in SCHEMAS}
    if any(value!=dict(schema=None,objects=[],tables=[],functions=[],privileges=[]) for value in profiles.values()):return False
    result=trial.query("begin read only;select jsonb_build_array((select count(*) from tf_feed_rehearsal.streams),(select count(*) from tf_feed_rehearsal.pages),(select count(*) from tf_feed_rehearsal.items),(select count(*) from tf_feed_rehearsal.outcomes));commit;")
    return json.loads(result.stdout)==[0,0,0,0]


def restore_cases(producer,receiver):
    original=preparation.custody.original
    source_feed=preparation.profile(producer,'tf_feed_rehearsal');principal=original.roles(producer)
    preparation.install_preparation(producer)
    profiles={schema:preparation.profile(producer,schema) for schema in SCHEMAS}
    producer.check('source_three_exact_closed_owner_profiles',original.expected_profile(profiles[SCHEMAS[0]])
        and preparation.custody.expected_profile(profiles[SCHEMAS[1]]) and preparation.expected_profile(profiles[SCHEMAS[2]]))
    producer.check('source_six_explicit_owner_default_acl_spellings',all(value['schema']['acl']=='{postgres=UC/postgres}'
        and value['tables'][0]['acl']=='{postgres=arwdDxtm/postgres}' for value in profiles.values()))
    expected,extraction_expected,receipt_sha=preparation.prepare_one(producer)
    rows=preparation.full_rows(producer)
    producer.check('source_two_original_one_result_one_preparation_only',len(rows['html'])==2 and len(rows['extraction'])==1 and len(rows['preparation'])==1
        and rows['feed']==[0,0,0,0] and original.roles(producer)==principal and preparation.profile(producer,'tf_feed_rehearsal')==source_feed)
    producer.record('HTML_PREPARATION_RESTORE_EXPECTED_CATALOGS',dict(profiles=profiles,roles=principal,rows=rows,feed=source_feed))
    binding=export_archive(producer)
    producer.check('own_archive_export_preserves_all_seven_table_hashes_profiles_and_roles',preparation.full_rows(producer)==rows
        and all(preparation.profile(producer,schema)==before for schema,before in profiles.items()) and original.roles(producer)==principal
        and preparation.profile(producer,'tf_feed_rehearsal')==source_feed)
    producer.stop();producer.check('source_stopped_before_distinct_receiver_create',not producer.inspect()['running'])
    receiver.create()
    receiver.check('new_receiver_identity_and_volume_distinct',receiver.identity!=binding.producer_identity and receiver.volume!=producer.volume)
    feed=preparation.profile(receiver,'tf_feed_rehearsal');roles=original.roles(receiver)
    receiver.check('three_namespaces_absent_receiver_feed_empty_and_principals_exact',blank_receiver(receiver) and roles==principal and feed==source_feed)
    raw=exact_archive(original._read(producer.proof/ARCHIVE_NAME),binding)
    with (receiver.proof/ARCHIVE_NAME).open('xb') as stream:stream.write(raw)
    (receiver.proof/ARCHIVE_NAME).chmod(0o600)
    receiver.record('HTML_PREPARATION_RESTORE_RECEIVER_BINDING',dict(producerProof=str(producer.proof),producerIdentity=binding.producer_identity,
        receiverIdentity=receiver.identity,archiveBytes=binding.bytes,archiveSHA256=binding.sha256))
    failed=receiver.query(restore_statement(raw,binding,late_failure=True),allowed=True)
    receiver.check('actual_all_four_artifacts_visible_before_late_outer_fault',failed.returncode!=0 and b'division by zero' in failed.stderr
        and len(failed.stdout.splitlines())==1 and json.loads(failed.stdout)==COUNTS and COMMIT_MARKER not in failed.stdout)
    try:committed_pg_json(failed.stdout,failed.stderr,failed.returncode)
    except ValueError:receiver.check('late_outer_restore_never_committed',True)
    else:receiver.check('late_outer_restore_never_committed',False)
    receiver.check('separate_connection_all_three_schema_ddl_data_acl_rollback',blank_receiver(receiver)
        and original.roles(receiver)==roles and preparation.profile(receiver,'tf_feed_rehearsal')==feed)
    clean=receiver.query(restore_statement(raw,binding));receipt=committed_pg_json(clean.stdout,clean.stderr,clean.returncode)
    receiver.check('same_exact_archive_clean_commit_full_counts',json.loads(receipt)==COUNTS)
    restored={schema:preparation.profile(receiver,schema) for schema in SCHEMAS}
    receiver.record('HTML_PREPARATION_RESTORE_ACTUAL_CATALOGS',dict(profiles=restored,roles=original.roles(receiver),rows=preparation.full_rows(receiver)))
    receiver.check('full_raw_catalog_owner_acl_rls_default_functions_constraints_triggers_exact',restored==profiles)
    receiver.check('all_seven_table_hashes_ids_times_exact',preparation.full_rows(receiver)==rows)
    receiver.check('incidental_feed_principals_and_default_acl_unchanged',original.roles(receiver)==roles and preparation.profile(receiver,'tf_feed_rehearsal')==feed)
    del raw,clean,receipt
    receiver.stop();receiver.start()
    reopened,receipt,extraction,current,previous=preparation.cold_read(receiver,expected,extraction_expected)
    metadata=intent_metadata(expected.intent)
    receiver.check('cold_four_full_receipts_restore_exact_historical_intent_and_parts',sha256(receipt).hexdigest()==receipt_sha
        and reopened.result.intent==expected.intent and reopened.result.prepared_at.isoformat(timespec='microseconds').replace('+00:00','Z')==metadata['prepared_at']
        and reopened.evidence_state=='invented_html_reopened_preparation_not_current_qualification_or_capture'
        and json.loads(reopened.result.parts.provenance_raw)['evidence_state']=='unverified_not_captured_no_durable_association')
    receiver.record('HTML_PREPARATION_RESTORE_COLD_BINDINGS',dict(preparation=sha256(receipt).hexdigest(),extraction=sha256(extraction).hexdigest(),
        currentOriginal=sha256(current).hexdigest(),previousOriginal=sha256(previous).hexdigest(),historicalPreparedAt=metadata['prepared_at'],
        reobservedAt=reopened.observed_at.isoformat(timespec='microseconds').replace('+00:00','Z')))
    receiver.check('cold_all_profiles_seven_rows_roles_and_feed_still_exact',preparation.full_rows(receiver)==rows
        and all(preparation.profile(receiver,schema)==before for schema,before in profiles.items()) and original.roles(receiver)==roles
        and preparation.profile(receiver,'tf_feed_rehearsal')==feed)
    return dict(archiveBytes=binding.bytes,archiveSHA256=binding.sha256,storedOriginals=2,storedExtractions=1,storedPreparations=1,
        restoredIntoDistinctNewCluster=True,matchingInstalledPostgresOnly=True,offhostBackupVerified=False,sourceRequests=0,modelCalls=0,heldCaptures=0,publicationEnabled=False)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed preparation restore takes no arguments')
    os.umask(0o077);trials=[]
    try:
        producer=FreshFeedPostgres();trials.append(producer)
        receiver=FreshFeedPostgres();trials.append(receiver)
        freeze_restore(producer);freeze_restore(receiver)
        if producer.frozen!=receiver.frozen:raise FeedPgTrialError('Source and receiver bindings differ')
        producer.create();result=restore_cases(producer,receiver)
        producer.record('HTML_PREPARATION_RESTORE_RESULT',dict(state='PASS_BOUNDED_INVENTED_HTML_PREPARATION_RESTORE',assertions=producer.assertions+receiver.assertions,receiverProof=str(receiver.proof),**result))
    except BaseException as error:
        for trial in trials:trial.record('HTML_PREPARATION_RESTORE_FAILURE',dict(state='held',exceptionClass=type(error).__name__,preserved=True))
        raise
    finally:close_trials(trials)
    print(json.dumps(dict(proof=str(producer.proof),receiverProof=str(receiver.proof),assertions=len(producer.assertions)+len(receiver.assertions),state='PASS_BOUNDED_INVENTED_HTML_PREPARATION_RESTORE',primaryChanged=False)))


if __name__=='__main__':main()
