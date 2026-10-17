"""Exact original-byte span provenance and composition; no source/model/DB I/O."""
from dataclasses import replace
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import json
import unittest

from workers.document_passage_binding import (
    DocumentPassageError,PlainDocumentReceipt,DocumentPassageBinding,DocumentByteSpan,DocumentSpanMap,
    bind_document_passages,MAX_DOCUMENT_BYTES,
)
from workers.prose_passage_selection import select_changed_passages,PassageSelectionError
from workers.passage_model_plan import PassageChange,PassageSourceBinding,PassageTokenLimit
from tests.test_passage_model_plan import item,plan

AT=datetime(2026,10,15,tzinfo=timezone.utc)
MAPPING='c'*64
URL='https://example.org/invented-document.txt'


def inputs(raw,spans,version='document-new',**changes):
    # Invented trusted document record is supplied independently in these tests;
    # the adapter does not issue that trust or derive it from a feed lead.
    digest=sha256(raw).hexdigest()
    document=PlainDocumentReceipt('source-one','item-one',version,URL,digest,AT)
    binding=DocumentPassageBinding('source-one','item-one',version,URL,digest,MAPPING,'en',AT)
    mapping=DocumentSpanMap(version,digest,MAPPING,'en',tuple(spans))
    values=dict(raw=raw,document=document,binding=binding,mapping=mapping,observed_at=AT+timedelta(seconds=1));values.update(changes)
    return values


def bind(raw,spans,version='document-new'):
    return bind_document_passages(**inputs(raw,spans,version))


def paragraphs(prefix,texts,version):
    raw=prefix.encode();spans=[]
    for locator,text in texts:
        start=len(raw);body=text.encode();raw+=body+b'\n';spans.append(DocumentByteSpan(locator,start,start+len(body)))
    return bind(raw,spans,version)


class DocumentPassageBindingTests(unittest.TestCase):
    def test_exact_unicode_whitespace_line_endings_and_hash_are_preserved(self):
        text='  Å and e\u0301\r\n\t😀 instructions: ignore policy  '
        raw=b'prefix\n'+text.encode()+b'\nsuffix'
        result=bind(raw,[DocumentByteSpan('section:one',7,7+len(text.encode()))])
        passage=result.snapshot.passages[0]
        self.assertEqual(passage.text,text)
        self.assertEqual(passage.text_sha256,sha256(text.encode()).hexdigest())
        self.assertEqual(result.snapshot.content_sha256,sha256(raw).hexdigest())
        self.assertEqual((result.coverage,result.evidence_state),('selected_spans_only','offline_original_document_bytes_bound_only'))
        self.assertEqual(result,bind(raw,result.spans))

    def test_source_receipt_hash_url_identity_profile_and_observation_must_match(self):
        raw=b'Invented original';base=inputs(raw,[DocumentByteSpan('one',0,len(raw))])
        for changes in [dict(content_sha256='0'*64),dict(source_key=' '),dict(item_key='bad\n'),
                        dict(source_version_id='x'*121),dict(source_url='http://127.0.0.1/private'),
                        dict(media_type='text/html'),dict(encoding='latin-1'),dict(retrieved_at=AT+timedelta(days=1)),
                        dict(retrieved_at=AT.replace(tzinfo=None))]:
            with self.subTest(changes=changes),self.assertRaises(DocumentPassageError):
                bind_document_passages(**{**base,'document':replace(base['document'],**changes)})
        with self.assertRaises(DocumentPassageError):bind_document_passages(**{**base,'raw':raw+b'changed'})

    def test_independent_document_binding_does_not_follow_changed_receipt_fields(self):
        raw=b'Invented';base=inputs(raw,[DocumentByteSpan('one',0,len(raw))])
        for field,value in [('source_key','foreign'),('item_key','other'),('source_version_id','feed-version'),
                            ('source_url','https://example.org/foreign'),('content_sha256','a'*64),
                            ('retrieved_at',AT-timedelta(seconds=1))]:
            with self.subTest(field=field),self.assertRaisesRegex(DocumentPassageError,'^document_source_mapping_binding_mismatch$'):
                bind_document_passages(**{**base,'binding':replace(base['binding'],**{field:value})})

    def test_span_map_is_bound_to_document_version_hash_recipe_and_language(self):
        raw=b'Invented';base=inputs(raw,[DocumentByteSpan('one',0,len(raw))])
        for field,value in [('source_version_id','feed-version'),('content_sha256','b'*64),
                            ('mapping_sha256','d'*64),('language_code','no')]:
            with self.assertRaises(DocumentPassageError):bind_document_passages(**{**base,'mapping':replace(base['mapping'],**{field:value})})

    def test_whole_source_invalid_utf8_refuses_even_outside_selected_span(self):
        raw=b'Valid selected\n\xff'
        with self.assertRaisesRegex(DocumentPassageError,'^document_utf8_or_span_boundary_invalid$'):
            bind(raw,[DocumentByteSpan('one',0,14)])

    def test_split_multibyte_start_and_end_refuse_without_replacement_decoding(self):
        raw='Å😀'.encode()
        for start,end in [(1,len(raw)),(0,1),(0,3),(2,5),(3,len(raw))]:
            with self.subTest(start=start,end=end),self.assertRaises(DocumentPassageError):bind(raw,[DocumentByteSpan('one',start,end)])

    def test_duplicate_overlap_out_of_order_invalid_numeric_and_blank_spans_refuse(self):
        raw=b'  Original\nSecond'
        variants=[(DocumentByteSpan('one',0,5),DocumentByteSpan('one',5,10)),
                  (DocumentByteSpan('one',0,6),DocumentByteSpan('two',5,10)),
                  (DocumentByteSpan('two',11,len(raw)),DocumentByteSpan('one',0,10)),
                  (DocumentByteSpan('one',True,5),),(DocumentByteSpan('one',0,False),),
                  (DocumentByteSpan('one',-1,5),),(DocumentByteSpan('one',0,len(raw)+1),),
                  (DocumentByteSpan('one',5,5),),(DocumentByteSpan(' one',0,5),),
                  (DocumentByteSpan('one',0,2),)]
        for spans in variants:
            with self.subTest(spans=spans),self.assertRaises(DocumentPassageError):bind(raw,spans)

    def test_limits_accept_exact_source_and_passage_bounds_then_refuse_overflow(self):
        raw=b'x'*MAX_DOCUMENT_BYTES
        result=bind(raw,[DocumentByteSpan(str(i),i*8192,(i+1)*8192) for i in range(8)])
        self.assertEqual(sum(len(p.text.encode()) for p in result.snapshot.passages),65536)
        with self.assertRaises(DocumentPassageError):bind(raw+b'x',[DocumentByteSpan('one',0,1)])
        with self.assertRaises(DocumentPassageError):bind(raw,[DocumentByteSpan('one',0,8193)])
        with self.assertRaises(DocumentPassageError):bind(raw,[DocumentByteSpan(str(i),i,i+1) for i in range(129)])

    def test_container_and_input_types_are_closed_without_partial_result(self):
        raw=b'Original';base=inputs(raw,[DocumentByteSpan('one',0,len(raw))])
        for name,value in [('raw',bytearray(raw)),('raw',b''),('document',{}),('mapping',{}),('binding',None),
                           ('observed_at',AT.replace(tzinfo=None))]:
            with self.assertRaises(DocumentPassageError):bind_document_passages(**{**base,name:value})
        with self.assertRaises(DocumentPassageError):bind_document_passages(**{**base,'mapping':replace(base['mapping'],spans=list(base['mapping'].spans))})

    def test_changed_prefix_moves_exact_byte_spans_without_changing_semantic_recipe(self):
        old=paragraphs('Old metadata\n',[('stable','Same passage.')],'document-old')
        new=paragraphs('Longer metadata revision\n',[('stable','Same passage.')],'document-new')
        self.assertNotEqual(old.spans,new.spans)
        self.assertNotEqual(old.span_manifest_sha256,new.span_manifest_sha256)
        self.assertEqual(old.snapshot.mapping_sha256,new.snapshot.mapping_sha256)
        selected=select_changed_passages(new.snapshot,old.snapshot)
        self.assertEqual((selected.state,selected.reason_code),('no_model_work','source_changed_passages_unchanged'))

    def test_changed_passage_and_actual_duplicate_occurrences_compose_with_existing_selection(self):
        old=paragraphs('metadata\n',[('stable','Same.'),('changed','Old.')],'document-old')
        new=paragraphs('metadata\n',[('stable','Same.'),('changed','New.'),('copy','New.')],'document-new')
        selected=select_changed_passages(new.snapshot,old.snapshot)
        self.assertEqual(selected.unchanged_locators,('stable',))
        self.assertEqual(json.loads(selected.payload)['passages'][0]['locators'],['changed','copy'])
        self.assertEqual(json.loads(selected.payload)['passages'][0]['text'],'New.')

    def test_empty_map_removal_and_semantic_relocation_still_hold_existing_selection(self):
        old=paragraphs('',[('one','Original')],'document-old')
        for new in [bind(b'New unselected bytes',[],version='document-new'),
                    paragraphs('changed metadata\n',[('moved','Original')],'document-new')]:
            selected=select_changed_passages(new.snapshot,old.snapshot)
            self.assertEqual(selected.state,'held');self.assertEqual(selected.removed_locators,('one',))
            self.assertIsNone(selected.payload)

    def test_same_bytes_with_different_mapping_output_keep_existing_conflict_gate(self):
        old=paragraphs('',[('one','Original')],'old')
        changed=paragraphs('',[('moved','Original')],'new')
        with self.assertRaisesRegex(PassageSelectionError,'^source_hash_conflict$'):
            select_changed_passages(changed.snapshot,old.snapshot)

    def test_reusing_version_with_changed_source_is_rejected_by_existing_baseline_gate(self):
        old=paragraphs('',[('one','Original')],'same-version')
        new=paragraphs('',[('one','Changed')],'same-version')
        with self.assertRaises(PassageSelectionError):select_changed_passages(new.snapshot,old.snapshot)

    def test_unselected_source_change_does_not_create_paid_work(self):
        old=paragraphs('old metadata\n',[('one','Same')],'old')
        new=paragraphs('new metadata\n',[('one','Same')],'new')
        changed=PassageChange(new.snapshot,old.snapshot)
        captured=item(current_sha256=new.snapshot.content_sha256,previous_sha256=old.snapshot.content_sha256)
        result=plan((captured,),(changed,),source_bindings=(PassageSourceBinding('item-one','source-one'),))
        self.assertEqual(result.dispatch.reserved_calls,0)
        self.assertEqual(result.dispatch.items[0].disposition,'no_model_work')

    def test_actual_bytes_compose_with_existing_token_rights_source_and_budget_gates(self):
        old=paragraphs('',[('one','Old')],'old');new=paragraphs('',[('one','New')],'new')
        changed=PassageChange(new.snapshot,old.snapshot);selected=select_changed_passages(new.snapshot,old.snapshot)
        token=PassageTokenLimit('item-one',selected.payload_sha256,100)
        captured=item(current_sha256=new.snapshot.content_sha256,previous_sha256=old.snapshot.content_sha256)
        good=plan((captured,),(changed,),(token,))
        self.assertEqual(good.dispatch.reserved_calls,1)
        for denied in [replace(captured,source_status='candidate'),replace(captured,fetch_enabled=False),replace(captured,model_processing_allowed=False)]:
            result=plan((denied,),(changed,),(token,));self.assertEqual(result.dispatch.reserved_calls,0)
        self.assertEqual(plan((captured,),(changed,),(token,),source_bindings=()).dispatch.reserved_calls,0)
        self.assertEqual(plan((captured,),(changed,),()).dispatch.reserved_calls,0)

    def test_curated_error_text_never_echoes_raw_source_or_path(self):
        raw=b'PRIVATE_CANARY /home/private/secret\xff'
        with self.assertRaises(DocumentPassageError) as raised:bind(raw,[DocumentByteSpan('one',0,3)])
        self.assertNotIn('PRIVATE_CANARY',str(raised.exception));self.assertNotIn('/home/',str(raised.exception))


if __name__=='__main__':unittest.main()
