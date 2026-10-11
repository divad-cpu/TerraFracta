"""Check the tracked public path boundary; never print candidate file contents."""
from pathlib import Path, PurePosixPath
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def allowed(path, policy):
    parts = PurePosixPath(path).parts
    if not parts or path.startswith('/') or '\\' in path or any(p in ('.', '..') for p in path.split('/')):
        return False
    if any(p in ('raw', 'tmp-preservation') for p in parts) or path in policy['excludedPaths']:
        return False
    if path in policy['rootFiles'] or path in policy['githubFiles']:
        return True
    if any(p.startswith('.') for p in parts):
        return False
    suffix = PurePosixPath(path).suffix
    if parts[0] in ('app', 'src', 'scripts', 'workers', 'tests'):
        return suffix in policy['sourceExtensions']
    if parts[:2] == ('research', 'pending'):
        return len(parts) == 3 and suffix == '.sql'
    if parts[0] == 'supabase':
        return suffix in ('.sql', '.toml')
    if parts[0] == 'fixtures':
        return suffix == '.json'
    if parts[0] == 'config':
        return path in ('config/source_registry.candidate.json', 'config/update_policy.candidate.json')
    if parts[:2] == ('docs', 'public'):
        return suffix == '.md'
    return path == 'docs/OSS_PACKAGE_INVENTORY.json'


def inspect_entries(entries, policy):
    failures = []
    for mode, path in entries:
        if mode not in ('100644', '100755') or not allowed(path, policy):
            failures.append(path)
    return failures


def check_inactive(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ('collection_enabled', 'auto_publication_enabled', 'runtime_enabled',
                       'publication_enabled', 'schedule_enabled') and item is not False:
                raise ValueError('Operational source flag admitted')
            if key == 'schedule' and item is not None:
                raise ValueError('Source schedule admitted')
            check_inactive(item)
    elif isinstance(value, list):
        for item in value:
            check_inactive(item)


def check_configurations(registry, update):
    if registry.get('activation_state') != 'disabled':
        raise ValueError('Source registry activated or missing its disabled state')
    for key in ('runtime_enabled', 'publication_enabled', 'schedule_enabled', 'chat_trigger_enabled'):
        if update.get(key) is not False:
            raise ValueError('Update policy enabled or missing its refusal flag')
    if 'active_schedule' not in update or update['active_schedule'] is not None:
        raise ValueError('Active schedule admitted')
    check_inactive(registry)
    check_inactive(update)


def main():
    raw = subprocess.check_output(['git', 'ls-files', '--stage', '-z'], cwd=ROOT)
    entries = []
    objects = {}
    for record in raw.split(b'\0'):
        if not record:
            continue
        metadata, path = record.decode().split('\t', 1)
        mode, object_id, stage = metadata.split()
        if stage != '0':
            raise ValueError('Unresolved index entry')
        entries.append((mode, path))
        objects[path] = object_id
    if not entries:
        raise ValueError('Public tracked scope is empty')
    required = ('PUBLIC_REPOSITORY_POLICY.json', 'config/source_registry.candidate.json',
                'config/update_policy.candidate.json')
    if any(path not in objects for path in required):
        raise ValueError('Required public policy/configuration is not tracked')
    def indexed_json(path):
        return json.loads(subprocess.check_output(['git', 'cat-file', 'blob', objects[path]], cwd=ROOT))
    policy = indexed_json(required[0])
    failures = inspect_entries(entries, policy)
    if failures:
        print(json.dumps({'publicBoundary':'FAIL', 'paths':failures}))
        return 1
    registry = indexed_json(required[1])
    update = indexed_json(required[2])
    check_configurations(registry, update)
    print(json.dumps({'publicBoundary':'PASS', 'trackedFiles':len(entries),
                      'realSourceOrOperationalAcceptance':False}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
