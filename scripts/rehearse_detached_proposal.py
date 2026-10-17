"""Fixed fresh-owned four-part preparation custody; no operational install."""
import ast,base64,json,os,sys
from dataclasses import replace
from datetime import datetime,timedelta,timezone
from hashlib import sha256
from pathlib import Path
from uuid import uuid4
from scripts.rehearse_postgres_feed_journal import FreshFeedPostgres,FeedPgTrialError
from scripts.rehearse_stream_reader import freeze_all,_acl,_same
from scripts.rehearse_reopened_change import freeze_change
from scripts.rehearse_document_reference import freeze_reference,reference_profile
from scripts.rehearse_private_extraction import freeze_private,owner_query,private_profile,private_snapshot
from scripts.rehearse_private_extraction_restore import seed_one,cold_artifact,ALL_SCHEMAS as PREVIOUS_SCHEMAS
from scripts.rehearse_stream_reader_restore import private_defaults
from scripts.rehearse_collection_reader import snapshot
from scripts.rehearse_feed_runtime_roles import OwnedRuntimeRoles
from workers.detached_proposal_custody import (DetachedPreparationIntent,DetachedProposalParts,prepare_detached_proposal_custody,part_bytes,intent_metadata)
from workers.detached_proposal_postgres import (prepare_detached_proposal_store,parse_stored_detached_proposal,parse_reopened_detached_proposal,detached_proposal_read_statement)
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,committed_pg_json,_time
from workers.pair_native_sql import _literal
ROOT=Path(__file__).resolve().parents[1]
FIXTURE='tests/fixtures/invented_detached_proposal.sql'
ALL_SCHEMAS=tuple(sorted((*PREVIOUS_SCHEMAS,'tf_detached_proposal')))


def freeze_detached(trial,*,extra=()):
 names={FIXTURE,'scripts/rehearse_detached_proposal.py','workers/detached_proposal_custody.py','workers/detached_proposal_postgres.py',*extra};queue=list(names)
 while queue:
  name=queue.pop()
  if not name.endswith('.py'):continue
  for node in ast.walk(ast.parse((ROOT/name).read_bytes())):
   if isinstance(node,ast.ImportFrom) and node.module:
    child=node.module.replace('.','/')+'.py'
    if child not in names and child not in trial.frozen and (ROOT/child).is_file():names.add(child);queue.append(child)
 rows=[]
 for name in sorted(names):
  raw=(ROOT/name).read_bytes()
  if name in trial.frozen:
   if trial.frozen[name]!=raw:raise FeedPgTrialError('Detached preparation dependency changed')
   continue
  path=trial.proof/'inputs'/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with path.open('xb') as f:f.write(raw)
  path.chmod(0o600);trial.frozen[name]=raw;row=dict(path=name,bytes=len(raw),sha256=sha256(raw).hexdigest());rows.append(row);trial.source_bindings.append(row)
 trial.record('DETACHED_PREPARATION_SOURCE_BINDINGS',rows)
 trial.record('DETACHED_PREPARATION_SCOPE',dict(newOwnedNamespaceOnly=True,fourRawParts=True,actualHeldCapture=False,
  sourceCalls=0,modelCalls=0,newRuntimeGrants=0,arbitrarySqlContainment=False,operationalAcceptance=False,primaryChanged=False))


def install_detached(trial,roles):
 if type(roles) is not OwnedRuntimeRoles or roles.trial is not trial:raise FeedPgTrialError('Detached custodian mismatch')
 roles.verify();trial.query("begin;set local statement_timeout='10s';"+trial.frozen[FIXTURE].decode()+'commit;');roles.verify()


def preparation_snapshot(query):
 return json.loads(query("begin isolation level repeatable read read only;select jsonb_build_object('rows',jsonb_array_length(body),'bytes',octet_length(body::text),'sha256',encode(sha256(convert_to(body::text,'UTF8')),'hex')) from (select coalesce(jsonb_agg(to_jsonb(r) order by operation_id),'[]'::jsonb) body from tf_detached_proposal.preparations r) scope;commit;").stdout)


def whole_detached_scope(query,*,empty=False):
 v=json.loads(query("""begin isolation level repeatable read read only;select jsonb_build_object(
 'schemas',(select jsonb_agg(nspname order by nspname) from pg_namespace where nspname !~ '^pg_' and nspname<>'information_schema'),
 'publicRelations',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
 'publicFunctions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
 'extensions',(select jsonb_agg(extname order by extname) from pg_extension),
 'tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and c.relkind='r'),
 'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('public','information_schema') and n.nspname !~ '^pg_'),
 'eventTriggers',(select count(*) from pg_event_trigger));commit;""").stdout)
 expected=dict(schemas=['public'] if empty else ['public',*ALL_SCHEMAS],publicRelations=0,publicFunctions=0,extensions=['plpgsql'],tables=0 if empty else 11,functions=0 if empty else 28,eventTriggers=0)
 if v!=expected or any(type(v[k]) is not type(value) for k,value in expected.items()):raise FeedPgTrialError('Whole detached scope unavailable')
 return v


def preparation_profile(query):
    value = json.loads(query("""begin isolation level repeatable read read only;select jsonb_build_object(
 'schema',(select jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'acl',
  (select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a)) from pg_namespace n where n.nspname='tf_detached_proposal'),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',
  (select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tf_detached_proposal' and c.relkind='r'),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'path',p.proconfig,'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),'acl',
  (select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tf_detached_proposal'),
 'constraints',(select jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid)) order by c.conname) from pg_constraint c where c.conrelid='tf_detached_proposal.preparations'::regclass),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'type',t.tgtype,'function',n.nspname||'.'||p.proname) order by t.tgname) from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='tf_detached_proposal.preparations'::regclass and not t.tgisinternal));commit;""").stdout)
    if not _same(value['schema'], dict(owner='tf_feed_lab_owner', acl=_acl(['CREATE', 'USAGE']))):
        raise FeedPgTrialError('Detached preparation schema profile unavailable')
    if not _same(value['tables'], [dict(name='preparations', owner='tf_feed_lab_owner', rls=True,
            acl=_acl(['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']))]):
        raise FeedPgTrialError('Detached preparation table profile unavailable')
    if [row['name'] for row in value['functions']] != ['preparation_receipt', 'refuse_mutation', 'store_preparation']:
        raise FeedPgTrialError('Detached preparation function scope unavailable')
    for row in value['functions']:
        if not _same({key: val for key, val in row.items() if key not in ('name','definitionSha256')},
                dict(owner='tf_feed_lab_owner', definer=False, path=['search_path=pg_catalog'], acl=_acl(['EXECUTE']))):
            raise FeedPgTrialError('Detached preparation function profile unavailable')
    if not _same(value['triggers'], [dict(name='detached_preparation_append_only', enabled='O', type=27, function='tf_detached_proposal.refuse_mutation')]):
        raise FeedPgTrialError('Detached preparation append-only profile unavailable')
    fks = [row for row in value['constraints'] if row['type']=='f']
    if (len(fks) != 1 or not all(row['validated'] for row in value['constraints'])
            or not all('REFERENCES tf_private_extraction.results(operation_id)' in row['definition'] for row in fks)):
        raise FeedPgTrialError('Detached preparation extraction foreign key unavailable')
    if not any(row['name']=='detached_preparation_storage_chronology' and row['type']=='c' and row['validated'] for row in value['constraints']):
        raise FeedPgTrialError('Detached preparation physical chronology guard unavailable')
    return value


def invented_context(extraction,*,at):
 b=extraction.result.current.request.binding;p=extraction.result.proposal
 return dict(schema_version=1,kind='invented_detached_extraction_context',snapshot_intent='single_claim_technical_review_not_issue_replacement',
  artifact=dict(operation_id=extraction.stored.operation_id,artifact_id=extraction.stored.artifact_id,
   request_sha256=extraction.stored.request_sha256,output_sha256=extraction.stored.output_sha256),
  held=dict(run_id=str(uuid4()),decision_id=str(uuid4()),item_key=b.item_key,source_version_id=b.source_version_id,
   content_sha256=b.content_sha256,locator=p.locator,jurisdiction_id='fictional-region',decided_at=_time(at),disposition='held'),
  issue=dict(issue_id=str(uuid4()),jurisdiction_id='fictional-region',jurisdiction_slug='fictional-region',issue_slug='invented-issue',
   created_at=_time(at-timedelta(days=1)),observed_at=_time(at),head=dict(publication_id=None,content_sha256=None,changed_at=None)),
  content=dict(capture_id=str(uuid4()),claim_id=str(uuid4()),title='Invented detached review candidate',summary='Unverified single-claim technical preparation.',
   period_label='Explicit invented period',last_evidence_review_on=at.date().isoformat(),review_date_basis='independently_supplied_not_inferred',
   publisher='Invented publisher',source_title='Invented source passage',source_published_on=None),
  support=dict(source_version_id=b.source_version_id,content_sha256=b.content_sha256,locator=p.locator,assertion=p.proposed_assertion,
   claim_type=p.proposed_claim_type,relation='supports',assignment_state='proposed_only'),translation=dict(display_language=p.language_code,status='unreviewed'))


def seed_preparation(trial):
 roles,scope,expectations,operation,private_sha=seed_one(trial)
 install_detached(trial,roles)
 extraction=cold_artifact(trial,trial,roles,scope,expectations,operation,'DETACHED_SEED')
 if sha256(extraction.full_receipt).hexdigest()!=private_sha:raise FeedPgTrialError('Seed extraction receipt changed')
 at=datetime.now(timezone.utc);ctx=invented_context(extraction,at=at)
 # Deliberately noncanonical original context: spacing/order is preserved too.
 raw=json.dumps(ctx,ensure_ascii=False,indent=1).encode('utf8')
 prepared=prepare_detached_proposal_custody(extraction,raw,operation_id=str(uuid4()),observed_at=datetime.now(timezone.utc))
 request=prepare_detached_proposal_store(prepared);output=owner_query(trial,roles,request.statement());receipt=committed_pg_json(output.stdout,output.stderr,output.returncode)
 stored=parse_stored_detached_proposal(receipt,request,observed_at=datetime.now(timezone.utc))
 trial.record('DETACHED_SEEDED_INTENT',dict(intent=json.loads(prepared.intent.canonical_metadata),artifactId=stored.artifact_id,
  receiptBytes=len(receipt),receiptSHA256=sha256(receipt).hexdigest(),partBytes=[len(x)for x in part_bytes(prepared.parts)],
  originalContextCanonical=False,actualHeldContext=False,modelCalls=0,sourceCalls=0))
 # No old originals, output, context, parts or proposal object crosses cold path.
 return roles,scope,expectations,operation,prepared.intent,sha256(receipt).hexdigest()


def cold_preparation(controller,target,roles,scope,expectations,operation,intent,label):
 extraction=cold_artifact(controller,target,roles,scope,expectations,operation,label+'_EXTRACTION')
 out=owner_query(target,roles,detached_proposal_read_statement(intent));raw=committed_pg_json(out.stdout,out.stderr,out.returncode)
 result=parse_reopened_detached_proposal(raw,intent,extraction,observed_at=datetime.now(timezone.utc))
 controller.record(label+'_FULL_READ',dict(operationId=result.stored.operation_id,artifactId=result.stored.artifact_id,
  receiptBytes=len(raw),receiptSHA256=sha256(raw).hexdigest(),partBytes=[len(x)for x in part_bytes(result.result.parts)],
  preparedAt=_time(result.result.prepared_at),historicalArtifactObservedAt=_time(result.result.historical_artifact_observed_at),
  freshArtifactObservedAt=_time(result.result.extraction.observed_at),observedAt=_time(result.observed_at),sourceCalls=0,modelCalls=0,oldPartsSupplied=False))
 return result


def all_rows(trial,label):
 v=dict(base=snapshot(trial),private=private_snapshot(trial.query),preparations=preparation_snapshot(trial.query));trial.record(label,v);return v


def all_profiles(trial,label):
 v=dict(base=reference_profile(trial.query),private=private_profile(trial.query),preparations=preparation_profile(trial.query),defaults=private_defaults(trial.query));trial.record(label,v);return v


def raw_store(intent,parts):
 args=[_literal(intent.canonical_metadata.decode())+'::jsonb']
 args.extend("decode("+_literal(base64.b64encode(x).decode())+",'base64')"for x in part_bytes(parts))
 return HEAD+"set time zone 'UTC';begin;select tf_detached_proposal.store_preparation("+','.join(args)+");commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def refused(trial,roles,label,sql,*,needle=b'invented_detached_preparation',role=None):
 before=all_rows(trial,label+'_BEFORE')
 out=owner_query(trial,roles,sql,allowed=True) if role is None else roles.query(role,sql,allowed=True)
 trial.check(label+'_refused',out.returncode!=0 and needle in out.stderr.lower())
 trial.check(label+'_all_eleven_tables_unchanged',all_rows(trial,label+'_AFTER')==before)
 return out


def mutated(intent,parts,case):
 meta=json.loads(intent.canonical_metadata);meta['operation_id']=str(uuid4())
 payload=json.loads(parts.payload_raw);selection=json.loads(parts.selection_raw);proof=json.loads(parts.provenance_raw);ctx=json.loads(parts.context_raw)
 if case=='missing_claim':
  del payload['snapshot']['claims'][0]['id'];del proof['claim_id'];del ctx['content']['claim_id']
 elif case=='number_claim':payload['snapshot']['claims'][0]['id']=proof['claim_id']=ctx['content']['claim_id']=42
 elif case=='missing_capture':del selection['captureId'];del ctx['content']['capture_id']
 elif case=='missing_base':del selection['basePublicationId'];del ctx['issue']['head']['publication_id']
 elif case=='missing_observation':del proof['artifact_observed_at']
 elif case=='future_context':ctx['issue']['observed_at']=_time(datetime.now(timezone.utc)+timedelta(days=1))
 elif case=='foreign_extraction':meta['extraction_operation_id']=str(uuid4())
 elif case=='foreign_artifact':meta['extraction_artifact_id']=str(uuid4())
 elif case=='wrong_request':meta['extraction_request_sha256']='f'*64
 elif case=='wrong_output':meta['extraction_output_sha256']='f'*64
 elif case=='extra_metadata':meta['extra']='not permitted'
 elif case=='string_version':meta['schema_version']='1'
 else:raise FeedPgTrialError('Unknown fixed negative case')
 encode=lambda v:json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()
 context_raw=encode(ctx);proof['independent_context']=ctx;proof['context_sha256']=sha256(context_raw).hexdigest();proof['supplied_context_sha256']=sha256(context_raw).hexdigest()
 payload_raw=encode(payload);selection_raw=encode(selection);proof['payload_sha256']=sha256(payload_raw).hexdigest();proof['selection_sha256']=sha256(selection_raw).hexdigest()
 values=(payload_raw,selection_raw,encode(proof),context_raw)
 for key,raw in zip(('payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256'),values):meta[key]=sha256(raw).hexdigest()
 return DetachedPreparationIntent(encode(meta)),DetachedProposalParts(*values)


def cases(trial):
 roles,scope,expectations,operation,intent,receipt_sha=seed_preparation(trial)
 whole=whole_detached_scope(trial.query);trial.record('DETACHED_WHOLE_SCOPE',whole)
 profiles=all_profiles(trial,'DETACHED_INITIAL_PROFILES');initial=all_rows(trial,'DETACHED_INITIAL_ROWS')
 trial.check('initial_single_preparation',initial['preparations']['rows']==1)
 trial.stop();trial.start();roles.verify()
 current=cold_preparation(trial,trial,roles,scope,expectations,operation,intent,'DETACHED_COLD_FIRST')
 trial.check('four_original_parts_receipt_survive_real_restart',sha256(current.full_receipt).hexdigest()==receipt_sha and current.result.historical_artifact_observed_at<current.result.extraction.observed_at)
 parts=current.result.parts
 # Warm/cold byte fidelity and exact replay, with delivery marker withheld only
 # after observing an actual committed reply. This is not a network-loss test.
 out=owner_query(trial,roles,raw_store(intent,parts));receipt=committed_pg_json(out.stdout,out.stderr,out.returncode)
 trial.check('exact_preparation_retry_is_same_receipt',receipt==current.full_receipt)
 try:committed_pg_json(receipt,b'',0)
 except ValueError:withheld=True
 else:withheld=False
 trial.check('withheld_commit_marker_stays_ambiguous',withheld)
 out=owner_query(trial,roles,detached_proposal_read_statement(intent));trial.check('known_operation_read_after_withheld_marker',committed_pg_json(out.stdout,out.stderr,out.returncode)==receipt)
 trial.check('replay_preserves_all_eleven_tables',all_rows(trial,'DETACHED_AFTER_REPLAY')==initial)
 # Actual owner-only observer/writer ACL denials preserve every table.
 for role in ('tf_feed_lab_observer','tf_feed_lab_writer'):
  refused(trial,roles,role+'_table','select count(*) from tf_detached_proposal.preparations;',needle=b'permission denied',role=role)
  refused(trial,roles,role+'_routine',detached_proposal_read_statement(intent),needle=b'permission denied',role=role)
 refused(trial,roles,'append_update','update tf_detached_proposal.preparations set payload_raw=payload_raw;',needle=b'append_only')
 refused(trial,roles,'append_delete','delete from tf_detached_proposal.preparations;',needle=b'append_only')
 for case in ('missing_claim','number_claim','missing_capture','missing_base','missing_observation','future_context','foreign_extraction','foreign_artifact','wrong_request','wrong_output','extra_metadata','string_version'):
  bad_intent,bad_parts=mutated(intent,parts,case);refused(trial,roles,'direct_'+case,raw_store(bad_intent,bad_parts))
 # A different valid body under an existing operation is an actual conflict.
 ctx=json.loads(parts.context_raw);ctx['content']['title']='Another invented technical candidate'
 prep=prepare_detached_proposal_custody(current.result.extraction,json.dumps(ctx).encode(),operation_id=json.loads(intent.canonical_metadata)['operation_id'],observed_at=datetime.now(timezone.utc))
 conflict=prepare_detached_proposal_store(prep);refused(trial,roles,'same_operation_conflict',conflict.statement())
 del prep,conflict,ctx
 # Direct owner INSERT proves the physical FK independently of routine checks.
 foreign=str(uuid4());op=str(uuid4())
 refused(trial,roles,'actual_extraction_foreign_key',"insert into tf_detached_proposal.preparations(operation_id,extraction_operation_id,input,payload_raw,selection_raw,provenance_raw,context_raw,stored_at) select "+_literal(op)+"::uuid,"+_literal(foreign)+"::uuid,input,payload_raw,selection_raw,provenance_raw,context_raw,stored_at from tf_detached_proposal.preparations;",needle=b'foreign key')
 # A target-only owned BEFORE INSERT fault exercises backward stored-clock
 # rollback, without changing system time or an existing object.
 trial.query("begin;set local role tf_feed_lab_owner;create function tf_detached_proposal.clock_fault() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$begin new.stored_at:=(new.input->>'prepared_at')::timestamptz-interval '1 microsecond';return new;end$$;create trigger detached_clock_fault before insert on tf_detached_proposal.preparations for each row execute function tf_detached_proposal.clock_fault();commit;")
 fault_sql="select jsonb_build_object('oid',p.oid,'owner',pg_get_userbyid(p.proowner),'definition',pg_get_functiondef(p.oid),'trigger',(select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgname='detached_clock_fault' and t.tgrelid='tf_detached_proposal.preparations'::regclass)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tf_detached_proposal' and p.proname='clock_fault';"
 fault=json.loads(trial.query(fault_sql).stdout);trial.record('DETACHED_CLOCK_FAULT_BOUND',fault)
 meta=json.loads(intent.canonical_metadata);meta['operation_id']=str(uuid4());clock_intent=DetachedPreparationIntent(json.dumps(meta,sort_keys=True,separators=(',',':')).encode())
 refused(trial,roles,'stored_clock_before_preparation',raw_store(clock_intent,parts))
 if json.loads(trial.query(fault_sql).stdout)!=fault or fault['owner']!='tf_feed_lab_owner':raise FeedPgTrialError('Owned clock fault identity changed')
 trial.query('begin;drop trigger detached_clock_fault on tf_detached_proposal.preparations;drop function tf_detached_proposal.clock_fault();commit;')
 trial.check('clock_fault_removed_exact_original_profiles',all_profiles(trial,'DETACHED_AFTER_CLOCK_PROFILE')==profiles)
 # Uncommitted insertion succeeded before deliberate fault; session abort rolls
 # it back. Absence of a delivered COMMIT alone never implies this rollback.
 meta['operation_id']=str(uuid4());rollback_intent=DetachedPreparationIntent(json.dumps(meta,sort_keys=True,separators=(',',':')).encode())
 sql=raw_store(rollback_intent,parts).replace(');commit;\n',');select 1/0;commit;\n')
 result=refused(trial,roles,'after_insert_transaction_rollback',sql,needle=b'division by zero')
 trial.check('rollback_fault_followed_actual_insert_return',meta['operation_id'].encode() in result.stdout)
 # Legal operation-ID alias across namespaces remains a separate new row.
 alias=json.loads(intent.canonical_metadata);alias['operation_id']=operation;alias_intent=DetachedPreparationIntent(json.dumps(alias,sort_keys=True,separators=(',',':')).encode())
 native=owner_query(trial,roles,raw_store(alias_intent,parts));alias_receipt=committed_pg_json(native.stdout,native.stderr,native.returncode)
 alias_read=json.loads(alias_receipt)
 trial.check('cross_table_alias_preserves_metadata_and_all_four_parts',alias_read['input']==alias and tuple(base64.b64decode(alias_read[k],validate=True) for k in ('payload_base64','selection_base64','provenance_base64','context_base64'))==part_bytes(parts))
 trial.check('legal_cross_table_operation_alias_stores_distinct_row',alias_read['operation_id']==operation and preparation_snapshot(trial.query)['rows']==2)
 # Fill only the NEW laboratory table; these operations preserve the exact
 # historical four-part candidate and are not model or capture dispatches.
 for index in range(48):
  extra=json.loads(intent.canonical_metadata);extra['operation_id']=str(uuid4());extra_intent=DetachedPreparationIntent(json.dumps(extra,sort_keys=True,separators=(',',':')).encode())
  output=owner_query(trial,roles,raw_store(extra_intent,parts));value=json.loads(committed_pg_json(output.stdout,output.stderr,output.returncode))
  if value['operation_id']!=extra['operation_id'] or value['input']!=extra:raise FeedPgTrialError('New lab quota receipt mismatch')
 trial.check('new_lab_quota_fifty_rows',preparation_snapshot(trial.query)['rows']==50)
 extra['operation_id']=str(uuid4());over=DetachedPreparationIntent(json.dumps(extra,sort_keys=True,separators=(',',':')).encode())
 refused(trial,roles,'new_lab_quota_fifty_first',raw_store(over,parts))
 replay=owner_query(trial,roles,raw_store(intent,parts));trial.check('exact_retry_at_full_new_quota',committed_pg_json(replay.stdout,replay.stderr,replay.returncode)==receipt)
 final=all_rows(trial,'DETACHED_FINAL_ROWS');trial.check('all_old_ten_tables_unchanged',final['base']==initial['base'] and final['private']==initial['private'])
 trial.check('final_complete_profiles_unchanged',all_profiles(trial,'DETACHED_FINAL_PROFILES')==profiles)
 del parts,current
 trial.stop();trial.start();roles.verify()
 final_cold=cold_preparation(trial,trial,roles,scope,expectations,operation,intent,'DETACHED_COLD_FINAL')
 trial.check('final_cold_exact_four_parts_receipt',sha256(final_cold.full_receipt).hexdigest()==receipt_sha)
 trial.check('new_fifty_rows_and_all_old_data_survive_restart',all_rows(trial,'DETACHED_FINAL_RESTART_ROWS')==final)
 whole_detached_scope(trial.query)
 return dict(schemas=8,tables=11,functions=28,preparations=50,actualHeldCapture=False,concurrencyQualified=False,actualLogin=False,offHost=False,modelCalls=0,sourceCalls=0)


def main():
 if sys.argv[1:]:raise FeedPgTrialError('Fixed invented detached preparation trial takes no arguments')
 os.umask(0o077);trial=FreshFeedPostgres()
 try:
  freeze_all(trial);freeze_change(trial);freeze_reference(trial);freeze_private(trial);freeze_detached(trial)
  trial.create();scope=cases(trial)
  trial.record('DETACHED_PREPARATION_RESULT',dict(state='PASS_INVENTED_DETACHED_PREPARATION',assertions=trial.assertions,scope=scope,primaryChanged=False))
 except BaseException as error:
  trial.record('DETACHED_PREPARATION_FAILED',dict(type=type(error).__name__,message='invented_detached_preparation_failed'));raise
 finally:
  try:trial.stop()
  finally:
   try:trial.stop_initializer()
   finally:trial.verify_sources('FINAL_DETACHED_PREPARATION')
  if trial.identity is not None:trial.record('DETACHED_PREPARATION_FINAL_OWNED_STATE',trial.inspect())
 print(json.dumps(dict(state='PASS_INVENTED_DETACHED_PREPARATION',proof=str(trial.proof),assertions=len(trial.assertions),primaryChanged=False)))

if __name__=='__main__':main()
