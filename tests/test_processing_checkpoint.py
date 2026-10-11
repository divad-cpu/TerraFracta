from dataclasses import replace
from datetime import timedelta
import json
import unittest
from tests.test_captured_update_pipeline import NOW,VERSION,DECISION,PUBLICATION
from tests.test_source_response_receipts import context
from workers.captured_update_pipeline import parse_processing_checkpoint
from workers.update_run_completion import RunManifest,PlannedSource,PlannedItem
from workers.update_request_identity import identify_update_request


def manifest():
    ctx=context();invocation=replace(ctx.invocation,mode='publish_eligible')
    return RunManifest(str(ctx.work.run_id),identify_update_request(invocation).request_fingerprint,'publish_eligible',
        (PlannedSource('fictional-source',ctx.registration_id,VERSION,'a'*64),),(PlannedItem('fictional-item','fictional-source',VERSION),))


def record():
    return {'decisions':[{'decisionId':DECISION,'itemKey':'fictional-item','sourceVersionId':VERSION,'disposition':'eligible'}],
        'activations':[{'publicationId':PUBLICATION,'decisionId':DECISION,'publicationSha256':'b'*64,'activatedAt':NOW.isoformat()}],
        'invalidSourceKeys':[]}


class ProcessingCheckpointTests(unittest.TestCase):
    def parse(self,row):return parse_processing_checkpoint(json.dumps(row).encode(),manifest(),now=NOW)
    def test_committed_records_decode_without_claimed_counts_or_visibility(self):
        result=self.parse(record())
        self.assertEqual(result.decisions[0].decision_id,DECISION)
        self.assertEqual(result.activations[0].publication_id,PUBLICATION)
        self.assertEqual(result.invalid_source_keys,())

    def test_counter_and_nested_private_or_missing_fields_refuse(self):
        for key,value in (('decidedItems',1),('runState','completed'),('rawBody','private')):
            row=record();row[key]=value
            with self.assertRaises(ValueError):self.parse(row)
        row=record();row['decisions'][0]['private']='not-exported'
        with self.assertRaises(ValueError):self.parse(row)
        row=record();del row['activations'][0]['activatedAt']
        with self.assertRaises(ValueError):self.parse(row)

    def test_foreign_decision_or_duplicated_record_cannot_inflate_processing(self):
        for change in (lambda r:r['decisions'][0].update(itemKey='foreign'),lambda r:r['decisions'].append(r['decisions'][0]),
                       lambda r:r['activations'][0].update(decisionId='66666666-6666-4666-8666-666666666666')):
            row=record();change(row)
            with self.assertRaises(ValueError):self.parse(row)

    def test_invalid_source_scope_is_unique_and_limited_to_manifest(self):
        row=record();row['invalidSourceKeys']=['fictional-source']
        self.assertEqual(self.parse(row).invalid_source_keys,('fictional-source',))
        for keys in (['foreign'],['fictional-source','fictional-source'],[None]):
            row=record();row['invalidSourceKeys']=keys
            with self.assertRaises(ValueError):self.parse(row)

    def test_future_naive_or_non_string_activation_time_refuses(self):
        for at in ((NOW+timedelta(seconds=1)).isoformat(),NOW.replace(tzinfo=None).isoformat(),False):
            row=record();row['activations'][0]['activatedAt']=at
            with self.assertRaises(ValueError):self.parse(row)

    def test_duplicate_root_arrays_and_oversized_payload_refuse(self):
        for body in (b'{"decisions":[],"decisions":[],"activations":[],"invalidSourceKeys":[]}',b' '*65537):
            with self.assertRaises(ValueError):parse_processing_checkpoint(body,manifest(),now=NOW)

if __name__=='__main__':unittest.main()
