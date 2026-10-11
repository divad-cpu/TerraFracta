"""Fixed invented coherent shared/custody inventory maintenance trial on a brand-new isolated cluster.

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
SQLS = [ROOT / ('research/pending/' + name) for name in ['TF007_contact_free_bound_writer_trial.sql','TF007_contact_free_custody_trial.sql','TF007_contact_free_write_composition_trial.sql','TF007_contact_free_shared_admission_trial.sql','TF007_contact_free_shared_inventory_trial.sql']]
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
    proof = Path('/tmp') / ('tf-shared-inventory-native-' + stamp)
    proof.mkdir(mode=0o700)
    data = proof / 'cluster'
    data.mkdir(mode=0o700)
    # Only the new invented-data mount is made writable for image UID100.
    data.chmod(0o777)
    name = 'terrafracta_shared_inventory_' + stamp.lower().replace('-', '_')
    label = 'terrafracta.shared-inventory-trial=' + stamp
    counter = 0
    command_lock = Lock()
    commands = []
    assertions = []
    body = b"\n".join(p.read_bytes() for p in SQLS)
    sources = {*SQLS, Path(__file__).resolve(), ROOT / "scripts/contact_free_shared_inventory_native.py", ROOT / "scripts/check_contact_free_shared_inventory.mjs"}
    sources.update(ROOT / ('src/'+n) for n in ['invented-contact-free-shared-inventory.ts','invented-contact-free-write-recovery.ts','invented-contact-free-recovery.ts','contact-free-correction-policy.ts','correction-target.ts','public-issue-projection.ts','public-read-consistency.ts','public-read-materializer.ts','public-read-outcome.ts','database.types.ts'])
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
        check('ownership_label', observed['labels'], {'terrafracta.shared-inventory-trial': stamp})
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
        from contact_free_shared_inventory_native import exercise_shared_inventory
        sql('insert into tf_shared_admission_trial.context values(true,'+quote(EXECUTION)+f',true,{RECEIVED});')
        exercise_shared_inventory(run=run,sql=sql,check=check,proof=proof,received=RECEIVED,day=DAY,target=TARGET,execution=EXECUTION)
        dump = run(['docker', 'exec', name, BIN + 'pg_dump', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '--no-password'])
        (proof/'FINAL_INVENTED_SOURCE_ONLY.sql').write_text(dump.stdout)
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
                            and identity['labels'] == {'terrafracta.shared-inventory-trial': stamp}
                            and type(identity['running']) is bool):
                        if identity['running'] is True:
                            stopped = run(['docker', 'stop', '--timeout', '10', name], allowed=True, timeout=15).returncode == 0
                        else:
                            stopped = True
        except Exception:
            cleanup_failed = True
        receipt = {'schemaVersion': 1, 'evidenceKind': 'invented_shared_custody_inventory',
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
