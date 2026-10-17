"""Finite source-contract checks only: no SQL parser, server or native execution.

Cross-check the new uninstalled HTML association against its existing native
preparation getter, the separately frozen pure command and invented full inputs.
These checks cannot prove that PostgreSQL compiles or executes the fixture.
"""
from pathlib import Path
import ast,base64,json,re,unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
FIXTURE='tests/fixtures/invented_html_initial_candidate_capture.sql'
NAMESPACE='tf_html_initial_candidate'


def functions(sql):
    return {m.group(1):m.group(2)for m in re.finditer(r'create function\s+tf_html_initial_candidate\.(\w+)\([^$]*?\bas\s*\$\$(.*?)\$\$;',sql,re.S|re.I)}


def ordered(text,tokens):
    positions=[text.index(token)for token in tokens]
    return positions==sorted(positions)and len(set(positions))==len(positions)


class HtmlInitialCandidateSqlScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql=(ROOT/FIXTURE).read_text();cls.bodies=functions(cls.sql)
        cls.write=cls.bodies['capture_for_work'];cls.read=cls.bodies['capture_receipt']
        cls.fixture=json.loads((ROOT/'fixtures/fictional-html-initial-candidate.json').read_bytes())
        cls.report=json.loads(cls.fixture['reportJson'])

    def test_closed_new_scope_contains_only_three_invoker_owner_functions_one_RLS_appendonly_table(self):
        self.assertEqual(set(self.bodies),{'refuse_mutation','capture_receipt','capture_for_work'})
        self.assertEqual(re.findall(r'create schema\s+(\w+)',self.sql),[NAMESPACE])
        self.assertEqual(re.findall(r'create table\s+([\w.]+)',self.sql),[NAMESPACE+'.captures'])
        self.assertEqual(self.sql.lower().count('security invoker set search_path=pg_catalog'),3)
        self.assertNotIn('security definer',self.sql.lower());self.assertNotRegex(self.sql.lower(),r'\bgrant\b[^.\n]*\bon\b')
        self.assertIn('alter table '+NAMESPACE+'.captures enable row level security;',self.sql)
        self.assertIn('before update or delete on '+NAMESPACE+'.captures',self.sql)
        self.assertIn("errcode='55000'",self.bodies['refuse_mutation'])
        self.assertEqual(len(re.findall(r'revoke all on function tf_html_initial_candidate\.',self.sql)),3)
        for body in(self.write,self.read):self.assertIn("current_user<>session_user or session_user<>'postgres'",body)

    def test_five_fixed_operands_match_existing_pure_HTML_contract_without_grant_install_or_default(self):
        pure=(ROOT/'src/server/html-initial-candidate-capture.ts').read_text()
        self.assertIn('tf_html_initial_candidate.capture_for_work($1::uuid,$2::text,$3::uuid,decode($4::text,\'base64\'),decode($5::text,\'base64\'))',pure.replace('"','"'))
        self.assertIn('capture_for_work(p_run uuid,p_fingerprint text,p_claim uuid,p_intent bytea,p_report bytea)',self.sql)
        self.assertIn('capture_receipt(p_capture uuid)',self.sql)
        self.assertNotIn('create or replace',self.sql.lower());self.assertNotIn('set session authorization',self.sql.lower())
        self.assertNotIn('tf_detached_proposal',self.sql);self.assertNotIn('tf_initial_candidate.',self.sql)

    def test_native_HTML_preparation_getter_full_intent_and_all_four_exact_parts_are_bound(self):
        self.assertIn('references tf_html_preparation.preparations(operation_id)',self.sql)
        self.assertIn('native_prep:=tf_html_preparation.preparation_receipt(prep.operation_id);',self.write)
        self.assertNotIn("'invented_detached_preparation_stored'",self.write)
        self.assertIn("convert_to(r->>'intent_json','UTF8')is distinct from prep.metadata",self.write)
        for field in('payload','selection','provenance'):
            self.assertIn("r->>'"+field+"_json'is distinct from convert_from(prep."+field+"_raw,'UTF8')",self.write)
        self.assertIn("metadata->>'context_raw_sha256'is distinct from encode(sha256(prep.context_raw),'hex')",self.write)
        for part in('payload_raw','selection_raw','provenance_raw','context_raw'):self.assertIn('then prep.'+part if part!='context_raw'else'else prep.context_raw',self.write)
        self.assertIn("i->'part_sha256'->>index is distinct from encode(sha256(part),'hex')",self.write)
        self.assertIn("r#>>'{preparation,receipt_sha256}'is distinct from i->>'preparation_full_receipt_sha256'",self.write)
        original=(ROOT/'tests/fixtures/invented_html_preparation.sql').read_text()
        for field in('metadata_base64','payload_base64','selection_base64','provenance_base64','context_base64'):self.assertIn("'"+field+"'",original)

    def test_report_root_and_preparation_closed_keys_match_properly_derived_fixture(self):
        arrays=re.findall(r"keys is distinct from array\[([^]]+)\]",self.write)
        grammar=[re.findall(r"'([^']+)'",text)for text in arrays]
        self.assertIn(sorted(self.report),grammar);self.assertIn(sorted(self.report['preparation']),grammar)
        self.assertIn('from json_object_keys(intent_json)k',self.write)
        self.assertIn('from json_object_keys(report_json)k',self.write)
        self.assertIn("from json_object_keys(report_json->'preparation')k",self.write)
        self.assertIn("r->>'kind'is distinct from 'private_html_preparation_review_report'",self.write)
        self.assertIn("metadata->>'kind'is distinct from 'invented_detached_html_proposal_preparation'",self.write)
        self.assertNotIn("'invented_detached_preparation_review'",self.write)
        self.assertIn("convert_from(p_intent,'UTF8')is distinct from canonical_intent",self.write)
        self.assertIn('order by k collate "C"',self.write)
        for key,value in self.report['limits'].items():self.assertFalse(value);self.assertIn("'"+key+"',false",self.write)

    def test_original_work_fences_surround_lock_replay_and_new_complete_pair_before_return(self):
        initial=self.write.index('perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);')
        self.assertLess(initial,self.write.index('lock table tf_html_initial_candidate.captures'))
        replay=self.write[self.write.index(' if found then'):self.write.index(' if(select count(*)')]
        self.assertTrue(ordered(replay,['old.intent_raw is distinct from p_intent','capture_receipt(old.capture_id)','assert_update_run_work(p_run,p_fingerprint,p_claim)','return receipt;']))
        new=self.write[self.write.index(' generic:='):]
        self.assertTrue(ordered(new,['terra_private.capture_held_proposal(',"generic->>'status'is distinct from 'stored'",'insert into tf_html_initial_candidate.captures','capture_receipt((i->>', 'perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);','return receipt;']))
        self.assertEqual(self.write.count('assert_update_run_work(p_run,p_fingerprint,p_claim)'),3)
        self.assertNotIn('renew_',self.write);self.assertNotIn('claim_update_run',self.write)

    def test_preexisting_or_concurrent_standalone_generic_captures_are_not_adopted(self):
        self.assertTrue(ordered(self.write,['if exists(select 1 from terra_private.proposal_captures','standalone_or_preparation_conflict','select * into prep','generic:=terra_private.capture_held_proposal',"generic->>'status'is distinct from 'stored'",'concurrent_standalone','insert into tf_html_initial_candidate.captures']))
        self.assertIn('or decision_id=(i->>\'decision_id\')::uuid',self.write)
        self.assertIn('old.intent_raw is distinct from p_intent or old.report_raw is distinct from p_report',self.write)
        self.assertNotIn('on conflict',self.write.lower())
        self.assertNotIn('update tf_html_initial_candidate',self.write.lower())

    def test_entirely_null_existing_head_and_one_claim_source_without_any_publication_action(self):
        self.assertIn("jsonb_build_object('publication_id',null,'content_sha256',null,'changed_at',null)",self.write)
        self.assertIn('where issue_id=target.id for update;',self.write)
        self.assertIn('if not found or head.current_publication_id is not null or head.changed_at is not null',self.write)
        for path in('{snapshot,claims}','{snapshot,claims,0,evidence}','{dependencyManifest,sourceVersionIds}'):
            self.assertIn("jsonb_typeof(payload#>'"+path+"')is distinct from 'array'",self.write)
            self.assertIn("jsonb_array_length(payload#>'"+path+"')<>1",self.write)
        for token in("payload->>'kind'is distinct from 'review_only'","payload->>'conflictCoverage'is distinct from 'not_recorded'","('unreviewed','not_recorded')"):
            self.assertIn(token,self.write)
        for forbidden in('activate_machine_publication','insert into terra_private.issue_publications','update terra_private.issue_heads','session_replication_role','fetch_enabled=','allow_fetch=','grant execute'):
            self.assertNotIn(forbidden,self.sql.lower())

    def test_current_HTML_original_native_source_and_held_evidence_must_agree_across_typed_storage(self):
        original=json.loads(base64.b64decode(self.fixture['fullReceipts']['current_receipt']))
        metadata=json.loads(base64.b64decode(original['metadata_base64']))
        for key in('source_version_id','content_sha256','item_key','source_url','source_key','retrieved_at'):
            self.assertIn(key,metadata['document']);self.assertIn("original_doc->>'"+key+"'",self.write)
            self.assertIn("r#>>'{extraction,inspection,current,"+key+"}'",self.write)
        self.assertIn("original_mapping->>'language_code'",self.write)
        self.assertIn('join tf_html_rehearsal.originals o on o.operation_id=e.current_operation_id',self.write)
        self.assertIn('where e.operation_id=prep.extraction_operation_id',self.write)
        self.assertIn("payload#>>'{dependencyManifest,sourceVersionIds,0}' is distinct from decision.source_version_id::text",self.write)
        for key in('run_id','decision_id','source_version_id','content_sha256','locator','item_key','jurisdiction_id','decided_at'):
            self.assertIn("context#>>'{held,"+key+"}'",self.write)

    def test_actual_native_receipt_has_original_observation_and_unchanged_complete_byte_cap(self):
        self.assertIn('octet_length(p_report)not between 2 and 524288',self.write)
        self.assertIn('octet_length(v::text)+29>131072',self.read)
        self.assertIn("native_prep::text,'UTF8'",self.write)
        self.assertIn("c.captured_at<(i->>'preparation_observed_at')::timestamptz",self.read)
        self.assertIn("r.stored_at>='10000-01-01Z'::timestamptz",self.read)
        self.assertIn("not isfinite(c.captured_at) or not isfinite(r.stored_at)",self.read)
        self.assertIn("'0001-01-01Z'::timestamptz",self.write)
        self.assertIn("to_char((i->>'preparation_observed_at')::timestamptz at time zone 'UTC'",self.write)
        self.assertNotIn("'observedAt',clock_timestamp()",self.read)

    def test_source_checks_remain_resource_free_and_cannot_claim_SQL_compilation_or_native_execution(self):
        source=Path(__file__).read_text()
        with patch('subprocess.Popen')as process,patch('subprocess.run')as run:
            self.assertTrue(self.sql.startswith('-- UNINSTALLED'))
            tree=ast.parse(source)
            imports=[name.name.split('.')[0]for n in ast.walk(tree)if isinstance(n,ast.Import)for name in n.names]
            self.assertFalse({'psycopg','docker'}&set(imports))
            calls=[n.func.attr for n in ast.walk(tree)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and isinstance(n.func.value,ast.Name)and n.func.value.id=='subprocess']
            self.assertEqual(calls,[])
            process.assert_not_called();run.assert_not_called()


if __name__=='__main__':unittest.main()
