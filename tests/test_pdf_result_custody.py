"""Small PDF custody contracts and uninstalled SQL scope; no database/process SQL."""
import base64
from contextlib import contextmanager
from dataclasses import replace
from datetime import timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch

from tests.test_pdf_result_packet import supplied, output, expected, capture, OPERATION, CallbackUtc
from workers.pdf_extraction_request import compile_pdf_extraction_request
from workers.pdf_result_packet import prepare_pdf_result_packet, MAX_RESULT_PACKET_BYTES
from workers.pdf_passage_binding import _stamp
from workers.passage_extraction_request import _canonical
import workers.pdf_result_custody as m

ARTIFACT='40000000-0000-4000-8000-000000000001'


def receipt(prepared, *, stored_at=None):
    intent=prepared.canonical_intent; packet=prepared.raw
    return dict(schema_version=1, kind='invented_pdf_result_stored', operation_id=prepared.operation_id,
        artifact_id=ARTIFACT, stored_at=_stamp(prepared.observed_at if stored_at is None else stored_at),
        intent_base64=base64.b64encode(intent).decode(), packet_base64=base64.b64encode(packet).decode(),
        intent_sha256=sha256(intent).hexdigest(), packet_sha256=sha256(packet).hexdigest(),
        intent_bytes=len(intent), packet_bytes=len(packet))


class PdfResultCustodyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import workers.pdf_text_inspection as inspector
        now, before, request=supplied(); cls.prepared_at=now.expected.recorded_observed_at+timedelta(seconds=1)
        cls.at=cls.prepared_at+timedelta(seconds=1);cls.later=cls.at+timedelta(days=1)
        cls.packet=prepare_pdf_result_packet(now,before,request=request,output_raw=output(now),
            operation_id=OPERATION,prepared_at=cls.prepared_at)
        assertion=expected(cls.packet,now,before,request)
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            child=launch(*args,**kwargs);children.append(child);return child
        with patch.object(inspector.subprocess,'Popen',side_effect=start), \
                patch.object(m,'reopen_pdf_result_packet',wraps=m.reopen_pdf_result_packet)as core:
            cls.prepared=m.prepare_pdf_result_custody(cls.packet.raw,assertion,observed_at=cls.at)
        cls.preparation_children=children;cls.preparation_core_calls=core.call_count

    def assertion(self):
        now,before,request=supplied();return expected(self.packet,now,before,request)

    @contextmanager
    def actual(self):
        import workers.pdf_text_inspection as inspector
        launch=inspector.subprocess.Popen;children=[]
        def start(*args,**kwargs):
            child=launch(*args,**kwargs);children.append(child);return child
        with patch.object(inspector.subprocess,'Popen',side_effect=start), \
                patch.object(m,'reopen_pdf_result_packet',wraps=m.reopen_pdf_result_packet)as core:
            try:yield children,core
            finally:
                for child in children:
                    self.assertIsNotNone(child.poll())
                    self.assertTrue(all(getattr(child,n).closed for n in('stdin','stdout','stderr')))

    def reopen(self, *, value=None, assertion=None, intent=None, at=None):
        raw=_canonical(receipt(self.prepared)if value is None else value)
        return m.reopen_pdf_result_custody(raw,self.assertion()if assertion is None else assertion,
            intent_raw=self.prepared.canonical_intent if intent is None else intent,
            observed_at=self.later if at is None else at)

    def before_child(self,action):
        with patch.object(m,'reopen_pdf_result_packet',side_effect=AssertionError('No rederivation'))as core:
            with self.assertRaisesRegex(m.PdfResultCustodyError,'^pdf_result_custody_unavailable$')as caught:action()
            core.assert_not_called()
        self.assertIsNone(caught.exception.__cause__)

    def test_actual_prepare_one_reopen_per_original_and_fixed_private_statement(self):
        self.assertEqual(self.preparation_core_calls,1);self.assertEqual(len(self.preparation_children),2)
        self.assertTrue(all(p.poll()is not None and all(getattr(p,n).closed for n in('stdin','stdout','stderr'))for p in self.preparation_children))
        self.assertIs(type(self.prepared.statement),str)
        self.assertIn('begin isolation level read committed read write;',self.prepared.statement)
        self.assertIn('select tf_pdf_result_rehearsal.store_result(decode(',self.prepared.statement)
        self.assertTrue(self.prepared.statement.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))
        self.assertLessEqual(len(self.prepared.statement.encode()),m.MAX_CAPTURE_STATEMENT)
        intent=json.loads(self.prepared.canonical_intent)
        self.assertEqual(intent['packet_sha256'],self.packet.packet_sha256)
        self.assertEqual(intent['prepared_at'],_stamp(self.prepared_at))
        self.assertEqual(intent['request_sha256'],self.packet.context.request.request_sha256)
        self.assertEqual(intent['previous_packet_sha256'],self.packet.context.previous_packet_sha256)
        self.assertEqual(self.prepared.result.context,self.prepared.context)
        self.assertEqual(self.prepared.result.proposal.review_state,'unverified')
        for hidden in('CLI_CURRENT_SELECTED','example.invalid','base64','proposed_assertion'):
            self.assertNotIn(hidden,repr(self.prepared))

    def test_complete_synthetic_receipt_reopens_actual_pdf_once_per_original(self):
        with self.actual()as(children,core):result=self.reopen()
        self.assertEqual(len(children),2);self.assertEqual(core.call_count,1)
        self.assertEqual(result.operation_id,OPERATION);self.assertEqual(result.artifact_id,ARTIFACT)
        self.assertEqual(result.stored_at,self.at);self.assertEqual(result.observed_at,self.later)
        self.assertEqual(result.raw,self.packet.raw);self.assertEqual(result.canonical_intent,self.prepared.canonical_intent)
        self.assertEqual(result.context.request,self.packet.context.request)
        self.assertEqual(result.result.proposal.review_state,'unverified')
        self.assertIn('not_authenticated',result.evidence_state)
        for hidden in('CLI_CURRENT_SELECTED','CLI_PRIOR_SELECTED','example.invalid','proposed_assertion'):
            self.assertNotIn(hidden,repr(result))

    def test_explicit_first_observation_intent_has_no_manufactured_prior(self):
        now,_,_=supplied();recorded=now.expected.recorded_observed_at
        request=compile_pdf_extraction_request(capture(now),observed_at=recorded,maximum_output_tokens=100)
        packet=prepare_pdf_result_packet(now,None,request=request,output_raw=output(now),operation_id=OPERATION,prepared_at=recorded)
        assertion=expected(packet,now,None,request)
        with self.actual()as(children,core):prepared=m.prepare_pdf_result_custody(packet.raw,assertion,observed_at=recorded)
        self.assertEqual(len(children),1);self.assertEqual(core.call_count,1)
        self.assertIsNone(json.loads(prepared.canonical_intent)['previous_packet_sha256'])
        with self.actual()as(children,core):
            result=m.reopen_pdf_result_custody(_canonical(receipt(prepared)),assertion,
                intent_raw=prepared.canonical_intent,observed_at=recorded)
        self.assertEqual(len(children),1);self.assertEqual(core.call_count,1);self.assertIsNone(result.context.previous)

    def test_portable_larger_packet_refuses_smaller_port_before_clock_or_child(self):
        assertion=self.assertion();clock=CallbackUtc(lambda:None)
        for raw in(b'',b'x'*(m.MAX_CUSTODY_PACKET_BYTES+1),bytearray(self.packet.raw)):
            self.before_child(lambda:m.prepare_pdf_result_custody(raw,assertion,observed_at=self.at.replace(tzinfo=clock)))
        self.assertEqual(clock.calls,0);self.assertEqual(MAX_RESULT_PACKET_BYTES,2*1024*1024)
        self.assertEqual(m.MAX_CUSTODY_PACKET_BYTES,65536);self.assertEqual(m.MAX_CUSTODY_INTENT_BYTES,2048)

    def test_genuine_valid_large_portable_packet_refuses_only_smaller_custody_port(self):
        from tests.test_pdf_extraction_request import capture as new_capture
        from tests.test_pdf_request_packet_context import reference
        from workers.pdf_derivation_packet import prepare_pdf_derivation_packet
        # An invented large unselected page remains visibly held; the selected
        # first page still qualifies for this portable mechanical contract.
        current=new_capture(unselected='X'*40000)
        recorded=current.document.retrieved_at+timedelta(seconds=1)
        derivation=prepare_pdf_derivation_packet(current,recorded_observed_at=recorded)
        ref=reference(derivation,current,recorded=recorded)
        request=compile_pdf_extraction_request(current,observed_at=recorded,maximum_output_tokens=100)
        packet=prepare_pdf_result_packet(ref,None,request=request,output_raw=output(ref),operation_id=OPERATION,prepared_at=recorded)
        self.assertGreater(len(packet.raw),m.MAX_CUSTODY_PACKET_BYTES)
        self.assertLessEqual(len(packet.raw),MAX_RESULT_PACKET_BYTES)
        self.assertEqual(packet.context.current.snapshot.passages[0].locator,'section-one')
        self.assertEqual(packet.proposal.review_state,'unverified')
        assertion=expected(packet,ref,None,request)
        clock=CallbackUtc(lambda:None)
        self.before_child(lambda:m.prepare_pdf_result_custody(packet.raw,assertion,observed_at=recorded.replace(tzinfo=clock)))
        self.assertEqual(clock.calls,0)

    def test_worst_receipt_and_statement_limits_are_checked_before_any_child(self):
        self.assertLess(len(json.dumps(receipt(self.prepared)).encode())+m.RECEIPT_MARGIN,m.MAX_CAPTURE_OUTPUT)
        with patch.object(m,'MAX_CAPTURE_OUTPUT',128):
            self.before_child(lambda:m.prepare_pdf_result_custody(self.packet.raw,self.assertion(),observed_at=self.at))
        with patch.object(m,'MAX_CAPTURE_STATEMENT',128):
            self.before_child(lambda:m.prepare_pdf_result_custody(self.packet.raw,self.assertion(),observed_at=self.at))

    def test_read_statement_has_only_exact_operation_and_readonly_repeatable_read(self):
        sql=m.pdf_result_custody_read_statement(OPERATION)
        self.assertIn('begin isolation level repeatable read read only;',sql)
        self.assertIn("tf_pdf_result_rehearsal.result_receipt('"+OPERATION+"'::uuid)",sql)
        self.assertTrue(sql.endswith('commit;\n\\echo TF_INVENTED_FEED_COMMITTED\n'))
        for bad in(True,'PRIVATE_SCHEMA.function()',OPERATION+';select 1',''):
            with self.assertRaisesRegex(m.PdfResultCustodyError,'^pdf_result_custody_unavailable$'):m.pdf_result_custody_read_statement(bad)

    def test_closed_receipt_duplicate_nonfinite_types_and_caps_refuse_before_core(self):
        for raw in(b'',b'[]',b'{"schema_version":1,"schema_version":1}',b'{"x":NaN}',b'\xff',b'x'*(m.MAX_CAPTURE_OUTPUT+1)):
            self.before_child(lambda:m.reopen_pdf_result_custody(raw,self.assertion(),intent_raw=self.prepared.canonical_intent,observed_at=self.later))
        for update in(dict(schema_version=True),dict(kind='stored_html_result'),dict(secret='PRIVATE'),dict(artifact_id='PRIVATE_ID'),dict(packet_bytes=True),dict(intent_bytes=True)):
            value=receipt(self.prepared);value.update(update);self.before_child(lambda:self.reopen(value=value))
        for intent in(b'',b'x'*(m.MAX_CUSTODY_INTENT_BYTES+1),bytearray(self.prepared.canonical_intent)):
            self.before_child(lambda:self.reopen(intent=intent))

    def test_receipt_complete_byte_lengths_hashes_and_canonical_base64(self):
        for key in('intent','packet'):
            for update in({key+'_base64':'!!!!'},{key+'_base64':receipt(self.prepared)[key+'_base64']+'\n'},
                           {key+'_bytes':0},{key+'_sha256':'f'*64}):
                value=receipt(self.prepared);value.update(update);self.before_child(lambda:self.reopen(value=value))
        value=receipt(self.prepared);raw=self.packet.raw+b' '
        value.update(packet_base64=base64.b64encode(raw).decode(),packet_bytes=len(raw),packet_sha256=sha256(raw).hexdigest())
        self.before_child(lambda:self.reopen(value=value))

    def test_independent_intent_expected_source_request_output_and_prior_cannot_be_inferred(self):
        e=self.assertion()
        for intent in(self.prepared.canonical_intent+b' ',_canonical(json.loads(self.prepared.canonical_intent)|{'extra':True})):
            self.before_child(lambda:self.reopen(intent=intent))
        variants=(replace(e,packet_sha256='f'*64),replace(e,output_sha256='f'*64),replace(e,previous=None),
            replace(e,current=replace(e.current,packet_sha256='f'*64)),
            replace(e,request=replace(e.request,body=b'PRIVATE_BAD_REQUEST')),
            replace(e,current=replace(e.current,document=replace(e.current.document,source_key='foreign-source'))))
        # Metadata mismatches refuse before the cold core. A foreign original
        # expectation is a deeper pure preflight in that core, still no child.
        for bad in variants[:-1]:self.before_child(lambda:self.reopen(assertion=bad))
        with patch('workers.pdf_text_inspection.subprocess.Popen',side_effect=AssertionError('No child'))as child:
            with self.assertRaises(m.PdfResultCustodyError):self.reopen(assertion=variants[-1])
            child.assert_not_called()

    def test_receipt_prepared_stored_observed_chronology_and_real_utc(self):
        for stored in(self.prepared_at-timedelta(microseconds=1),self.later+timedelta(microseconds=1)):
            self.before_child(lambda:self.reopen(value=receipt(self.prepared,stored_at=stored)))
        for text in('2026-02-30T00:00:00.000000Z','2026-10-17T09:00:02Z','2026-10-17T09:00:02.000000+00:00'):
            value=receipt(self.prepared);value['stored_at']=text;self.before_child(lambda:self.reopen(value=value))
        self.before_child(lambda:m.prepare_pdf_result_custody(self.packet.raw,self.assertion(),observed_at=self.prepared_at-timedelta(microseconds=1)))
        self.before_child(lambda:self.reopen(at=self.later.replace(tzinfo=None)))

    def test_prepare_captures_expected_context_and_clock_before_callback(self):
        assertion=self.assertion();wanted_request=assertion.request.body;wanted_sha=assertion.packet_sha256
        def mutate():
            assertion.__dict__.update(packet_sha256='f'*64,operation_id='PRIVATE_OP')
            assertion.previous.mapping.selections[0].__dict__['page_number']=2
            assertion.request.__dict__['body']=b'PRIVATE_CHANGED_REQUEST'
        clock=CallbackUtc(mutate)
        with self.actual()as(children,core):
            value=m.prepare_pdf_result_custody(self.packet.raw,assertion,observed_at=self.at.replace(tzinfo=clock))
        self.assertEqual(core.call_count,1);self.assertEqual(len(children),2);self.assertEqual(clock.calls,1)
        self.assertEqual(value.expected.packet_sha256,wanted_sha);self.assertEqual(value.context.request.body,wanted_request)
        self.assertEqual(value.context.previous.spans[0].page_number,1)

    def test_read_captures_receipt_independent_intent_and_full_expected_before_clock(self):
        assertion=self.assertion();wanted_request=assertion.request.body
        def mutate():
            assertion.__dict__.update(output_sha256='f'*64)
            assertion.current.binding.__dict__['source_key']='foreign-after-entry'
            assertion.request.__dict__['body']=b'PRIVATE_CHANGED_REQUEST'
        clock=CallbackUtc(mutate)
        with self.actual()as(children,core):result=self.reopen(assertion=assertion,at=self.later.replace(tzinfo=clock))
        self.assertEqual(core.call_count,1);self.assertEqual(len(children),2);self.assertEqual(clock.calls,1)
        self.assertEqual(result.context.request.body,wanted_request)
        self.assertEqual(result.result.output_sha256,self.packet.output_sha256)

    def test_private_clock_failure_and_bad_expected_namespace_are_curated(self):
        def fail():raise RuntimeError('PRIVATE_CLOCK /home/private/original')
        clock=CallbackUtc(fail)
        self.before_child(lambda:m.prepare_pdf_result_custody(self.packet.raw,self.assertion(),observed_at=self.at.replace(tzinfo=clock)))
        clock=CallbackUtc(fail);self.before_child(lambda:self.reopen(at=self.later.replace(tzinfo=clock)))
        assertion=self.assertion();assertion.__dict__['PRIVATE_UNKNOWN']='value'
        self.before_child(lambda:self.reopen(assertion=assertion))


class PdfResultCustodySqlScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql=(Path(__file__).parent/'fixtures/invented_pdf_result_custody.sql').read_text()

    def test_one_private_byte_carrier_no_foreign_schema_role_or_public_grant(self):
        sql=self.sql.lower()
        self.assertEqual(len(re.findall(r'create table\s',sql)),1)
        self.assertEqual(len(re.findall(r'create function\s',sql)),3)
        self.assertNotRegex(sql,r'\bgrant\b|\bcreate role\b|\breferences\b|\bsecurity definer\b')
        self.assertNotIn('tf_feed_rehearsal.',sql);self.assertNotIn('tf_html_',sql)
        self.assertIn('enable row level security',sql)
        self.assertIn('before update or delete',sql);self.assertIn('before truncate',sql)
        self.assertEqual(sql.count('security invoker set search_path=pg_catalog'),3)
        self.assertIn("current_user<>'postgres' or session_user<>'postgres'",sql)
        for signature in('refuse_mutation()','result_receipt(uuid)','store_result(bytea,bytea)'):
            self.assertIn('revoke all on function tf_pdf_result_rehearsal.'+signature+' from public;',sql)

    def test_store_preserves_serialized_exact_bytes_and_prewrite_capacity_guards(self):
        sql=self.sql
        self.assertIn("current_setting('transaction_isolation')<>'read committed'",sql)
        self.assertIn("current_setting('transaction_read_only')<>'off'",sql)
        self.assertIn('octet_length(p_intent) not between 1 and 2048',sql)
        self.assertIn('octet_length(p_packet) not between 1 and 65536',sql)
        self.assertIn("old.intent is distinct from p_intent or old.packet is distinct from p_packet",sql)
        self.assertIn("errcode='23505'",sql)
        self.assertLess(sql.index('octet_length(receipt::text)+4096>131072'),sql.index('insert into tf_pdf_result_rehearsal.results'))
        self.assertLess(sql.index('pg_advisory_xact_lock'),sql.index('select * into old'))
        self.assertLess(sql.index('select * into old'),sql.index('insert into tf_pdf_result_rehearsal.results'))
        for field in('current_packet_sha256','previous_packet_sha256','request_sha256','output_sha256','selected_payload_sha256'):
            self.assertIn(field,sql)

    def test_getter_is_select_only_full_bytes_and_canonical_base64_without_wrapper_limit_widening(self):
        sql=self.sql;getter=sql[sql.index('create function tf_pdf_result_rehearsal.result_receipt'):sql.index('create function tf_pdf_result_rehearsal.store_result')]
        self.assertNotRegex(getter.lower(),r'\b(insert|update|delete|truncate)\s')
        self.assertIn('select * into r',getter);self.assertIn('stable security invoker',getter)
        self.assertIn("replace(encode(r.packet,'base64'),E'\\n','')",getter)
        self.assertIn("replace(encode(r.intent,'base64'),E'\\n','')",getter)
        self.assertEqual(m.MAX_CAPTURE_STATEMENT,294912);self.assertEqual(m.MAX_CAPTURE_OUTPUT,131072)


if __name__=='__main__':unittest.main()
