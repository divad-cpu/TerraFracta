"""Synthetic protocol receipts; actual native transaction proof is separate."""
import base64,json,unittest
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from tests.test_html_proposal_custody import prepared_proposal,STORED,LATER
from workers.html_proposal_postgres import (prepare_html_proposal_store,parse_stored_html_proposal,
    prepare_html_preparation_reopen,reopen_stored_html_proposal,HtmlProposalPostgresError)

ARTIFACT='b1000000-0000-4000-8000-000000000001'


def request():return prepare_html_proposal_store(prepared_proposal())


def wire(expected):
    p=expected.prepared
    return dict(schema_version=1,kind='invented_html_preparation_stored',operation_id=json.loads(p.intent.canonical_metadata)['operation_id'],artifact_id=ARTIFACT,
        stored_at=STORED.isoformat(timespec='microseconds').replace('+00:00','Z'),
        **{key:base64.b64encode(raw).decode() for key,raw in zip(('metadata_base64','payload_base64','selection_base64','provenance_base64','context_base64'),
            (p.intent.canonical_metadata,p.parts.payload_raw,p.parts.selection_raw,p.parts.provenance_raw,p.parts.context_raw))})


def encode(value):return json.dumps(value,separators=(',',':')).encode()


def cold(expected):return prepare_html_preparation_reopen(intent=expected.prepared.intent,artifact_id=ARTIFACT,stored_at=STORED,observed_at=LATER)


def reopen(raw,selected,expected=None,**changes):
    if expected is None:expected=request()
    p=expected.prepared
    values=dict(extraction_receipt=p.receipt,extraction_expected=p.extraction_expected,current_receipt=p.current_receipt,previous_receipt=p.previous_receipt,observed_at=LATER)
    values.update(changes)
    return reopen_stored_html_proposal(raw,selected,**values)


class HtmlProposalPostgresTests(unittest.TestCase):
    def test_fixed_bytea_operands_and_precommit_rechecks_preserve_all_five_exact_parts(self):
        selected=request();sql=selected.statement();p=selected.prepared
        self.assertIn('begin isolation level read committed read write;',sql);self.assertIn('tf_html_preparation.store_preparation(',sql)
        self.assertEqual(sql.count('decode('),5)
        for value in [p.intent.canonical_metadata,p.parts.payload_raw,p.parts.selection_raw,p.parts.provenance_raw,p.parts.context_raw]:self.assertIn(base64.b64encode(value).decode(),sql)
        self.assertTrue(sql.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'));self.assertLess(len(sql.encode()),294912)
        with self.assertRaises(HtmlProposalPostgresError):replace(selected,prepared=replace(p,receipt=b'{}')).statement()

    def test_whole_warm_receipt_and_independent_cold_identity_keep_original_context(self):
        selected=request();raw=encode(wire(selected));stored=parse_stored_html_proposal(raw,selected,observed_at=LATER)
        self.assertEqual(stored.artifact_id,ARTIFACT);self.assertEqual(stored.stored_at,STORED)
        expect=cold(selected);self.assertFalse(hasattr(expect,'parts'))
        self.assertIn('begin isolation level repeatable read read only;',expect.statement())
        result=reopen(raw,expect,selected)
        self.assertEqual(result.result.parts,selected.prepared.parts);self.assertEqual(result.result.prepared_at,selected.prepared.observed_at)
        self.assertEqual(result.result.observed_at,LATER);self.assertEqual(result.full_receipt,raw)
        self.assertEqual(result.evidence_state,'invented_html_reopened_preparation_not_current_qualification_or_capture')

    def test_metadata_and_every_part_are_exact_canonical_base64_not_hash_only(self):
        selected=request();body=wire(selected)
        for key in ['metadata_base64','payload_base64','selection_base64','provenance_base64','context_base64']:
            for value in [base64.b64encode(b'{}').decode(),body[key]+'\n',False]:
                changed=body|{key:value}
                with self.subTest(key=key),self.assertRaises(HtmlProposalPostgresError):reopen(encode(changed),cold(selected),selected)

    def test_unknown_duplicate_boolean_truncated_and_oversized_receipts_fail_privately(self):
        selected=request();body=wire(selected);raw=encode(body)
        candidates=[encode(body|{'extra':True}),encode(body|{'schema_version':True}),raw.replace(b'"schema_version":1',b'"schema_version":1,"schema_version":1'),
            bytearray(raw),b'PRIVATE_CANARY /home/private',b'x'*131073,raw[:-1]]
        for candidate in candidates:
            with self.assertRaises(HtmlProposalPostgresError) as error:reopen(candidate,cold(selected),selected)
            self.assertEqual(str(error.exception),'html_proposal_reopened_result_unavailable')

    def test_another_artifact_store_time_or_intent_cannot_be_selected_as_the_expected_preparation(self):
        selected=request();expect=cold(selected);raw=encode(wire(selected))
        for altered in [replace(expect,artifact_id='b1000000-0000-4000-8000-000000000002'),replace(expect,stored_at=STORED+timedelta(microseconds=1)),
                replace(expect,intent=replace(expect.intent,canonical_metadata=b'{}'))]:
            with self.assertRaises(HtmlProposalPostgresError):reopen(raw,altered,selected)
        with self.assertRaises(HtmlProposalPostgresError):reopen(raw,replace(expect,observed_at=LATER+timedelta(seconds=1)),selected)

    def test_all_three_fresh_extraction_and_original_receipts_are_still_required(self):
        selected=request();raw=encode(wire(selected));expect=cold(selected)
        for key in ['extraction_receipt','current_receipt','previous_receipt']:
            for value in [None,b'{}',b'PRIVATE_CANARY']:
                with self.subTest(key=key),self.assertRaises(HtmlProposalPostgresError):reopen(raw,expect,selected,**{key:value})

    def test_store_and_read_times_are_independent_not_renewed_preparation(self):
        selected=request();raw=encode(wire(selected));p=selected.prepared
        with self.assertRaises(HtmlProposalPostgresError):parse_stored_html_proposal(raw,selected,observed_at=p.observed_at)
        for stored,observed in [(p.observed_at-timedelta(microseconds=1),LATER),(STORED,STORED-timedelta(microseconds=1))]:
            with self.assertRaises(HtmlProposalPostgresError):prepare_html_preparation_reopen(intent=p.intent,artifact_id=ARTIFACT,stored_at=stored,observed_at=observed)
        result=reopen(raw,cold(selected),selected)
        self.assertEqual(result.result.parts.provenance_raw,p.parts.provenance_raw)
        self.assertEqual(json.loads(result.result.parts.provenance_raw)['evidence_state'],'unverified_not_captured_no_durable_association')

    def test_complete_receipt_and_input_budgets_refuse_before_a_statement_is_returned(self):
        p=prepared_proposal()
        with patch('workers.html_proposal_postgres.MAX_CAPTURE_OUTPUT',100):
            with self.assertRaises(HtmlProposalPostgresError):prepare_html_proposal_store(p)
        with patch('workers.html_proposal_postgres.MAX_CAPTURE_STATEMENT',100):
            with self.assertRaises(HtmlProposalPostgresError):prepare_html_proposal_store(p)

    def test_separate_uninstalled_fixture_preserves_owner_only_fk_and_append_only_byte_contract(self):
        sql=(Path(__file__).resolve().parent/'fixtures/invented_html_preparation.sql').read_text()
        self.assertEqual(sql.count('create table '),1);self.assertEqual(sql.count('create function '),3)
        self.assertIn('references tf_html_extraction.results(operation_id)',sql);self.assertIn('metadata bytea not null',sql)
        self.assertIn('from json_object_keys(metadata_json)',sql);self.assertIn('old.metadata is distinct from p_metadata',sql)
        self.assertIn('language plpgsql volatile security invoker',sql);self.assertIn('enable row level security',sql)
        self.assertNotIn('create role ',sql);self.assertNotIn('tf_detached_proposal.',sql);self.assertNotIn('tf_private_extraction.',sql)


if __name__=='__main__':unittest.main()
