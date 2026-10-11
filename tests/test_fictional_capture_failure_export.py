from copy import deepcopy
import json
from pathlib import Path
import unittest
from scripts.export_fictional_capture_failure import build_snapshot
ROOT=Path(__file__).resolve().parents[1]


def proof():
    return {'evidenceKind':'actual_owner_failed_capture_partial_closeout','network':'none','primaryChanged':False,'runtimeAccepted':False,
      'actualSourceFetches':0,'uncertainChargeRetained':True,'observedAt':'2026-10-01T10:11:00+00:00','finishedAt':'2026-10-01T10:10:59+00:00',
      'counts':{'reservations':1,'dispatches':1,'settlements':1,'sourceChecks':2,'failedChecks':1,'deferredChecks':1,'versions':0,'manifests':1,'closeouts':1,'activations':0,'chargedBytes':65537},
      'terminalSettlement':{'outcome':'uncertain','chargedBodyBytes':65537,'contentSha256':None},'fixtureOpenAttempts':1,'fixtureStreamsOpened':0,'dependentSourceRequests':0,
      'failedSourceKey':'fictional-a','deferredSourceKey':'fictional-b','summary':{'runState':'partial','commitState':'none','visibilityState':'not_required',
       'dueSourceKeys':['fictional-a','fictional-b'],'missingSourceKeys':['fictional-a','fictional-b'],'coveredSourceKeys':[],
       'invalidSourceKeys':[],'pendingItemKeys':[],'committedPublicationIds':[],'visiblePublicationIds':[],'pendingVisibilityPublicationIds':[],
       'failedVisibilityPublicationIds':[],'expectedItems':0,'decidedItems':0,'heldItems':0}}


class FailedCaptureExportTests(unittest.TestCase):
    def test_whitelist_preserves_missing_coverage_without_fabricated_measurement(self):
        row=proof();row.update(runId='private',workClaimId='private',rawBody='private',principal='private')
        result=build_snapshot(row)
        self.assertIsNone(result['measuredResponseBytes'])
        self.assertEqual(result['savedCloseouts'],1)
        self.assertEqual(result['retainedChargeBytes'],65537)
        self.assertFalse(any(key in result for key in ('runId','workClaimId','rawBody','principal')))

    def test_runtime_or_fabricated_counts_and_measurement_refuse(self):
        for section,key,value in ((None,'runtimeAccepted',True),(None,'primaryChanged',True),(None,'actualSourceFetches',1),
          (None,'fixtureOpenAttempts',True),('terminalSettlement','chargedBodyBytes',65537.0),('counts','sourceChecks',True),('counts','chargedBytes',0),('counts','versions',1),('terminalSettlement','outcome','measured')):
            row=proof();(row if section is None else row[section])[key]=value
            with self.assertRaises(ValueError):build_snapshot(row)

    def test_hidden_missing_source_or_invented_findings_refuse(self):
        for key,value in (('runState','completed'),('missingSourceKeys',[]),('coveredSourceKeys',['fictional-a']),('expectedItems',1),('heldItems',1)):
            row=proof();row['summary'][key]=value
            with self.assertRaises(ValueError):build_snapshot(row)

    def test_future_finish_or_naive_time_refuses(self):
        for value in ('2027-01-01T00:00:00+00:00','2026-10-01T10:10:59'):
            row=proof();row['finishedAt']=value
            with self.assertRaises(ValueError):build_snapshot(row)

if __name__=='__main__':unittest.main()
