"""Stable preparation intent survives fresh later original-byte observations."""
from dataclasses import replace
from datetime import timedelta
import json
import unittest
from tests.test_private_extraction_result import fixture, prepare, NOW
from tests.test_private_extraction_postgres import wire
from tests.test_feed_capture_reopen import encode
from workers.document_result_reopen import parse_reopened_document
from workers.feed_postgres_contract import _time
from workers.private_extraction_result import PrivateExtractionResultError
from workers.private_extraction_postgres import prepare_private_extraction_store, parse_stored_private_extraction_result


def fresh_contexts(values):
    values = dict(values)
    for side in ('current', 'previous'):
        old=values[side]; request=replace(old.request, observed_at=NOW+timedelta(seconds=9))
        response=json.loads(old.response_raw);response['observed_at']=_time(NOW+timedelta(seconds=10))
        values[side]=parse_reopened_document(encode(response),request,observed_at=NOW+timedelta(seconds=11))
    return {**values,'observed_at':NOW+timedelta(seconds=12)}


class PrivateExtractionReobservationTests(unittest.TestCase):
    def test_same_intent_and_bytes_reopen_with_fresh_evidence_time(self):
        values=fixture(); initial=prepare_private_extraction_store(prepare(values)); raw=encode(wire(initial))
        fresh=prepare_private_extraction_store(prepare(fresh_contexts(values)))
        self.assertEqual(initial.canonical_metadata,fresh.canonical_metadata)
        self.assertEqual(initial.result.canonical_input,fresh.result.canonical_input)
        self.assertNotEqual(initial.result.observed_at,fresh.result.observed_at)
        self.assertEqual(initial.result.prepared_at,fresh.result.prepared_at)
        stored=parse_stored_private_extraction_result(raw,fresh,observed_at=NOW+timedelta(seconds=13))
        self.assertEqual(stored.operation_id,initial.result.operation_id)

    def test_preparation_must_be_utc_after_both_stored_originals_and_not_future(self):
        values=fixture()
        for bad in [None,NOW.replace(tzinfo=None),NOW+timedelta(microseconds=1),
                max(values['current'].stored_at,values['previous'].stored_at)-timedelta(microseconds=1)]:
            with self.assertRaises(PrivateExtractionResultError):prepare({**values,'prepared_at':bad})


if __name__=='__main__':unittest.main()
