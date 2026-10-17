"""Resource-free SOURCE contract for an UNINSTALLED PDF association fixture.

These checks inspect bounded DDL/control-flow text. They neither parse SQL with
PostgreSQL nor qualify transactions, concurrency, privileges or PDF semantics.
Independent pre-execution review and fresh native evidence remain required.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SQL_PATH = ROOT / 'tests/fixtures/invented_pdf_appended_issue_capture.sql'


def function(source, name):
    match = re.search(r'create function tf_pdf_review\.' + re.escape(name) + r'\((.*?)\)\s*returns .*? as \$\$(.*?)\$\$;', source, re.S | re.I)
    if not match:
        raise AssertionError('fixed function unavailable: ' + name)
    return match.group(1), match.group(2), match.group(0)


def ordered(test, body, *needles):
    at = -1
    for needle in needles:
        found = body.find(needle, at + 1)
        test.assertGreater(found, at, 'missing/out-of-order fixed boundary: ' + needle)
        at = found


class PdfAppendedIssueSqlScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SQL_PATH.read_text(encoding='utf8')
        cls.write_args, cls.write, cls.write_full = function(cls.source, 'capture_issue')
        cls.read_args, cls.read, cls.read_full = function(cls.source, 'capture_receipt')
        cls.work_args, cls.work, cls.work_full = function(cls.source, 'capture_issue_for_work')

    def test_only_fixed_future_schema_table_and_four_functions(self):
        self.assertEqual(re.findall(r'create schema (\w+)', self.source), ['tf_pdf_review'])
        self.assertEqual(re.findall(r'create table ([\w.]+)', self.source), ['tf_pdf_review.captures'])
        self.assertEqual(re.findall(r'create function ([\w.]+)', self.source), [
            'tf_pdf_review.refuse_mutation', 'tf_pdf_review.capture_receipt',
            'tf_pdf_review.capture_issue', 'tf_pdf_review.capture_issue_for_work'])
        for forbidden in ('tf_html_', 'tf_feed_', 'create role', 'create extension', 'security definer', 'grant execute', 'grant select', 'commit;', 'execute format', 'dblink'):
            self.assertNotIn(forbidden, self.source.lower())

    def test_fixed_seven_and_distinct_ten_operands_match_pure_contract(self):
        self.assertEqual(self.write_args.split(','), [f'p_{key} bytea' for key in ('intent','report','base','canonical','context','proposal','composition')])
        self.assertEqual(self.work_args.split(',')[:3], ['p_run uuid','p_fingerprint text','p_claim uuid'])
        self.assertEqual(self.work_args.split(',')[3:], self.write_args.split(','))
        self.assertEqual(self.read_args, 'p_capture uuid')
        self.assertEqual(self.work.count('v:=tf_pdf_review.capture_issue('), 1)
        self.assertNotIn('terra_private.capture_held_proposal(', self.work)

    def test_owner_invoker_no_public_execution_and_rls(self):
        functions = re.findall(r'create function .*?\$\$;', self.source, re.S)
        self.assertEqual(len(functions), 4)
        for text in functions:
            self.assertIn('security invoker set search_path=pg_catalog', text)
        for body in (self.write, self.read, self.work):
            self.assertIn("current_user<>session_user or session_user<>'postgres'", body)
            self.assertIn("errcode='42501'", body)
        for name in ('refuse_mutation()', 'capture_receipt(uuid)', 'capture_issue(bytea,bytea,bytea,bytea,bytea,bytea,bytea)', 'capture_issue_for_work(uuid,text,uuid,bytea,bytea,bytea,bytea,bytea,bytea,bytea)'):
            self.assertIn('revoke all on function tf_pdf_review.' + name + 'from public;', self.source)
        self.assertIn('alter table tf_pdf_review.captures enable row level security;', self.source)
        self.assertIn('revoke all on schema tf_pdf_review from public;', self.source)
        self.assertNotIn('create policy', self.source)

    def test_non_cascading_indexed_foreign_keys_and_all_mutation_guards(self):
        self.assertIn('capture_id uuid primary key references terra_private.proposal_captures(id)', self.source)
        self.assertIn('preparation_operation_id uuid not null unique references tf_pdf_result_rehearsal.preparations(operation_id)', self.source)
        self.assertNotIn('cascade', self.source.lower())
        self.assertIn('before update or delete on tf_pdf_review.captures for each row', self.source)
        self.assertIn('before truncate on tf_pdf_review.captures for each statement', self.source)
        self.assertIn("errcode='55000',message='invented_pdf_appended_append_only'", self.source)
        self.assertIn('constraint pdf_appended_capture_chronology check(stored_at>=', self.source)

    def test_actual_raw_limits_and_six_byte_hashes(self):
        fields = {'intent_raw':4096,'candidate_report_raw':262144,'baseline_raw':24576,
                  'canonical_baseline_raw':24576,'context_raw':32768,'proposal_raw':16384,'composition_raw':65536}
        for field, cap in fields.items():
            self.assertRegex(self.source, rf'{field} bytea not null check\(octet_length\({field}\)between [12] and {cap}\)')
        self.assertIn('limits integer[]:=array[262144,24576,24576,32768,16384,65536]', self.write)
        self.assertIn('carriers bytea[]:=array[p_report,p_base,p_canonical,p_context,p_proposal,p_composition]', self.write)
        for index, field in enumerate(list(fields)[1:]):
            self.assertIn(f"sha256({field}),'hex')=convert_from(intent_raw,'UTF8')::jsonb#>>'{{part_sha256,{index}}}'", self.source)
        self.assertIn('encode(sha256(carriers[index+1])', self.write)

    def test_intent_closed_duplicate_aware_canonical_and_uuid_domains(self):
        expected = sorted('schema_version kind snapshot_intent capture_id run_id decision_id issue_id base_publication_id preparation_operation_id preparation_artifact_id preparation_intent_sha256 preparation_full_receipt_sha256 preparation_stored_at part_sha256 composition_observed_at'.split())
        match = re.search(r'json_object_keys\(intent_json\)k;\s*if keys is distinct from array\[(.*?)\]', self.write, re.S)
        self.assertEqual(re.findall(r"'([^']+)'", match.group(1)), expected)
        self.assertIn("intent_json->>'schema_version'is distinct from '1'", self.write)
        self.assertIn("['capture_id','run_id','decision_id','issue_id','base_publication_id','preparation_operation_id','preparation_artifact_id']", self.write)
        self.assertIn("['capture_id','run_id','decision_id','issue_id','base_publication_id']", self.write)
        self.assertIn('[1-8][a-f0-9]{3}', self.write)
        self.assertIn('[45][a-f0-9]{3}', self.write)
        self.assertIn('jsonb_each(i)', self.write)
        self.assertIn('order by k collate "C"', self.write)
        self.assertIn("convert_from(p_intent,'UTF8')is distinct from canonical_intent", self.write)

    def test_report_and_composition_keep_distinct_outer_six_and_stored_four(self):
        for kind in ('private_stored_pdf_preparation_review_report','invented_supplied_pdf_custody_only','invented_pdf_appended_issue_review','invented_supplied_full_pdf_receipts_only'):
            self.assertIn(kind, self.write)
        self.assertIn("jsonb_array_length(i->'part_sha256')<>6", self.write)
        self.assertIn("jsonb_array_length(composition->'candidate_part_sha256')<>4", self.write)
        self.assertIn("composition->'candidate_part_sha256'->>(index-1)is distinct from encode(sha256(part),'hex')", self.write)
        self.assertIn("part_keys text[]:=array['payload','selection','provenance','context']", self.write)
        self.assertIn("convert_to(r->'parts'->>(key||'_json'),'UTF8')is distinct from part", self.write)
        self.assertIn("r->'limits'is distinct from jsonb_build_object(", self.write)
        self.assertIn("'source_authenticated',false", self.write)
        self.assertIn("'publication_authorized',false", self.write)
        self.assertIn("'held_capture_observed',false", self.write)

    def test_complete_immutable_prep_result_getters_and_actual_original_links(self):
        for needle in ('tf_pdf_result_rehearsal.preparation_receipt(prep.operation_id)',
                       'tf_pdf_result_rehearsal.result_receipt(source_result.operation_id)',
                       "encode(sha256(convert_to(native_prep::text,'UTF8')),'hex')",
                       "encode(sha256(convert_to(native_result::text,'UTF8')),'hex')",
                       "decode(result_frame#>>'{current,base64}','base64')",
                       "decode(current_frame->>'original_base64','base64')",
                       "decode(current_frame->>'derivation_base64','base64')",
                       "encode(sha256(original_raw),'hex')", "derivation->'document'",
                       "proof#>>'{previous,packet_sha256}'is distinct from result_intent->>'previous_packet_sha256'"):
            self.assertIn(needle, self.write)
        self.assertIn("prep.stored_at>(i->>'composition_observed_at')::timestamptz", self.write)
        self.assertIn("source_result.stored_at>(metadata->>'prepared_at')::timestamptz", self.write)
        self.assertIn("prep.stored_at<(metadata->>'prepared_at')::timestamptz", self.write)

    def test_actual_current_source_held_run_and_issue_not_baseline_substitution(self):
        for field in ('source_version_id','content_sha256','source_url','source_key','item_key','retrieved_at','language_code'):
            self.assertIn("proof#>>'{current," + field + "}'", self.write)
        for needle in ("where md.id=(i->>'decision_id')::uuid and r.id=(i->>'run_id')::uuid",
                       "decision.disposition<>'held'", "context#>>'{held,locator}'is distinct from decision.evidence_locator",
                       "payload#>>'{snapshot,claims,0,evidence,0,sourceVersionId}'is distinct from decision.source_version_id::text",
                       "target.jurisdiction_id is distinct from decision.jurisdiction_id",
                       "context#>>'{issue,issue_id}'is distinct from target.id::text"):
            self.assertIn(needle, self.write)
        self.assertNotIn('tf_pdf_initial_candidate.', self.source)

    def test_exact_native_nonempty_base_and_full_old_claim_manifest_preservation(self):
        ordered(self, self.write, 'select * into head from terra_private.issue_heads',
                'head.current_publication_id is null', 'select * into publication',
                "terra_private.proposal_base_json(publication)is distinct from convert_from(p_base,'UTF8')")
        self.assertIn("convert_from(p_canonical,'UTF8')::jsonb is distinct from base", self.write)
        self.assertIn("(base#>'{snapshot,claims}')||(payload#>'{snapshot,claims}')", self.write)
        self.assertIn("'snapshot',(base->'snapshot')||jsonb_build_object", self.write)
        self.assertIn("(base#>'{dependencyManifest,sourceVersionIds}')||case when", self.write)
        self.assertIn("proposed is distinct from jsonb_build_object('schemaVersion',1,'kind','review_only'", self.write)
        self.assertIn("whole_context->'baseline'is distinct from jsonb_build_object", self.write)
        self.assertIn("jsonb_array_length(base#>'{snapshot,claims}')not between 1 and 29", self.write)

    def test_exact_replay_and_no_standalone_or_used_preparation_adoption(self):
        ordered(self, self.write, 'lock table tf_pdf_review.captures in share row exclusive mode',
                'select * into old from tf_pdf_review.captures', 'return tf_pdf_review.capture_receipt(old.capture_id)',
                'invented_pdf_appended_standalone_refused', 'invented_pdf_appended_preparation_already_used',
                'select * into prep from tf_pdf_result_rehearsal.preparations',
                'select * into head from terra_private.issue_heads')
        replay = self.write[self.write.index('if found then'):self.write.index('return tf_pdf_review.capture_receipt(old.capture_id)')]
        for key in ('intent_raw','candidate_report_raw','baseline_raw','canonical_baseline_raw','context_raw','proposal_raw','composition_raw'):
            self.assertIn('old.' + key + ' is distinct from p_', replay)
        ordered(self, self.write, 'generic:=terra_private.capture_held_proposal(',
                "generic->>'status'is distinct from 'stored'", 'invented_pdf_appended_concurrent_standalone_refused',
                'insert into tf_pdf_review.captures(', 'receipt:=tf_pdf_review.capture_receipt(')
        self.assertEqual(self.write.count('insert into '), 1)

    def test_full_dependency_native_receipt_budget_precedes_either_write(self):
        ordered(self, self.write, "dependencies:=proposed#>'{dependencyManifest,sourceVersionIds}'",
                'into native_sources,source_count from terra_private.source_versions',
                'source_count<>jsonb_array_length(dependencies)',
                "receipt:=jsonb_build_object('schema_version',1", 'octet_length(receipt::text)+4096>131072',
                'generic:=terra_private.capture_held_proposal(', 'insert into tf_pdf_review.captures(')
        self.assertIn("jsonb_array_length(dependencies)not between 1 and 120", self.write)
        self.assertIn("'sourceReceipts',native_sources", self.write)
        for part in ('p_report','p_base','p_canonical','p_context','p_proposal','p_composition','p_intent'):
            self.assertIn("encode(" + part + ",'base64')", self.write)
        self.assertIn('octet_length(v::text)+29>131072', self.read)
        self.assertIn("receipt#>'{capture,sourceReceipts}'is distinct from native_sources", self.write)

    def test_work_fences_bracket_every_wait_and_complete_atomic_call(self):
        assertion = 'perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);'
        self.assertEqual(self.work.count(assertion), 4)
        ordered(self, self.work, assertion, 'lock table tf_pdf_review.captures in share row exclusive mode', assertion,
                'select * into head from terra_private.issue_heads', 'for update;', assertion,
                'v:=tf_pdf_review.capture_issue(', assertion, 'return v;')
        self.assertNotIn('head.current_publication_id is null', self.work)
        for body in (self.write, self.work):
            self.assertIn("current_setting('transaction_read_only')='on'", body)
            self.assertIn("current_setting('transaction_isolation')<>'read committed'", body)
        self.assertNotIn('extend', self.work)
        self.assertNotIn('renew', self.work)

    def test_read_is_complete_historical_receipt_without_fresh_head_work_claim(self):
        for field in ('schema_version','kind','capture_id','preparation_operation_id','stored_at','intent_base64','parts_base64','capture'):
            self.assertIn("'" + field + "'", self.read)
        for field in ('captureId','runId','decisionId','issueId','basePublicationId','baseHeadChangedAt','baseContentSha256','proposalSha256','capturedAt','sourceReceipts'):
            self.assertIn("'" + field + "'", self.read)
        self.assertNotIn('issue_heads', self.read)
        self.assertNotIn('assert_update_run_work', self.read)
        self.assertIn("c.captured_at<(i->>'composition_observed_at')::timestamptz", self.read)
        self.assertIn('c.captured_at>r.stored_at', self.read)
        self.assertIn('r.stored_at>clock_timestamp()', self.read)
        self.assertIn("c.proposal_json is distinct from convert_from(r.proposal_raw,'UTF8')", self.read)
        self.assertNotIn('insert into', self.read)
        self.assertNotIn('update ', self.read)


if __name__ == '__main__':
    unittest.main()
