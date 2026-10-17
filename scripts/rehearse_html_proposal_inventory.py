"""Fresh fixed owner-only HTML preparation discovery and explicit full reading.

No metadata-derived prewrite witness, automatic newest/first choice, current
publication claim, source/provider request, held capture or operational target.
"""
from __future__ import annotations
import ast,json,os,sys
from datetime import datetime,timezone
from hashlib import sha256
from uuid import uuid4
from dataclasses import replace
from scripts import rehearse_html_proposal_custody as preparation
from workers.html_proposal_inventory import prepare_html_proposal_inventory,parse_html_proposal_inventory,select_html_proposal,HtmlProposalInventoryError
from workers.html_proposal_custody import prepare_html_proposal_custody
from workers.html_proposal_postgres import prepare_html_proposal_store,parse_stored_html_proposal,prepare_html_preparation_reopen

ROOT=preparation.ROOT
ENTRY='scripts/rehearse_html_proposal_inventory.py'
NEW_FILES=(ENTRY,'tests/test_html_proposal_inventory_scope.py','workers/html_proposal_inventory.py','tests/test_html_proposal_inventory.py')
FreshFeedPostgres=preparation.FreshFeedPostgres
FeedPgTrialError=preparation.FeedPgTrialError
SCHEMAS=('tf_feed_rehearsal','tf_html_rehearsal','tf_html_extraction','tf_html_preparation')


def freeze_inventory(trial):
    if trial.counter!=0 or trial.identity is not None or trial.creation_attempted or trial.initializer_attempted:raise FeedPgTrialError('Inventory freeze must precede all resource commands')
    preparation.freeze_preparation(trial)
    names=set(NEW_FILES);pending=list(names);rows=[]
    while pending:
        name=pending.pop();body=preparation.custody.original._read(ROOT/name)
        if name.endswith('.py'):
            for node in ast.walk(ast.parse(body)):
                modules=[node.module] if isinstance(node,ast.ImportFrom) and node.module else [n.name for n in node.names] if isinstance(node,ast.Import) else []
                for module in modules:
                    child=module.replace('.','/')+'.py'
                    if (ROOT/child).is_file() and child not in names:names.add(child);pending.append(child)
    for name in sorted(names):
        body=preparation.custody.original._read(ROOT/name)
        if name in trial.frozen:
            if body!=trial.frozen[name]:raise FeedPgTrialError('Frozen inventory dependency changed')
            continue
        path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with path.open('xb') as stream:stream.write(body)
        path.chmod(0o600);trial.frozen[name]=body;rows.append(dict(path=name,bytes=len(body),sha256=sha256(body).hexdigest()))
    trial.source_bindings.extend(rows);trial.record('HTML_INVENTORY_SOURCE_BINDINGS',rows)


def lookup(trial,extraction_expected,label):
    _,receipt,current,previous=preparation.custody.cold_read(trial,extraction_expected)
    request=prepare_html_proposal_inventory(receipt,extraction_expected,current_receipt=current,previous_receipt=previous,observed_at=datetime.now(timezone.utc))
    raw=preparation.custody.original.committed(trial,request.statement())
    observation=parse_html_proposal_inventory(raw,request,observed_at=datetime.now(timezone.utc))
    (trial.proof/('HTML_INVENTORY_'+label+'_RECEIPT.json')).write_bytes(raw)
    trial.record('HTML_INVENTORY_'+label+'_OBSERVATION',dict(sourceScope=json.loads(request.canonical_scope),observedAt=observation.observed_at.isoformat(),candidates=[dict(operationId=c.operation_id,artifactId=c.artifact_id,storedAt=c.stored_at.isoformat(),metadataSHA256=sha256(c.intent.canonical_metadata).hexdigest()) for c in observation.candidates]))
    return observation


def add_preparation(trial,extraction_expected,*,known_head):
    if type(known_head) is not bool:raise FeedPgTrialError('Fixed invented head branch required')
    _,receipt,current,previous=preparation.custody.cold_read(trial,extraction_expected)
    context=preparation.invented_context(extraction_expected)
    if known_head:context['issue']['head']=dict(publication_id=str(uuid4()),content_sha256='d'*64,changed_at='2020-01-02T00:00:00.000000Z')
    raw_context=json.dumps(context,indent=2,ensure_ascii=False).encode()+b'\n'
    prepared=prepare_html_proposal_custody(receipt,extraction_expected,raw_context,current_receipt=current,previous_receipt=previous,operation_id=str(uuid4()),observed_at=datetime.now(timezone.utc))
    request=prepare_html_proposal_store(prepared)
    full=preparation.custody.original.committed(trial,request.statement())
    stored=parse_stored_html_proposal(full,request,observed_at=datetime.now(timezone.utc))
    expected=prepare_html_preparation_reopen(intent=prepared.intent,artifact_id=stored.artifact_id,stored_at=stored.stored_at,observed_at=datetime.now(timezone.utc))
    label='KNOWN' if known_head else 'EMPTY'
    (trial.proof/('HTML_INVENTORY_'+label+'_FULL_PREPARATION.json')).write_bytes(full)
    trial.record('HTML_INVENTORY_'+label+'_INDEPENDENT_EXPECTATION',preparation.custody._json_value(dict(intent=prepared.intent.canonical_metadata,artifact_id=expected.artifact_id,stored_at=expected.stored_at,observed_at=expected.observed_at)))
    return expected,sha256(full).hexdigest()


def full_selected(trial,observation,independent,extraction_expected,expected_sha,label):
    metadata=json.loads(independent.intent.canonical_metadata)
    selected=select_html_proposal(observation,independent.intent,operation_id=metadata['operation_id'],artifact_id=independent.artifact_id,observed_at=datetime.now(timezone.utc))
    reopened,receipt,_,_,_=preparation.cold_read(trial,selected,extraction_expected)
    trial.check(label+'_explicit_independent_choice_full_receipt_exact',sha256(receipt).hexdigest()==expected_sha and reopened.stored.artifact_id==independent.artifact_id and reopened.result.intent.canonical_metadata==independent.intent.canonical_metadata)
    payload=json.loads(reopened.result.parts.selection_raw)
    trial.check(label+'_historical_head_stays_explicit', (payload['basePublicationId'] is None)==label.startswith('EMPTY'))
    return selected


def cases(trial):
    principal=preparation.custody.original.roles(trial)
    preparation.install_preparation(trial)
    profiles={schema:preparation.profile(trial,schema) for schema in SCHEMAS}
    trial.check('closed_invented_owner_profiles',preparation.expected_profile(profiles['tf_html_preparation']) and preparation.custody.expected_profile(profiles['tf_html_extraction']) and preparation.custody.original.expected_profile(profiles['tf_html_rehearsal']))
    extraction_expected,_,_=preparation.custody.store_pair_and_result(trial)
    empty=lookup(trial,extraction_expected,'EMPTY')
    trial.check('actual_witnessed_empty_preparation_list',empty.candidates==())
    first,first_sha=add_preparation(trial,extraction_expected,known_head=False)
    second,second_sha=add_preparation(trial,extraction_expected,known_head=True)
    baseline=preparation.full_rows(trial)
    trial.check('same_extraction_two_explicit_contexts_only',len(baseline['html'])==2 and len(baseline['extraction'])==1 and len(baseline['preparation'])==2 and baseline['feed']==[0,0,0,0])
    listed=lookup(trial,extraction_expected,'TWO')
    identities={row.artifact_id for row in listed.candidates}
    trial.check('actual_two_rows_keep_both_exact_independent_intents',identities=={first.artifact_id,second.artifact_id} and {row.intent.canonical_metadata for row in listed.candidates}=={first.intent.canonical_metadata,second.intent.canonical_metadata})
    full_selected(trial,listed,first,extraction_expected,first_sha,'EMPTY')
    full_selected(trial,listed,second,extraction_expected,second_sha,'KNOWN')
    counter=trial.counter
    for label,observation,independent,artifact in [('stale_empty',empty,first,first.artifact_id),('mixed_artifact',listed,first,second.artifact_id),('foreign_intent',listed,replace(first,intent=second.intent),first.artifact_id)]:
        operation=json.loads(independent.intent.canonical_metadata)['operation_id']
        try:select_html_proposal(observation,independent.intent,operation_id=operation,artifact_id=artifact,observed_at=datetime.now(timezone.utc))
        except HtmlProposalInventoryError:trial.check(label+'_never_defaults_to_another_choice',True)
        else:trial.check(label+'_never_defaults_to_another_choice',False)
    trial.check('refused_choices_issue_no_database_command',trial.counter==counter)
    for label,mutate in [('principal',lambda value:value.update(session_principal='foreign')),('scope',lambda value:value['scope'].update(extraction_request_sha256='f'*64)),('duplicate',lambda value:value['candidates'].append(value['candidates'][0]))]:
        value=json.loads(listed.full_receipt);mutate(value)
        try:parse_html_proposal_inventory(json.dumps(value).encode(),listed.request,observed_at=datetime.now(timezone.utc))
        except HtmlProposalInventoryError:trial.check(label+'_actual_metadata_envelope_withheld_whole',True)
        else:trial.check(label+'_actual_metadata_envelope_withheld_whole',False)
    trial.stop();trial.start()
    cold=lookup(trial,extraction_expected,'COLD')
    trial.check('cold_metadata_identities_intent_bytes_times_exact',cold.candidates==listed.candidates and cold.request.canonical_scope==listed.request.canonical_scope)
    full_selected(trial,cold,first,extraction_expected,first_sha,'EMPTY_COLD')
    full_selected(trial,cold,second,extraction_expected,second_sha,'KNOWN_COLD')
    trial.check('metadata_reads_and_choices_leave_all_seven_tables_profiles_roles_exact',preparation.full_rows(trial)==baseline and preparation.custody.original.roles(trial)==principal and all(preparation.profile(trial,schema)==profile for schema,profile in profiles.items()))
    trial.record('HTML_INVENTORY_FINAL_STATE',dict(rows=baseline,profiles=profiles,roles=principal))
    return dict(storedOriginals=2,storedExtractions=1,storedPreparations=2,automaticChoices=0,sourceRequests=0,modelCalls=0,actualHeldCapture=False,publicationEnabled=False)


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed inventory trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres()
    try:
        freeze_inventory(trial);trial.create();result=cases(trial)
        trial.record('HTML_INVENTORY_RESULT',dict(state='PASS_BOUNDED_INVENTED_HTML_PREPARATION_INVENTORY',assertions=trial.assertions,**result))
    except BaseException as error:
        trial.record('HTML_INVENTORY_FAILURE',dict(state='held',exceptionClass=type(error).__name__,preserved=True));raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:
                trial.verify_sources('HTML_INVENTORY_FINAL')
                if hasattr(trial,'html_runtime'):preparation.custody.original.verify_runtime(trial,'INVENTORY_FINAL')
        if trial.identity is not None:trial.record('HTML_INVENTORY_FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps(dict(proof=str(trial.proof),assertions=len(trial.assertions),state='PASS_BOUNDED_INVENTED_HTML_PREPARATION_INVENTORY',primaryChanged=False)))


if __name__=='__main__':main()
