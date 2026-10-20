"""Fresh owned PostgreSQL17 feed trial; never chooses an existing target.

Only the pinned already installed image, a new labelled volume/initializer and
a new network-none cluster are used. No primary connection, migration replay,
password/login creation, published ports, source fetch or default provider.
Owned containers stop on exit; resources/evidence remain for explicit review.
"""

from __future__ import annotations

import base64
import ast
from datetime import datetime,timezone,timedelta
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from uuid import uuid4

from scripts.feed_postgres_trial_cases import adversarial
from scripts.docker_inspect_command_log import docker_inspect_command_kind, docker_inspect_log_record
from workers.bounded_worker_process import communicate_bounded
from workers.feed_discovery import FeedReceipt
from workers.feed_postgres_contract import (
    COMMIT_MARKER,prepare_invented_pg_capture,committed_pg_json,parse_invented_pg_readback,
    invented_pg_read_statement,
)
from workers.pair_native_sql import _literal

ROOT=Path(__file__).resolve().parents[1]
IMAGE='sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453'
BIN='/nix/var/nix/profiles/default/bin/'
LABEL='terrafracta.feed-journal-trial'


class FeedPgTrialError(ValueError):pass


class FreshFeedPostgres:
    def __init__(self):
        self.suffix=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(4)
        self.target='tf_feed_pg_'+self.suffix.lower()
        self.volume=self.target+'_data';self.initializer=self.target+'_init'
        self.proof=Path('/tmp')/('tf-feed-postgres-trial-'+self.suffix)
        self.proof.mkdir(mode=0o700)
        self.identity=None;self.counter=0;self.assertions=[];self.creation_attempted=False
        self.initializer_attempted=False;self.initializer_identity=None
        config=self.proof/'empty-docker-config';config.mkdir(mode=0o700)
        self.environment={'PATH':'/usr/bin:/bin','LC_ALL':'C.UTF-8','DOCKER_CONFIG':str(config)}
        self.docker=['/usr/bin/docker','--host','unix:///var/run/docker.sock']
        self.frozen={};(self.proof/'inputs').mkdir(mode=0o700)
        self.source_bindings=[]
        names={'scripts/rehearse_postgres_feed_journal.py','workers/feed_postgres_contract.py','tests/fixtures/invented_feed_journal.sql','pyproject.toml','uv.lock'}
        queue=list(names)
        while queue:
            name=queue.pop()
            if not name.endswith('.py'):continue
            for node in ast.walk(ast.parse((ROOT/name).read_bytes())):
                if isinstance(node,ast.ImportFrom) and node.module:
                    child=node.module.replace('.','/')+'.py'
                    if child not in names and (ROOT/child).is_file():names.add(child);queue.append(child)
        for name in sorted(names):
            raw=(ROOT/name).read_bytes();self.frozen[name]=raw
            destination=self.proof/'inputs'/name;destination.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            with destination.open('xb') as output:output.write(raw)
            destination.chmod(0o600)
            self.source_bindings.append({'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()})
        self.record('SOURCE_BINDINGS',self.source_bindings)
        self.record('CREATE_INTENT',{'target':self.target,'initializer':self.initializer,'volume':self.volume,'label':self.suffix,
            'image':IMAGE,'network':'none','sourceRequests':0,'primaryTargetAllowed':False,'loginCredentialsCreated':False})

    def record(self,name,value):
        path=self.proof/(name+'.json')
        with path.open('x') as f:json.dump(value,f,indent=2);f.write('\n')
        path.chmod(0o600)

    def verify_sources(self,label):
        if any((ROOT/name).read_bytes()!=raw or (self.proof/'inputs'/name).read_bytes()!=raw for name,raw in self.frozen.items()):
            raise FeedPgTrialError('Trial source binding changed')
        self.record('SOURCE_CHECK_'+label,{'exactFiles':len(self.frozen),'unchanged':True})

    def command(self,args):
        if not args or args[0]!='docker':raise FeedPgTrialError('Only the pinned local Docker socket is allowed')
        return self.docker+args[1:]

    def run(self,args,*,payload=b'',timeout=15,allowed=False):
        # Capture the logical inspect command before the pinned socket rewrite
        # or process callbacks; never infer logging scope from returned bytes.
        logical_command=tuple(args)
        inspect_command=docker_inspect_command_kind(logical_command) is not None
        args=self.command(args)
        self.counter+=1
        if payload and not inspect_command:
            path=self.proof/f'{self.counter:03d}_input.sql'
            with path.open('xb') as stream:stream.write(payload)
            path.chmod(0o600)
        process=subprocess.Popen(args,env=self.environment,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        result=communicate_bounded(process,payload,timeout=timeout,max_input=294912,max_stdout=131072,max_stderr=4096)
        if inspect_command:
            self.record(f'{self.counter:03d}_COMMAND',json.loads(docker_inspect_log_record(logical_command,result)))
            outputs=(('stdout',b'<omitted>\n'),('stderr',b'<omitted>\n'))
        else:
            self.record(f'{self.counter:03d}_COMMAND',{'argv':args,'returncode':result.returncode,
                'stdoutBytes':len(result.stdout),'stderrBytes':len(result.stderr),'inputBytes':len(payload),'inputSHA256':sha256(payload).hexdigest()})
            # Noninspect SQL/data remains fixed invented private evidence.
            outputs=(('stdout',result.stdout),('stderr',result.stderr))
        for suffix,raw in outputs:
            path=self.proof/f'{self.counter:03d}_{suffix}.txt'
            with path.open('xb') as f:f.write(raw)
            path.chmod(0o600)
        if result.returncode and not allowed:
            raise FeedPgTrialError('Fresh owned PostgreSQL trial command refused; preserve evidence')
        return result

    def inspect(self):
        if self.identity is None:
            # Lost create output: only an exact new-intent name/label/image can
            # be identified. Existing unrelated objects are never adopted.
            target=self.target
        else:target=self.identity
        fields='{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"labels":{{json .Config.Labels}},"network":{{json .HostConfig.NetworkMode}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"ports":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}},"running":{{json .State.Running}},"user":{{json .Config.User}}}'
        result=self.run(['docker','inspect','--format',fields,target])
        value=json.loads(result.stdout)
        if (not re.fullmatch('[a-f0-9]{64}',value['id']) or value['name']!='/'+self.target or value['image']!=IMAGE
                or value['labels']!={LABEL:self.suffix} or value['network']!='none' or not value['readonly']
                or value['ports'] or value['user']!='100:101'
                or len(value['mounts'])!=1 or value['mounts'][0]['Type']!='volume'
                or value['mounts'][0]['Name']!=self.volume or value['mounts'][0]['Destination']!='/trial'):
            raise FeedPgTrialError('Owned trial identity unavailable')
        if self.identity is not None and value['id']!=self.identity:
            raise FeedPgTrialError('Owned trial identity changed')
        self.identity=value['id']
        return value

    def query(self,statement,*,allowed=False):
        self.inspect()
        return self.run(['docker','exec','-i',self.identity,BIN+'psql','-h','/tmp','-U','postgres','-d','postgres',
            '-X','-qAt','-v','ON_ERROR_STOP=1'],payload=statement.encode('utf8'),allowed=allowed)

    def create(self):
        self.verify_sources('BEFORE_CREATE')
        image=self.run(['docker','image','inspect','--format','{{.Id}}',IMAGE])
        if image.stdout.decode().strip()!=IMAGE:raise FeedPgTrialError('Pinned installed image unavailable')
        for kind,name in [('container',self.target),('container',self.initializer),('volume',self.volume)]:
            absent=self.run(['docker',kind,'inspect','--format','{{.Id}}' if kind=='container' else '{{.Name}}',name],allowed=True)
            if absent.returncode==0 or b'no such' not in absent.stderr.lower():
                raise FeedPgTrialError('Fresh resource absence unconfirmed')
        label=LABEL+'='+self.suffix
        self.run(['docker','volume','create','--label',label,self.volume])
        fields='{"name":{{json .Name}},"labels":{{json .Labels}}}'
        volume=json.loads(self.run(['docker','volume','inspect','--format',fields,self.volume]).stdout)
        if volume!={'name':self.volume,'labels':{LABEL:self.suffix}}:raise FeedPgTrialError('Fresh volume identity mismatch')
        self.initializer_attempted=True
        self.run(['docker','run','--pull','never','--name',self.initializer,'--label',label,'--network','none','--read-only',
            '--user','0','--cap-drop','ALL','--cap-add','CHOWN','--security-opt','no-new-privileges',
            '--mount','type=volume,source='+self.volume+',target=/trial','--entrypoint','chown',IMAGE,'100:101','/trial'])
        self.stop_initializer()
        launch=('if test ! -f /trial/data/PG_VERSION; then '+BIN+'initdb -D /trial/data -U postgres '
            '--auth-local=trust --auth-host=reject --locale=C --encoding=UTF8 >/tmp/init.log 2>&1 || exit 1; fi; exec '+BIN+
            "postgres -D /trial/data -k /tmp -h '' -c shared_preload_libraries='' -c logging_collector=off "
            '-c log_statement=none -c log_min_error_statement=panic -c shared_buffers=16MB -c max_connections=8')
        self.creation_attempted=True
        result=self.run(['docker','create','--pull','never','--name',self.target,'--label',label,'--network','none',
            '--read-only','--user','100:101','--memory','256m','--cpus','1','--pids-limit','64','--tmpfs','/tmp:rw,mode=1777',
            '--shm-size','128m','--cap-drop','ALL','--security-opt','no-new-privileges',
            '--mount','type=volume,source='+self.volume+',target=/trial','--entrypoint','sh',IMAGE,'-c',launch])
        identity=result.stdout.decode().strip()
        if not re.fullmatch('[a-f0-9]{64}',identity):raise FeedPgTrialError('Fresh container acknowledgement unavailable')
        self.identity=identity;metadata=self.inspect()
        if metadata['running']:raise FeedPgTrialError('Fresh container unexpectedly running')
        self.record('OWNED_IDENTITY',metadata)
        self.start()
        version=self.query('show server_version;').stdout.decode().strip()
        if not version.startswith('17.'):raise FeedPgTrialError('PostgreSQL17 unavailable')
        self.record('SERVER_VERSION',{'version':version,'sourceRequests':0,'primaryChanged':False})
        self.bootstrap_schema()

    def bootstrap_schema(self):
        """Fixed default feed schema; source-controlled subclasses choose their own lab schema."""
        fixture=self.frozen['tests/fixtures/invented_feed_journal.sql'].decode('utf8')
        self.query("begin;set local statement_timeout='10s';set local lock_timeout='1s';"+fixture+'commit;')

    def start(self):
        if self.inspect()['running']:raise FeedPgTrialError('Owned cluster already running')
        self.run(['docker','start',self.identity])
        for _ in range(30):
            ready=self.run(['docker','exec',self.identity,BIN+'pg_isready','-h','/tmp','-U','postgres'],allowed=True,timeout=3)
            if ready.returncode==0:return
            time.sleep(.1)
        raise FeedPgTrialError('Owned cluster did not become ready')

    def stop(self):
        if self.identity is None:
            if not self.creation_attempted:return
            candidate=self.run(['docker','container','inspect','--format','{{.Id}}',self.target],allowed=True)
            if candidate.returncode and b'no such' in candidate.stderr.lower():return
            # inspect() verifies the complete intent binding before adoption.
        metadata=self.inspect()
        if metadata['running']:
            self.run(['docker','stop','--timeout','8',self.identity],timeout=15)
        if self.inspect()['running']:raise FeedPgTrialError('Owned cluster did not stop')

    def stop_initializer(self):
        if not self.initializer_attempted:return
        fields='{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"labels":{{json .Config.Labels}},"network":{{json .HostConfig.NetworkMode}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"ports":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}},"running":{{json .State.Running}},"user":{{json .Config.User}},"entrypoint":{{json .Config.Entrypoint}},"cmd":{{json .Config.Cmd}}}'
        result=self.run(['docker','container','inspect','--format',fields,self.initializer_identity or self.initializer],allowed=True)
        if result.returncode:
            if b'no such' in result.stderr.lower():return
            raise FeedPgTrialError('Initializer state unavailable')
        value=json.loads(result.stdout)
        if (not re.fullmatch('[a-f0-9]{64}',value['id']) or value['name']!='/'+self.initializer or value['image']!=IMAGE
                or value['labels']!={LABEL:self.suffix} or value['network']!='none' or not value['readonly']
                or value['ports'] or value['user']!='0' or value['entrypoint']!=['chown'] or value['cmd']!=['100:101','/trial']
                or len(value['mounts'])!=1 or value['mounts'][0]['Type']!='volume'
                or value['mounts'][0]['Name']!=self.volume or value['mounts'][0]['Destination']!='/trial'
                or (self.initializer_identity is not None and value['id']!=self.initializer_identity)):
            raise FeedPgTrialError('Initializer identity unavailable')
        self.initializer_identity=value['id']
        if value['running']:
            self.run(['docker','stop','--timeout','8',self.initializer_identity],timeout=15)
            return self.stop_initializer()
        self.record('INITIALIZER_STOPPED_'+str(self.counter),value)

    def check(self,label,condition):
        if condition is not True:raise FeedPgTrialError('Invented native feed assertion failed: '+label)
        self.assertions.append({'label':label,'pass':True})


def rss(items='',next_url=None):
    link='' if next_url is None else '<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="next" href="'+next_url+'"/>'
    return ('<rss version="2.0"><channel><title>Invented</title><link>https://example.org/</link>'
        '<description>Invented only</description>'+link+items+'</channel></rss>').encode()


def entry(key,url='https://example.org/item',title='Invented notice'):
    return f'<item><guid isPermaLink="false">{key}</guid><title>{title}</title><link>{url}</link></item>'


def capture_context(raw,stream,*,operation=None,revision=0,url='https://example.org/feed.xml',next_url=None,format='rss20'):
    source=FeedReceipt('fictional-feed',str(uuid4()),url,sha256(raw).hexdigest(),datetime(2026,10,14,tzinfo=timezone.utc))
    return prepare_invented_pg_capture(raw,source,format=format,stream_id=stream,operation_id=operation or str(uuid4()),
        expected_revision=revision,allowed_next_url=next_url)


def seed(trial):
    stream=str(uuid4())
    trial.query('insert into tf_feed_rehearsal.streams(id,source_key,initial_url,next_url) values('
        +_literal(stream)+",'fictional-feed','https://example.org/feed.xml','https://example.org/feed.xml');")
    return stream


def capture(trial,context):
    result=trial.query(context.statement())
    raw=committed_pg_json(result.stdout,result.stderr,result.returncode)
    return parse_invented_pg_readback(raw,context,observed_at=datetime.now(timezone.utc)),raw


def readback(trial,context):
    result=trial.query(invented_pg_read_statement(context))
    raw=committed_pg_json(result.stdout,result.stderr,result.returncode)
    return parse_invented_pg_readback(raw,context,observed_at=datetime.now(timezone.utc)),raw


def nominal(trial):
    stream=seed(trial);next_url='https://example.org/feed.xml?page=2'
    raw=rss(entry('one')+entry('held','http://127.0.0.1/private')+entry('two'),next_url)
    context=capture_context(raw,stream,next_url=next_url)
    value,record=capture(trial,context)
    trial.check('native_all_occurrences',len(value.items)==3 and [i.processing_state for i in value.items]==['pending','parse_held','pending'])
    trial.check('native_cursor',value.cursor.revision==1 and value.cursor.next_url==next_url)
    replay,replayed=capture(trial,context);trial.check('exact_replay_native_bytes',replayed==record and replay==value)
    second=capture_context(rss(entry('three')),stream,revision=1,url=next_url)
    final,_=capture(trial,second);trial.check('window_boundary_not_history',final.cursor.state=='window_boundary' and final.cursor.next_url is None)
    historical,historical_raw=readback(trial,context);trial.check('historical_readback_after_successor',historical==value and historical_raw==record)
    trial.stop();trial.start()
    restored,restored_raw=readback(trial,context);trial.check('actual_restart_readback',restored==value and restored_raw==record)
    # This is a local ordinary restart, not power-loss/host/NAS acceptance.
    return {'streamId':stream,'firstOperationId':context.operation_id,'secondOperationId':second.operation_id,
        'firstPageId':value.page.page_record_id}


def main():
    if sys.argv[1:]:raise FeedPgTrialError('Fixed invented PostgreSQL trial takes no arguments')
    os.umask(0o077);trial=FreshFeedPostgres();error=None
    try:
        trial.create()
        result=nominal(trial)
        result['adversarial']=adversarial(trial,seed=seed,rss=rss,entry=entry,context=capture_context,capture=capture,readback=readback)
        trial.record('RESULT',{'state':'PASS_BOUNDED_INVENTED_POSTGRES','assertions':trial.assertions,'identities':result,
            'sourceRequests':0,'modelCalls':0,'primaryChanged':False,'sourcePermissionIssued':False,'publicationEnabled':False,
            'ownerOnlyFixture':True,'applicationLeastPrivilegeAccepted':False,'powerLossAccepted':False})
    except BaseException as failure:
        error=type(failure).__name__
        trial.record('FAILURE',{'state':'held','exceptionClass':error,'preservedForInspection':True})
        raise
    finally:
        try:trial.stop()
        finally:
            try:trial.stop_initializer()
            finally:trial.verify_sources('FINAL')
        if trial.identity is not None:trial.record('FINAL_OWNED_STATE',trial.inspect())
    print(json.dumps({'proof':str(trial.proof),'assertions':len(trial.assertions),'state':'PASS_BOUNDED_INVENTED_POSTGRES','primaryChanged':False}))


if __name__=='__main__':main()
