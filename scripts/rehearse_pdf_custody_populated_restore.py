"""Fixed supplied PDF archive over two owned predecessor rows, manual lab only.

The catalogue oracle is the fresh schema installed from the same frozen declared
PDF DDL, not an observed historical producer catalogue. No default operands,
existing target, source, provider, login, network or operational storage choice.
The outer launcher separately freezes the full import closure before importing.
"""
from __future__ import annotations

import ast
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sys

from scripts import rehearse_pdf_result_custody as custody
from scripts import rehearse_pdf_result_custody_restore as matching
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import HEAD, COMMIT_MARKER, MAX_CAPTURE_STATEMENT, MAX_CAPTURE_OUTPUT
from workers.passage_extraction_request import _canonical
from workers.pdf_result_custody import (
    prepare_pdf_result_custody, pdf_result_custody_read_statement, reopen_pdf_result_custody,
)

ROOT = custody.ROOT
ENTRY = 'scripts/rehearse_pdf_custody_populated_restore.py'
TEST = 'tests/test_pdf_custody_populated_restore_scope.py'
CODE = 'pdf_populated_restore_unavailable'
OPERANDS = None
MAX_RENDER_BYTES = 131072
WITNESS_KIND = 'invented_pdf_populated_source_rows_witness'
SEED_OPERATIONS = ('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002')
# Exact selectors from the separately reviewed original producer operand set.
# These identify the supplied bytes, never authenticate their factual source.
FIXED_BINDINGS = (
    ('archive', 26616, '0f8ff669a10c472072c1ae89d479cd703b8c725357b4015eb9baf0dcb31d6cf9'),
    ('independent_input_raw', 32925, 'fd7772159f0cf55d613d01a1497c8ae81416dcbb7d8915ccc29baacc040847bb'),
    ('intent_raw', 702, 'f23a75eac4de55c080ee6aac8f7145c6dbc9ffccd83cc5186d51dcdaf2a50620'),
    ('source_receipt', 26198, 'b4ffc923243b4219f27342c7d1be2cb3331865fc0654728680c0a37fd6e8c6c4'),
    ('source_profile_raw', 651, '839381af42ec2b8c1ce3fa38ca734169a4ef229911e1c1ee657a2c18c230c07f'),
    ('source_rows_raw', 323, '23e6bdaa28cbdeca27f2d3643e049ad1123fc5fe5708bdaf3b96d843c5abb4e3'),
)
CATALOGUE_KEYS = frozenset(('schema', 'objects', 'tables', 'indexes', 'constraints', 'triggers',
    'policies', 'functions', 'types', 'effective_acl', 'default_acl', 'unexpected', 'extensions', 'raw_acl'))

# All object identities are names/signatures, never newly allocated OIDs. Raw
# ACL spellings are a separate retained field; effective named privileges use
# PostgreSQL's own acldefault/aclexplode for schema/table/function/type objects.
CATALOGUE_SQL = """begin isolation level repeatable read read only;
set local search_path=pg_catalog;
with ns as(select * from pg_namespace where nspname='tf_pdf_result_rehearsal'),
rels as(select c.* from pg_class c join ns n on n.oid=c.relnamespace),
tabs as(select * from rels where relkind='r'),
fns as(select p.* from pg_proc p join ns n on n.oid=p.pronamespace),
privileges as(
 select jsonb_build_object('kind','schema','name',n.nspname,'identity','',
  'grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilege',a.privilege_type,'grantable',a.is_grantable) value
 from ns n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
 union all select jsonb_build_object('kind','table','name',c.relname,'identity','',
  'grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilege',a.privilege_type,'grantable',a.is_grantable)
 from tabs c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 union all select jsonb_build_object('kind','function','name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),
  'grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilege',a.privilege_type,'grantable',a.is_grantable)
 from fns p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 union all select jsonb_build_object('kind','type','name',t.typname,'identity','',
  'grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilege',a.privilege_type,'grantable',a.is_grantable)
 from pg_type t join ns n on n.oid=t.typnamespace cross join lateral aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) a
 union all select jsonb_build_object('kind','additional_column','name',c.relname||'.'||v.attname,'identity','',
  'grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilege',a.privilege_type,'grantable',a.is_grantable)
 from tabs c join pg_attribute v on v.attrelid=c.oid and v.attnum>0 and not v.attisdropped
 cross join lateral aclexplode(v.attacl) a),
raw_acls as(
 select jsonb_build_object('kind','schema','name',n.nspname,'identity','','acl',n.nspacl::text) value from ns n
 union all select jsonb_build_object('kind','table','name',c.relname,'identity','','acl',c.relacl::text) from tabs c
 union all select jsonb_build_object('kind','function','name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'acl',p.proacl::text) from fns p
 union all select jsonb_build_object('kind','column','name',c.relname||'.'||a.attname,'identity','','acl',a.attacl::text)
 from tabs c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
 union all select jsonb_build_object('kind','type','name',t.typname,'identity','','acl',t.typacl::text)
 from pg_type t join ns n on n.oid=t.typnamespace
 union all select jsonb_build_object('kind','default','name',pg_get_userbyid(d.defaclrole)||':'||coalesce(n.nspname,'')||':'||d.defaclobjtype::text,'identity','','acl',d.defaclacl::text)
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace)
select jsonb_build_object(
 'schema',(select jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner)) from ns),
 'objects',coalesce((select jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
  'persistence',c.relpersistence,'access_method',(select amname from pg_am where oid=c.relam)) order by c.relname) from rels c),'[]'::jsonb),
 'tables',coalesce((select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),
  'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,'replica_identity',c.relreplident,'partition',c.relispartition,'options',c.reloptions,
  'columns',(select coalesce(jsonb_agg(jsonb_build_object('number',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'notnull',a.attnotnull,'has_default',a.atthasdef,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,
    'generated',a.attgenerated,'storage',a.attstorage,'compression',a.attcompression,
    'collation',(select n.nspname||'.'||x.collname from pg_collation x join pg_namespace n on n.oid=x.collnamespace where x.oid=a.attcollation))
    order by a.attnum),'[]'::jsonb) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) order by c.relname) from tabs c),'[]'::jsonb),
 'indexes',coalesce((select jsonb_agg(jsonb_build_object('name',r.relname,'table',t.relname,'owner',pg_get_userbyid(r.relowner),
  'definition',pg_get_indexdef(i.indexrelid),'unique',i.indisunique,'primary',i.indisprimary,'valid',i.indisvalid,'ready',i.indisready,
  'immediate',i.indimmediate,'nulls_not_distinct',i.indnullsnotdistinct,'key_count',i.indnkeyatts,'attribute_count',i.indnatts,
  'clustered',i.indisclustered,'replica_identity',i.indisreplident) order by r.relname)
  from pg_index i join rels r on r.oid=i.indexrelid join tabs t on t.oid=i.indrelid),'[]'::jsonb),
 'constraints',coalesce((select jsonb_agg(jsonb_build_object('table',t.relname,'name',c.conname,'kind',c.contype,
  'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred,'no_inherit',c.connoinherit,
  'definition',pg_get_constraintdef(c.oid)) order by t.relname,c.conname) from pg_constraint c join tabs t on t.oid=c.conrelid),'[]'::jsonb),
 'triggers',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,
  'internal',t.tgisinternal,'definition',pg_get_triggerdef(t.oid)) order by c.relname,t.tgname)
  from pg_trigger t join tabs c on c.oid=t.tgrelid),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,'name',p.polname,'permissive',p.polpermissive,'command',p.polcmd,
  'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(p.polroles) r),
  'qual',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by c.relname,p.polname)
  from pg_policy p join tabs c on c.oid=p.polrelid),'[]'::jsonb),
 'functions',coalesce((select jsonb_agg(jsonb_build_object('name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),
  'result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'language',(select lanname from pg_language where oid=p.prolang),
  'kind',p.prokind,'definer',p.prosecdef,'leakproof',p.proleakproof,'strict',p.proisstrict,'returns_set',p.proretset,
  'volatility',p.provolatile,'parallel',p.proparallel,'config',p.proconfig,'cost',p.procost,'rows',p.prorows,
  'definition',pg_get_functiondef(p.oid)) order by p.proname,pg_get_function_identity_arguments(p.oid)) from fns p),'[]'::jsonb),
 'types',coalesce((select jsonb_agg(jsonb_build_object('name',t.typname,'owner',pg_get_userbyid(t.typowner),'kind',t.typtype,
  'category',t.typcategory,'element',(select format_type(oid,null) from pg_type where oid=t.typelem),
  'relation',(select relname from rels where oid=t.typrelid)) order by t.typname)
  from pg_type t join ns n on n.oid=t.typnamespace),'[]'::jsonb),
 'effective_acl',coalesce((select jsonb_agg(value order by value::text) from privileges),'[]'::jsonb),
 'default_acl',coalesce((select jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'kind',d.defaclobjtype,
  'entries',(select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
   'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)
   order by pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable),'[]'::jsonb)
   from aclexplode(d.defaclacl) a)) order by pg_get_userbyid(d.defaclrole),n.nspname,d.defaclobjtype)
  from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace),'[]'::jsonb),
 'unexpected',jsonb_build_object(
  'schemas',(select count(*) from pg_namespace where nspname!~'^pg_' and nspname not in('public','information_schema','tf_pdf_result_rehearsal')),
  'relations_outside',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname!~'^pg_' and n.nspname not in('information_schema','tf_pdf_result_rehearsal')),
  'relation_kinds_inside',(select count(*) from rels where relkind not in('r','i')),
  'functions_outside',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname!~'^pg_' and n.nspname not in('information_schema','tf_pdf_result_rehearsal')),
  'types_outside',(select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname!~'^pg_' and n.nspname not in('information_schema','tf_pdf_result_rehearsal')),
  'event_triggers',(select count(*) from pg_event_trigger),
  'custom_roles',(select count(*) from pg_roles where rolname!~'^pg_' and rolname<>'postgres'),
  'nondefault_extensions',(select count(*) from pg_extension where extname<>'plpgsql')),
 'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) order by e.extname)
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'raw_acl',coalesce((select jsonb_agg(value order by value::text) from raw_acls),'[]'::jsonb));
commit;
"""


def _fixed_inputs(inputs):
    captured = matching._capture(inputs)
    for name, size, digest in FIXED_BINDINGS:
        raw = getattr(captured, name)
        if len(raw) != size or sha256(raw).hexdigest() != digest:
            raise ValueError
    return captured


def _module_paths(module):
    """Project modules plus executed package initializers; no environment paths."""
    if type(module) is not str or not module or any(not part.isidentifier() for part in module.split('.')):
        return ()
    parts = module.split('.'); names = []
    for size in range(1, len(parts) + 1):
        package = '/'.join(parts[:size]) + '/__init__.py'
        if (ROOT / package).is_file(): names.append(package)
    filename = module.replace('.', '/') + '.py'
    if (ROOT / filename).is_file(): names.append(filename)
    return tuple(names)


def source_files():
    """Fixed full project closure for the outer pre-import freezer as well.

    Parent NEW_FILES includes string-selected SQL/fixtures/tests. The PDF child
    is launched by filename, not import; it and Python lock metadata are seeds.
    from-package aliases are resolved as submodules as well as their package.
    """
    names = {ENTRY, TEST, *custody.NEW_FILES, 'tests/fixtures/invented_feed_journal.sql', 'workers/_pdf_text_worker.py', 'pyproject.toml', 'uv.lock'}
    pending = list(names)
    while pending:
        filename = pending.pop(); raw = (ROOT / filename).read_bytes()
        if not filename.endswith('.py'): continue
        parent = filename.rsplit('/', 1)[0].replace('/', '.') if '/' in filename else ''
        for node in ast.walk(ast.parse(raw)):
            modules = []
            if isinstance(node, ast.Import): modules = [item.name for item in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    parts = parent.split('.') if parent else []
                    keep = len(parts) - node.level + 1
                    if keep < 0: raise ValueError
                    base = '.'.join(parts[:keep] + ([node.module] if node.module else []))
                else: base = node.module or ''
                modules = [base] + [(base + '.' if base else '') + item.name for item in node.names if item.name != '*']
            for module in modules:
                for child in _module_paths(module):
                    if child not in names: names.add(child); pending.append(child)
    return tuple(sorted(names))


def freeze_populated_sources(trial):
    if trial.counter or trial.identity is not None or trial.creation_attempted or trial.initializer_attempted:
        raise custody.FeedPgTrialError(CODE)
    rows = []
    for name in source_files():
        raw = (ROOT / name).read_bytes()
        if name in trial.frozen:
            if trial.frozen[name] != raw: raise custody.FeedPgTrialError(CODE)
            continue
        path = trial.proof / 'inputs' / name
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        matching._private_write(path, raw)
        trial.frozen[name] = raw
        rows.append(dict(path=name, bytes=len(raw), sha256=sha256(raw).hexdigest()))
    trial.source_bindings.extend(rows); trial.record('PDF_POPULATED_SOURCE_BINDINGS', rows)


class FreshPdfPopulatedRestore(custody.FreshPdfResultPostgres):
    """Existing fresh lifecycle/bootstrap: only the unchanged declared PDF DDL."""
    def __init__(self):
        super().__init__()
        freeze_populated_sources(self)


def _query_json(trial, statement):
    if type(statement) is not str or not 1 <= len(statement.encode()) <= MAX_CAPTURE_STATEMENT:
        raise custody.FeedPgTrialError(CODE)
    result = trial.query(statement)
    if (type(result.returncode) is not int or result.returncode != 0
            or type(result.stderr) is not bytes or result.stderr
            or type(result.stdout) is not bytes or not 1 <= len(result.stdout) <= MAX_CAPTURE_OUTPUT):
        raise custody.FeedPgTrialError(CODE)
    return strict_json(result.stdout)


def _admit_catalogue(value):
    if type(value) is not dict or set(value) != CATALOGUE_KEYS:
        raise ValueError
    if _canonical(value['schema']) != _canonical(dict(name='tf_pdf_result_rehearsal', owner='postgres')):
        raise ValueError
    for name in CATALOGUE_KEYS - {'schema', 'unexpected'}:
        if type(value[name]) is not list: raise ValueError
    if ([(r['name'], r['kind'], r['owner']) for r in value['objects']] !=
            [('results','r','postgres'), ('results_artifact_id_key','i','postgres'), ('results_pkey','i','postgres')]
            or len(value['tables']) != 1 or value['tables'][0]['name'] != 'results'
            or value['tables'][0]['owner'] != 'postgres' or value['tables'][0]['rls'] is not True
            or value['tables'][0]['forced'] is not False
            or [c['name'] for c in value['tables'][0]['columns']] != ['operation_id','artifact_id','intent','packet','stored_at']
            or [r['name'] for r in value['indexes']] != ['results_artifact_id_key','results_pkey']
            or len(value['constraints']) != 5
            or [r['name'] for r in value['triggers']] != ['pdf_result_append_only','pdf_result_no_truncate']
            or any(r['enabled'] != 'O' or r['internal'] is not False for r in value['triggers'])
            or value['policies'] != [] or value['default_acl'] != []
            or [r['name'] for r in value['types']] != ['_results','results']
            or [r['name'] for r in value['functions']] != ['refuse_mutation','result_receipt','store_result']
            or any(r['owner'] != 'postgres' or r['definer'] is not False or r['config'] != ['search_path=pg_catalog'] for r in value['functions'])):
        raise ValueError
    unexpected = {'schemas':0, 'relations_outside':0, 'relation_kinds_inside':0,
        'functions_outside':0, 'types_outside':0, 'event_triggers':0, 'custom_roles':0, 'nondefault_extensions':0}
    if (_canonical(value['unexpected']) != _canonical(unexpected)
            or len(value['extensions']) != 1 or value['extensions'][0]['name'] != 'plpgsql'
            or value['extensions'][0]['schema'] != 'pg_catalog'):
        raise ValueError
    if not value['effective_acl']: raise ValueError
    acl_keys = {'kind','name','identity','grantor','grantee','privilege','grantable'}
    for row in value['effective_acl']:
        if (type(row) is not dict or set(row) != acl_keys or type(row['grantable']) is not bool
                or any(type(row[k]) is not str for k in acl_keys - {'grantable'})
                or row['grantor'] != 'postgres'
                or row['grantee'] != 'postgres' and not (
                    row['kind'] == 'type' and row['name'] in ('_results','results') and row['identity'] == ''
                    and row['grantee'] == 'PUBLIC' and row['privilege'] == 'USAGE' and row['grantable'] is False)):
            raise ValueError
    raw_keys = {'kind','name','identity','acl'}
    for row in value['raw_acl']:
        if (type(row) is not dict or set(row) != raw_keys
                or any(type(row[k]) is not str for k in ('kind','name','identity'))
                or row['acl'] is not None and type(row['acl']) is not str):
            raise ValueError
    return value


def catalogue(trial, label):
    value = _admit_catalogue(_query_json(trial, CATALOGUE_SQL))
    trial.record('PDF_POPULATED_CATALOGUE_' + label, value)
    return value


def compare_catalogue(expected, actual):
    _admit_catalogue(expected); _admit_catalogue(actual)
    # Do not rewrite, normalize or silently delete any nested catalogue field.
    # Only separately retained raw ACL spellings are excluded; their complete
    # effective named entries remain compared in the same immutable snapshots.
    left = {k:v for k,v in expected.items() if k != 'raw_acl'}
    right = {k:v for k,v in actual.items() if k != 'raw_acl'}
    if _canonical(left) != _canonical(right): raise custody.FeedPgTrialError(CODE)
    return dict(declared_catalogue_equal=True, effective_named_acl_equal=True,
        raw_acl_spelling_equal=_canonical(expected['raw_acl']) == _canonical(actual['raw_acl']),
        historical_producer_catalogue_observed=False, arbitrary_equivalence=False)


def _render(trial, inputs):
    trial.inspect()
    result = trial.run(['docker','exec','-i',trial.identity,custody.BIN+'pg_restore',
        '--clean','--if-exists','--file=-'], payload=inputs.archive)
    if (type(result.returncode) is not int or result.returncode != 0
            or type(result.stderr) is not bytes or result.stderr
            or type(result.stdout) is not bytes or not 1 <= len(result.stdout) <= MAX_RENDER_BYTES):
        raise custody.FeedPgTrialError(CODE)
    text = result.stdout.decode('utf8','strict')
    if '\x00' in text:
        raise custody.FeedPgTrialError(CODE)
    matching._private_write(trial.proof/'PDF_POPULATED_RENDERED.sql', result.stdout)
    trial.record('PDF_POPULATED_RENDERED',dict(bytes=len(result.stdout),sha256=sha256(result.stdout).hexdigest(),
        archive_sha256=inputs.archive_sha256,transaction_framing='fixed_parent_psql_transaction'))
    return result.stdout


def _witness_select():
    # Same native row primitives/order as the reviewed producer fingerprint.
    return ("select jsonb_build_object('kind','"+WITNESS_KIND+"','rows',"
        "(select coalesce(jsonb_agg(jsonb_build_object('operation_id',operation_id,'artifact_id',artifact_id,"
        "'stored_at',stored_at,'intent_sha256',encode(sha256(intent),'hex'),'packet_sha256',encode(sha256(packet),'hex')) "
        "order by operation_id),'[]'::jsonb) from tf_pdf_result_rehearsal.results));")


def restore_statement(rendered, *, late_fault):
    if type(rendered) is not bytes or not 1 <= len(rendered) <= MAX_RENDER_BYTES or type(late_fault) is not bool:
        raise custody.FeedPgTrialError(CODE)
    text = rendered.decode('utf8','strict')
    statement = ('\\set VERBOSITY verbose\n'+HEAD+"set time zone 'UTC';begin;\n"+text+'\n'+_witness_select()+
        ('\nselect 1/0;' if late_fault else '')+'\ncommit;\n\\echo '+COMMIT_MARKER.decode()+'\n')
    if len(statement.encode('utf8')) > MAX_CAPTURE_STATEMENT: raise custody.FeedPgTrialError(CODE)
    return statement


def witness(result, inputs, *, late_fault):
    if (type(result.returncode) is not int or type(result.stdout) is not bytes or type(result.stderr) is not bytes
            or not 1 <= len(result.stdout) <= MAX_CAPTURE_OUTPUT or len(result.stderr) > 4096):
        raise custody.FeedPgTrialError(CODE)
    lines = [line for line in result.stdout.splitlines() if line]
    if late_fault:
        if (result.returncode == 0 or COMMIT_MARKER in result.stdout
                or not custody.matches_native_refusal(result.stderr,'22012','division by zero')):
            raise custody.FeedPgTrialError(CODE)
    else:
        if result.returncode != 0 or result.stderr or len(lines) != 2 or lines[-1] != COMMIT_MARKER:
            raise custody.FeedPgTrialError(CODE)
        lines = lines[:-1]
    if len(lines) != 1: raise custody.FeedPgTrialError(CODE)
    value = strict_json(lines[0])
    if (type(value) is not dict or set(value) != {'kind','rows'} or value['kind'] != WITNESS_KIND
            or _canonical(value['rows']) != _canonical(strict_json(inputs.source_rows_raw))):
        raise custody.FeedPgTrialError(CODE)
    return dict(state='late_fault_after_full_source_row_witness' if late_fault else 'committed_full_source_row_witness',
        source_rows=value['rows'],source_rows_sha256=sha256(_canonical(value['rows'])).hexdigest(),
        exact_sqlstate='22012' if late_fault else None,commit_observed=not late_fault)


def _seed(trial, inputs):
    packet, expected, _ = custody._decode(inputs.independent_input_raw)
    if custody.fingerprint(trial) != []: raise custody.FeedPgTrialError(CODE)
    receipts = {}
    for index, operation in enumerate(SEED_OPERATIONS):
        raw, independent = custody.variant(packet, expected, operation=operation,
            assertion='Entirely invented predecessor '+str(index+1)+' for populated recovery.')
        prepared = prepare_pdf_result_custody(raw, independent, observed_at=datetime.now(timezone.utc))
        receipt = custody.committed(trial, prepared.statement)
        receipts[operation] = receipt
        matching._private_write(trial.proof/('PDF_PREDECESSOR_'+str(index+1)+'_RECEIPT.json'),receipt)
    rows = custody.fingerprint(trial)
    if [r['operation_id'] for r in rows] != list(SEED_OPERATIONS): raise custody.FeedPgTrialError(CODE)
    trial.record('PDF_POPULATED_PREDECESSOR_ROWS',rows)
    return rows,receipts


def exercise(trial, inputs):
    predecessors, receipts = _seed(trial, inputs)
    before = catalogue(trial,'BEFORE')
    rendered = _render(trial,inputs)
    matching._verify(trial,inputs,'PDF_POPULATED_BEFORE_LATE_FAULT')
    failed = trial.query(restore_statement(rendered,late_fault=True),allowed=True)
    inner = witness(failed,inputs,late_fault=True)
    trial.record('PDF_POPULATED_LATE_FAULT_WITNESS',inner)
    if _canonical(custody.fingerprint(trial)) != _canonical(predecessors): raise custody.FeedPgTrialError(CODE)
    for operation,raw in receipts.items():
        if custody.committed(trial,pdf_result_custody_read_statement(operation)) != raw:
            raise custody.FeedPgTrialError(CODE)
    rollback = catalogue(trial,'AFTER_ROLLBACK')
    rollback_match = compare_catalogue(before,rollback)
    # Rollback preserves even the raw ACL representation of its original objects.
    if rollback_match['raw_acl_spelling_equal'] is not True: raise custody.FeedPgTrialError(CODE)
    trial.record('PDF_POPULATED_ROLLBACK',dict(predecessor_full_receipts_equal=True,**rollback_match))
    matching._verify(trial,inputs,'PDF_POPULATED_BEFORE_SUCCESS')
    success = trial.query(restore_statement(rendered,late_fault=False))
    trial.record('PDF_POPULATED_SUCCESS_WITNESS',witness(success,inputs,late_fault=False))
    if _canonical(custody.fingerprint(trial)) != _canonical(strict_json(inputs.source_rows_raw)):
        raise custody.FeedPgTrialError(CODE)
    actual = catalogue(trial,'AFTER_SUCCESS')
    qualified = compare_catalogue(before,actual)
    trial.record('PDF_POPULATED_DECLARED_CATALOGUE_MATCH',qualified)
    packet,expected,_ = custody._decode(inputs.independent_input_raw)
    raw = custody.committed(trial,pdf_result_custody_read_statement(expected.operation_id))
    if raw != inputs.source_receipt: raise custody.FeedPgTrialError(CODE)
    matching._private_write(trial.proof/'PDF_POPULATED_RESTORED_FULL_RECEIPT.json',raw)
    opened = reopen_pdf_result_custody(raw,expected,intent_raw=inputs.intent_raw,observed_at=datetime.now(timezone.utc))
    if opened.raw != packet: raise custody.FeedPgTrialError(CODE)
    return dict(archive_sha256=inputs.archive_sha256,rendered_sha256=sha256(rendered).hexdigest(),
        operation_id=opened.operation_id,artifact_id=opened.artifact_id,stored_at=opened.stored_at.isoformat(),
        receipt_sha256=sha256(raw).hexdigest(),predecessor_rows=2,late_fault_sqlstate='22012',
        declared_catalogue_equal=True,effective_named_acl_equal=True,
        raw_acl_spelling_equal=qualified['raw_acl_spelling_equal'],historical_producer_catalogue_observed=False)


def run_populated_restore(inputs: matching.PdfCustodyRestoreInputs):
    trial = None; failed = False; result = None; cleanup = []
    try:
        captured = matching._preflight(_fixed_inputs(inputs))
        trial = FreshPdfPopulatedRestore()
        matching._record_operands(trial,captured)
        matching._verify(trial,captured,'PDF_POPULATED_BEFORE_CREATE')
        trial.create()
        result = exercise(trial,captured)
        matching._verify(trial,captured,'PDF_POPULATED_AFTER_CHECKS')
    except Exception:
        failed = True
    finally:
        if trial is not None:
            for label,action in (('cluster_stopped',trial.stop),('initializer_stopped',trial.stop_initializer)):
                try:action();cleanup.append(dict(check=label,status='PASS'))
                except Exception:failed=True;cleanup.append(dict(check=label,status='FAIL'))
            try:
                trial.record('PDF_POPULATED_CLEANUP',cleanup)
                matching._verify(trial,captured,'PDF_POPULATED_AFTER_CLEANUP')
            except Exception:failed=True
    if failed or result is None:
        if trial is not None:
            try:trial.record('PDF_POPULATED_FAILURE',dict(status='FAIL',code=CODE))
            except Exception:pass
        raise custody.FeedPgTrialError(CODE) from None
    value = dict(status='PASS',scope='invented_pdf_populated_rollback_and_declared_schema_recovery_only',
        evidence=str(trial.proof),owned_resources_stopped=True,primary_changed=False,
        source_authenticated=False,operationally_qualified=False,offhost_recovery_qualified=False,**result)
    try:trial.record('PDF_POPULATED_RESULT',value)
    except Exception:raise custody.FeedPgTrialError(CODE) from None
    return value


def main(args=None):
    args = sys.argv[1:] if args is None else args
    if args == ['--help']:
        print('Fixed supplied PDF populated rollback/recovery in one new owned lab; no target/path selector.')
        return 0
    if args or OPERANDS is None:
        print('pdf_populated_restore_operands_required',file=sys.stderr);return 2
    try:result = run_populated_restore(OPERANDS)
    except custody.FeedPgTrialError:
        print(CODE,file=sys.stderr);return 1
    print(json.dumps(result));return 0


if __name__ == '__main__':raise SystemExit(main())
