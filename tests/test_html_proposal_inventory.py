"""Supplied historical metadata never becomes independent prewrite proof."""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import base64,json,unittest
from unittest.mock import patch
from tests.test_html_proposal_custody import prepared_proposal,STORED,LATER,OPERATION
from workers.html_proposal_custody import HtmlPreparationIntent
from workers.html_proposal_inventory import (prepare_html_proposal_inventory,parse_html_proposal_inventory,select_html_proposal,HtmlProposalInventoryError)

ARTIFACT='c1000000-0000-4000-8000-000000000001'
AT=LATER+timedelta(seconds=1)
READ=AT+timedelta(seconds=1)


def encode(value):return json.dumps(value,separators=(',',':')).encode()


def request():
    p=prepared_proposal()
    return prepare_html_proposal_inventory(p.receipt,p.extraction_expected,current_receipt=p.current_receipt,previous_receipt=p.previous_receipt,observed_at=LATER)


def candidate():
    p=prepared_proposal()
    return dict(operation_id=OPERATION,artifact_id=ARTIFACT,stored_at=STORED.isoformat(timespec='microseconds').replace('+00:00','Z'),metadata_base64=base64.b64encode(p.intent.canonical_metadata).decode())


def wire(selected,rows=None):
    return dict(schema_version=1,kind='invented_html_preparation_inventory',scope=json.loads(selected.canonical_scope),principal='postgres',session_principal='postgres',observed_at=AT.isoformat(timespec='microseconds').replace('+00:00','Z'),candidates=[candidate()] if rows is None else rows)


def parse(raw=None,selected=None):
    if selected is None:selected=request()
    if raw is None:raw=encode(wire(selected))
    return parse_html_proposal_inventory(raw,selected,observed_at=READ)


class HtmlProposalInventoryTests(unittest.TestCase):
    def test_fixed_owner_metadata_only_read_rechecks_all_three_original_result_receipts(self):
        selected=request();sql=selected.statement();scope=json.loads(selected.canonical_scope)
        self.assertIn('begin isolation level repeatable read read only;',sql);self.assertIn('limit 51',sql)
        self.assertIn('tf_html_preparation.preparations',sql);self.assertIn('tf_html_extraction.result_receipt(',sql)
        self.assertIn(scope['extraction_full_receipt_sha256'],sql)
        for private_column in ['p.payload_raw','p.selection_raw','p.provenance_raw','p.context_raw']:self.assertNotIn(private_column,sql)
        self.assertTrue(sql.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))
        for key in ['receipt','current_receipt','previous_receipt']:
            with self.assertRaises(HtmlProposalInventoryError):replace(selected,**{key:b'{}'}).statement()

    def test_historical_metadata_preserves_exact_intent_and_requires_explicit_independent_selection(self):
        observation=parse();row=observation.candidates[0];intent=prepared_proposal().intent
        self.assertEqual(row.intent.canonical_metadata,intent.canonical_metadata)
        self.assertEqual(observation.observed_at,AT);self.assertEqual(row.stored_at,STORED)
        self.assertEqual(row.evidence_state,'historical_html_metadata_not_full_parts_or_independent_intent')
        selected=select_html_proposal(observation,intent,operation_id=OPERATION,artifact_id=ARTIFACT,observed_at=READ)
        self.assertEqual(selected.intent,intent);self.assertEqual(selected.artifact_id,ARTIFACT);self.assertEqual(selected.stored_at,STORED)
        self.assertFalse(hasattr(selected,'parts'));self.assertFalse(hasattr(selected,'statement_result'))

    def test_witnessed_empty_list_is_distinct_from_unavailable_or_an_implicit_first_choice(self):
        selected=request();observation=parse(encode(wire(selected,[])),selected)
        self.assertEqual(observation.candidates,())
        with self.assertRaises(HtmlProposalInventoryError):select_html_proposal(observation,prepared_proposal().intent,operation_id=OPERATION,artifact_id=ARTIFACT,observed_at=READ)
        for raw in [None,b'{}',b'PRIVATE_CANARY']:
            with self.assertRaises(HtmlProposalInventoryError):parse_html_proposal_inventory(raw,selected,observed_at=READ)

    def test_foreign_scope_principal_unknown_boolean_duplicate_and_size_refuse_privately(self):
        selected=request();body=wire(selected)
        variants=[body|{'extra':True},body|{'schema_version':True},body|{'principal':'foreign'},body|{'session_principal':'foreign'}]
        changed=deepcopy(body);changed['scope']['extraction_request_sha256']='f'*64;variants.append(changed)
        raws=[encode(v) for v in variants]+[encode(body).replace(b'"schema_version":1',b'"schema_version":1,"schema_version":1',1),b'x'*98305,bytearray(encode(body))]
        for raw in raws:
            with self.assertRaises(HtmlProposalInventoryError) as error:parse(raw,selected)
            self.assertEqual(str(error.exception),'html_proposal_inventory_unavailable')

    def test_foreign_duplicate_out_of_order_or_noncanonical_candidate_withholds_all_rows(self):
        selected=request();first=candidate()
        for rows in [[first,first],[first|{'metadata_base64':first['metadata_base64']+'\n'}],[first|{'artifact_id':'bad'}],[first|{'extra':1}]]:
            with self.assertRaises(HtmlProposalInventoryError):parse(encode(wire(selected,rows)),selected)
        other=deepcopy(first);meta=json.loads(prepared_proposal().intent.canonical_metadata)
        meta['operation_id']='a1000000-0000-4000-8000-000000000002';other['operation_id']=meta['operation_id'];other['artifact_id']='c1000000-0000-4000-8000-000000000002'
        other['metadata_base64']=base64.b64encode(json.dumps(meta,sort_keys=True,separators=(',',':')).encode()).decode()
        self.assertEqual(len(parse(encode(wire(selected,[first,other])),selected).candidates),2)
        with self.assertRaises(HtmlProposalInventoryError):parse(encode(wire(selected,[other,first])),selected)

    def test_future_reversed_store_or_query_times_are_not_freshness(self):
        selected=request();body=wire(selected)
        for instant in [LATER-timedelta(microseconds=1),READ+timedelta(microseconds=1)]:
            with self.assertRaises(HtmlProposalInventoryError):parse(encode(body|{'observed_at':instant.isoformat(timespec='microseconds').replace('+00:00','Z')}),selected)
        for stored in [prepared_proposal().observed_at-timedelta(microseconds=1),AT+timedelta(microseconds=1)]:
            row=candidate();row['stored_at']=stored.isoformat(timespec='microseconds').replace('+00:00','Z')
            with self.assertRaises(HtmlProposalInventoryError):parse(encode(wire(selected,[row])),selected)

    def test_metadata_cannot_replace_a_different_independent_intent_or_artifact(self):
        observation=parse();intent=prepared_proposal().intent;meta=json.loads(intent.canonical_metadata);meta['payload_sha256']='f'*64
        changed=HtmlPreparationIntent(json.dumps(meta,sort_keys=True,separators=(',',':')).encode())
        for value,operation,artifact in [(None,OPERATION,ARTIFACT),(changed,OPERATION,ARTIFACT),(intent,'a1000000-0000-4000-8000-000000000009',ARTIFACT),(intent,OPERATION,'c1000000-0000-4000-8000-000000000009')]:
            with self.assertRaises(HtmlProposalInventoryError):select_html_proposal(observation,value,operation_id=operation,artifact_id=artifact,observed_at=READ)

    def test_mutated_prebuilt_observation_or_candidate_is_reparsed_and_withheld(self):
        observation=parse();intent=prepared_proposal().intent
        for changed in [replace(observation,full_receipt=b'{}'),replace(observation,candidates=()),replace(observation,observed_at=READ),
                replace(observation,candidates=(replace(observation.candidates[0],artifact_id='c1000000-0000-4000-8000-000000000009'),))]:
            with self.assertRaises(HtmlProposalInventoryError):select_html_proposal(changed,intent,operation_id=OPERATION,artifact_id=ARTIFACT,observed_at=READ)

    def test_limit_never_silently_truncates_and_no_io_is_started(self):
        selected=request()
        with patch('workers.html_proposal_inventory.MAX_CANDIDATES',0):
            with self.assertRaises(HtmlProposalInventoryError):parse(encode(wire(selected)),selected)
        with patch('subprocess.Popen',side_effect=AssertionError('no process')),patch('builtins.open',side_effect=AssertionError('no file')):
            observation=parse(encode(wire(selected)),selected)
            self.assertEqual(select_html_proposal(observation,prepared_proposal().intent,operation_id=OPERATION,artifact_id=ARTIFACT,observed_at=READ).artifact_id,ARTIFACT)


if __name__=='__main__':unittest.main()
