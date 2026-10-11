"""Reuse the H held-before-scrub transaction against an actual combined chain.

Fixed fresh-cluster caller only. No restart grant, provider, primary connection,
real report, credentials or external service. Raw child plans are not retained.
"""
import json
from pathlib import Path
from uuid import uuid4
from contact_free_shared_restore_receipt import check_shared_restore_plan,qualify_captured_shared_inventory
from contact_free_shared_restore_native import quote,encoded,NODE
CLI=Path(__file__).resolve().parent/'check_contact_free_shared_restore_plan.mjs'
INVENTORY_CLI=Path(__file__).resolve().parent/'check_contact_free_shared_inventory.mjs'
class CombinedRestore:
    def __init__(self,*,run,sql,check,proof,name,binary,received,target,execution):
        self.run,self.sql,self.check,self.proof,self.name,self.binary=run,sql,check,proof,name,binary
        self.received,self.target,self.execution,self.at=received,target,execution,received
        record_fields = "jsonb_build_object('lifecycle',jsonb_build_object('schemaVersion',1,'reportId',r.report_id,'receivedAtMs',r.received_at_ms,'closedAtMs',r.closed_at_ms,'erasedAtMs',r.erased_at_ms,'eraseReason',r.erase_reason),'requestId',r.request_id,'target',r.target,'closedReason',r.closed_reason,'reviewerId',r.reviewer_id,'version',r.version)"
        records_query = "select coalesce(jsonb_agg(jsonb_build_object('record',"+record_fields+",'hasPayload',exists(select from tf_contact_free_trial.payloads p where p.report_id=r.report_id)) order by r.report_id),'[]'::jsonb) from tf_contact_free_trial.records r"
        payload_query = "select coalesce(jsonb_agg(to_jsonb(p) order by p.report_id),'[]'::jsonb) from tf_contact_free_trial.payloads p"
        target_query = "select coalesce(jsonb_agg(to_jsonb(t) order by t.issue_id),'[]'::jsonb) from tf_bound_trial.current_targets t"
        shared_queries = {table:'select coalesce(jsonb_agg(to_jsonb(t) order by '+key+"),'[]'::jsonb) from tf_shared_admission_trial."+table+' t'
            for table,key in [('accepted','observed_at_ms'),('buckets','key'),('reservations','ticket')]}
        control_queries = {table:"select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from "+table+' c'
            for table in ['tf_shared_admission_trial.context','tf_contact_free_write_trial.context_state',
                          'tf_contact_free_trial.clock_state','tf_bound_trial.clock_state']}
        self.records_query,self.payload_query,self.target_query=records_query,payload_query,target_query
        self.shared_queries,self.control_queries=shared_queries,control_queries
    def value(self,text,database='postgres',role=None):
        return json.loads(self.sql(text,database=database,role=role).stdout.strip())
    def capture(self,label):
        result=self.value('select tf_shared_inventory_trial.capture_invented('+quote(self.execution)+');',role='tf_shared_inventory')
        if not qualify_captured_shared_inventory(result,self.execution,self.at):
            raise AssertionError('Invented source-bound shared capture held')
        output=self.run([NODE,'--experimental-strip-types',str(INVENTORY_CLI)],text=json.dumps({'inventory':result,'nowMs':self.at},ensure_ascii=False,separators=(',',':')),allowed=True)
        expected={'kind':'checked_invented_shared_inventory','openReports':sum(r['lifecycle']['closedAtMs'] is None for r in result['writeInventory']['records']),
          'acceptedInHour':len(result['admission']['acceptedAtMs']),'admissionDisposition':'held_pending_or_unknown' if result['admission']['reservations'] else 'snapshot_only_no_restart_authority'}
        self.check(label+'_G_metadata_qualified',json.loads(output.stdout),expected)
        self.check(label+'_G_child_exit',output.returncode,0)
        self.proof.joinpath(label+'_INVENTED_INVENTORY.json').write_text(json.dumps(result,indent=2)+'\n')
        return result
    def backup(self):
        original=self.capture('BEFORE_REPLACEMENT')
        self.check('copy_pending_unknown_included',len(original['admission']['reservations']),1)
        self.check('copy_unsettled_effect_not_counted',original['admission']['acceptedAtMs'],[])
        self.copy={'schemaVersion':1,'kind':'invented_shared_backup_inventory','sharedInventory':original,
          'writeBackup':{'schemaVersion':1,'kind':'invented_write_backup_inventory','executionId':self.execution,'copiedAtMs':self.received,
            'records':self.value(self.records_query+';'),'operations':original['writeInventory']['operations']}}
        self.original_payloads=self.value(self.payload_query+';');self.original_targets=self.value(self.target_query+';')
        self.original_shared={t:self.value(q+';') for t,q in self.shared_queries.items()}
        self.original_controls={t:self.value(q+';') for t,q in self.control_queries.items()}
        for table,rows in self.original_controls.items():
            expected={'singleton':True,'known':True}
            if table.endswith('.context'):expected.update(execution_id=self.execution,last_now_ms=self.received)
            elif table.endswith('.context_state'):expected.update(execution_id=self.execution)
            else:expected.update(now_ms=self.received)
            self.check('combined_copy_exact_control_'+table,rows,[expected])
        self.dump=self.run(['docker','exec',self.name,self.binary+'pg_dump','-h','/tmp','-U','postgres','-d','postgres','--no-password']).stdout
        self.check('copy_records_unchanged',self.value(self.records_query+';'),self.copy['writeBackup']['records'])
        self.check('copy_shared_state_unchanged',{t:self.value(q+';') for t,q in self.shared_queries.items()},self.original_shared)
        self.proof.joinpath('INVENTED_COMBINED_BACKUP.sql').write_text(self.dump)
        self.proof.joinpath('INVENTED_COMBINED_BACKUP.json').write_text(json.dumps(self.copy,indent=2)+'\n')
    def plan(self,latest,label):
        reply=self.run([NODE,'--experimental-strip-types',str(CLI)],text=json.dumps({'backup':self.copy,'latest':latest,'nowMs':self.at},ensure_ascii=False,separators=(',',':')),allowed=True)
        result=json.loads(reply.stdout)
        if result=={'kind':'held'}:
            self.check(label+'_held_plan_exit',reply.returncode,2)
        else:
            if not check_shared_restore_plan(result,self.copy,latest,self.at):
                raise AssertionError('Invented source-qualified shared actions held')
            self.check(label+'_qualified_plan_exit',reply.returncode,0)
        self.proof.joinpath('COMBINED_PLAN_'+label+'.json').write_text(json.dumps(result,indent=2)+'\n')
        return result
    def restore(self,database):
        self.sql('create database '+database+';')
        hold='update tf_contact_free_trial.clock_state set known=false;update tf_bound_trial.clock_state set known=false;update tf_contact_free_write_trial.context_state set known=false;update tf_shared_admission_trial.context set known=false;revoke execute on all functions in schema tf_shared_admission_trial from tf_shared_writer,tf_shared_recovery;'
        self.sql('begin;'+self.dump+'\n'+hold+'commit;',database=database)
        self.check(database+'_admission_grant_held',self.sql("select has_function_privilege('tf_shared_writer','tf_shared_admission_trial.begin_invented(uuid,uuid,uuid,uuid,bigint)','execute');",database=database).stdout.strip(),'f')
        self.check(database+'_original_read_held',self.value('select tf_contact_free_trial.read_private('+quote(self.report)+');',database,'tf_trial_reviewer'),{'kind':'held'})
    def scrub(self,database,result,allowed=False):
        sql,check=self.sql,self.check
        records_query,payload_query,target_query=self.records_query,self.payload_query,self.target_query
        shared_queries,control_queries=self.shared_queries,self.control_queries
        backup,original_payloads,original_targets=self.copy,self.original_payloads,self.original_targets
        original_shared,original_controls=self.original_shared,self.original_controls
        latest_targets,at=self.latest_targets,self.at
        check(database+'_scrub_requires_qualified_plan',result['kind'],'planned_invented_shared_restore')
        statements=['begin;','set local standard_conforming_strings=on;',
            'lock table tf_contact_free_trial.records,tf_contact_free_trial.payloads,tf_contact_free_write_trial.operations,tf_contact_free_write_trial.context_state,tf_contact_free_trial.clock_state,tf_bound_trial.clock_state,tf_bound_trial.current_targets,tf_shared_admission_trial.context,tf_shared_admission_trial.accepted,tf_shared_admission_trial.buckets,tf_shared_admission_trial.reservations in access exclusive mode;',
            'create temporary table tf_shared_restore_guard(verified boolean not null check(verified is true));']
        for query,expected in [(records_query,backup['writeBackup']['records']),(payload_query,original_payloads),(target_query,original_targets),*[(query,original_shared[table]) for table,query in shared_queries.items()]]:
            statements.append('insert into tf_shared_restore_guard select ('+query+') is not distinct from '+quote(json.dumps(expected))+'::jsonb;')
        # Exact immutable old operations are guarded against renewed identity/effect.
        operation_query="select coalesce(jsonb_agg(jsonb_build_object('operationId',o.operation_id,'executionId',o.execution_id,'requestId',o.request_id,'target',o.target,'admittedAtMs',o.admitted_at_ms,'expiresAtMs',o.expires_at_ms,'state',o.state,'reportId',o.report_id,'inserted',o.inserted) order by o.operation_id),'[]'::jsonb) from tf_contact_free_write_trial.operations o"
        statements.append('insert into tf_shared_restore_guard select ('+operation_query+') is not distinct from '+quote(json.dumps(backup['writeBackup']['operations']))+'::jsonb;')
        for table,query in control_queries.items():
            held_rows=[{**row,'known':False} for row in original_controls[table]]
            # Aggregate always yields exactly one guard row, including when an
            # original singleton disappeared. Empty SELECT cannot bypass CHECK.
            statements.append('insert into tf_shared_restore_guard select ('+query+') is not distinct from '+quote(json.dumps(held_rows))+'::jsonb;')
        for action in result['recordActions']:
            record=action['latestRecord'];rid=action['reportId']
            if record is None:statements.append('delete from tf_contact_free_trial.records where report_id='+quote(rid)+';');continue
            lifecycle=record['lifecycle'];columns=['report_id','request_id','target','received_at_ms','closed_at_ms','closed_reason','reviewer_id','erased_at_ms','erase_reason','version']
            values=[rid,record['requestId'],json.dumps(record['target']),lifecycle['receivedAtMs'],lifecycle['closedAtMs'],record['closedReason'],record['reviewerId'],lifecycle['erasedAtMs'],lifecycle['eraseReason'],record['version']]
            statements.append('insert into tf_contact_free_trial.records('+','.join(columns)+') values('+','.join(map(encoded,values))+') on conflict(report_id) do update set '+','.join(col+'=excluded.'+col for col in columns[1:])+';')
            if action['payload']=='remove':statements.append('delete from tf_contact_free_trial.payloads where report_id='+quote(rid)+';')
        for action in result['operationActions']:
            operation=action['latestOperation']
            if operation is None:statements.append('delete from tf_contact_free_write_trial.operations where operation_id='+quote(action['operationId'])+';');continue
            values=[operation['operationId'],operation['executionId'],operation['requestId'],json.dumps(operation['target']),operation['admittedAtMs'],operation['expiresAtMs'],operation['state'],operation['reportId'],operation['inserted']]
            statements.append('insert into tf_contact_free_write_trial.operations values('+','.join(map(encoded,values))+') on conflict(operation_id) do nothing;')
        statements.append('delete from tf_bound_trial.current_targets;')
        for selected in latest_targets:
            claims='array['+','.join(quote(v)+'::uuid' for v in selected['claim_ids'])+']::uuid[]'
            statements.append('insert into tf_bound_trial.current_targets values('+quote(selected['issue_id'])+','+quote(json.dumps(selected['target']))+'::jsonb,'+claims+','+encoded(selected['eligible_for_invented_trial'])+');')
        for table in shared_queries:statements.append('delete from tf_shared_admission_trial.'+table+';')
        for timestamp in result['latestAdmission']['acceptedAtMs']:statements.append('insert into tf_shared_admission_trial.accepted values('+str(timestamp)+');')
        for bucket in result['latestAdmission']['addressBuckets']:
            attempts='array['+','.join(map(str,bucket['attempts']))+']::bigint[]'
            statements.append('insert into tf_shared_admission_trial.buckets values('+quote(bucket['key'])+','+str(bucket['epoch'])+','+str(bucket['expiresAtMs'])+','+attempts+');')
        for reservation in result['latestAdmission']['reservations']:
            values=[reservation['ticket'],reservation['operationId'],reservation['admittedAtMs'],reservation['phase'],reservation['requestId'],None if reservation['target'] is None else json.dumps(reservation['target'])]
            statements.append('insert into tf_shared_admission_trial.reservations values('+','.join(map(encoded,values))+');')
        statements.extend([f'update tf_contact_free_trial.clock_state set now_ms={at},known=true;',f'update tf_bound_trial.clock_state set now_ms={at},known=true;',
            'update tf_contact_free_write_trial.context_state set known=true;',f'update tf_shared_admission_trial.context set last_now_ms={at},known=false;',
            "create temporary table tf_shared_restore_sweep(value jsonb not null check((value->>'kind'='swept' and value-'kind'-'removedPayloads'-'removedRecords'='{}'::jsonb and jsonb_typeof(value->'removedPayloads')='number' and jsonb_typeof(value->'removedRecords')='number' and value->>'removedPayloads'~'^[0-9]+$' and value->>'removedRecords'~'^[0-9]+$' and (value->>'removedPayloads')::numeric between 0 and 200 and (value->>'removedRecords')::numeric between 0 and 200) is true));",
            'insert into tf_shared_restore_sweep select tf_contact_free_trial.sweep_private();',
            "create temporary table tf_shared_restore_expiry(value jsonb not null check((value->>'kind'='expired_operations' and value-'kind'-'removed'='{}'::jsonb and jsonb_typeof(value->'removed')='number' and value->>'removed'~'^[0-9]+$' and (value->>'removed')::numeric between 0 and 400) is true));",
            'insert into tf_shared_restore_expiry select tf_contact_free_write_trial.expire_operations();','commit;'])
        return sql('\n'.join(statements),database=database,allowed=allowed)
    def finish(self):
        self.at=self.received+86400000
        self.sql(f'begin;update tf_contact_free_trial.clock_state set now_ms={self.at};update tf_bound_trial.clock_state set now_ms={self.at};commit;')
        self.report=self.copy['writeBackup']['records'][0]['record']['lifecycle']['reportId']
        self.check('combined_newer_erasure',self.value('select tf_contact_free_trial.erase_private('+quote(self.report)+",'reporter_request');",role='tf_trial_reviewer')['kind'],'erased_private')
        self.pending=self.value('select tf_shared_admission_trial.begin_invented('+','.join(quote(v) for v in [self.execution,str(uuid4()),str(uuid4()),str(uuid4())])+','+str(self.at//900000)+');',role='tf_shared_writer')
        self.check('combined_new_pending_reservation',self.pending['kind'],'reserved_invented')
        self.sql('select tf_shared_admission_trial.arm_invented('+quote(self.execution)+','+quote(self.pending['ticket'])+','+quote(str(uuid4()))+','+quote(json.dumps(self.target))+'::jsonb);',role='tf_shared_writer')
        self.sql('update tf_bound_trial.current_targets set eligible_for_invented_trial=false;')
        latest=self.capture('NEWEST_AFTER_REPLACEMENT_ERASURE')
        self.latest_targets=self.value(self.target_query+';')
        plan=self.plan(latest,'latest');self.check('combined_H_plan_qualified',plan['kind'],'planned_invented_shared_restore')
        self.check('combined_H_never_restart_authority',plan['admissionHeld'] and not plan['writerEnabled'],True)
        for database in ['tf_combined_restored','tf_combined_missing_control']:
            self.restore(database)
        self.scrub('tf_combined_restored',plan)
        self.check('combined_original_payload_scrubbed',self.value(self.payload_query+';','tf_combined_restored'),[])
        self.check('combined_latest_erasure_retained',self.value(self.records_query+';','tf_combined_restored'),[{'record':latest['writeInventory']['records'][0],'hasPayload':False}])
        self.check('combined_latest_unknown_retained',self.value(self.shared_queries['reservations']+';','tf_combined_restored')[0]['ticket'],self.pending['ticket'])
        # A confirmed repeat can add a second original effect without another
        # report. Compare every qualified recorded operation, not one scalar row.
        recorded=[o for o in latest['writeInventory']['operations'] if o['state']=='recorded']
        query="select coalesce(jsonb_agg(jsonb_build_object('operationId',o.operation_id,'executionId',o.execution_id,'requestId',o.request_id,'target',o.target,'admittedAtMs',o.admitted_at_ms,'expiresAtMs',o.expires_at_ms,'state',o.state,'reportId',o.report_id,'inserted',o.inserted) order by o.operation_id),'[]'::jsonb) from tf_contact_free_write_trial.operations o where state='recorded';"
        self.check('combined_original_effect_unchanged',self.value(query,'tf_combined_restored'),sorted(recorded,key=lambda o:o['operationId']))
        self.check('combined_shared_context_still_held',self.sql('select known from tf_shared_admission_trial.context;',database='tf_combined_restored').stdout.strip(),'f')
        self.check('combined_owner_inventory_cannot_restart',self.value('select tf_shared_inventory_trial.capture_invented('+quote(self.execution)+');','tf_combined_restored','tf_shared_inventory'),{'kind':'held'})
        self.sql('delete from tf_contact_free_write_trial.context_state;',database='tf_combined_missing_control')
        self.check('combined_missing_control_rolls_back',self.scrub('tf_combined_missing_control',plan,True).returncode!=0,True)
        self.check('combined_failed_scrub_keeps_old_payload',self.value(self.payload_query+';','tf_combined_missing_control'),self.original_payloads)
        self.check('combined_failed_scrub_remains_held',self.sql('select known from tf_contact_free_trial.clock_state;',database='tf_combined_missing_control').stdout.strip(),'f')
        self.at=self.received+180*86400000
        self.sql(f'begin;update tf_contact_free_trial.clock_state set now_ms={self.at};update tf_bound_trial.clock_state set now_ms={self.at};commit;')
        expired=self.capture('ORIGINAL_180D')
        self.check('combined_original_reference_removed',expired['writeInventory']['operations'],[])
        self.check('combined_original_custody_removed',expired['writeInventory']['records'],[])
        self.check('combined_179d_pending_identity_retained',expired['admission']['reservations'][0]['phase'],'armed')
        self.at+=86400000
        self.sql(f'begin;update tf_contact_free_trial.clock_state set now_ms={self.at};update tf_bound_trial.clock_state set now_ms={self.at};commit;')
        opaque=self.capture('PENDING_ORIGINAL_180D')
        self.check('combined_expired_debt_is_opaque',opaque['admission']['reservations'],[{'ticket':self.pending['ticket'],'operationId':None,'admittedAtMs':None,'phase':'expired','requestId':None,'target':None}])
        self.check('combined_empty_custody_never_releases_debt',self.value('select tf_shared_admission_trial.begin_invented('+','.join(quote(v) for v in [self.execution,str(uuid4()),str(uuid4()),str(uuid4())])+','+str(self.at//900000)+');',role='tf_shared_writer'),{'kind':'held'})
