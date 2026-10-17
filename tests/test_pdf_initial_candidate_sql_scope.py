"""Source/grammar scopes only; never PostgreSQL compilation or execution."""
import ast
import base64
from hashlib import sha256
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
FIXTURE='tests/fixtures/invented_pdf_initial_candidate_capture.sql'
SCHEMA='tf_pdf_initial_candidate'
FENCE='perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);'

def functions(sql):
    matches=re.findall(r'create function '+SCHEMA+r'\.(\w+)\((.*?)\)\s*returns.*?as \$\$(.*?)\$\$;',sql,re.S)
    return {name:(args,body) for name,args,body in matches}

def ordered(raw,tokens):
    cursor=0
    for token in tokens:
        found=raw.find(token,cursor)
        if found<0:return False
        cursor=found+len(token)
    return True

def static_contract(sql):
    """Small declared source invariants, not an executable SQL validator."""
    f=functions(sql)
    if set(f)!={'refuse_mutation','capture_receipt','capture_for_work'}:return False
    body=f['capture_for_work'][1];read=f['capture_receipt'][1]
    return (sql.count('security invoker set search_path=pg_catalog')==3
        and body.count(FENCE)==6
        and ordered(body,[FENCE,'lock table '+SCHEMA+'.captures',FENCE,'select * into old'])
        and ordered(body,['octet_length(receipt::text)+4096>131072','generic:=terra_private.capture_held_proposal',FENCE,'insert into '+SCHEMA+'.captures','capture_receipt((i->>',FENCE,'return receipt;'])
        and 'octet_length(v::text)+29>131072' in read
        and 'before truncate on '+SCHEMA+'.captures' in sql
        and 'native_result:=tf_pdf_result_rehearsal.result_receipt(source_result.operation_id);' in body
        and 'native_prep:=tf_pdf_result_rehearsal.preparation_receipt(prep.operation_id);' in body)

class PdfInitialCandidateSqlScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql=(ROOT/FIXTURE).read_text();cls.f=functions(cls.sql)
        cls.write=cls.f['capture_for_work'][1];cls.read=cls.f['capture_receipt'][1]
        cls.example=json.loads((ROOT/'fixtures/fictional-stored-pdf-preparation-review.json').read_bytes())
        cls.report=json.loads(cls.example['reportJson'])

    def test_exact_new_objects_invoker_owner_RLS_no_grants_and_indexed_noncascading_FKs(self):
        self.assertTrue(static_contract(self.sql))
        self.assertEqual(re.findall(r'create schema\s+(\w+)',self.sql),[SCHEMA])
        self.assertEqual(re.findall(r'create table\s+([\w.]+)',self.sql),[SCHEMA+'.captures'])
        self.assertIn('capture_id uuid primary key references terra_private.proposal_captures(id)',self.sql)
        self.assertIn('preparation_operation_id uuid not null unique references tf_pdf_result_rehearsal.preparations(operation_id)',self.sql)
        self.assertNotIn('cascade',self.sql.lower())
        self.assertIn('alter table '+SCHEMA+'.captures enable row level security;',self.sql)
        self.assertNotRegex(self.sql.lower(),r'\bgrant\b[^\n]*\bon\b')
        self.assertNotIn('security definer',self.sql.lower());self.assertNotIn('create policy',self.sql.lower())
        for body in (self.write,self.read):self.assertIn("current_user<>session_user or session_user<>'postgres'",body)
        self.assertEqual(len(re.findall(r'revoke all on function '+SCHEMA+r'\.',self.sql)),3)
        self.assertIn('before update or delete on '+SCHEMA+'.captures',self.sql)
        self.assertIn('before truncate on '+SCHEMA+'.captures',self.sql)
        self.assertIn("errcode='55000'",self.f['refuse_mutation'][1])

    def test_exact_five_fixed_args_and_future_TS_names_with_no_target_or_transport(self):
        self.assertEqual(self.f['capture_for_work'][0],'p_run uuid,p_fingerprint text,p_claim uuid,p_intent bytea,p_report bytea')
        self.assertEqual(self.f['capture_receipt'][0],'p_capture uuid')
        pure=(ROOT/'src/server/pdf-initial-candidate-capture.ts').read_text()
        self.assertIn("tf_pdf_initial_candidate.capture_for_work($1::uuid,$2::text,$3::uuid,decode($4::text,'base64'),decode($5::text,'base64'))",pure)
        self.assertIn('tf_pdf_initial_candidate.capture_receipt($1::uuid)',pure)
        for token in ['create or replace','set session authorization','dblink','postgres_fdw','execute format','copy program','tf_html_','tf_initial_candidate.']:
            self.assertNotIn(token,self.sql.lower())
        self.assertTrue(self.sql.startswith('-- UNINSTALLED'))

    def test_closed_intent_types_digest_array_UUID45_and_canonical_token_reconstruction(self):
        arrays=[re.findall(r"'([^']+)'",value) for value in re.findall(r'keys is distinct from array\[([^]]+)\]',self.write)]
        intent=['schema_version','kind','snapshot_intent','capture_id','run_id','decision_id','issue_id','base_publication_id','preparation_operation_id','preparation_artifact_id','preparation_intent_sha256','preparation_full_receipt_sha256','report_sha256','part_sha256','preparation_observed_at']
        self.assertIn(sorted(intent),arrays)
        self.assertIn('from json_object_keys(intent_json)k',self.write)
        self.assertIn("foreach key in array array['capture_id','run_id','decision_id','issue_id']",self.write)
        self.assertIn('[45][0-9a-f]{3}',self.write);self.assertIn('[1-8][0-9a-f]{3}',self.write)
        self.assertIn("jsonb_typeof(i->'part_sha256'->index)is distinct from 'string'",self.write)
        self.assertIn("i->'base_publication_id'is distinct from 'null'::jsonb",self.write)
        self.assertIn("i->>'run_id'is distinct from p_run::text",self.write)
        self.assertIn('order by k collate "C"',self.write)
        self.assertIn("convert_from(p_intent,'UTF8')is distinct from canonical_intent",self.write)
        self.assertNotIn('regexp_replace',self.write[self.write.index('native_prep:='):])

    def test_report_closed_root_preparation_parts_and_limits_match_actual_generated_fixture(self):
        arrays=[re.findall(r"'([^']+)'",value) for value in re.findall(r'keys is distinct from array\[([^]]+)\]',self.write)]
        for obj in [self.report,self.report['preparation'],self.report['parts'],self.report['limits']]:self.assertIn(sorted(obj),arrays)
        for section in ['preparation','parts','limits']:self.assertIn("from json_object_keys(report_json->'"+section+"')k",self.write)
        self.assertIn("r->>'kind'is distinct from 'private_stored_pdf_preparation_review_report'",self.write)
        for key,value in self.report['limits'].items():self.assertFalse(value);self.assertIn("'"+key+"',false",self.write)

    def test_actual_preparation_intent_packet_and_all_four_exact_decoded_bytes_are_bound(self):
        self.assertIn("convert_to(r->>'intent_json','UTF8')is distinct from prep.intent",self.write)
        self.assertIn("r#>>'{preparation,packet_sha256}'is distinct from encode(sha256(prep.packet),'hex')",self.write)
        self.assertIn("decode(frame->>'intent_base64','base64')is distinct from prep.intent",self.write)
        self.assertIn("part_keys text[]:=array['payload','selection','provenance','context']",self.write)
        self.assertIn("convert_to(r->'parts'->>(key||'_json'),'UTF8')is distinct from part",self.write)
        self.assertIn("i->'part_sha256'->>(index-1)is distinct from encode(sha256(part),'hex')",self.write)
        self.assertIn("case index when 1 then 16384 when 2 then 2048 when 3 then 65536 else 32768 end",self.write)
        metadata=json.loads(self.report['intent_json'])
        for part,key in [('payload_json','payload_sha256'),('selection_json','selection_sha256'),('provenance_json','provenance_sha256'),('context_json','context_raw_sha256')]:self.assertEqual(sha256(self.report['parts'][part].encode()).hexdigest(),metadata[key])
        self.assertEqual(self.report['preparation']['intent_sha256'],sha256(self.report['intent_json'].encode()).hexdigest())

    def test_actual_full_preparation_and_result_getters_and_existing_result_crosslinks(self):
        for call in ['native_prep:=tf_pdf_result_rehearsal.preparation_receipt(prep.operation_id);','native_result:=tf_pdf_result_rehearsal.result_receipt(source_result.operation_id);']:
            self.assertIn(call,self.write)
        self.assertIn("encode(sha256(convert_to(native_prep::text,'UTF8')),'hex')",self.write)
        self.assertIn("encode(sha256(convert_to(native_result::text,'UTF8')),'hex')",self.write)
        self.assertIn('where operation_id=prep.result_operation_id',self.write)
        for key in ['extraction_operation_id','extraction_artifact_id','extraction_request_sha256','extraction_output_sha256','canonical_intent_sha256','full_receipt_sha256','artifact_stored_at','artifact_prepared_at']:
            self.assertIn(key,self.write)
        self.assertIn("result_intent->'previous_packet_sha256'='null'::jsonb and proof->'previous'is distinct from 'null'::jsonb",self.write)
        self.assertIn("proof#>>'{previous,packet_sha256}'is distinct from result_intent->>'previous_packet_sha256'",self.write)

    def test_actual_binary_original_and_derivation_document_not_HTML_or_text_offset_cast(self):
        for token in ["current_raw:=decode(result_frame#>>'{current,base64}','base64')","original_raw:=decode(current_frame->>'original_base64','base64')","derivation_raw:=decode(current_frame->>'derivation_base64','base64')","original_doc:=derivation->'document'","original_doc->>'content_sha256'is distinct from encode(sha256(original_raw),'hex')"]:self.assertIn(token,self.write)
        self.assertIn("proof#>>'{current,packet_sha256}'is distinct from result_intent->>'current_packet_sha256'",self.write)
        self.assertIn("proof#>>'{current,mapping_sha256}'is distinct from derivation->>'mapping_sha256'",self.write)
        self.assertNotIn('convert_from(original_raw',self.write)
        self.assertNotIn('original_utf8',self.write)

    def test_current_source_version_held_and_issue_metadata_join_real_generic_rows(self):
        self.assertIn('from terra_private.machine_candidate_decisions md join terra_private.update_runs r on r.id=md.run_id',self.write)
        self.assertIn('join terra_private.source_versions sv on sv.id=md.source_version_id',self.write)
        self.assertIn('where md.id=(i->>\'decision_id\')::uuid and r.id=p_run',self.write)
        for key in ['source_version_id','content_sha256','item_key','source_url','source_key','retrieved_at']:
            self.assertIn("original_doc->>'"+key+"'",self.write);self.assertIn("proof#>>'{current,"+key+"}'",self.write)
        for key in ['run_id','decision_id','source_version_id','content_sha256','locator','item_key','jurisdiction_id','decided_at']:self.assertIn("context#>>'{held,"+key+"}'",self.write)
        for key in ['issue_id','jurisdiction_id','jurisdiction_slug','issue_slug','created_at']:self.assertIn("context#>>'{issue,"+key+"}'",self.write)
        self.assertIn("payload#>>'{dependencyManifest,sourceVersionIds,0}'is distinct from decision.source_version_id::text",self.write)

    def test_original_live_work_surrounds_lock_head_generic_wait_replay_and_complete_pair(self):
        self.assertEqual(self.write.count(FENCE),6)
        self.assertTrue(ordered(self.write,[FENCE,'lock table '+SCHEMA+'.captures',FENCE,'select * into old']))
        replay=self.write[self.write.index(' if found then'):self.write.index(' if(select count(*)')]
        self.assertTrue(ordered(replay,['old.intent_raw is distinct from p_intent or old.report_raw is distinct from p_report','capture_receipt(old.capture_id)',FENCE,'return receipt;']))
        head=self.write[self.write.index(' select * into head'):]
        # FOUND must be tested before PERFORM can overwrite PL/pgSQL FOUND.
        self.assertTrue(ordered(head,['for update;','if not found or head.current_publication_id is not null or head.changed_at is not null',FENCE,'generic:=terra_private.capture_held_proposal',FENCE,'insert into '+SCHEMA+'.captures','capture_receipt((i->>',FENCE,'return receipt;']))
        self.assertNotIn('renew_',self.write);self.assertNotIn('claim_update_run',self.write)

    def test_standalone_existing_preparation_or_concurrent_generic_capture_is_never_adopted(self):
        self.assertTrue(ordered(self.write,['if exists(select 1 from terra_private.proposal_captures','standalone_or_preparation_conflict','select * into prep','generic:=terra_private.capture_held_proposal',"generic->>'status'is distinct from 'stored'",'concurrent_standalone','insert into '+SCHEMA+'.captures']))
        self.assertIn("or decision_id=(i->>'decision_id')::uuid",self.write)
        self.assertIn('where preparation_operation_id=(i->>\'preparation_operation_id\')::uuid',self.write)
        self.assertNotIn('on conflict',self.write.lower());self.assertNotIn('update '+SCHEMA+'.captures',self.write.lower())

    def test_exact_null_head_single_claim_proposed_state_and_no_publication_writes(self):
        self.assertIn("context#>'{issue,head}'is distinct from jsonb_build_object('publication_id',null,'content_sha256',null,'changed_at',null)",self.write)
        for path in ['{snapshot,claims}','{snapshot,claims,0,evidence}','{dependencyManifest,sourceVersionIds}']:
            self.assertIn("jsonb_typeof(payload#>'"+path+"')is distinct from 'array'",self.write)
            self.assertIn("jsonb_array_length(payload#>'"+path+"')<>1",self.write)
        self.assertIn("payload->>'kind'is distinct from 'review_only'",self.write)
        self.assertIn("payload->>'conflictCoverage'is distinct from 'not_recorded'",self.write)
        self.assertIn("('unreviewed','not_recorded')",self.write)
        for forbidden in ['activate_machine_publication','insert into terra_private.issue_publications','update terra_private.issue_heads','session_replication_role','grant execute']:
            self.assertNotIn(forbidden,self.sql.lower())

    def test_full_native_receipt_budget_precedes_any_insert_and_getter_rechecks_actual_bytes(self):
        self.assertTrue(ordered(self.write,['receipt:=jsonb_build_object(\'schema_version\',1,\'kind\',\'invented_pdf_initial_candidate_capture_stored\'','octet_length(receipt::text)+4096>131072','generic:=terra_private.capture_held_proposal','insert into '+SCHEMA+'.captures']))
        self.assertIn('octet_length(v::text)+29>131072',self.read)
        self.assertIn('octet_length(p_report)not between 2 and 262144',self.write)
        for key in ['captureId','runId','decisionId','issueId','basePublicationId','baseHeadChangedAt','baseContentSha256','proposalSha256','capturedAt','sourceReceipts']:self.assertIn("'"+key+"'",self.read)
        self.assertIn("r.stored_at>='10000-01-01Z'::timestamptz",self.read)
        self.assertIn("c.captured_at<(i->>'preparation_observed_at')::timestamptz",self.read)
        self.assertIn("not isfinite(c.captured_at) or not isfinite(r.stored_at)",self.read)
        self.assertIn("native_prep:=tf_pdf_result_rehearsal.preparation_receipt(r.preparation_operation_id)",self.read)
        self.assertNotIn("'observedAt',clock_timestamp()",self.read)

    def test_static_scope_mutations_detect_loss_of_required_budget_fences_getter_or_truncate_guard(self):
        self.assertTrue(static_contract(self.sql))
        mutations=[self.sql.replace('+4096>131072','+4096>262144'),self.sql.replace(FENCE,'',1),self.sql.replace('before truncate on '+SCHEMA+'.captures','after truncate on '+SCHEMA+'.captures'),self.sql.replace('native_result:=tf_pdf_result_rehearsal.result_receipt(source_result.operation_id);','native_result:=null;'),self.sql.replace('capture_for_work(p_run uuid','foreign_writer(p_run uuid')]
        for changed in mutations:self.assertNotEqual(changed,self.sql);self.assertFalse(static_contract(changed))

    def test_scope_itself_cannot_start_resources_or_claim_SQL_compilation(self):
        with patch('subprocess.Popen') as process,patch('subprocess.run') as run:
            tree=ast.parse(Path(__file__).read_text())
            names={name.name.split('.')[0] for node in ast.walk(tree) if isinstance(node,ast.Import) for name in node.names}
            self.assertFalse(names&{'psycopg','docker','requests'})
            self.assertEqual([node for node in ast.walk(tree) if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and isinstance(node.func.value,ast.Name) and node.func.value.id=='subprocess'],[])
            process.assert_not_called();run.assert_not_called()

if __name__=='__main__':unittest.main()
