from copy import deepcopy
import json
import unittest
from scripts.export_invented_correction_review_snapshot import build_snapshot, PUBLICATIONS, REQUIRED_DENIALS, CURRENT_DENIALS, CANDIDATES


class PrivateReviewExportTests(unittest.TestCase):
    def setUp(self):
        self.pins = dict(zip(CANDIDATES, ('a'*64,'b'*64,'c'*64)))
        events = [{'sequence':1,'fromState':'new','toState':'in_review','recordedAt':'2026-10-03T05:00:00.000001Z'},
                  {'sequence':2,'fromState':'in_review','toState':'closed','recordedAt':'2026-10-03T05:00:00.000002Z'}]
        statuses = []
        for index, state in enumerate(('closed','new','in_review','new')):
            count = {'new':0,'in_review':1,'closed':2}[state]
            statuses.append({'schemaVersion':1,'status':'private_review_snapshot',
                'reportId':f'aaaaaaa{index}-aaaa-4aaa-8aaa-aaaaaaaaaaaa','publicationId':PUBLICATIONS[index//2],
                'reviewState':state,'reportedAt':'2026-10-03T05:00:00.000000Z',
                'reviewedAt':events[count-1]['recordedAt'] if count else None,'events':deepcopy(events[:count])})
        self.receipt = {'evidenceKind':'actual_invented_correction_private_review','candidateSha256':self.pins,
            'observedAt':'2026-10-03T05:01:00Z','privateReports':4,'requestReceipts':4,'reviewEvents':3,
            'actualSourceRequests':0,'modelCalls':0,'realReports':0,'statuses':statuses,'states':{'new':2,'in_review':1,'closed':1},
            'denials':sorted(REQUIRED_DENIALS)}
        self.receipt.update({key:False for key in ('primaryChanged','liveReviewEnabled','privacyPolicySelected','notificationSent',
                                                 'publicContentChangedByReports','browserVerified')})
        self.receipt.update({key:True for key in ('temporaryAccountsRetired','ownedCloneStopped','actualTypeScriptContractsChecked',
            'duplicateEventLockWaitObserved','competingTransitionLockWaitObserved','rollbackLeftNoEventOrStateChange',
            'closureRecoveredAfterUnconsumedCommit','historicalReceiptReplayDidNotReopenReport','historicalReviewDuringWithdrawnDisplayRights',
            'reportIdentityContentAndPublicationsUnchanged','eventsAppendOnly')})
    def checked(self): return build_snapshot(self.receipt, self.pins)
    def test_exact_counts_export_no_private_ids_bodies_paths_credentials_or_notes(self):
        self.receipt.update(privateEvidenceDirectory='/private-canary',password='private-canary',reportDetails='private-canary')
        value = self.checked(); encoded = json.dumps(value)
        self.assertEqual(value['states'], {'new':2,'in_review':1,'closed':1})
        self.assertEqual([edition['privateReports'] for edition in value['editions']], [2,2])
        for private in ('canary', 'reportId', 'publicationId', 'reviewer', 'resolutionNote', *PUBLICATIONS): self.assertNotIn(private, encoded)
        self.assertFalse(value['liveReviewEnabled']); self.assertFalse(value['publicContentChanged'])
    def test_wrong_native_scope_counts_missing_refusals_and_live_promotion_refuse(self):
        original = deepcopy(self.receipt)
        for key, value in (('candidateSha256', {}), ('privateReports', True), ('reviewEvents', False),
            ('ownedCloneStopped', False), ('liveReviewEnabled', True), ('notificationSent', True), ('privacyPolicySelected', True)):
            self.receipt = deepcopy(original); self.receipt[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.checked()
        self.receipt = deepcopy(original); self.receipt['denials'].pop()
        with self.assertRaises(ValueError): self.checked()
    def test_duplicated_id_extra_status_body_event_order_and_microsecond_clock_tampering_refuse(self):
        original = deepcopy(self.receipt)
        changes = [lambda statuses: statuses[1].update(reportId=statuses[0]['reportId']),
            lambda statuses: statuses[0].update(details='private-body-canary'),
            lambda statuses: statuses[0].update(reviewedAt='2026-10-03T05:00:00.000003Z'),
            lambda statuses: statuses[0].update(reportedAt='2026-10-03T05:00:00.000002Z'),
            lambda statuses: statuses[0]['events'].reverse(),
            lambda statuses: statuses[0]['events'][0].update(reviewer='private-canary')]
        for index, change in enumerate(changes):
            self.receipt = deepcopy(original); change(self.receipt['statuses'])
            with self.subTest(index=index), self.assertRaises(ValueError): self.checked()
    def test_wrong_revision_distribution_and_claimed_state_totals_refuse(self):
        self.receipt['statuses'][0]['publicationId'] = PUBLICATIONS[1]
        with self.assertRaises(ValueError): self.checked()

    def test_boolean_state_counts_and_silently_truncated_event_precision_refuse(self):
        original = deepcopy(self.receipt)
        self.receipt['states']['closed'] = True
        with self.assertRaises(ValueError): self.checked()
        self.receipt = deepcopy(original)
        self.receipt['statuses'][0]['events'][0]['recordedAt'] = '2026-10-03T05:00:00.0000009Z'
        with self.assertRaises(ValueError): self.checked()

    def test_archived_candidate_names_and_pin_shapes_are_required(self):
        for wrong in ({'one':'a'*64,'two':'b'*64,'three':'c'*64}, {**self.pins,CANDIDATES[0]:'x'*64}):
            self.receipt['candidateSha256'] = wrong
            with self.subTest(pins=wrong), self.assertRaises(ValueError): build_snapshot(self.receipt, wrong)
        self.setUp(); self.receipt['states'] = {'new':2,'in_review':0,'closed':2}
        with self.assertRaises(ValueError): self.checked()

    def test_current_exact_refusals_do_not_change_the_historical_export_contract(self):
        with self.assertRaises(ValueError):build_snapshot(self.receipt,self.pins,require_current_denials=True)
        self.receipt['denials']=sorted(CURRENT_DENIALS)
        with self.assertRaises(ValueError):self.checked()
        self.assertEqual(build_snapshot(self.receipt,self.pins,require_current_denials=True)['reviewEvents'],3)
        for changed in (self.receipt['denials'][:-1], self.receipt['denials']+['unexpected']):
            with self.subTest(denials=changed),self.assertRaises(ValueError):
                build_snapshot({**self.receipt,'denials':changed},self.pins,require_current_denials=True)
        for wrong in (1,None,'current'):
            with self.subTest(version=wrong),self.assertRaises(ValueError):
                build_snapshot(self.receipt,self.pins,require_current_denials=wrong)


if __name__ == '__main__': unittest.main()
