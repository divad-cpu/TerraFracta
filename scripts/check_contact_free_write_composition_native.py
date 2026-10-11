"""Fixed invented write/custody/operation-fence composition trial on a brand-new isolated cluster.

No primary connection, external network, published port, migration installation,
new login/password, source fetch or personal report. Retains the stopped cluster,
SQL, command receipts, failed results and logical dump; never deletes evidence.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys
import re
import time
from threading import Lock
from uuid import uuid4

IMAGE = 'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453'
BIN = '/nix/var/nix/profiles/default/bin/'
ROOT = Path(__file__).resolve().parent.parent
SQLS = [ROOT / ('research/pending/' + name) for name in ['TF007_contact_free_bound_writer_trial.sql','TF007_contact_free_custody_trial.sql','TF007_contact_free_write_composition_trial.sql']]
EXECUTION = 'c8700000-0000-4000-8000-000000000002'
RECEIVED = 1791453600000
DAY = 86400000
REPORT = 'b8200000-1111-4111-8111-111111111111'
REQUEST = 'b8200000-2222-4222-8222-222222222222'
TARGET = {'issueId': '718863b9-75b8-572b-9184-3bc18a13658a',
          'publicationId': 'd8400000-6666-4666-8666-666666666666', 'revision': 1,
          'jurisdictionSlug': 'fictional-country', 'issueSlug': 'fictional-share', 'claimId': None}


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    if sys.argv[1:]:
        raise ValueError('Fixed trial accepts no arguments')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid4().hex[:8]
    proof = Path('/tmp') / ('tf-write-composition-native-' + stamp)
    proof.mkdir(mode=0o700)
    data = proof / 'cluster'
    data.mkdir(mode=0o700)
    # Only the new invented-data mount is made writable for image UID100.
    data.chmod(0o777)
    name = 'terrafracta_write_composition_' + stamp.lower().replace('-', '_')
    label = 'terrafracta.write-composition-trial=' + stamp
    counter = 0
    command_lock = Lock()
    commands = []
    assertions = []
    body = b"\n".join(p.read_bytes() for p in SQLS)
    sources = {*SQLS, Path(__file__).resolve()}
    source_hashes = {}
    for source in sorted(sources):
        relative = source.relative_to(ROOT)
        saved = proof / 'inputs' / relative
        saved.parent.mkdir(parents=True, exist_ok=True)
        content = source.read_bytes()
        saved.write_bytes(content)
        source_hashes[str(relative)] = sha256(content).hexdigest()
    (proof / 'SOURCE_BINDINGS.json').write_text(json.dumps(source_hashes, indent=2) + '\n')
    (proof / 'EXACT_TRIAL.sql').write_bytes(body)
    (proof / 'EXACT_RUNNER.py').write_bytes(Path(__file__).read_bytes())
    started = False
    completed = False

    def run(args, *, text=None, allowed=False, timeout=30):
        nonlocal counter
        timed_out = False
        invoked = [args[0], '--host', 'unix:///var/run/docker.sock', *args[1:]] if args[0] == 'docker' else args
        try:
            result = subprocess.run(invoked, input=text, capture_output=True, text=True, timeout=timeout,
                                    env={'PATH': '/usr/bin:/bin'})
        except subprocess.TimeoutExpired:
            # A lost acknowledgement proves neither absence nor completion.
            # Partial stdout/stderr and exception bodies are not reinterpreted.
            timed_out = True
            result = subprocess.CompletedProcess(invoked, 124, '', 'Invented command timed out')
        with command_lock:
            counter += 1
            sequence = counter
        # Preserve successful, explicitly invented SQL observations only. Docker
        # control replies and failed output can contain unrelated private text.
        program = args[4] if len(args) > 4 and args[2] == '-i' else (args[3] if len(args) > 3 else None)
        retain = result.returncode == 0 and args[:2] == ['docker', 'exec'] and program in (BIN + 'psql', BIN + 'pg_dump')
        record = {'command': invoked, 'exitCode': result.returncode, 'timedOut': timed_out,
                  'outputRetained': retain, 'stdout': result.stdout if retain else '', 'stderr': ''}
        (proof / f'{sequence:03d}-command.json').write_text(json.dumps(record, indent=2) + '\n')
        commands.append({'command': invoked, 'exitCode': result.returncode, 'timedOut': timed_out})
        if result.returncode and not allowed:
            raise RuntimeError('Owned invented trial command failed: ' + str(sequence))
        return result

    def sql(text, *, role=None, allowed=False, database='postgres'):
        wrapped = ('set session authorization ' + role + ';' if role else '') + text
        return run(['docker', 'exec', '-i', name, BIN + 'psql', '-h', '/tmp', '-U', 'postgres',
                    '-d', database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], text=wrapped, allowed=allowed)

    def value(text, *, role=None):
        return json.loads(sql(text, role=role).stdout.strip())

    def check(label, actual, expected):
        if actual != expected:
            assertions.append({'label': label, 'pass': False, 'actual': actual, 'expected': expected})
            raise AssertionError('Invented assertion failed: ' + label)
        assertions.append({'label': label, 'pass': True})

    try:
        meta = json.loads(run(['docker', 'image', 'inspect', IMAGE, '--format', '{{json .Id}}']).stdout)
        check('exact_existing_image', meta, IMAGE)
        # No existing named container is adopted, started, stopped or mounted.
        exists = run(['docker', 'container', 'inspect', name, '--format', '{{.Id}}'], allowed=True)
        check('new_container_name', exists.returncode == 1 and 'No such' in exists.stderr, True)
        launch = (BIN + 'initdb -D /trial/data --username=postgres --auth-local=trust --auth-host=reject '
                  '--no-locale --encoding=UTF8 >/tmp/initdb.log && exec ' + BIN + 'postgres -D /trial/data '
                  "-c listen_addresses='' -c unix_socket_directories=/tmp -c log_statement=none "
                  '-c log_min_error_statement=panic')
        started = True  # Lost start acknowledgement still requires owned-name inspection.
        run(['docker', 'run', '--detach', '--name', name, '--label', label,
             '--network', 'none', '--user', '100:101', '--read-only', '--tmpfs', '/tmp:rw,mode=1777',
             '--shm-size', '128m', '--memory', '512m', '--cpus', '2', '--cap-drop', 'ALL',
             '--security-opt', 'no-new-privileges', '--mount', 'type=bind,source=' + str(data) + ',target=/trial',
             '--entrypoint', 'sh', IMAGE, '-c', launch])
        observed = json.loads(run(['docker', 'inspect', name, '--format',
            '{"image":{{json .Image}},"labels":{{json .Config.Labels}},"network":{{json .HostConfig.NetworkMode}},'
            '"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}']).stdout)
        check('image_binding', observed['image'], IMAGE)
        check('ownership_label', observed['labels'], {'terrafracta.write-composition-trial': stamp})
        check('network_none', observed['network'], 'none')
        check('no_published_ports', observed['ports'], {})
        check('only_new_mount', [(m['Source'], m['Destination']) for m in observed['mounts']], [(str(data), '/trial')])
        for _ in range(10):
            ready = run(['docker', 'exec', name, BIN + 'pg_isready', '-h', '/tmp', '-U', 'postgres'], allowed=True, timeout=3)
            if ready.returncode == 0:
                break
            time.sleep(0.2)
        else:
            raise RuntimeError('Owned invented cluster unavailable')
        sql('begin;' + body.decode() + 'commit;')
        sql(f'insert into tf_bound_trial.clock_state values(true,true,{RECEIVED});'
            f'insert into tf_contact_free_trial.clock_state values(true,true,{RECEIVED});'
            'insert into tf_bound_trial.current_targets values(' + quote(TARGET['issueId']) + ','
            + quote(json.dumps(TARGET)) + "::jsonb,'{d8400000-7777-4777-8777-777777777777}',true);"
            'insert into tf_contact_free_write_trial.context_state values(true,'+quote(EXECUTION)+',true);')
        fixtures = []
        def packet():
            selected={'schemaVersion':1,'requestId':str(uuid4()),'draft':{'target':dict(TARGET),'fields':{
                'kind':'incorrect_statement','details':"INVENTED_PRIVATE_CANARY blåbær 日本語 ; DROP TABLE x; --",'sourceUrl':'https://example.org/INVENTED_ONLY'}}}
            fixtures.append(selected)
            return selected
        def write_query(selected, operation, admitted=RECEIVED):
            return 'select tf_contact_free_write_trial.submit_invented('+quote(EXECUTION)+','+quote(operation)+','+quote(json.dumps(selected))+f'::jsonb,{admitted});'
        def write(selected,operation=None,admitted=RECEIVED):
            return value(write_query(selected,operation or str(uuid4()),admitted),role='tf_trial_writer')
        def recovery_query(selected,operation,admitted=RECEIVED):
            return 'select tf_contact_free_write_trial.recover_invented('+quote(EXECUTION)+','+quote(operation)+','+quote(selected['requestId'])+','+quote(json.dumps(selected['draft']['target']))+f'::jsonb,{admitted});'
        def recover(selected,operation,admitted=RECEIVED):
            return value(recovery_query(selected,operation,admitted),role='tf_write_recovery')
        def count(table):
            return int(sql('select count(*) from '+table+';').stdout.strip())
        def set_time(at):
            sql(f'begin;update tf_contact_free_trial.clock_state set now_ms={at};update tf_bound_trial.clock_state set now_ms={at};commit;')
        def no_stage(label):
            check(label+'_stage_records',count('tf_bound_trial.records'),0)
            check(label+'_stage_payloads',count('tf_bound_trial.payloads'),0)
        check('server_version',sql('select version();').stdout.strip().split()[1].startswith('17.'),True)
        check('all_new_fixture_roles_nologin',sql("select bool_and(not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreaterole) from pg_roles where rolname like 'tf_%';").stdout.strip(),'t')
        expected_functions={'submit_invented(uuid,uuid,jsonb,bigint)':'tf_trial_writer',
            'recover_invented(uuid,uuid,uuid,jsonb,bigint)':'tf_write_recovery','expire_operations()':'tf_trial_custodian',
            'valid_packet(jsonb)':None,'valid_target(jsonb)':None,'envelope(uuid,uuid,text,jsonb)':None,
            'observation(tf_contact_free_write_trial.operations,bigint)':None}
        for role in ['tf_trial_public','tf_trial_writer','tf_write_recovery','tf_trial_reviewer','tf_trial_custodian']:
            actual={function:sql('select has_function_privilege('+quote(role)+','+quote('tf_contact_free_write_trial.'+function)+",'execute');").stdout.strip()=='t' for function in expected_functions}
            check(role+'_exact_function_facade',actual,{function:owner==role for function,owner in expected_functions.items()})
            for owner in ['tf_bound_owner','tf_trial_owner']:
                check(role+'_cannot_become_'+owner,sql('set role '+owner+';',role=role,allowed=True).returncode!=0,True)
        for role in ['tf_trial_writer','tf_write_recovery']:
            for table in ['tf_bound_trial.records','tf_bound_trial.payloads','tf_contact_free_trial.records','tf_contact_free_trial.payloads','tf_contact_free_write_trial.operations','tf_contact_free_write_trial.context_state']:
                check(role+'_direct_'+table+'_read_denied',sql('select * from '+table+';',role=role,allowed=True).returncode!=0,True)
        check('old_writer_stage_entry_revoked',sql("select has_function_privilege('tf_bound_writer','tf_bound_trial.write_invented(jsonb)','execute');").stdout.strip(),'f')
        check('writer_custody_read_denied',sql("select tf_contact_free_trial.read_private('b8200000-1111-4111-8111-111111111111');",role='tf_trial_writer',allowed=True).returncode!=0,True)
        check('recovery_custody_erase_denied',sql("select tf_contact_free_trial.erase_private('b8200000-1111-4111-8111-111111111111','reporter_request');",role='tf_write_recovery',allowed=True).returncode!=0,True)
        selected=packet();operation=str(uuid4());result=write(selected,operation)
        check('new_custodied_write_confirmed',result['outcome'],'confirmed')
        check('new_effect_not_replayed',result['result']['replayed'],False)
        check('exact_envelope_keys',sorted(result),['executionId','operationId','outcome','result'])
        check('exact_receipt_keys',sorted(result['result']),sorted(['schemaVersion','status','requestId','reportId','publicationId','revision','replayed','operationId','target','lifecycle','version','observedAtMs','payloadAvailable']))
        report=result['result']['reportId']
        check('custody_one_private_payload',count('tf_contact_free_trial.payloads'),1)
        no_stage('first_commit')
        check('same_operation_same_ack',write(selected,operation),result)
        check('read_only_recorded_recovery_same_original_effect',recover(selected,operation),result)
        repeated=write(selected)
        check('new_operation_repeat_original_report',repeated['result']['reportId'],report)
        check('new_operation_repeat_effect',repeated['result']['replayed'],True)
        check('repeat_original_received',repeated['result']['lifecycle']['receivedAtMs'],RECEIVED)
        check('repeat_no_private_duplicate',count('tf_contact_free_trial.records'),1)
        no_stage('repeat_commit')
        changed=json.loads(json.dumps(selected));changed['draft']['fields']['details']='Changed invented private explanation'
        check('same_operation_changed_body_unknown',write(changed,operation)['outcome'],'unknown')
        check('new_operation_conflicting_request_fenced',write(changed)['outcome'],'known_nonwrite')
        check('conflict_keeps_original_body',value('select tf_contact_free_trial.read_private('+quote(report)+');',role='tf_trial_reviewer')['payload']['details'],selected['draft']['fields']['details'])
        no_stage('conflict')
        for label,mutate in [('extra_frame',lambda p:p.update(email='invented@example.org')),
            ('wrong_schema',lambda p:p.update(schemaVersion=2)),('null_fields',lambda p:p['draft'].update(fields=None)),
            ('extra_target',lambda p:p['draft']['target'].update(details='INVENTED_PRIVATE_CANARY')),
            ('missing_target',lambda p:p['draft'].pop('target'))]:
            invalid=json.loads(json.dumps(selected));mutate(invalid)
            check(label+'_existing_operation_unknown',write(invalid,operation)['outcome'],'unknown')
        check('minimal_operations_exclude_private_fields',not any(term in sql('select jsonb_agg(to_jsonb(o)) from tf_contact_free_write_trial.operations o;').stdout for term in ['CANARY','details','sourceUrl','digest','address']),True)
        absent=packet();absent_op=str(uuid4())
        check('absence_is_fenced_nonwrite',recover(absent,absent_op)['outcome'],'known_nonwrite')
        check('late_write_cannot_cross_absence_fence',write(absent,absent_op)['outcome'],'known_nonwrite')
        check('absence_fence_has_no_report',count('tf_contact_free_trial.records'),1)
        no_stage('absence_fence')
        # Actual failure after staging but before custody payload: both copies roll back.
        sql("create function tf_contact_free_trial.reject_composed_payload() returns trigger language plpgsql as $$begin raise exception 'Invented payload rejected';end $$;create trigger reject_composed_payload before insert on tf_contact_free_trial.payloads for each row execute function tf_contact_free_trial.reject_composed_payload();")
        failed=packet();failed_op=str(uuid4())
        check('custody_payload_fault_fenced',write(failed,failed_op)['outcome'],'known_nonwrite')
        check('custody_partial_record_rollback',count('tf_contact_free_trial.records'),1)
        no_stage('payload_fault')
        sql('drop trigger reject_composed_payload on tf_contact_free_trial.payloads;')
        check('failed_attempt_cannot_replay_after_fault_removed',write(failed,failed_op)['outcome'],'known_nonwrite')
        # Real concurrent sessions: an uncertain client exit is not server completion.
        from concurrent.futures import ThreadPoolExecutor
        def await_activity(application,event):
            for _ in range(60):
                observed=sql('select coalesce(bool_or(wait_event_type='+quote(event)+'),false) from pg_stat_activity where application_name='+quote(application)+';').stdout.strip()
                if observed=='t':return True
                time.sleep(0.03)
            return False
        concurrent=packet();concurrent_op=str(uuid4())
        with ThreadPoolExecutor(max_workers=2) as workers:
            writing=workers.submit(sql,"begin;set local application_name='tf_composed_writer';"+write_query(concurrent,concurrent_op)+"select pg_sleep(1.0);commit;",role='tf_trial_writer')
            check('writer_real_transaction_open',await_activity('tf_composed_writer','Timeout'),True)
            recovery=workers.submit(sql,"set application_name='tf_composed_recovery';"+recovery_query(concurrent,concurrent_op),role='tf_write_recovery')
            check('recovery_waits_for_actual_server_write',await_activity('tf_composed_recovery','Lock'),True)
            writing.result(); recovered=json.loads(recovery.result().stdout.strip())
        check('post_server_commit_recovery_confirmed',recovered['outcome'],'confirmed')
        check('post_server_commit_original_effect',recovered['result']['replayed'],False)
        no_stage('server_commit_race')
        fenced=packet();fenced_op=str(uuid4())
        before_fence=count('tf_contact_free_trial.records')
        with ThreadPoolExecutor(max_workers=2) as workers:
            recovery=workers.submit(sql,"begin;set local application_name='tf_composed_fence';"+recovery_query(fenced,fenced_op)+"select pg_sleep(1.0);commit;",role='tf_write_recovery')
            check('absence_fence_real_transaction_open',await_activity('tf_composed_fence','Timeout'),True)
            writing=workers.submit(sql,"set application_name='tf_composed_late_writer';"+write_query(fenced,fenced_op),role='tf_trial_writer')
            check('late_server_write_waits_for_absence_fence',await_activity('tf_composed_late_writer','Lock'),True)
            recovery.result();late=json.loads(writing.result().stdout.strip())
        check('fence_wins_late_write_known_nonwrite',late['outcome'],'known_nonwrite')
        check('fence_race_no_new_private_record',count('tf_contact_free_trial.records'),before_fence)
        duplicate=packet()
        with ThreadPoolExecutor(max_workers=2) as workers:
            responses=list(workers.map(lambda _:write(duplicate),range(2)))
        check('concurrent_request_has_one_new_effect',sum(not response['result']['replayed'] for response in responses),1)
        check('concurrent_request_has_one_report',len({response['result']['reportId'] for response in responses}),1)
        no_stage('concurrent_duplicate')
        # Current target still belongs to the actual staging transaction lock.
        retirement=packet();retirement_op=str(uuid4())
        with ThreadPoolExecutor(max_workers=2) as workers:
            retiring=workers.submit(sql,"begin;set local application_name='tf_composed_retire';update tf_bound_trial.current_targets set eligible_for_invented_trial=false;select pg_sleep(1.0);commit;")
            check('retirement_actual_lock_open',await_activity('tf_composed_retire','Timeout'),True)
            writing=workers.submit(sql,"set application_name='tf_composed_wait_writer';"+write_query(retirement,retirement_op),role='tf_trial_writer')
            check('composed_writer_waits_for_current_target',await_activity('tf_composed_wait_writer','Lock'),True)
            retiring.result();held_write=json.loads(writing.result().stdout.strip())
        check('retired_before_transaction_has_no_write',held_write['outcome'],'known_nonwrite')
        check('historical_operation_recovery_after_retirement',recover(selected,operation)['outcome'],'confirmed')
        sql('update tf_bound_trial.current_targets set eligible_for_invented_trial=true;')
        no_stage('retirement_race')
        # Existing custody functions enforce original received/closure/erasure.
        set_time(RECEIVED+10*DAY)
        check('reviewer_close_composed_record',value('select tf_contact_free_trial.close_private('+quote(report)+",'corrected','Invented private resolution');",role='tf_trial_reviewer')['kind'],'closed_private')
        closed=recover(selected,operation)
        check('closed_original_received_not_renewed',closed['result']['lifecycle']['receivedAtMs'],RECEIVED)
        check('closure_original_time',closed['result']['lifecycle']['closedAtMs'],RECEIVED+10*DAY)
        set_time(RECEIVED+40*DAY)
        check('closure_deadline_private_read_held',value('select tf_contact_free_trial.read_private('+quote(report)+');',role='tf_trial_reviewer'),{'kind':'held'})
        swept=value('select tf_contact_free_trial.sweep_private();',role='tf_trial_custodian')
        check('closure_deadline_actual_payload_removed',swept['removedPayloads'],1)
        expired=recover(selected,operation)
        check('expired_operation_retains_minimal_confirmation',expired['outcome'],'confirmed')
        check('expired_operation_cannot_open_payload',expired['result']['payloadAvailable'],False)
        check('expired_original_received_not_renewed',expired['result']['lifecycle']['receivedAtMs'],RECEIVED)
        check('expired_payload_request_cannot_resurrect',write(selected,admitted=RECEIVED+40*DAY)['outcome'],'known_nonwrite')
        no_stage('expired_replay')
        erased=packet();erased_op=str(uuid4());erased_result=write(erased,erased_op,RECEIVED+40*DAY)
        check('later_fresh_custody_record_confirmed',erased_result['outcome'],'confirmed')
        erased_report=erased_result['result']['reportId']
        check('reviewer_erase_composed_payload',value('select tf_contact_free_trial.erase_private('+quote(erased_report)+",'sensitive_material');",role='tf_trial_reviewer')['kind'],'erased_private')
        erased_seen=recover(erased,erased_op,RECEIVED+40*DAY)
        check('erased_recovery_original_received',erased_seen['result']['lifecycle']['receivedAtMs'],RECEIVED+40*DAY)
        check('erased_recovery_payload_false',erased_seen['result']['payloadAvailable'],False)
        wrong=json.loads(json.dumps(erased));wrong['draft']['target']['issueSlug']='other-issue'
        check('recovery_wrong_target_is_unknown',recover(wrong,erased_op,RECEIVED+40*DAY)['outcome'],'unknown')
        sql('update tf_contact_free_write_trial.context_state set known=false;')
        check('unknown_execution_context_recovery_held',recover(erased,erased_op,RECEIVED+40*DAY)['outcome'],'unknown')
        check('unknown_execution_context_write_held',write(packet(),admitted=RECEIVED+40*DAY)['outcome'],'unknown')
        sql('update tf_contact_free_write_trial.context_state set known=true;')
        # Capacity is development backpressure; do not evict live intent fences.
        cap_packet=packet();cap_op=str(uuid4())
        cap_seed="begin;delete from tf_contact_free_write_trial.operations;insert into tf_contact_free_write_trial.operations select md5(n::text)::uuid,"+quote(EXECUTION)+","+quote(cap_packet['requestId'])+","+quote(json.dumps(TARGET))+f"::jsonb,{RECEIVED+40*DAY},{RECEIVED+180*DAY},'nonwrite',null,null from generate_series(1,400)n;"
        cap_query=cap_seed+'select jsonb_build_object(\'write\',tf_contact_free_write_trial.submit_invented('+quote(EXECUTION)+','+quote(cap_op)+','+quote(json.dumps(cap_packet))+f'::jsonb,{RECEIVED+40*DAY})->>\'outcome\',\'count\',(select count(*) from tf_contact_free_write_trial.operations));rollback;'
        cap=value(cap_query)
        check('operation_capacity_backpressure',cap,{'write':'unknown','count':400})
        no_stage('capacity')
        set_time(RECEIVED+180*DAY)
        check('expired_original_intent_recovery_unknown',recover(selected,operation)['outcome'],'unknown')
        check('expired_original_intent_write_unknown',write(selected,operation)['outcome'],'unknown')
        expired_refs=value('select tf_contact_free_write_trial.expire_operations();',role='tf_trial_custodian')
        check('actual_expired_operation_references_removed',expired_refs['removed']>0,True)
        check('expired_original_custody_removed',value('select tf_contact_free_trial.sweep_private();',role='tf_trial_custodian')['removedRecords']>=1,True)
        check('expired_original_receipt_not_recreated',recover(selected,operation)['outcome'],'unknown')
        (proof/'INPUT_FIXTURES_INVENTED_ONLY.json').write_text(json.dumps(fixtures,indent=2)+'\n')
        dump=run(['docker','exec',name,BIN+'pg_dump','-h','/tmp','-U','postgres','-d','postgres','--no-password'])
        (proof/'FINAL_INVENTED_ONLY.sql').write_text(dump.stdout)
        for relative,expected in source_hashes.items():check('source_binding_'+relative,sha256((ROOT/relative).read_bytes()).hexdigest(),expected)
        completed=True
    finally:
        stopped = False
        cleanup_failed = False
        try:
            if started:
                ownership = run(['docker', 'inspect', name, '--format',
                    '{"image":{{json .Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}}}'], allowed=True)
                if ownership.returncode == 0:
                    identity = json.loads(ownership.stdout)
                    if (type(identity) is dict and set(identity) == {'image', 'labels', 'running'}
                            and identity['image'] == IMAGE
                            and identity['labels'] == {'terrafracta.write-composition-trial': stamp}
                            and type(identity['running']) is bool):
                        if identity['running'] is True:
                            stopped = run(['docker', 'stop', '--timeout', '10', name], allowed=True, timeout=15).returncode == 0
                        else:
                            stopped = True
        except Exception:
            cleanup_failed = True
        receipt = {'schemaVersion': 1, 'evidenceKind': 'invented_write_custody_operation_composition',
                   'closedAt': datetime.now(timezone.utc).isoformat(), 'container': name, 'image': IMAGE,
                   'clusterPath': str(data), 'stopped': stopped, 'primaryDatabaseTouched': False,
                   'completed': completed and stopped, 'assertionsComplete': completed,
                   'cleanupState': 'stopped' if stopped else ('unknown' if started else 'not_started'),
                   'cleanupError': cleanup_failed,
                   'loginCredentialsCreated': False, 'actualSourceRequests': 0, 'liveIntakeEnabled': False,
                   'physicalDeletionVerified': False, 'assertions': assertions, 'commands': commands,
                   'sqlSha256': sha256(body).hexdigest(), 'sourceBindings': source_hashes, 'privateEvidenceDirectory': str(proof)}
        (proof / 'RESULT.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps({'privateEvidenceDirectory': str(proof), 'assertionsPassed': sum(a['pass'] for a in assertions),
                          'assertionsFailed': sum(not a['pass'] for a in assertions), 'ownedClusterStopped': stopped}))
        if started and not stopped:
            raise RuntimeError('Owned trial cleanup is unconfirmed; inspect its retained receipt before further action')


if __name__ == '__main__':
    main()
