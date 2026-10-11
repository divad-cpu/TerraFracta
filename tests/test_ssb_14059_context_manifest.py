from dataclasses import replace
import unittest
from tests import test_reserved_ssb_capture as support
contexts=support.contexts
from workers.ssb_14059_context_manifest import build_ssb_context_manifest,METADATA_KEY,DATA_KEY
from workers.update_run_completion import canonical_run_manifest,reconcile_run_completion
from tests.test_source_response_receipts import NOW

META='66666666-6666-4666-8666-666666666666'
DATA='77777777-7777-4777-8777-777777777777'


class PairedManifestTests(unittest.TestCase):
    def fixture(self):
        harness=support.ReservedSSBTests();harness.setUp();return harness.pair()
    def build(self,metadata=None,data=None,requests=None,versions=(META,DATA)):
        if metadata is None:metadata,data=self.fixture()
        return build_ssb_context_manifest(*(requests or contexts()),metadata,data,*versions)

    def test_metadata_and_data_both_required_charged_and_present_in_expected_work(self):
        metadata,data=self.fixture();result=self.build(metadata,data)
        self.assertEqual(result.logical_source_key,'ssb-14059')
        self.assertEqual({s.source_key for s in result.manifest.sources},{METADATA_KEY,DATA_KEY})
        self.assertEqual(result.total_charged_bytes,len(metadata.capture.body)+len(data.capture.body))
        self.assertEqual({i.source_key for i in result.manifest.items},{METADATA_KEY,DATA_KEY})
        self.assertEqual({i.item_key for i in result.manifest.items},{'ssb-14059-year-2024','ssb-14059-year-2025','ssb-14059-metadata-review'})
        completion=reconcile_run_completion(result.manifest,(),(),(),now=NOW)
        self.assertEqual(completion.covered_source_keys,tuple(sorted((METADATA_KEY,DATA_KEY))))
        self.assertEqual(completion.run_state,'partial')
        self.assertEqual(completion.decided_items,0)
        self.assertEqual(completion.visibility_state,'not_required')

    def test_swapped_contexts_versions_or_registration_alias_cannot_bind(self):
        metadata,data=self.fixture();m,d=contexts()
        for requests,versions,first,second in (((d,m),(META,DATA),metadata,data),
            ((m,replace(d,registration_id=m.registration_id)),(META,DATA),metadata,data),
            ((m,d),(META,META),metadata,data),((m,d),('bad',DATA),metadata,data),
            ((m,d),(META,DATA),data,metadata)):
            with self.assertRaises(ValueError):self.build(first,second,requests,versions)

    def test_substituted_body_settlement_charge_or_parsed_value_rejects(self):
        metadata,data=self.fixture()
        variants=(replace(data,capture=replace(data.capture,body=b'{}')),
            replace(data,receipt=replace(data.receipt,body=b'{}')),
            replace(data,receipt=replace(data.receipt,settlement=replace(data.receipt.settlement,charged_bytes=0))),
            replace(data,receipt=replace(data.receipt,settlement=replace(data.receipt.settlement,content_sha256='a'*64))),
            replace(data,parsed=replace(data.parsed,raw_sha256='a'*64)))
        for altered in variants:
            with self.assertRaises(ValueError):self.build(metadata,altered)

    def test_captured_context_cannot_be_relabelled_to_another_run_or_registration(self):
        from uuid import UUID
        metadata,data=self.fixture();m,d=contexts()
        with self.assertRaises(ValueError):
            self.build(metadata,data,(replace(m,registration_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),d))
        work=replace(m.work,run_id=UUID('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
        with self.assertRaises(ValueError):self.build(metadata,data,(replace(m,work=work),replace(d,work=work)))

    def test_durable_checkpoint_ids_or_reservation_bound_cannot_be_spliced(self):
        metadata,data=self.fixture();receipt=data.receipt
        foreign='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        altered=(replace(receipt,reservation=replace(receipt.reservation,reservation_id=foreign)),
                 replace(receipt,dispatch=replace(receipt.dispatch,reservation_id=foreign)),
                 replace(receipt,settlement=replace(receipt.settlement,reservation_id=foreign)),
                 replace(receipt,reservation=replace(receipt.reservation,reserved_bytes=0)))
        for forged in altered:
            with self.assertRaises(ValueError):self.build(metadata,replace(data,receipt=forged))

    def test_future_dispatch_or_expired_capture_context_cannot_support_a_manifest(self):
        from datetime import timedelta
        metadata,data=self.fixture();receipt=data.receipt
        with self.assertRaises(ValueError):
            self.build(metadata,replace(data,receipt=replace(receipt,dispatch=replace(receipt.dispatch,dispatched_at=data.capture.retrieved_at+timedelta(seconds=1)))))
        m,d=contexts();expired=replace(d.work,lease_expires_at=data.capture.retrieved_at)
        altered_requests=(replace(m,work=expired),replace(d,work=expired))
        with self.assertRaises(ValueError):
            self.build(replace(metadata,request=altered_requests[0]),replace(data,request=altered_requests[1]),altered_requests)

    def test_source_coverage_does_not_grant_usable_status_or_public_decision(self):
        result=self.build()
        self.assertNotIn('usable',canonical_run_manifest(result.manifest))
        completion=reconcile_run_completion(result.manifest,(),(),(),now=NOW,invalid_source_keys=(METADATA_KEY,))
        self.assertIn(METADATA_KEY,completion.missing_source_keys)
        self.assertEqual(completion.run_state,'partial')
        self.assertEqual(completion.committed_publication_ids,())


if __name__=='__main__':unittest.main()


class IncrementalPairedManifestTests(unittest.TestCase):
    def test_an_identical_known_pair_keeps_both_checks_but_plans_no_duplicate_findings(self):
        h=support.ReservedSSBTests();h.setUp();meta,data=h.pair()
        result=build_ssb_context_manifest(*contexts(),meta,data,META,DATA,
            previous_accepted_data=data.parsed,previous_accepted_metadata=meta.parsed)
        self.assertEqual(result.manifest.items,())
        self.assertEqual(result.attention_reasons,())
        self.assertEqual(len(result.manifest.sources),2)
        completion=reconcile_run_completion(result.manifest,(),(),(),now=NOW)
        self.assertEqual(completion.run_state,'completed')
        self.assertEqual(completion.commit_state,'none')

    def test_metadata_only_body_change_creates_one_definition_item_and_no_numeric_duplicate(self):
        import json
        prior=support.ReservedSSBTests();prior.setUp();meta,data=prior.pair()
        changed=support.ReservedSSBTests();changed.setUp()
        changed.wires['metadata']=json.dumps(json.loads(changed.wires['metadata']),indent=1).encode()
        new_meta,new_data=changed.pair()
        result=build_ssb_context_manifest(*contexts(),new_meta,new_data,META,DATA,
            previous_accepted_data=data.parsed,previous_accepted_metadata=meta.parsed)
        self.assertEqual([i.item_key for i in result.manifest.items],['ssb-14059-metadata-review'])
        self.assertIn('metadata_body_changed',result.attention_reasons)
        self.assertEqual(result.manifest.items[0].source_key,METADATA_KEY)

    def test_data_body_only_change_creates_a_data_disposition_item(self):
        import json
        prior=support.ReservedSSBTests();prior.setUp();meta,data=prior.pair()
        changed=support.ReservedSSBTests();changed.setUp()
        changed.wires['data']=json.dumps(json.loads(changed.wires['data']),indent=1).encode()
        new_meta,new_data=changed.pair()
        result=build_ssb_context_manifest(*contexts(),new_meta,new_data,META,DATA,
            previous_accepted_data=data.parsed,previous_accepted_metadata=meta.parsed)
        self.assertEqual([i.item_key for i in result.manifest.items],['ssb-14059-data-review'])
        self.assertIn('data_body_changed',result.attention_reasons)

    def test_changed_2025_cell_plans_only_the_changed_year(self):
        import json
        prior=support.ReservedSSBTests();prior.setUp();meta,data=prior.pair()
        changed=support.ReservedSSBTests();changed.setUp()
        payload=json.loads(changed.wires['data']);payload['value'][1]=13.2
        changed.wires['data']=json.dumps(payload,separators=(',',':')).encode()
        new_meta,new_data=changed.pair()
        result=build_ssb_context_manifest(*contexts(),new_meta,new_data,META,DATA,
            previous_accepted_data=data.parsed,previous_accepted_metadata=meta.parsed)
        self.assertEqual([i.item_key for i in result.manifest.items],['ssb-14059-year-2025'])
