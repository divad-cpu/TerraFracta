"""Legitimate compiler input may exceed the narrower complete custody channel."""
import base64
from datetime import timedelta
import json
import unittest
from tests.test_document_result_contract import request as result_request, stored_shape
from tests.test_feed_capture_reopen import fixture as feed_fixture, encode
from tests.test_feed_postgres_contract import uid
from tests.test_document_passage_binding import AT
from workers.document_passage_binding import DocumentByteSpan
from workers.feed_capture_reopen import parse_reopened_capture
from workers.document_result_reopen import prepare_document_reopen, parse_reopened_document
from workers.reopened_document_change import prepare_reopened_document_change
from workers.passage_extraction_request import compile_extraction_request, MAX_REQUEST_BYTES
from workers.private_extraction_result import prepare_private_extraction_result
from workers.private_extraction_postgres import prepare_private_extraction_store, PrivateExtractionPostgresError
from workers.feed_postgres_contract import _time
NOW=AT+timedelta(seconds=20)


def original(*, large, version):
    raw=b'';spans=[]
    for i in range(128):
        body=(f'Invented {i:03}: '+('"'*80 if large else 'Older invented text.')).encode()
        start=len(raw);raw+=body+b'\n';spans.append(DocumentByteSpan(f'section:{i:03}:'+('l'*188),start,start+len(body)))
    expected=result_request(raw=raw,spans=spans,version=uid(version),operation_id=uid(version+100))
    _,page,feed_request,feed_response,feed_at=feed_fixture(expected.feed_capture)
    feed=parse_reopened_capture(encode(feed_response),feed_request,observed_at=feed_at)
    stored={**stored_shape(expected),'artifact_id':uid(version+200)}
    history=encode(dict(item_id=expected.association.feed_item_id,page=page,outcomes=[stored['outcome']]))
    request=prepare_document_reopen(feed,encode(page),history,binding=expected.binding,mapping=expected.mapping,
        association=expected.association,observed_at=AT+timedelta(seconds=13))
    response=dict(schema_version=1,kind='invented_document_reopened_original',request=json.loads(request.canonical_input),
        raw_base64=base64.b64encode(raw).decode(),artifact_id=stored['artifact_id'],stored_at=stored['stored_at'],observed_at=_time(AT+timedelta(seconds=14)))
    return parse_reopened_document(encode(response),request,observed_at=AT+timedelta(seconds=15)),encode(stored)


class PrivateExtractionCapacityTests(unittest.TestCase):
    def test_real_valid_quote_heavy_request_is_not_truncated_into_smaller_native_channel(self):
        current,cr=original(large=True,version=31);previous,pr=original(large=False,version=30)
        pair=prepare_reopened_document_change(current,cr,previous,pr,observed_at=NOW)
        request=compile_extraction_request(pair.current,pair.previous,observed_at=NOW,maximum_output_tokens=100)
        self.assertGreater(len(request.body),80000);self.assertLess(len(request.body),MAX_REQUEST_BYTES)
        b=current.request.binding
        output=encode(dict(schema_version=1,source_version_id=b.source_version_id,source_sha256=b.content_sha256,
            language_code=b.language_code,locator='section:000:'+('l'*188),proposed_claim_type='condition',
            proposed_assertion='😀'*600,source_date_text=None))
        result=prepare_private_extraction_result(current,cr,previous,pr,request=request,output_raw=output,
            operation_id=uid(500),prepared_at=NOW,observed_at=NOW,maximum_output_tokens=100)
        self.assertEqual(result.request.body,request.body)
        with self.assertRaisesRegex(PrivateExtractionPostgresError,'^private_extraction_store_input_unavailable$'):
            prepare_private_extraction_store(result)


if __name__=='__main__':unittest.main()
