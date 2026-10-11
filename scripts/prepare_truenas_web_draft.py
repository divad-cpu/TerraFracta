"""Preserve an offline container build/import draft of a checked private web packet.

No image pull/build, Docker daemon, NAS operation, credentials or source access.
Reuse the existing exact candidate copy/inventory/notice checks. The selected
base image and NAS release still require separate review and actual acceptance.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import secrets
import sys

from scripts.prepare_local_web_candidate import _body, _copy_tree, _inventory, _unique, verify_candidate
from scripts.prepare_server_notice_bundle import BASE, _exclusive
from scripts.check_private_attempt_readiness import private_directory, private_read

SOURCE = BASE / 'local-web-candidate-20261004121727_26f80a'
MANIFEST = 'TRUENAS_DRAFT_MANIFEST.json'
FALSE_FIELDS = ('runtime_enabled', 'publication_enabled', 'schedule_enabled',
                'imageBuilt', 'baseImagePinned', 'nasInstalled', 'hostVerified',
                'browserVerified', 'liveSourceProvisioned', 'releaseCleared')
DOCKERFILE = b'''# Offline draft: an independently accepted official Node digest is required.
ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE}
WORKDIR /opt/terrafracta
COPY --chown=1000:1000 payload/ ./payload/
COPY --chown=1000:1000 entrypoint.cjs ./entrypoint.cjs
USER 1000:1000
EXPOSE 3210
ENTRYPOINT ["/usr/bin/env", "-i", "/usr/local/bin/node", "/opt/terrafracta/entrypoint.cjs"]
CMD []
'''
IGNORE = b'**\n!Dockerfile\n!entrypoint.cjs\n!payload/\n!payload/**\n'
GUIDE = b'''# Offline TrueNAS Community web draft

This is preparation for the owner's desktop PC with three HDDs and TrueNAS
Community Edition. No image has been downloaded, built, imported or started.
The exact NAS release, capacity, access route and official base-image digest
remain unselected. Dockerfile requires NODE_BASE_IMAGE; no default tag is used.
The final official base must supply Node 24.18.0, Linux/amd64 and UID/GID 1000.
Its origin, OS/native notices and resulting image need independent review.

payload/ is the exact separately verified private standalone packet, including
its notices and original manifest. The container entrypoint is outside it and
accepts no arguments. It refuses another Node/platform/build, clears inherited
server configuration and starts only production mode. All development/private
operations remain refused by that existing build. This is an invented-content
prototype with no real provider, database, raw mount, collector or schedule.

compose.yaml is a JSON-form YAML document accepted by Docker Compose. It refers
only to a future locally imported image, with pull_policy never and no build
directive. The proposed host binding is 127.0.0.1:3210 only. It is not accessible
from another computer without a separately selected access route. No LAN or
external binding, host networking, Docker socket, host data or credential mount
is included. Read-only root and dropped capabilities coexist with bounded
temporary/cache mounts. The 512 MiB/one CPU/128 PID limits are draft budgets, not
measured NAS capacity or proof of runtime compatibility. Restart is disabled.

Check TRUENAS_DRAFT_MANIFEST.json using the project read-only verifier. It seals
internal consistency, not provenance or authority. Keep the exact source pin,
reviewed image build/export/import, actual NAS version/accounts/network and
runtime observation separate. Do not deploy this draft. A later concrete
reviewed installation needs explicit authorization. Physical NAS storage,
raw 30-day cleanup, snapshot/copy exclusions and writer/source qualification are
separate installation work. The owner selected a dedicated terrafracta dataset
and /var/lib/terrafracta/{database,raw,journal,state,logs}, with raw as a separate
child mount and the same application paths on a later own cloud server. This
web packet mounts no data or raw directory and implements no storage service.
The existing PC cleanup is not NAS cleanup. No disk/pool/share/backup setting
has been changed.
'''


def _build_id(value):
    if type(value) is not str or re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value) is None:
        raise ValueError('Invalid draft build identity')
    return value


def entrypoint(build_id):
    expected = json.dumps(_build_id(build_id))
    return ('''// Fixed production preview only; no authority to deploy or collect.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
try {
  if (process.argv.length !== 2 || process.version !== 'v24.18.0' ||
      process.platform !== 'linux' || process.arch !== 'x64') throw new Error();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, {NODE_ENV:'production', HOSTNAME:'0.0.0.0',
    PORT:'3210', NEXT_TELEMETRY_DISABLED:'1'});
  const payload = path.join(__dirname, 'payload');
  if (fs.readFileSync(path.join(payload, '.next', 'BUILD_ID'), 'utf8').trim() !== ''' + expected + ''') throw new Error();
  process.chdir(payload);
  require(path.join(payload, 'server.js'));
} catch {
  console.error('Private preview unavailable');
  process.exitCode = 1;
}
''').encode()


def compose(build_id):
    # Opaque Next build identities may start with a hyphen; Docker tags may not.
    tag = 'build-' + sha256(_build_id(build_id).encode('ascii')).hexdigest()
    return (json.dumps({'name': 'terrafracta-private-preview', 'services': {'web': {
        'image': 'terrafracta-private-preview:' + tag,
        'pull_policy': 'never', 'platform': 'linux/amd64', 'user': '1000:1000',
        'read_only': True, 'init': True, 'restart': 'no', 'cap_drop': ['ALL'],
        'security_opt': ['no-new-privileges:true'], 'cpus': '1.0',
        'mem_limit': '512m', 'pids_limit': 128,
        'ports': [{'target': 3210, 'published': '3210', 'host_ip': '127.0.0.1', 'protocol': 'tcp'}],
        'tmpfs': ['/tmp:rw,noexec,nosuid,nodev,size=16777216,mode=1777',
                  '/opt/terrafracta/payload/.next/cache:rw,noexec,nosuid,nodev,size=33554432,uid=1000,gid=1000,mode=0700'],
        'logging': {'driver': 'local', 'options': {'max-size': '1m', 'max-file': '2'}},
    }}}, indent=2) + '\n').encode()


def _generated(build_id):
    return {'Dockerfile': DOCKERFILE, '.dockerignore': IGNORE,
            'entrypoint.cjs': entrypoint(build_id), 'compose.yaml': compose(build_id),
            'README_DRAFT.md': GUIDE}


def prepare_draft(source, destination):
    source = Path(source).resolve(strict=True)
    if not isinstance(destination, Path) or not destination.is_absolute() or '..' in destination.parts:
        raise ValueError('Invalid draft destination')
    private_directory(destination.parent)
    if destination.exists() or destination.is_symlink() or destination.is_relative_to(source):
        raise ValueError('Draft destination exists or overlaps source')
    readback = verify_candidate(source)
    before = _inventory(source, private=True)
    source_manifest_hash = sha256(_body(source / 'LOCAL_CANDIDATE_MANIFEST.json')).hexdigest()
    destination.mkdir(mode=0o700)
    _copy_tree(source, destination / 'payload', expected=before)
    for name, body in _generated(readback['buildId']).items():
        _exclusive(destination / name, body)
    if _inventory(source, private=True) != before or verify_candidate(source) != readback:
        raise ValueError('Draft source changed during preparation')
    saved = {'schemaVersion': 1, 'evidenceKind': 'offline_truenas_community_web_draft',
             'createdAt': datetime.now(timezone.utc).isoformat(),
             'sourceCandidateManifestSha256': source_manifest_hash,
             'sourceCandidateReadback': readback, 'selectedNasVersion': None,
             'baseImageReference': None, 'inventory': _inventory(destination, private=True),
             **{name: False for name in FALSE_FIELDS}}
    _exclusive(destination / MANIFEST, (json.dumps(saved, indent=2, sort_keys=True) + '\n').encode())
    verify_draft(destination)
    return saved


def verify_draft(directory):
    private_directory(directory)
    saved = json.loads(private_read(directory / MANIFEST, limit=4*1024*1024), object_pairs_hook=_unique)
    keys = {'schemaVersion', 'evidenceKind', 'createdAt', 'sourceCandidateManifestSha256',
            'sourceCandidateReadback', 'selectedNasVersion', 'baseImageReference', 'inventory', *FALSE_FIELDS}
    if type(saved) is not dict or set(saved) != keys or type(saved['schemaVersion']) is not int \
            or saved['schemaVersion'] != 1 or saved['evidenceKind'] != 'offline_truenas_community_web_draft' \
            or any(saved[name] is not False for name in FALSE_FIELDS) \
            or saved['selectedNasVersion'] is not None or saved['baseImageReference'] is not None:
        raise ValueError('Invalid held NAS draft receipt')
    inventory = _inventory(directory, private=True)
    inventory['entries'] = [row for row in inventory['entries'] if row['path'] != MANIFEST]
    inventory['bytes'] -= len(private_read(directory / MANIFEST, limit=4*1024*1024))
    if inventory != saved['inventory']:
        raise ValueError('NAS draft files or links differ')
    payload = directory / 'payload'
    readback = verify_candidate(payload)
    if readback != saved['sourceCandidateReadback'] or \
            sha256(_body(payload / 'LOCAL_CANDIDATE_MANIFEST.json')).hexdigest() != saved['sourceCandidateManifestSha256']:
        raise ValueError('NAS draft candidate binding differs')
    for name, body in _generated(readback['buildId']).items():
        if _body(directory / name) != body:
            raise ValueError('NAS draft control differs')
    return {'evidenceKind': 'offline_truenas_draft_exact_readback',
            'files': sum(row['kind'] == 'file' for row in inventory['entries']),
            'links': sum(row['kind'] == 'link' for row in inventory['entries']),
            'bytes': inventory['bytes'], 'buildId': readback['buildId'],
            'runtime_enabled': False, 'imageBuilt': False, 'nasInstalled': False,
            'filesExecuted': False, 'releaseCleared': False}


def main():
    if sys.argv[1:]:
        raise RuntimeError('Fixed NAS draft preparation accepts no arguments')
    destination = BASE / ('truenas-web-draft-' + datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S') + '_' + secrets.token_hex(3))
    prepare_draft(SOURCE, destination)
    print(json.dumps({'draft': str(destination), **verify_draft(destination)}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
