"""Resource-free controls for one declared PDF populated rollback/recovery epoch.

Native SQL/pg_restore/PDF children are never run. Manually invented catalogue
and fake process outputs qualify control wiring only, not PostgreSQL syntax,
actual rollback or historical producer catalogue equivalence.
"""
import base64
from contextlib import contextmanager,redirect_stdout,redirect_stderr
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
from io import StringIO
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import scripts.rehearse_pdf_custody_populated_restore as m
import workers.pdf_result_custody as port
from workers.passage_extraction_request import _canonical
from workers.pdf_passage_binding import _stamp


def inputs():
    independent=(m.ROOT/'fixtures/fictional-pdf-result-review-input.json').read_bytes()
    packet,expected,at=m.custody._decode(independent)
    intent=port._intent(packet,expected)
    stored=expected.prepared_at+timedelta(seconds=1)
    receipt=_canonical(dict(schema_version=1,kind=port.RECEIPT_KIND,
        operation_id=expected.operation_id,artifact_id='40000000-0000-4000-8000-000000000001',stored_at=_stamp(stored),
        intent_base64=base64.b64encode(intent).decode(),packet_base64=base64.b64encode(packet).decode(),
        intent_sha256=sha256(intent).hexdigest(),packet_sha256=sha256(packet).hexdigest(),intent_bytes=len(intent),packet_bytes=len(packet)))
    profile=dict(schemas=['tf_pdf_result_rehearsal'],schema_owner='postgres',table_owner='postgres',rls=True,policies=0,public_grants=0,
        functions=[dict(name=n,owner='postgres',definer=False,config=['search_path=pg_catalog'])
                   for n in ('refuse_mutation','result_receipt','store_result')])
    rows=[dict(operation_id=expected.operation_id,artifact_id='40000000-0000-4000-8000-000000000001',stored_at=stored.isoformat(),
        intent_sha256=sha256(intent).hexdigest(),packet_sha256=sha256(packet).hexdigest())]
    archive=b'PGDMPINVENTED_FAKE_ARCHIVE_NOT_PG_RESTORE_PROOF'
    return m.matching.PdfCustodyRestoreInputs(archive,sha256(archive).hexdigest(),independent,intent,receipt,_canonical(profile),_canonical(rows))


def catalogue():
    # Structural test fixture; these spellings are NOT PostgreSQL observations.
    names=('operation_id','artifact_id','intent','packet','stored_at')
    value=dict(schema=dict(name='tf_pdf_result_rehearsal',owner='postgres'),
        objects=[dict(name=n,kind=k,owner='postgres',persistence='p',access_method='heap'if k=='r'else'btree')
                 for n,k in (('results','r'),('results_artifact_id_key','i'),('results_pkey','i'))],
        tables=[dict(name='results',owner='postgres',rls=True,forced=False,replica_identity='d',partition=False,options=None,
            columns=[dict(number=i+1,name=n,type=t,notnull=True,has_default=n=='artifact_id',
                default='gen_random_uuid()'if n=='artifact_id'else None,identity='',generated='',storage='p',compression='',collation=None)
                for i,(n,t) in enumerate(zip(names,('uuid','uuid','bytea','bytea','timestamp with time zone')))])],
        indexes=[dict(name=n,table='results',owner='postgres',definition='INVENTED_INDEX_'+n,unique=True,primary=n=='results_pkey',valid=True,ready=True,
            immediate=True,nulls_not_distinct=False,key_count=1,attribute_count=1,clustered=False,replica_identity=False)
            for n in ('results_artifact_id_key','results_pkey')],
        constraints=[dict(table='results',name=n,kind='c',validated=True,deferrable=False,deferred=False,no_inherit=False,definition='INVENTED_CHECK_'+n)
            for n in ('artifact','intent','packet','pkey','time')],
        triggers=[dict(table='results',name=n,enabled='O',internal=False,definition='INVENTED_TRIGGER_'+n)
            for n in ('pdf_result_append_only','pdf_result_no_truncate')],policies=[],
        functions=[dict(name=n,identity='',result='jsonb',owner='postgres',language='plpgsql',kind='f',definer=False,leakproof=False,strict=False,
            returns_set=False,volatility='v',parallel='u',config=['search_path=pg_catalog'],cost=100,rows=0,definition='INVENTED_FUNCTION_'+n)
            for n in ('refuse_mutation','result_receipt','store_result')],
        types=[dict(name=n,owner='postgres',kind='b'if n.startswith('_')else'c',category='A'if n.startswith('_')else'C',element=None,relation='results')
            for n in ('_results','results')],
        effective_acl=[dict(kind=k,name=n,identity='',grantor='postgres',grantee='postgres',privilege=p,grantable=False)
            for k,n,p in (('schema','tf_pdf_result_rehearsal','USAGE'),('table','results','SELECT'),('function','refuse_mutation','EXECUTE'),
                ('function','result_receipt','EXECUTE'),('function','store_result','EXECUTE'))],default_acl=[],
        unexpected=dict(schemas=0,relations_outside=0,relation_kinds_inside=0,functions_outside=0,types_outside=0,event_triggers=0,custom_roles=0,nondefault_extensions=0),
        extensions=[dict(name='plpgsql',version='1.0',schema='pg_catalog')],
        raw_acl=[dict(kind='schema',name='tf_pdf_result_rehearsal',identity='',acl='{postgres=UC/postgres}'),
            dict(kind='table',name='results',identity='',acl='{postgres=arwdDxtm/postgres}')])
    return value


def native(stdout=b'',stderr=b'',code=0):return SimpleNamespace(stdout=stdout,stderr=stderr,returncode=code)


class FakeTrial:
    def __init__(self,path,selected,*,defect=None):
        self.proof=path;self.identity='a'*64;self.events=[];self.records={};self.selected=selected;self.defect=defect
        self.rows={};self.receipts={};self.stage='seed';self.rendered=b'-- Invented fixed renderer fixture only\n'
        self.source_hook=lambda label:None
    def record(self,name,value):
        if name in self.records:raise FileExistsError
        if self.defect=='result_record'and name=='PDF_POPULATED_RESULT':raise OSError('PRIVATE_RECORD')
        self.events.append(name);self.records[name]=value
    def create(self):self.events.append('create')
    def inspect(self):self.events.append('inspect');return dict(running=True)
    def verify_sources(self,label):self.events.append(label);self.source_hook(label)
    def stop(self):
        self.events.append('stop')
        if self.defect=='cleanup':raise RuntimeError('PRIVATE_STOP')
    def stop_initializer(self):self.events.append('stop_initializer')
    def run(self,args,*,payload):
        self.events.append(('render',args,payload))
        return native(self.rendered,b'PRIVATE_RENDER'if self.defect=='render_error'else b'')
    def fingerprint(self):
        if self.stage=='source':return json.loads(self.selected.source_rows_raw)
        if self.stage=='rollback'and self.defect=='rollback_rows':return []
        return [self.rows[key]for key in sorted(self.rows)]
    def query(self,statement,*,allowed=False):
        self.events.append(('query',statement,allowed))
        if statement==m.CATALOGUE_SQL:
            value=catalogue()
            if self.stage=='rollback'and self.defect=='rollback_catalogue':value['functions'][0]['definition']='PRIVATE_CHANGED'
            if self.stage=='source':
                value['raw_acl'][1]['acl']=None
                if self.defect=='success_catalogue':value['tables'][0]['columns'][2]['default']='PRIVATE_CHANGED'
                if self.defect=='success_acl':value['effective_acl'][1]['grantable']=True
            return native(_canonical(value))
        if m.WITNESS_KIND in statement:
            late='select 1/0;'in statement
            value=dict(kind=m.WITNESS_KIND,rows=json.loads(self.selected.source_rows_raw))
            if late:
                self.stage='rollback'
                if self.defect=='late_witness':value['rows']=[]
                output=b'\n'+_canonical(value)+b'\n'
                if self.defect=='late_marker':output+=m.COMMIT_MARKER+b'\n'
                error=b'ERROR:  22012: division by zero\n'
                if self.defect=='late_state':error=b'ERROR:  42601: syntax error\n'
                return native(output,error,3)
            self.stage='source'
            return native(b'\n'+_canonical(value)+b'\n'+m.COMMIT_MARKER+b'\n')
        if 'store_result(decode('in statement:
            bodies=re.findall(r"decode\('([A-Za-z0-9+/=]+)','base64'\)",statement)
            intent,packet=(base64.b64decode(body,validate=True)for body in bodies)
            value=json.loads(intent);op=value['operation_id'];index=len(self.rows)+1
            _,expected,_=m.custody._decode(self.selected.independent_input_raw)
            at=expected.prepared_at+timedelta(seconds=index+1)
            artifact='60000000-0000-4000-8000-'+str(index).zfill(12)
            receipt=_canonical(dict(schema_version=1,kind=port.RECEIPT_KIND,operation_id=op,artifact_id=artifact,stored_at=_stamp(at),
                intent_base64=base64.b64encode(intent).decode(),packet_base64=base64.b64encode(packet).decode(),
                intent_sha256=sha256(intent).hexdigest(),packet_sha256=sha256(packet).hexdigest(),intent_bytes=len(intent),packet_bytes=len(packet)))
            self.rows[op]=dict(operation_id=op,artifact_id=artifact,stored_at=at.isoformat(),intent_sha256=sha256(intent).hexdigest(),packet_sha256=sha256(packet).hexdigest())
            self.receipts[op]=receipt
            return native(receipt+b'\n'+m.COMMIT_MARKER+b'\n')
        if 'result_receipt('in statement:
            source=json.loads(self.selected.source_rows_raw)[0]['operation_id']
            if source in statement:raw=self.selected.source_receipt
            else:
                op=next(key for key in self.receipts if key in statement);raw=self.receipts[op]
                if self.defect=='rollback_receipt':raw=b'{}'
            return native(raw+b'\n'+m.COMMIT_MARKER+b'\n')
        if 'jsonb_agg'in statement:return native(_canonical(self.fingerprint()))
        raise AssertionError('Unrecognized fake SQL boundary')


class PdfCustodyPopulatedRestoreScopeTests(unittest.TestCase):
    @contextmanager
    def no_process(self):
        with patch('subprocess.Popen',side_effect=AssertionError('No process'))as popen, \
                patch('subprocess.run',side_effect=AssertionError('No process'))as run:
            yield
            popen.assert_not_called();run.assert_not_called()

    def refusal(self,action):
        with self.assertRaisesRegex(m.custody.FeedPgTrialError,'^'+m.CODE+'$')as caught:action()
        self.assertIsNone(caught.exception.__cause__)

    @contextmanager
    def trial(self,*,defect=None):
        selected=inputs()
        fakebindings=tuple((name,len(getattr(selected,name)),sha256(getattr(selected,name)).hexdigest())for name,_,_ in m.FIXED_BINDINGS)
        with TemporaryDirectory()as directory:
            trial=FakeTrial(Path(directory),selected,defect=defect)
            with self.no_process(),patch.object(m,'FIXED_BINDINGS',fakebindings), \
                    patch.object(m,'FreshPdfPopulatedRestore',return_value=trial)as constructor, \
                    patch.object(port,'reopen_pdf_result_packet',return_value=SimpleNamespace(context=None)):
                yield selected,trial,constructor

    def test_fixed_all_operand_selectors_and_noargs_help_foreign_parameters_before_resources(self):
        self.assertEqual(m.FIXED_BINDINGS[0],('archive',26616,'0f8ff669a10c472072c1ae89d479cd703b8c725357b4015eb9baf0dcb31d6cf9'))
        self.assertEqual({name for name,_,_ in m.FIXED_BINDINGS},set(m.matching.LIMITS))
        self.assertIsNone(m.OPERANDS)
        with self.no_process(),patch.object(m,'FreshPdfPopulatedRestore')as constructor,patch.object(m.matching,'_preflight')as preflight:
            for args,code in (([],2),(['--help'],0),(['--target','PRIVATE_DB'],2),(['/tmp/archive.dump'],2)):
                out=StringIO();err=StringIO()
                with redirect_stdout(out),redirect_stderr(err):self.assertEqual(m.main(args),code)
                self.assertNotIn('PRIVATE_DB',out.getvalue()+err.getvalue())
            self.refusal(lambda:m.run_populated_restore(inputs()))
            constructor.assert_not_called();preflight.assert_not_called()

    def test_invalid_changed_part_or_class_never_reaches_pdf_preflight_or_constructor(self):
        selected=inputs();fixed=tuple((name,len(getattr(selected,name)),sha256(getattr(selected,name)).hexdigest())for name,_,_ in m.FIXED_BINDINGS)
        cases=[None,vars(selected),replace(selected,archive_sha256='f'*64)]
        for name in m.matching.LIMITS:cases.append(replace(selected,**{name:getattr(selected,name)+b' '}))
        with self.no_process(),patch.object(m,'FIXED_BINDINGS',fixed),patch.object(m.matching,'_preflight')as preflight, \
                patch.object(m,'FreshPdfPopulatedRestore')as constructor:
            for value in cases:self.refusal(lambda:m.run_populated_restore(value))
            constructor.assert_not_called();preflight.assert_not_called()

    def test_native_render_fixed_owned_argv_caps_utf8_nul_and_stderr_no_sql_parser(self):
        with TemporaryDirectory()as directory:
            selected=inputs();events=[]
            # A function-body END; is legitimate rendered data, not an outer
            # transaction to reject by a whole-body regex or semantic parser.
            rendered=b'CREATE FUNCTION invented()RETURNS void LANGUAGE plpgsql AS $$\nBEGIN\nNULL;\nEND;\n$$;\n'
            trial=SimpleNamespace(proof=Path(directory),identity='a'*64,inspect=lambda:events.append('inspect'),
                run=lambda args,**kw:(events.append((args,kw))or native(rendered)),record=lambda n,v:events.append(n))
            with self.no_process():self.assertEqual(m._render(trial,selected),rendered)
            self.assertEqual(events[1],(['docker','exec','-i','a'*64,m.custody.BIN+'pg_restore','--clean','--if-exists','--file=-'],{'payload':selected.archive}))
            self.assertEqual((trial.proof/'PDF_POPULATED_RENDERED.sql').read_bytes(),rendered)
        for result in (native(b''),native(b'x'*131073),native(b'\xff'),native(b'A\x00B'),native(b'fixed',b'PRIVATE'),native(b'fixed',code=1),native(b'fixed',code=True)):
            with TemporaryDirectory()as directory:
                trial=SimpleNamespace(proof=Path(directory),identity='a'*64,inspect=lambda:None,run=lambda *a,**kw:result)
                with self.no_process(),self.assertRaises(ValueError):m._render(trial,inputs())
                self.assertFalse((trial.proof/'PDF_POPULATED_RENDERED.sql').exists())

    def test_fixed_parent_transaction_full_render_then_witness_then_error_then_commit(self):
        rendered=b'-- DISTINCT_FULL_RENDER_BODY\n'
        late=m.restore_statement(rendered,late_fault=True);good=m.restore_statement(rendered,late_fault=False)
        self.assertTrue(late.startswith('\\set VERBOSITY verbose\n'+m.HEAD))
        self.assertLess(late.index('begin;'),late.index(rendered.decode()))
        self.assertLess(late.index(rendered.decode()),late.index(m.WITNESS_KIND))
        self.assertLess(late.index(m.WITNESS_KIND),late.index('select 1/0;'))
        self.assertLess(late.index('select 1/0;'),late.index('commit;'))
        self.assertEqual(late.replace('\nselect 1/0;',''),good)
        self.assertTrue(good.endswith('commit;\n\\echo '+m.COMMIT_MARKER.decode()+'\n'))
        self.assertLessEqual(len(m.restore_statement(b'x'*131072,late_fault=False).encode()),294912)
        for body,flag in ((b'',True),(b'x'*131073,True),(bytearray(b'x'),True),(b'x',1)):
            with self.assertRaises(ValueError):m.restore_statement(body,late_fault=flag)

    def test_late_witness_requires_exact_source_primitives_22012_and_never_commit(self):
        selected=inputs();value=dict(kind=m.WITNESS_KIND,rows=json.loads(selected.source_rows_raw))
        good=native(b'\n'+_canonical(value)+b'\n',b'ERROR:  22012: division by zero\n',3)
        self.assertEqual(m.witness(good,selected,late_fault=True)['exact_sqlstate'],'22012')
        cases=[native(good.stdout,good.stderr,0),native(good.stdout+m.COMMIT_MARKER+b'\n',good.stderr,3),
            native(good.stdout,b'ERROR:  42601: syntax error\n',3),native(good.stdout,b'ERROR:  22012: different message\n',3),
            native(good.stdout,b'ERROR:  22012: division by zero\nERROR:  22012: division by zero\n',3),
            native(b'{}\n',good.stderr,3),native(good.stdout+b'{}\n',good.stderr,3),native(good.stdout,b'',3)]
        wrong=deepcopy(value);wrong['rows'][0]['artifact_id']=True
        cases.append(native(_canonical(wrong)+b'\n',good.stderr,3))
        for result in cases:
            with self.assertRaises(ValueError):m.witness(result,selected,late_fault=True)

    def test_success_witness_requires_complete_marker_clean_exit_and_no_other_select_output(self):
        selected=inputs();body=_canonical(dict(kind=m.WITNESS_KIND,rows=json.loads(selected.source_rows_raw)))
        good=native(b'\n'+body+b'\n'+m.COMMIT_MARKER+b'\n')
        self.assertTrue(m.witness(good,selected,late_fault=False)['commit_observed'])
        for result in (native(body+b'\n'),native(good.stdout,b'PRIVATE'),native(good.stdout,code=1),
                       native(good.stdout+b'{}\n'),native(body+b'\nOTHER\n'+m.COMMIT_MARKER+b'\n')):
            with self.assertRaises(ValueError):m.witness(result,selected,late_fault=False)

    def test_catalogue_all_declared_categories_and_effective_acl_default_not_raw_null_alias(self):
        before=catalogue();after=deepcopy(before);after['raw_acl'][1]['acl']=None
        keep_before=deepcopy(before);keep_after=deepcopy(after)
        result=m.compare_catalogue(before,after)
        self.assertTrue(result['declared_catalogue_equal']);self.assertTrue(result['effective_named_acl_equal'])
        self.assertFalse(result['raw_acl_spelling_equal']);self.assertFalse(result['historical_producer_catalogue_observed'])
        self.assertEqual(before,keep_before);self.assertEqual(after,keep_after)
        after['effective_acl'][1]['grantable']=True
        self.refusal(lambda:m.compare_catalogue(before,after))
        self.assertEqual(set(before),m.CATALOGUE_KEYS)

    def test_catalogue_any_nonraw_column_default_index_constraint_trigger_function_or_owner_change_holds(self):
        baseline=catalogue()
        changes=[lambda v:v['tables'][0]['columns'][2].update(default='foreign'),
            lambda v:v['tables'][0]['columns'][2].update(type='text'),lambda v:v['indexes'][0].update(definition='foreign'),
            lambda v:v['constraints'][0].update(definition='foreign'),lambda v:v['triggers'][0].update(definition='foreign'),
            lambda v:v['functions'][0].update(definition='foreign'),lambda v:v['functions'][0].update(strict=True),
            lambda v:v['types'][0].update(owner='foreign'),lambda v:v['extensions'][0].update(version='foreign'),
            lambda v:v['tables'][0]['columns'][2].update(notnull=1)]
        for change in changes:
            value=deepcopy(baseline);change(value)
            with self.subTest(change=change),self.assertRaises(ValueError):m.compare_catalogue(baseline,value)
        for key,change in (('unexpected',dict(schemas=False)),('schema',dict(owner='foreign'))):
            value=deepcopy(baseline);value[key].update(change)
            with self.assertRaises(ValueError):m.compare_catalogue(baseline,value)
        for key,bad in (('default_acl',None),('policies',[{}]),('raw_acl',{})):
            value=deepcopy(baseline);value[key]=bad
            with self.assertRaises(ValueError):m.compare_catalogue(baseline,value)

    def test_additional_column_null_acl_is_not_replaced_by_zero_dimensional_array(self):
        # pg_attribute.attacl NULL means no additional column grants. Native
        # aclexplode is strict: passing NULL produces no rows; a synthetic '{}'
        # is zero-dimensional and raises before the catalogue is available.
        # This resource-free check constrains query construction, not SQL execution.
        column_branch=m.CATALOGUE_SQL.split("'kind','additional_column'",1)[1].split('raw_acls as(',1)[0]
        self.assertIn('cross join lateral aclexplode(v.attacl) a',column_branch)
        self.assertNotIn('coalesce(v.attacl',column_branch)
        self.assertNotIn("'{}'::aclitem[]",column_branch)
        self.assertIn("'acl',a.attacl::text",m.CATALOGUE_SQL)
        self.assertIn("aclexplode(coalesce(t.typacl,acldefault('T',t.typowner)))",m.CATALOGUE_SQL)

    def test_explicit_additional_column_grants_remain_compared_without_raw_acl_alias(self):
        # Manually invented privilege rows exercise comparison semantics only;
        # neither this model nor the query assertion proves native SQL behavior.
        absent=catalogue();self.assertTrue(m.compare_catalogue(absent,deepcopy(absent))['effective_named_acl_equal'])
        granted=deepcopy(absent)
        grant=dict(kind='additional_column',name='results.packet',identity='',grantor='postgres',
            grantee='postgres',privilege='SELECT',grantable=False)
        granted['effective_acl'].append(grant)
        granted['raw_acl'].append(dict(kind='column',name='results.packet',identity='',acl='{postgres=r/postgres}'))
        same=deepcopy(granted);self.assertTrue(m.compare_catalogue(granted,same)['effective_named_acl_equal'])
        same['raw_acl'][-1]['acl']=None
        result=m.compare_catalogue(granted,same)
        self.assertTrue(result['effective_named_acl_equal']);self.assertFalse(result['raw_acl_spelling_equal'])
        # A grant cannot disappear into the no-additional-grants baseline, and
        # the NULL repair must not remove or normalize any real column entry.
        with self.assertRaises(ValueError):m.compare_catalogue(absent,granted)
        with self.assertRaises(ValueError):m.compare_catalogue(granted,absent)
        for key,value in (('privilege','UPDATE'),('grantable',True),('name','results.intent'),('grantee','foreign_role')):
            changed=deepcopy(granted);changed['effective_acl'][-1][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.compare_catalogue(granted,changed)
        self.assertEqual(granted['effective_acl'][-1],grant)

    def test_generated_type_default_public_usage_retained_and_unexpected_effective_type_acl_fails(self):
        before=catalogue()
        for name in ('_results','results'):
            for grantee in ('PUBLIC','postgres'):
                before['effective_acl'].append(dict(kind='type',name=name,identity='',grantor='postgres',
                    grantee=grantee,privilege='USAGE',grantable=False))
            before['raw_acl'].append(dict(kind='type',name=name,identity='',acl=None))
        after=deepcopy(before)
        after['raw_acl'][-1]['acl']='{=U/postgres,postgres=U/postgres}'
        result=m.compare_catalogue(before,after)
        self.assertTrue(result['effective_named_acl_equal']);self.assertFalse(result['raw_acl_spelling_equal'])
        # Actual default PUBLIC USAGE is recorded, not revoked or normalized
        # into no rights. Namespace/table/function privacy stays independent.
        self.assertEqual([r['grantee']for r in before['effective_acl']if r['kind']=='type'],['PUBLIC','postgres','PUBLIC','postgres'])
        for change in ('missing','foreign','grantable','wrong_public_kind'):
            wrong=deepcopy(after)
            row=next(r for r in wrong['effective_acl']if r['kind']=='type'and r['grantee']=='PUBLIC')
            if change=='missing':wrong['effective_acl'].remove(row)
            elif change=='foreign':row['grantee']='foreign_role'
            elif change=='grantable':row['grantable']=True
            else:row['kind']='table'
            with self.subTest(change=change),self.assertRaises(ValueError):m.compare_catalogue(before,wrong)
        self.assertIn("aclexplode(coalesce(t.typacl,acldefault('T',t.typowner)))",m.CATALOGUE_SQL)
        self.assertIn("'acl',t.typacl::text",m.CATALOGUE_SQL)

    def test_catalogue_sql_declares_native_definitions_named_acl_and_no_secret_or_raw_oid_identity(self):
        sql=m.CATALOGUE_SQL
        for required in ('pg_attribute','pg_get_expr','pg_get_indexdef','pg_get_constraintdef','pg_get_triggerdef','pg_get_functiondef',
            'pg_policy','pg_default_acl',"acldefault('n'","acldefault('r'","acldefault('f'",'aclexplode',
            'pg_get_userbyid','is_grantable','prosecdef','relrowsecurity','attcompression','indnullsnotdistinct'):
            self.assertIn(required,sql)
        self.assertIn('repeatable read read only',sql);self.assertIn('set local search_path=pg_catalog',sql)
        for forbidden in ('pg_authid','rolpassword','subconninfo','create role','create database','alter default privileges'):
            self.assertNotIn(forbidden,sql.lower())
        self.assertNotIn("'oid'",sql);self.assertNotIn('SCOPED_SCHEMAS',sql)
        self.assertIs(m.FreshPdfPopulatedRestore.bootstrap_schema,m.custody.FreshPdfResultPostgres.bootstrap_schema)

    def test_full_fake_sequence_rollback_two_original_receipts_then_same_archive_success_and_cleanup(self):
        with self.trial()as(selected,trial,constructor):
            result=m.run_populated_restore(selected)
            self.assertEqual(result['status'],'PASS');self.assertEqual(result['predecessor_rows'],2)
            self.assertEqual(result['late_fault_sqlstate'],'22012');self.assertFalse(result['raw_acl_spelling_equal'])
            self.assertFalse(result['historical_producer_catalogue_observed']);self.assertTrue(result['owned_resources_stopped'])
            renders=[event for event in trial.events if type(event)is tuple and event[0]=='render'];self.assertEqual(len(renders),1)
            restores=[event[1]for event in trial.events if type(event)is tuple and event[0]=='query'and m.WITNESS_KIND in event[1]]
            self.assertEqual(len(restores),2);self.assertEqual(restores[0].replace('\nselect 1/0;',''),restores[1])
            self.assertLess(trial.events.index('PDF_POPULATED_LATE_FAULT_WITNESS'),trial.events.index('PDF_POPULATED_ROLLBACK'))
            self.assertLess(trial.events.index('PDF_POPULATED_ROLLBACK'),trial.events.index('PDF_POPULATED_SUCCESS_WITNESS'))
            self.assertLess(trial.events.index('stop'),trial.events.index('PDF_POPULATED_RESULT'))
            self.assertLess(trial.events.index('stop_initializer'),trial.events.index('PDF_POPULATED_RESULT'))
            self.assertEqual((trial.proof/'PDF_POPULATED_RESTORED_FULL_RECEIPT.json').read_bytes(),selected.source_receipt)
            self.assertEqual(len(list((trial.proof/'restore-operands').iterdir())),7)

    def test_late_phase_wrong_witness_state_marker_or_predecessor_catalogue_never_reaches_success(self):
        for defect in ('late_witness','late_state','late_marker','rollback_rows','rollback_receipt','rollback_catalogue'):
            with self.subTest(defect=defect),self.trial(defect=defect)as(selected,trial,constructor):
                self.refusal(lambda:m.run_populated_restore(selected))
                self.assertNotIn('PDF_POPULATED_SUCCESS_WITNESS',trial.records)
                self.assertNotIn('PDF_POPULATED_RESULT',trial.records)
                self.assertIn('stop',trial.events);self.assertIn('stop_initializer',trial.events)

    def test_success_catalogue_acl_render_cleanup_or_result_record_failure_cannot_pass(self):
        for defect in ('success_catalogue','success_acl','render_error','cleanup','result_record'):
            with self.subTest(defect=defect),self.trial(defect=defect)as(selected,trial,constructor):
                self.refusal(lambda:m.run_populated_restore(selected))
                self.assertNotIn('PDF_POPULATED_RESULT',trial.records)
                self.assertIn('stop',trial.events);self.assertIn('stop_initializer',trial.events)

    def test_frozen_operand_drift_before_fault_and_source_drift_after_cases_holds_and_stops(self):
        for kind in ('operand','source'):
            with self.trial()as(selected,trial,constructor):
                def hook(label):
                    if kind=='operand'and label=='PDF_POPULATED_BEFORE_LATE_FAULT':
                        (trial.proof/'restore-operands'/'archive.bin').write_bytes(b'PRIVATE_TAMPER')
                    if kind=='source'and label=='PDF_POPULATED_AFTER_CHECKS':raise RuntimeError('PRIVATE_SOURCE_DRIFT')
                trial.source_hook=hook
                self.refusal(lambda:m.run_populated_restore(selected))
                self.assertNotIn('PDF_POPULATED_RESULT',trial.records);self.assertIn('stop_initializer',trial.events)

    def test_full_source_closure_includes_parent_seeds_alias_imports_package_initializers_child_and_locks(self):
        with TemporaryDirectory()as directory:
            root=Path(directory);bodies={m.ENTRY:b'from scripts import aliased as local\nimport workers.direct as inspector\n',m.TEST:b'# focused scope\n',
                'scripts/__init__.py':b'# package initializer\n','scripts/aliased.py':b'from workers import helper as same\n',
                'workers/__init__.py':b'# package initializer\n','workers/direct.py':b'from . import peer\n','workers/helper.py':b'x=1\n','workers/peer.py':b'x=2\n',
                'tests/fixtures/invented_feed_journal.sql':b'UNUSED_PARENT_DECLARATION;',
                'scripts/parent.py':b'# parent source seed\n','tests/fixtures/fixed.sql':b'FIXED_DECLARATION;',
                'workers/_pdf_text_worker.py':b'from workers import launched_dependency as fixed\n','workers/launched_dependency.py':b'x=3\n',
                'pyproject.toml':b'[project]\nname="invented"\n','uv.lock':b'version=1\n'}
            for name,raw in bodies.items():
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            with self.no_process(),patch.object(m,'ROOT',root),patch.object(m.custody,'NEW_FILES',('scripts/parent.py','tests/fixtures/fixed.sql')):
                names=m.source_files();self.assertEqual(set(names),set(bodies))
                proof=root/'proof';proof.mkdir();(proof/'inputs').mkdir();records={}
                trial=SimpleNamespace(counter=0,identity=None,creation_attempted=False,initializer_attempted=False,
                    proof=proof,frozen={},source_bindings=[],record=lambda n,v:records.setdefault(n,v))
                m.freeze_populated_sources(trial);self.assertEqual(set(trial.frozen),set(bodies))
                self.assertEqual(len(records['PDF_POPULATED_SOURCE_BINDINGS']),len(bodies))
                trial.counter=1;self.refusal(lambda:m.freeze_populated_sources(trial));trial.counter=0
                (root/'workers/helper.py').write_bytes(b'x=4\n')
                self.refusal(lambda:m.freeze_populated_sources(trial))


if __name__=='__main__':unittest.main()
