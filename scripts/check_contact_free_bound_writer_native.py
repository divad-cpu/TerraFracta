"""Fixed invented atomic current-target write trial on a brand-new isolated cluster.

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
SQL = ROOT / 'research/pending/TF007_contact_free_bound_writer_trial.sql'
RECEIVED = 1767268800123
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
    proof = Path('/tmp') / ('tf-bound-writer-native-' + stamp)
    proof.mkdir(mode=0o700)
    data = proof / 'cluster'
    data.mkdir(mode=0o700)
    # Only the new invented-data mount is made writable for image UID100.
    data.chmod(0o777)
    name = 'terrafracta_bound_writer_' + stamp.lower().replace('-', '_')
    label = 'terrafracta.bound-writer-trial=' + stamp
    counter = 0
    command_lock = Lock()
    commands = []
    assertions = []
    body = SQL.read_bytes()
    sources = {SQL, Path(__file__).resolve()}
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
        check('ownership_label', observed['labels'], {'terrafracta.bound-writer-trial': stamp})
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
            'insert into tf_bound_trial.current_targets values(' + quote(TARGET['issueId']) + ','
            + quote(json.dumps(TARGET)) + "::jsonb,'{d8400000-7777-4777-8777-777777777777}',true);")
        check('server_version', sql('select version();').stdout.strip().split()[1].startswith('17.'), True)
        check('all_fixture_roles_nologin', sql("select bool_and(not rolcanlogin) from pg_roles where rolname like 'tf_bound_%';").stdout.strip(), 't')
        for role in ['tf_bound_public', 'tf_bound_writer']:
            for table in ['records', 'payloads', 'current_targets', 'clock_state']:
                for action in ['select *', 'delete']:
                    check(role+'_'+table+'_'+action+'_denied', sql(action+' from tf_bound_trial.'+table+';', role=role, allowed=True).returncode != 0, True)
            for function, wanted in [('write_invented(jsonb)',role=='tf_bound_writer'),('valid_text(text,integer,integer)',False),('valid_id(text)',False),('trimmed(text)',False),('guard_clock()',False)]:
                check(role+'_function_'+function, sql('select has_function_privilege('+quote(role)+','+quote('tf_bound_trial.'+function)+",'execute');").stdout.strip(), 't' if wanted else 'f')
            check(role+'_owner_escalation_denied', sql('set role tf_bound_owner;',role=role,allowed=True).returncode != 0,True)
        check('writer_publication_update_denied', sql('update tf_bound_trial.current_targets set eligible_for_invented_trial=true;',role='tf_bound_writer',allowed=True).returncode != 0,True)
        def packet():
            return {'schemaVersion':1,'requestId':str(uuid4()),'draft':{'target':dict(TARGET),'fields':{
                'kind':'incorrect_statement','details':"INVENTED_PRIVATE_CANARY blåbær 日本語 ; DROP TABLE x; --",'sourceUrl':'https://example.org/INVENTED_ONLY'}}}
        def write(selected):
            return value('select tf_bound_trial.write_invented('+quote(json.dumps(selected))+"::jsonb);",role='tf_bound_writer')
        def count():
            return int(sql('select count(*) from tf_bound_trial.records;').stdout.strip())
        selected=packet();result=write(selected)
        check('fresh_current_target_recorded',result['kind'],'recorded_invented')
        check('receipt_keys_only',sorted(result),['kind','reportId'])
        check('stable_same_request_same_content',write(selected),result)
        check('exact_private_row_only',count(),1)
        check('unicode_sql_lookalike_stays_data',sql('select details from tf_bound_trial.payloads;').stdout.strip(),selected['draft']['fields']['details'])
        check('minimal_has_no_payload',not any(term in sql('select to_jsonb(r) from tf_bound_trial.records r;').stdout for term in ['CANARY','details','sourceUrl','digest','address']),True)
        changed=json.loads(json.dumps(selected));changed['draft']['fields']['details']='Different invented content.'
        check('same_id_changed_body_held',write(changed),{'kind':'held'});check('same_id_no_second_write',count(),1)
        claimed=packet();claimed['draft']['target']['claimId']='d8400000-7777-4777-8777-777777777777'
        check('current_claim_recorded',write(claimed)['kind'],'recorded_invented')
        for field,replacement in [('publicationId',str(uuid4())),('revision',2),('issueSlug','changed'),('jurisdictionSlug','changed'),('claimId',str(uuid4())),('issueId',str(uuid4()))]:
            changed=packet();changed['draft']['target'][field]=replacement
            check('changed_'+field+'_held',write(changed),{'kind':'held'})
        for label,mutate in [
            ('extra_contact',lambda p:p.update(email='invented@example.org')),
            ('extra_payload',lambda p:p['draft']['fields'].update(resolution='invented')),
            ('oversized_body',lambda p:p['draft']['fields'].update(details='x'*17000)),
            ('short_details',lambda p:p['draft']['fields'].update(details='short')),
            ('long_utf16',lambda p:p['draft']['fields'].update(details='😀'*501)),
            ('control_text',lambda p:p['draft']['fields'].update(details='private\x01invented text')),
            ('http_url',lambda p:p['draft']['fields'].update(sourceUrl='http://example.org')),
            ('credential_url',lambda p:p['draft']['fields'].update(sourceUrl='https://invented:invented@example.org')),
            ('invalid_kind',lambda p:p['draft']['fields'].update(kind='publish')),
            ('nonstring_details',lambda p:p['draft']['fields'].update(details=17)),
            ('target_extra',lambda p:p['draft']['target'].update(private='invented')),
            ('invalid_request_uuid',lambda p:p.update(requestId='not-uuid')),
            ('unsupported_uuid_version',lambda p:p.update(requestId='d8400000-1111-9111-8111-111111111111')),
            ('unsupported_uuid_variant',lambda p:p.update(requestId='d8400000-1111-4111-7111-111111111111')),
            ('uppercase_request_uuid',lambda p:p.update(requestId='D8400000-1111-4111-8111-111111111111')),
            ('blank_unicode_details',lambda p:p['draft']['fields'].update(details='\u00a0'*10)),
            ('not_normalized_details',lambda p:p['draft']['fields'].update(details='  invented leading text  ')),
            ('empty_field_object',lambda p:p['draft'].update(fields={})),
            ('schema_mismatch',lambda p:p.update(schemaVersion=2)),
        ]:
            malformed=packet();mutate(malformed);check(label+'_held',write(malformed),{'kind':'held'})
        check('malformed_never_writes',count(),2)
        for label,inventory in [
            ('null', 'array[null::uuid]'),
            ('mixed_null', "array['d8400000-7777-4777-8777-777777777777'::uuid,null::uuid]"),
            ('duplicate', "array['d8400000-7777-4777-8777-777777777777'::uuid,'d8400000-7777-4777-8777-777777777777'::uuid]"),
            ('empty', "'{}'::uuid[]"),
            ('multidimensional', "array[array['d8400000-7777-4777-8777-777777777777'::uuid]]"),
            ('over_projection_limit', 'array(select gen_random_uuid() from generate_series(1,31))'),
            ('unsupported_uuid', "array['d8400000-7777-9777-8777-777777777777'::uuid]"),
        ]:
            sql('update tf_bound_trial.current_targets set claim_ids='+inventory+';')
            for selected_claim in [None,'d8400000-8888-4888-8888-888888888888']:
                malformed=packet();malformed['draft']['target']['claimId']=selected_claim
                check('invalid_inventory_'+label+('_page' if selected_claim is None else '_absent_claim'),write(malformed),{'kind':'held'})
        check('invalid_current_inventory_never_writes',count(),2)
        sql("update tf_bound_trial.current_targets set claim_ids='{d8400000-7777-4777-8777-777777777777}';")
        sql('update tf_bound_trial.clock_state set known=false;')
        check('unknown_clock_held',write(packet()),{'kind':'held'});sql('update tf_bound_trial.clock_state set known=true;')
        check('backward_clock_denied',sql(f'update tf_bound_trial.clock_state set now_ms={RECEIVED-1};',allowed=True).returncode != 0,True)
        sql('update tf_bound_trial.current_targets set eligible_for_invented_trial=false;')
        check('retired_before_write_held',write(packet()),{'kind':'held'})
        check('retired_retry_held',write(selected),{'kind':'held'})
        sql('update tf_bound_trial.current_targets set eligible_for_invented_trial=true;')
        sql("create function tf_bound_trial.force_invented_failure() returns trigger language plpgsql as $$begin raise exception 'Invented rollback';end$$;"
            'create trigger forced_rollback before insert on tf_bound_trial.payloads for each row execute function tf_bound_trial.force_invented_failure();')
        check('partial_payload_failure_held',write(packet()),{'kind':'held'});check('partial_record_rollback',count(),2)
        sql('drop trigger forced_rollback on tf_bound_trial.payloads;drop function tf_bound_trial.force_invented_failure();')
        from concurrent.futures import ThreadPoolExecutor
        def await_activity(application, wanted):
            for _ in range(30):
                rows=int(sql("select count(*) from pg_stat_activity where application_name="+quote(application)+" and wait_event"+('='+quote(wanted) if wanted=='PgSleep' else '_type='+quote(wanted))+';').stdout.strip())
                if rows: return True
                time.sleep(.02)
            return False
        concurrent=packet()
        with ThreadPoolExecutor(max_workers=2) as workers:
            retire=workers.submit(sql,"set application_name='tf_bound_retire';begin;update tf_bound_trial.current_targets set eligible_for_invented_trial=false;select pg_sleep(2);commit;")
            check('actual_retirement_transaction_holds_row',await_activity('tf_bound_retire','PgSleep'),True)
            writing=workers.submit(sql,"set application_name='tf_bound_waiting_writer';set statement_timeout=5000;set role tf_bound_writer;select tf_bound_trial.write_invented("+quote(json.dumps(concurrent))+"::jsonb);")
            check('actual_writer_waits_on_retirement_lock',await_activity('tf_bound_waiting_writer','Lock'),True)
            check('owner_retirement_committed',retire.result().returncode,0)
            check('writer_sees_committed_retirement',json.loads(writing.result().stdout.strip()),{'kind':'held'})
        check('retirement_race_no_private_write',count(),2)
        sql('update tf_bound_trial.current_targets set eligible_for_invented_trial=true;')
        concurrent=packet()
        with ThreadPoolExecutor(max_workers=2) as workers:
            writing=workers.submit(sql,"set application_name='tf_bound_recording_writer';begin;set local role tf_bound_writer;select tf_bound_trial.write_invented("+quote(json.dumps(concurrent))+"::jsonb);select pg_sleep(2);commit;")
            check('actual_writer_transaction_holds_row',await_activity('tf_bound_recording_writer','PgSleep'),True)
            retire=workers.submit(sql,"set application_name='tf_bound_waiting_retire';set statement_timeout=5000;update tf_bound_trial.current_targets set eligible_for_invented_trial=false;")
            check('actual_retirement_waits_on_writer_lock',await_activity('tf_bound_waiting_retire','Lock'),True)
            check('writer_recorded_under_original_lock',json.loads(writing.result().stdout.strip())['kind'],'recorded_invented')
            check('later_owner_retirement_committed',retire.result().returncode,0)
        check('one_locked_concurrent_write',count(),3)
        check('retired_request_replay_not_current_authority',write(concurrent),{'kind':'held'})
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
                            and identity['labels'] == {'terrafracta.bound-writer-trial': stamp}
                            and type(identity['running']) is bool):
                        if identity['running'] is True:
                            stopped = run(['docker', 'stop', '--timeout', '10', name], allowed=True, timeout=15).returncode == 0
                        else:
                            stopped = True
        except Exception:
            cleanup_failed = True
        receipt = {'schemaVersion': 1, 'evidenceKind': 'invented_atomic_current_target_write',
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
