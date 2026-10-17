"""Supplied binary PDF packets: historic derivation is not current custody."""
import base64
from dataclasses import replace
from datetime import datetime, timezone, timedelta
from hashlib import sha256
import json
import unittest
from unittest.mock import patch

from tests.helpers.pdf_fixture import pdf_bytes
from workers.pdf_text_inspection import PdfDocumentReceipt, _encode as encode_inspection
from workers.pdf_passage_binding import PdfPassageBinding, PdfPageSelection, PdfPageSelectionMap
from workers.pdf_passage_comparison import PdfPassageCapture
from workers.pdf_extraction_request import compile_pdf_extraction_request, bind_pdf_full_request_token_limit, PdfExtractionRequestError
from workers.passage_extraction_request import _canonical, FullRequestTokenLimit
import workers.pdf_derivation_packet as m

AT = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)
LATER = AT + timedelta(days=1)


def capture(text='Selected original.', *, version=2, raw=None, selections=None):
    raw=pdf_bytes((text,'x'*8193,None),compressed=True,page_labels=True) if raw is None else raw
    doc=PdfDocumentReceipt('fictional-pdf','invented-item',f'10000000-0000-4000-8000-{version:012d}',
        'https://example.org/invented.pdf',sha256(raw).hexdigest(),AT-timedelta(minutes=version))
    b=PdfPassageBinding(doc.source_key,doc.item_key,doc.source_version_id,doc.source_url,doc.content_sha256,'a'*64,'en',doc.retrieved_at)
    if selections is None:selections=(PdfPageSelection('selected-page',1,sha256(text.encode()).hexdigest()),)
    return PdfPassageCapture(raw,doc,b,PdfPageSelectionMap(doc.source_version_id,doc.content_sha256,b.mapping_sha256,b.language_code,selections))


def independent(packet, value):
    return m.PdfDerivationPacketExpected(replace(value.document),replace(value.binding),
        replace(value.mapping,selections=tuple(replace(s)for s in value.mapping.selections)),
        packet.recorded_observed_at,packet.packet_sha256,packet.inspection_sha256,packet.derivation_sha256)


def resign(raw, expected):
    return replace(expected,packet_sha256=sha256(raw).hexdigest())


def component(body, name, raw):
    body[name+'_base64']=base64.b64encode(raw).decode();body[name+'_bytes']=len(raw);body[name+'_sha256']=sha256(raw).hexdigest()


class PdfDerivationPacketTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.value=capture()
        cls.packet=m.prepare_pdf_derivation_packet(cls.value,recorded_observed_at=AT)

    def expected(self):return independent(self.packet,self.value)

    def test_preparation_inspects_once_and_retains_exact_binary_full_components(self):
        value=capture();real=m.bind_pdf_passages
        with patch.object(m,'bind_pdf_passages',wraps=real)as binder:
            packet=m.prepare_pdf_derivation_packet(value,recorded_observed_at=AT)
        self.assertEqual(binder.call_count,1);body=json.loads(packet.raw)
        self.assertEqual(packet.raw,_canonical(body));self.assertEqual(set(body),m.PACKET_KEYS)
        self.assertEqual(body['kind'],m.KIND);self.assertEqual(packet.packet_sha256,sha256(packet.raw).hexdigest())
        self.assertIn(b'\x00',value.raw);self.assertNotEqual(value.raw.decode('latin1').encode('utf8'),value.raw)
        for name,raw in [('original',value.raw),('inspection',packet.result.inspection_report_raw),('derivation',packet.result.derivation_manifest_raw)]:
            self.assertEqual(base64.b64decode(body[name+'_base64']),raw)
            self.assertEqual(body[name+'_bytes'],len(raw));self.assertEqual(body[name+'_sha256'],sha256(raw).hexdigest())
        report=json.loads(packet.result.inspection_report_raw)
        self.assertEqual([p['state']for p in report['pages']],['text_extracted','held','no_native_text'])
        self.assertTrue(packet.result.inspection_report_raw.endswith(b'\n'))
        self.assertNotIn('Selected original.',repr(packet));self.assertNotIn('Untrusted label',packet.result.derivation_manifest_raw.decode())
        self.assertIn('not_stored_or_authenticated',packet.evidence_state)

    def test_public_preflight_copies_all_inputs_without_native_work(self):
        expected=self.expected()
        with patch.object(m,'bind_pdf_passages',side_effect=AssertionError('No child'))as binder:
            frozen=m.capture_pdf_derivation_packet_inputs(self.packet.raw,expected,reopened_at=LATER)
            binder.assert_not_called()
        self.assertIsNot(frozen.expected,expected);self.assertIsNot(frozen.expected.document,expected.document)
        self.assertIsNot(frozen.expected.mapping.selections[0],expected.mapping.selections[0])
        self.assertEqual(frozen.inputs.observed_at,AT);self.assertEqual(frozen.reopened_at,LATER)
        self.assertEqual(frozen.inspection_raw,self.packet.result.inspection_report_raw)
        self.assertNotIn('Selected original.',repr(frozen))

    def test_cold_reopen_uses_recorded_time_once_and_preserves_exact_component_bytes(self):
        real=m.bind_pdf_passages
        with patch.object(m,'bind_pdf_passages',wraps=real)as binder:
            reopened=m.reopen_pdf_derivation_packet(bytes(self.packet.raw),self.expected(),reopened_at=LATER)
        self.assertEqual(binder.call_count,1);self.assertEqual(reopened.recorded_observed_at,AT);self.assertEqual(reopened.reopened_at,LATER)
        self.assertEqual(binder.call_args.kwargs['observed_at'],AT)
        self.assertEqual(reopened.capture.raw,self.value.raw);self.assertEqual(reopened.result.inspection_report_raw,self.packet.result.inspection_report_raw)
        self.assertEqual(reopened.result.derivation_manifest_raw,self.packet.result.derivation_manifest_raw)
        self.assertEqual(reopened.result.inspection_report_sha256,self.packet.inspection_sha256)
        self.assertIn('not_current_trust',reopened.evidence_state)

    def test_historical_complete_request_survives_explicit_reopen_but_new_observation_does_not(self):
        # Both old/current packets deliberately share the original request's AT.
        before=capture('Old selected.',version=1)
        # Retrieval order must match the comparison's chronology.
        before=replace(before,document=replace(before.document,retrieved_at=AT-timedelta(minutes=3)),
                       binding=replace(before.binding,retrieved_at=AT-timedelta(minutes=3)))
        original=compile_pdf_extraction_request(self.value,before,observed_at=AT,maximum_output_tokens=100)
        prior_packet=m.prepare_pdf_derivation_packet(before,recorded_observed_at=AT)
        current=m.reopen_pdf_derivation_packet(self.packet.raw,self.expected(),reopened_at=LATER)
        previous=m.reopen_pdf_derivation_packet(prior_packet.raw,independent(prior_packet,before),reopened_at=LATER)
        recompiled=compile_pdf_extraction_request(current.capture,previous.capture,observed_at=current.recorded_observed_at,maximum_output_tokens=100)
        self.assertEqual(recompiled.body,original.body);self.assertEqual(recompiled.request_sha256,original.request_sha256)
        new=compile_pdf_extraction_request(current.capture,previous.capture,observed_at=LATER,maximum_output_tokens=100)
        self.assertEqual(new.selected_payload_sha256,original.selected_payload_sha256);self.assertNotEqual(new.request_sha256,original.request_sha256)
        with patch('workers.pdf_extraction_request.compare_pdf_passages',side_effect=AssertionError('No child'))as compare:
            with self.assertRaises(PdfExtractionRequestError):
                bind_pdf_full_request_token_limit(new,current=current.capture,previous=previous.capture,observed_at=LATER,
                    maximum_output_tokens=100,proof=FullRequestTokenLimit('invented-item',original.request_sha256,10000))
            compare.assert_not_called()

    def test_independent_foreign_receipt_recipe_hash_and_reflection_inputs_refuse_before_child(self):
        e=self.expected();other='10000000-0000-4000-8000-000000000099'
        cases=[replace(e,packet_sha256='f'*64),replace(e,inspection_sha256='f'*64),replace(e,derivation_sha256='f'*64),
            replace(e,document=replace(e.document,media_type='text/plain')),
            replace(e,document=replace(e.document,content_sha256='f'*64)),
            replace(e,document=replace(e.document,source_key='foreign'),binding=replace(e.binding,source_key='foreign')),
            replace(e,document=replace(e.document,source_url='https://example.org/foreign.pdf'),binding=replace(e.binding,source_url='https://example.org/foreign.pdf')),
            replace(e,document=replace(e.document,retrieved_at=AT),binding=replace(e.binding,retrieved_at=AT)),
            replace(e,document=replace(e.document,source_version_id=other),binding=replace(e.binding,source_version_id=other),mapping=replace(e.mapping,source_version_id=other)),
            replace(e,binding=replace(e.binding,mapping_sha256='c'*64),mapping=replace(e.mapping,mapping_sha256='c'*64)),
            replace(e,binding=replace(e.binding,language_code='fr'),mapping=replace(e.mapping,language_code='fr')),
            replace(e,mapping=replace(e.mapping,selections=(replace(e.mapping.selections[0],page_text_sha256='f'*64),)))]
        extended=self.expected();object.__setattr__(extended,'foreign','PRIVATE');cases.append(extended)
        class Fake:
            @property
            def document(self):raise AssertionError('No getter')
        cases += [Fake(),{},self.packet,self.packet.result,replace(e,packet_sha256=True)]
        with patch.object(m,'bind_pdf_passages',side_effect=AssertionError('No child'))as binder:
            for bad in cases:
                with self.subTest(type=type(bad).__name__),self.assertRaises(m.PdfDerivationPacketError):
                    m.reopen_pdf_derivation_packet(self.packet.raw,bad,reopened_at=LATER)
            binder.assert_not_called()

    def test_closed_packet_json_types_canonical_base64_sizes_and_bytes_refuse_before_child(self):
        body=json.loads(self.packet.raw);invalid=[]
        for key,value in [('schema_version',True),('kind','stored'),('unknown','PRIVATE'),('original_bytes',True),
                          ('inspection_bytes',0),('derivation_sha256','A'*64),('original_base64','AA==\n'),('recorded_observed_at','2026-02-30T00:00:00.000000Z')]:
            changed=dict(body);changed[key]=value;invalid.append(_canonical(changed))
        invalid += [self.packet.raw+b' ',self.packet.raw[:-1]+b',"kind":"duplicate"}',b'[]',b'{"schema_version":NaN}',b'\xff',b'']
        class Data(bytes):pass
        invalid += [bytearray(self.packet.raw),Data(self.packet.raw),b'x'*(m.MAX_PACKET_BYTES+1)]
        with patch.object(m,'bind_pdf_passages',side_effect=AssertionError('No child'))as binder:
            for raw in invalid:
                expected=replace(self.expected(),packet_sha256=sha256(raw).hexdigest())
                with self.assertRaises(m.PdfDerivationPacketError):m.reopen_pdf_derivation_packet(raw,expected,reopened_at=LATER)
            binder.assert_not_called()

    def test_each_component_cap_is_checked_before_preflight_or_child(self):
        for name,limit in m.PART_LIMITS.items():
            changed=json.loads(self.packet.raw);component(changed,name,b'x'*(limit+1));raw=_canonical(changed)
            with patch.object(m,'_preflight',side_effect=AssertionError('No preflight'))as preflight,patch.object(m,'bind_pdf_passages')as binder:
                with self.assertRaises(m.PdfDerivationPacketError):m.reopen_pdf_derivation_packet(raw,resign(raw,self.expected()),reopened_at=LATER)
                preflight.assert_not_called();binder.assert_not_called()
        self.assertEqual(m.MAX_PACKET_BYTES,524288)

    def test_closed_report_manifest_physical_offsets_and_parser_identity_refuse_before_child(self):
        for name,key,value in [('inspection','unknown',True),('inspection','parser_identity','other'),
            ('derivation','unknown',True),('derivation','offset_space','original_pdf_bytes'),('derivation','rendered_visibility_verified',True)]:
            body=json.loads(self.packet.raw);part=json.loads(base64.b64decode(body[name+'_base64']));part[key]=value
            raw_part=_canonical(part)+(b'\n'if name=='inspection'else b'');component(body,name,raw_part);raw=_canonical(body)
            e=resign(raw,self.expected());e=replace(e,**{name+'_sha256':sha256(raw_part).hexdigest()})
            with patch.object(m,'bind_pdf_passages',side_effect=AssertionError('No child'))as binder:
                with self.assertRaises(m.PdfDerivationPacketError):m.reopen_pdf_derivation_packet(raw,e,reopened_at=LATER)
                binder.assert_not_called()
        for key,value in [('page_number',2),('derived_start_utf8',1),('derived_end_utf8',True),('printed_label','I')]:
            body=json.loads(self.packet.raw);part=json.loads(base64.b64decode(body['derivation_base64']));part['spans'][0][key]=value
            raw_part=_canonical(part);component(body,'derivation',raw_part);raw=_canonical(body)
            e=replace(resign(raw,self.expected()),derivation_sha256=sha256(raw_part).hexdigest())
            with patch.object(m,'bind_pdf_passages',side_effect=AssertionError('No child'))as binder:
                with self.assertRaises(m.PdfDerivationPacketError):m.reopen_pdf_derivation_packet(raw,e,reopened_at=LATER)
                binder.assert_not_called()

    def test_fully_resigned_consistent_unselected_report_still_requires_complete_original_rederivation(self):
        body=json.loads(self.packet.raw);report=json.loads(base64.b64decode(body['inspection_base64']))
        # Preserve the producer wire order so only the peer claim is forged.
        self.assertEqual(encode_inspection(report),base64.b64decode(body['inspection_base64'],validate=True))
        # Forged unselected peer is internally consistent; selected proof stays exact.
        text='Invented forged peer.';report['pages'][1]=dict(page_number=2,state='text_extracted',text=text,text_sha256=sha256(text.encode()).hexdigest(),reason_code=None)
        inspection=encode_inspection(report);component(body,'inspection',inspection)
        derivation=json.loads(base64.b64decode(body['derivation_base64']));derivation['inspection_report_sha256']=sha256(inspection).hexdigest()
        manifest=_canonical(derivation);component(body,'derivation',manifest);raw=_canonical(body)
        e=replace(resign(raw,self.expected()),inspection_sha256=sha256(inspection).hexdigest(),derivation_sha256=sha256(manifest).hexdigest())
        frozen=m.capture_pdf_derivation_packet_inputs(raw,e,reopened_at=LATER)
        self.assertEqual(frozen.inspection_raw,inspection)
        with patch.object(m,'bind_pdf_passages',wraps=m.bind_pdf_passages)as binder:
            with self.assertRaises(m.PdfDerivationPacketError):m.reopen_pdf_derivation_packet(raw,e,reopened_at=LATER)
        self.assertEqual(binder.call_count,1)

    def test_expectations_and_observations_are_captured_before_actual_popen_callback(self):
        import workers.pdf_text_inspection as inspector
        expected=self.expected();original=inspector.subprocess.Popen;children=[]
        def launch(*args,**kwargs):
            object.__setattr__(expected,'packet_sha256','f'*64);object.__setattr__(expected,'recorded_observed_at',LATER)
            object.__setattr__(expected.document,'item_key','PRIVATE_MUTATED')
            object.__setattr__(expected.mapping.selections[0],'locator','PRIVATE_MUTATED')
            process=original(*args,**kwargs);children.append(process);return process
        with patch.object(inspector.subprocess,'Popen',side_effect=launch):
            result=m.reopen_pdf_derivation_packet(self.packet.raw,expected,reopened_at=LATER)
        self.assertEqual(result.recorded_observed_at,AT);self.assertEqual(result.reopened_at,LATER)
        self.assertEqual(result.capture.document.item_key,'invented-item');self.assertEqual(result.result.spans[0].locator,'selected-page')
        self.assertNotIn('PRIVATE_MUTATED',result.result.inspection_report_raw.decode()+result.result.derivation_manifest_raw.decode())
        self.assertEqual(len(children),1);self.assertIsNotNone(children[0].poll());self.assertTrue(all(getattr(children[0],n).closed for n in('stdin','stdout','stderr')))

    def test_timestamp_inversions_non_utc_and_recorded_date_changes_refuse_before_child(self):
        e=self.expected();offset=timezone(timedelta(hours=1))
        cases=[(e,AT-timedelta(microseconds=1)),(e,LATER.replace(tzinfo=None)),(e,LATER.replace(tzinfo=offset)),
            (replace(e,recorded_observed_at=AT.replace(tzinfo=None)),LATER),
            (replace(e,recorded_observed_at=AT+timedelta(microseconds=1)),LATER),
            (replace(e,recorded_observed_at=AT-timedelta(days=1)),LATER)]
        with patch.object(m,'bind_pdf_passages',side_effect=AssertionError('No child'))as binder:
            for expected,at in cases:
                with self.assertRaises(m.PdfDerivationPacketError):m.reopen_pdf_derivation_packet(self.packet.raw,expected,reopened_at=at)
            binder.assert_not_called()
        frozen=m.capture_pdf_derivation_packet_inputs(self.packet.raw,e,reopened_at=LATER.replace(tzinfo=timezone(timedelta(0),'caller')))
        self.assertIs(frozen.reopened_at.tzinfo,timezone.utc)

    def test_empty_selection_never_all_pages_and_selected_or_whole_holds_refuse(self):
        empty=capture(selections=());packet=m.prepare_pdf_derivation_packet(empty,recorded_observed_at=AT)
        reopened=m.reopen_pdf_derivation_packet(packet.raw,independent(packet,empty),reopened_at=LATER)
        self.assertEqual(reopened.result.snapshot.passages,());self.assertEqual(reopened.result.spans,())
        self.assertEqual(len(json.loads(reopened.result.inspection_report_raw)['pages']),3)
        for selections in[(PdfPageSelection('held',2,'b'*64),),(PdfPageSelection('textless',3,'b'*64),),(PdfPageSelection('missing',4,'b'*64),)]:
            with self.assertRaises(m.PdfDerivationPacketError):m.prepare_pdf_derivation_packet(capture(selections=selections),recorded_observed_at=AT)
        with self.assertRaises(m.PdfDerivationPacketError):m.prepare_pdf_derivation_packet(capture(raw=b'%PDF-PRIVATE_BROKEN',selections=()),recorded_observed_at=AT)

    def test_actual_original_byte_boundary_and_unicode_keep_namespaces_separate(self):
        raw=self.value.raw+b' '*(65536-len(self.value.raw));value=capture(raw=raw)
        packet=m.prepare_pdf_derivation_packet(value,recorded_observed_at=AT);self.assertEqual(json.loads(packet.raw)['original_bytes'],65536)
        with patch.object(m,'bind_pdf_passages',side_effect=AssertionError('No child'))as binder:
            with self.assertRaises(m.PdfDerivationPacketError):m.prepare_pdf_derivation_packet(capture(raw=raw+b' '),recorded_observed_at=AT)
            binder.assert_not_called()
        raw=pdf_bytes(('unused',),unicode_text=True,page_labels=True)
        value=capture(raw=raw,selections=(PdfPageSelection('unicode',1,sha256('\U00010400'.encode()).hexdigest()),))
        packet=m.prepare_pdf_derivation_packet(value,recorded_observed_at=AT)
        result=m.reopen_pdf_derivation_packet(packet.raw,independent(packet,value),reopened_at=LATER)
        self.assertEqual(result.result.spans[0].derived_end_utf8,4);self.assertEqual(result.result.spans[0].page_number,1)
        self.assertNotEqual(result.result.spans[0].derived_text_sha256,result.capture.document.content_sha256)

    def test_no_supplied_report_or_bound_substitute_and_errors_hide_private_data(self):
        with patch.object(m,'bind_pdf_passages',side_effect=AssertionError('No child'))as binder:
            for candidate in[{},self.packet,self.packet.result,json.loads(self.packet.result.inspection_report_raw)]:
                with self.assertRaises(m.PdfDerivationPacketError)as caught:m.prepare_pdf_derivation_packet(candidate,recorded_observed_at=AT)
                self.assertEqual(str(caught.exception),'pdf_derivation_packet_unavailable');self.assertIsNone(caught.exception.__cause__)
            with self.assertRaises(m.PdfDerivationPacketError)as caught:m.reopen_pdf_derivation_packet(b'PRIVATE_SOURCE /home/private/file',self.expected(),reopened_at=LATER)
            self.assertEqual(str(caught.exception),'pdf_derivation_packet_unavailable');binder.assert_not_called()
