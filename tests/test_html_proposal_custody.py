"""Pure synthetic full receipts; no durable HTML preparation is claimed."""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json,unittest
from unittest.mock import patch
from tests.test_html_extraction_custody import prepared,wire,encoded,cold
from tests.test_html_extraction_held_proposal import context,AT,UID
from workers.html_extraction_held_proposal import prepare_html_extraction_held_proposal
from workers.detached_proposal_custody import DetachedProposalParts,DetachedPreparationIntent,PART_LIMITS,part_bytes
from workers.html_proposal_custody import (HtmlPreparationIntent,PreparedHtmlProposal,ReobservedHtmlProposal,
    prepare_html_proposal_custody,recheck_prepared_html_proposal,reobserve_html_proposal,intent_metadata,HtmlProposalCustodyError)
from workers.feed_postgres_contract import _time

OPERATION='a1000000-0000-4000-8000-000000000001'
STORED=AT+timedelta(seconds=1)
LATER=AT+timedelta(days=2)


def inputs():
    selected=prepared()
    return dict(receipt=encoded(wire(selected)),extraction_expected=cold(selected),context_raw=json.dumps(context(selected),indent=2).encode()+b'\n',
        current_receipt=selected.result.current_receipt,previous_receipt=selected.result.previous_receipt,operation_id=OPERATION,observed_at=AT)


def prepared_proposal(**changes):return prepare_html_proposal_custody(**(inputs()|changes))


def reseal(parts,intent,**changes):
    value=json.loads(intent.canonical_metadata)
    for key,raw in zip(('payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256'),part_bytes(parts)):value[key]=sha256(raw).hexdigest()
    value.update(changes)
    return HtmlPreparationIntent(encoded_canonical(value))


def encoded_canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


class HtmlProposalCustodyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.original=prepared_proposal()

    def reobserve(self,parts=None,intent=None,**changes):
        initial=self.original
        values=dict(receipt=initial.receipt,extraction_expected=initial.extraction_expected,parts=initial.parts if parts is None else parts,
            intent=initial.intent if intent is None else intent,current_receipt=initial.current_receipt,previous_receipt=initial.previous_receipt,
            stored_at=STORED,observed_at=LATER)
        values.update(changes);return reobserve_html_proposal(**values)

    def refuse(self,parts=None,intent=None,**changes):
        with self.assertRaisesRegex(HtmlProposalCustodyError,'^html_proposal_reobservation_unavailable$') as error:self.reobserve(parts,intent,**changes)
        self.assertIsNone(error.exception.__cause__)

    def test_exact_typed_intent_four_parts_and_original_context_are_deterministic(self):
        p=self.original;self.assertIs(type(p),PreparedHtmlProposal);self.assertIs(type(p.intent),HtmlPreparationIntent);self.assertIs(type(p.parts),DetachedProposalParts)
        self.assertEqual(p,prepared_proposal());self.assertEqual(p,recheck_prepared_html_proposal(p))
        metadata=intent_metadata(p.intent);proof=json.loads(p.parts.provenance_raw)
        self.assertEqual(metadata['kind'],'invented_detached_html_proposal_preparation');self.assertEqual(metadata['operation_id'],OPERATION)
        for key,raw in zip(('payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256'),part_bytes(p.parts)):self.assertEqual(metadata[key],sha256(raw).hexdigest())
        self.assertEqual(metadata['prepared_at'],proof['prepared_at']);self.assertEqual(metadata['extraction_artifact_id'],proof['artifact']['artifact_id'])
        self.assertEqual(p.parts.context_raw,inputs()['context_raw']);self.assertNotEqual(p.parts.context_raw,encoded_canonical(json.loads(p.parts.context_raw)))
        self.assertEqual(p.evidence_state,'invented_html_preparation_only_not_stored_or_captured');self.assertNotIn('invented source statement',repr(p))
        self.assertFalse(hasattr(p,'statement'));self.assertFalse(hasattr(p,'extraction'))

    def test_closed_canonical_intent_requires_new_type_exact_bytes_fields_and_utc(self):
        raw=self.original.intent.canonical_metadata;value=json.loads(raw)
        for mutate in [lambda v:v.update(schema_version=True),lambda v:v.update(extra='PRIVATE_CANARY'),lambda v:v.update(operation_id=42),
                lambda v:v.update(extraction_request_sha256='x'*64),lambda v:v.update(prepared_at='0000-01-01T00:00:00.000000Z')]:
            changed=deepcopy(value);mutate(changed);self.refuse(intent=HtmlPreparationIntent(encoded_canonical(changed)))
        for candidate in [HtmlPreparationIntent(raw+b' '),HtmlPreparationIntent(b'{"schema_version":1,"schema_version":1}'),HtmlPreparationIntent(bytearray(raw)),
                HtmlPreparationIntent(b'x'*4097),DetachedPreparationIntent(raw),None]:
            with self.subTest(type=type(candidate).__name__):
                with self.assertRaises(ValueError):intent_metadata(candidate)

    def test_mutated_part_bytes_types_and_shared_limits_refuse_whole_reobservation(self):
        class Hostile(bytes):
            def __len__(self):raise AssertionError('hostile hook must not execute')
            def decode(self,*args,**kwargs):raise AssertionError('hostile hook must not execute')
            def __eq__(self,other):raise AssertionError('hostile hook must not execute')
        for field,limit in zip(('payload_raw','selection_raw','provenance_raw','context_raw'),PART_LIMITS):
            for value in [b'{}',b'x'*(limit+1),bytearray(b'{}'),Hostile(b'{}')]:
                with self.subTest(field=field,type=type(value).__name__):self.refuse(replace(self.original.parts,**{field:value}))
        self.refuse(parts={})

    def test_recheck_rederives_originals_output_and_refuses_any_prebuilt_shadow(self):
        p=self.original
        candidates=[None,replace(p,intent=HtmlPreparationIntent(b'{}')),replace(p,evidence_state='approved'),replace(p,observed_at=AT-timedelta(seconds=5)),
            replace(p,receipt=b'{}'),replace(p,current_receipt=b'{}'),replace(p,previous_receipt=b'{}'),replace(p,extraction_expected=replace(p.extraction_expected,canonical_metadata=b'{}'))]
        candidates.extend(replace(p,parts=replace(p.parts,**{field:b'{}'})) for field in ('payload_raw','selection_raw','provenance_raw','context_raw'))
        for candidate in candidates:
            with self.subTest(type=type(candidate).__name__),self.assertRaisesRegex(HtmlProposalCustodyError,'^html_proposal_preparation_unavailable$'):recheck_prepared_html_proposal(candidate)

    def test_later_full_rederivation_changes_only_two_observations_and_retains_historical_bytes(self):
        p=self.original
        fresh=prepare_html_extraction_held_proposal(p.receipt,p.extraction_expected,p.parts.context_raw,current_receipt=p.current_receipt,previous_receipt=p.previous_receipt,observed_at=LATER)
        old=json.loads(p.parts.provenance_raw);now=json.loads(fresh.provenance_raw)
        self.assertEqual({key for key in old if old[key]!=now[key]},{'prepared_at','artifact_observed_at'})
        value=self.reobserve();self.assertIs(type(value),ReobservedHtmlProposal);self.assertIs(value.parts,p.parts);self.assertIs(value.intent,p.intent)
        self.assertEqual(value.prepared_at,AT);self.assertEqual(value.historical_artifact_observed_at,AT);self.assertEqual(value.stored_at,STORED);self.assertEqual(value.observed_at,LATER)
        self.assertEqual(value.evidence_state,'invented_html_historical_preparation_not_current_qualification_or_capture')
        self.assertEqual(value.parts.provenance_raw,p.parts.provenance_raw);self.assertFalse(hasattr(value,'statement'))

    def test_canonical_equivalent_context_cannot_replace_original_spelling_even_with_new_part_hash(self):
        changed=replace(self.original.parts,context_raw=encoded_canonical(json.loads(self.original.parts.context_raw)))
        self.refuse(changed);self.refuse(changed,reseal(changed,self.original.intent))

    def test_changed_stable_provenance_and_boolean_alias_cannot_be_resealed(self):
        for key,value in [('schema_version',True),('source_date_text','PRIVATE_CANARY changed date'),('evidence_state','approved')]:
            proof=json.loads(self.original.parts.provenance_raw);proof[key]=value
            changed=replace(self.original.parts,provenance_raw=encoded_canonical(proof))
            self.refuse(changed,reseal(changed,self.original.intent))

    def test_historical_preparation_storage_observation_order_and_non_utc_hold(self):
        for value in [None,STORED.replace(tzinfo=None),AT-timedelta(microseconds=1),LATER+timedelta(microseconds=1)]:
            with self.subTest(stored_at=value):self.refuse(stored_at=value)
        for value in [None,LATER.replace(tzinfo=None),STORED-timedelta(microseconds=1)]:
            with self.subTest(observed_at=value):self.refuse(observed_at=value)
        proof=json.loads(self.original.parts.provenance_raw);proof['artifact_observed_at']=_time(AT+timedelta(microseconds=1))
        changed=replace(self.original.parts,provenance_raw=encoded_canonical(proof));self.refuse(changed,reseal(changed,self.original.intent))

    def test_context_future_at_original_preparation_cannot_be_laundered_by_fresh_observation(self):
        p=self.original
        for section,key in [('held','decided_at'),('issue','observed_at'),('content','last_evidence_review_on')]:
            ctx=json.loads(p.parts.context_raw)
            if section=='content':ctx[section][key]=(AT+timedelta(days=1)).date().isoformat()
            else:
                ctx[section][key]=_time(AT+timedelta(seconds=3))
                if section=='held':ctx['issue']['observed_at']=_time(AT+timedelta(seconds=4))
            raw=encoded(ctx)
            fresh=prepare_html_extraction_held_proposal(p.receipt,p.extraction_expected,raw,current_receipt=p.current_receipt,previous_receipt=p.previous_receipt,observed_at=LATER)
            proof=json.loads(fresh.provenance_raw);proof['prepared_at']=_time(AT);proof['artifact_observed_at']=_time(AT)
            changed=DetachedProposalParts(fresh.payload_raw,fresh.selection_raw,encoded_canonical(proof),raw)
            with self.subTest(section=section):self.refuse(changed,reseal(changed,p.intent))

    def test_full_receipts_and_independent_expectation_are_required_even_for_historical_parts(self):
        for field in ('receipt','current_receipt','previous_receipt'):
            for value in [None,b'{}',bytearray(b'{}'),self.original.parts.provenance_raw]:
                with self.subTest(field=field):self.refuse(**{field:value})
        for value in [None,replace(self.original.extraction_expected,artifact_id=UID(99)),replace(self.original.extraction_expected,canonical_metadata=b'{}')]:self.refuse(extraction_expected=value)

    def test_independent_extraction_identity_in_intent_must_match_regenerated_full_proof(self):
        for key,value in [('extraction_operation_id',UID(90)),('extraction_artifact_id',UID(91)),('extraction_request_sha256','f'*64),('extraction_output_sha256','e'*64)]:
            metadata=json.loads(self.original.intent.canonical_metadata);metadata[key]=value
            with self.subTest(key=key):self.refuse(intent=HtmlPreparationIntent(encoded_canonical(metadata)))

    def test_invalid_prepare_scope_and_immutable_historical_parts_never_dispatch_io(self):
        for changes in [dict(operation_id='invalid'),dict(observed_at=AT.replace(tzinfo=None)),dict(context_raw=bytearray(inputs()['context_raw'])),dict(receipt=b'{}')]:
            with self.assertRaisesRegex(HtmlProposalCustodyError,'^html_proposal_preparation_unavailable$'):prepared_proposal(**changes)
        with patch('subprocess.Popen',side_effect=AssertionError('no transport')),patch('builtins.open',side_effect=AssertionError('no file')):
            self.assertEqual(prepared_proposal(),self.original);value=self.reobserve()
        self.assertEqual(value.parts,self.original.parts);self.assertEqual(value.intent,self.original.intent)


if __name__=='__main__':unittest.main()
