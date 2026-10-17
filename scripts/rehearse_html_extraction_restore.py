"""Fixed local logical restore of invented HTML bytes into a new owned cluster.

This is not an importer for arbitrary SQL or existing targets. Only pg_dump from
this invocation's fixed, independently inventoried source may reach its new
receiver. No primary, remote storage, credentials, roles or publication change.
"""
from __future__ import annotations
import ast,json,os,re,sys
from dataclasses import dataclass
from hashlib import sha256

from scripts import rehearse_html_extraction_custody as custody
from scripts.rehearse_postgres_feed_journal import BIN
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json

ROOT=custody.ROOT
ENTRY='scripts/rehearse_html_extraction_restore.py'
NEW_FILES=(ENTRY,'tests/test_html_extraction_restore_scope.py')
FreshFeedPostgres=custody.FreshFeedPostgres
FeedPgTrialError=custody.FeedPgTrialError
MAX_ARCHIVE=131072
ARCHIVE_NAME='HTML_EXTRACTION_ARCHIVE.sql'
SCHEMAS=('tf_html_rehearsal','tf_html_extraction')
# pg_dump omits explicit owner-default ACL arrays. Recreate exactly the four
# retained spellings, without granting any privilege or normalizing catalogs.
# The source must have these exact owner-only arrays before export.
OWNER_ACL_REPLAY=("revoke all on schema tf_html_rehearsal from public;"
    "revoke all on tf_html_rehearsal.originals from public;"
    "revoke all on schema tf_html_extraction from public;"
    "revoke all on tf_html_extraction.results from public;")
COUNTS_SQL="select jsonb_build_object('originals',(select count(*) from tf_html_rehearsal.originals),'results',(select count(*) from tf_html_extraction.results));"


@dataclass(frozen=True)
class ArchiveBinding:
    producer_identity:str
    bytes:int
    sha256:str


def freeze_restore(trial):
    if trial.counter!=0 or trial.identity is not None or trial.creation_attempted or trial.initializer_attempted:
        raise FeedPgTrialError('Restore freeze must precede all resource commands')
    custody.freeze_extraction(trial)
    rows=[]
    for name in NEW_FILES:
        body=custody.original._read(ROOT/name)
        if name in trial.frozen:raise FeedPgTrialError('Unexpected restore source overlap')
        if name.endswith('.py'):ast.parse(body)
        destination=trial.proof/'inputs'/name
        destination.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with destination.open('xb') as stream:stream.write(body)
        destination.chmod(0o600);trial.frozen[name]=body
        rows.append(dict(path=name,bytes=len(body),sha256=sha256(body).hexdigest()))
    trial.source_bindings.extend(rows);trial.record('HTML_RESTORE_SOURCE_BINDINGS',rows)


def exact_archive(raw,binding):
    # Integrity of a trusted own-source archive, not semantic SQL admission.
    if (type(binding) is not ArchiveBinding or type(binding.producer_identity) is not str
            or re.fullmatch('[a-f0-9]{64}',binding.producer_identity) is None
            or type(binding.bytes) is not int or not 1<=binding.bytes<=MAX_ARCHIVE
            or type(binding.sha256) is not str or re.fullmatch('[a-f0-9]{64}',binding.sha256) is None
            or type(raw) is not bytes or len(raw)!=binding.bytes or sha256(raw).hexdigest()!=binding.sha256):
        raise FeedPgTrialError('Own-source archive identity or full bytes changed')
    try:raw.decode('utf8','strict')
    except UnicodeError:raise FeedPgTrialError('Own-source archive encoding refused') from None
    if b'\x00' in raw:raise FeedPgTrialError('Own-source archive encoding refused')
    return raw


def export_archive(producer):
    identity=producer.inspect()['id']
    result=producer.run(['docker','exec',identity,BIN+'pg_dump','-h','/tmp','-U','postgres','-d','postgres',
        '--format=p','--schema=tf_html_rehearsal','--schema=tf_html_extraction','--strict-names','--no-comments','--no-security-labels'])
    if result.returncode!=0 or result.stderr:raise FeedPgTrialError('Own-source archive export unconfirmed')
    binding=ArchiveBinding(identity,len(result.stdout),sha256(result.stdout).hexdigest())
    raw=exact_archive(result.stdout,binding)
    path=producer.proof/ARCHIVE_NAME
    with path.open('xb') as stream:stream.write(raw)
    path.chmod(0o600)
    if exact_archive(custody.original._read(path),binding)!=raw:raise FeedPgTrialError('Archive readback changed')
    producer.record('HTML_RESTORE_ARCHIVE_BINDING',dict(producerIdentity=binding.producer_identity,bytes=binding.bytes,sha256=binding.sha256,
        schemas=list(SCHEMAS),format='plain',ownerAndAclIncluded=True,externalArchiveAccepted=False))
    return binding


def restore_statement(raw,binding,*,late_failure=False):
    raw=exact_archive(raw,binding)
    if type(late_failure) is not bool:raise FeedPgTrialError('Fixed restore phase refused')
    # Suppress only known pg_dump SELECT setup output. Errors still reach the
    # bounded stderr channel; all SQL input is retained. Reset before our count.
    # pg_dump's own restriction key, if present, ends before the reset.
    sql=HEAD+"set time zone 'UTC';begin;\n\\o /dev/null\n"+raw.decode('utf8')+"\n"+OWNER_ACL_REPLAY+"\n\\o\n"+COUNTS_SQL
    if late_failure:sql+='select 1/0;'
    sql+='commit;\n\\echo '+COMMIT_MARKER.decode()+'\n'
    if len(sql.encode())>294912:raise FeedPgTrialError('Fixed restore pipe bound refused')
    return sql


def blank_receiver(trial):
    profiles={schema:custody.profile(trial,schema) for schema in SCHEMAS}
    for value in profiles.values():
        if value!=dict(schema=None,objects=[],tables=[],functions=[],privileges=[]):return False
    counts=json.loads(trial.query("begin read only;select jsonb_build_array((select count(*) from tf_feed_rehearsal.streams),(select count(*) from tf_feed_rehearsal.pages),(select count(*) from tf_feed_rehearsal.items),(select count(*) from tf_feed_rehearsal.outcomes));commit;").stdout)
    return counts==[0,0,0,0]


def restore_cases(producer,receiver):
    custody.install_extraction(producer)
    profiles={schema:custody.profile(producer,schema) for schema in SCHEMAS}
    producer.check('archive_source_exact_closed_profiles',custody.original.expected_profile(profiles[SCHEMAS[0]]) and custody.expected_profile(profiles[SCHEMAS[1]]))
    producer.check('source_explicit_owner_default_acl_spelling',all(profile['schema']['acl']=='{postgres=UC/postgres}'
        and profile['tables'][0]['acl']=='{postgres=arwdDxtm/postgres}' for profile in profiles.values()))
    expected,packet_sha,receipt_sha=custody.store_pair_and_result(producer)
    rows=custody.full_rows(producer);principal=custody.original.roles(producer)
    producer.check('archive_source_exact_two_originals_one_result',len(rows['html'])==2 and len(rows['extraction'])==1 and rows['feed']==[0,0,0,0])
    producer.record('HTML_RESTORE_EXPECTED_CATALOGS',dict(profiles=profiles,roles=principal,rows=rows))
    binding=export_archive(producer)
    producer.check('archive_export_preserves_full_source',custody.full_rows(producer)==rows and all(custody.profile(producer,schema)==profile for schema,profile in profiles.items()) and custody.original.roles(producer)==principal)
    producer.stop()
    producer.check('source_stopped_before_receiver_create',not producer.inspect()['running'])
    receiver.create()
    receiver.check('distinct_new_receiver_identity',receiver.identity!=binding.producer_identity and receiver.volume!=producer.volume)
    feed=custody.profile(receiver,'tf_feed_rehearsal');roles=custody.original.roles(receiver)
    receiver.check('empty_receiver_no_html_installed_and_same_principals',blank_receiver(receiver) and roles==principal)
    raw=exact_archive(custody.original._read(producer.proof/ARCHIVE_NAME),binding)
    # Preserve exact bytes beside the receiver as well, before any restore.
    with (receiver.proof/ARCHIVE_NAME).open('xb') as stream:stream.write(raw)
    (receiver.proof/ARCHIVE_NAME).chmod(0o600)
    receiver.record('HTML_RESTORE_RECEIVER_BINDING',dict(producerProof=str(producer.proof),producerIdentity=binding.producer_identity,receiverIdentity=receiver.identity,archiveBytes=binding.bytes,archiveSHA256=binding.sha256))
    failed=receiver.query(restore_statement(raw,binding,late_failure=True),allowed=True)
    receiver.check('actual_full_restore_visible_before_late_fault',failed.returncode!=0 and failed.stderr and b'division by zero' in failed.stderr and len(failed.stdout.splitlines())==1 and json.loads(failed.stdout)==dict(originals=2,results=1) and COMMIT_MARKER not in failed.stdout)
    try:committed_pg_json(failed.stdout,failed.stderr,failed.returncode)
    except ValueError:receiver.check('late_restore_fault_never_commit_receipt',True)
    else:receiver.check('late_restore_fault_never_commit_receipt',False)
    receiver.check('late_fault_rolls_back_all_ddl_data_and_permissions',blank_receiver(receiver) and custody.original.roles(receiver)==roles and custody.profile(receiver,'tf_feed_rehearsal')==feed)
    clean=receiver.query(restore_statement(raw,binding))
    receipt=committed_pg_json(clean.stdout,clean.stderr,clean.returncode)
    receiver.check('same_exact_archive_committed_after_known_rollback',json.loads(receipt)==dict(originals=2,results=1))
    restored={schema:custody.profile(receiver,schema) for schema in SCHEMAS}
    receiver.record('HTML_RESTORE_ACTUAL_CATALOGS',dict(profiles=restored,roles=custody.original.roles(receiver),rows=custody.full_rows(receiver)))
    receiver.check('complete_owner_acl_rls_constraints_functions_triggers_exact',restored==profiles)
    receiver.check('all_original_request_output_row_hashes_ids_times_exact',custody.full_rows(receiver)==rows)
    receiver.check('incidental_feed_principals_and_defaults_unchanged',custody.original.roles(receiver)==roles and custody.profile(receiver,'tf_feed_rehearsal')==feed)
    del raw,clean,receipt
    receiver.stop();receiver.start()
    stored,receipt,current,previous=custody.cold_read(receiver,expected)
    receiver.check('cold_three_getters_rederive_exact_stored_packet',sha256(receipt).hexdigest()==receipt_sha and sha256(stored.result.canonical_input).hexdigest()==packet_sha and stored.result.proposal.review_state=='unverified')
    receiver.record('HTML_RESTORE_COLD_RECEIPT_HASHES',dict(result=sha256(receipt).hexdigest(),currentOriginal=sha256(current).hexdigest(),previousOriginal=sha256(previous).hexdigest(),canonicalPacket=packet_sha,reviewState=stored.result.proposal.review_state))
    receiver.check('cold_full_catalogs_rows_principals_still_exact',custody.full_rows(receiver)==rows and all(custody.profile(receiver,schema)==profile for schema,profile in profiles.items()) and custody.original.roles(receiver)==roles and custody.profile(receiver,'tf_feed_rehearsal')==feed)
    return dict(archiveBytes=binding.bytes,archiveSHA256=binding.sha256,storedOriginals=2,storedExtractions=1,restoredIntoDistinctNewCluster=True,matchingInstalledPostgresOnly=True,offhostBackupVerified=False,sourceRequests=0,modelCalls=0,publicationEnabled=False)


def close_trials(trials):
    # Cleanup one owned trial must not prevent attempts for the other. Any
    # cleanup/readback failure still withholds the success launcher result.
    errors=[]
    for trial in reversed(trials):
        checks=[trial.stop,trial.stop_initializer,lambda t=trial:t.verify_sources('HTML_RESTORE_FINAL')]
        if hasattr(trial,'html_runtime'):checks.append(lambda t=trial:custody.original.verify_runtime(t,'RESTORE_FINAL'))
        for check in checks:
            try:check()
            except BaseException as error:errors.append(type(error).__name__)
        if trial.identity is not None:
            try:trial.record('HTML_RESTORE_FINAL_OWNED_STATE',trial.inspect())
            except BaseException as error:errors.append(type(error).__name__)
    if errors:raise FeedPgTrialError('Owned restore cleanup or readback incomplete; inspect retained proof')


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed restore trial takes no arguments')
    os.umask(0o077);trials=[]
    try:
        # Track each constructor immediately for failure cleanup; do not adopt
        # an existing cluster or consume an external archive at any phase.
        producer=FreshFeedPostgres();trials.append(producer)
        receiver=FreshFeedPostgres();trials.append(receiver)
        freeze_restore(producer);freeze_restore(receiver)
        if producer.frozen!=receiver.frozen:raise FeedPgTrialError('Producer and receiver source bindings differ')
        producer.create();result=restore_cases(producer,receiver)
        producer.record('HTML_RESTORE_RESULT',dict(state='PASS_BOUNDED_INVENTED_HTML_EXTRACTION_RESTORE',assertions=producer.assertions+receiver.assertions,receiverProof=str(receiver.proof),**result))
    except BaseException as error:
        for trial in trials:trial.record('HTML_RESTORE_FAILURE',dict(state='held',exceptionClass=type(error).__name__,preserved=True))
        raise
    finally:
        close_trials(trials)
    print(json.dumps(dict(proof=str(producer.proof),receiverProof=str(receiver.proof),assertions=len(producer.assertions)+len(receiver.assertions),state='PASS_BOUNDED_INVENTED_HTML_EXTRACTION_RESTORE',primaryChanged=False)))


if __name__=='__main__':main()
