"""Synthetic coverage qualification; no SQL or native commands are executed."""
import json
import unittest
from test_shared_write_receipt import CONTAINER,decoder,packet

class TargetRefusalCoverage(unittest.TestCase):
    def decode(self,value):
        return decoder.decode_shared_write_receipt(json.dumps(value),CONTAINER,'replacement')

    def test_prior_successful_replacement_cannot_claim_new_target_refusal_coverage(self):
        value=packet('replacement')
        value['assertions']=[a for a in value['assertions'] if not a['label'].startswith('targetgap_')]
        self.assertIsNone(self.decode(value))

    def test_incomplete_nonwrite_or_original_resolution_evidence_cannot_complete(self):
        for label in ['targetgap_B_transaction_known_nonwrite','targetgap_immutable_original_nonwrite_fence',
            'targetgap_resolution_original_nonwrite','targetgap_no_original_private_record',
            'targetgap_no_new_accepted_or_open_effect','targetgap_original_SQL_ticket_cannot_write_again']:
            value=packet('replacement')
            value['assertions']=[a for a in value['assertions'] if a['label']!=label]
            self.assertIsNone(self.decode(value))

if __name__=='__main__':unittest.main()
