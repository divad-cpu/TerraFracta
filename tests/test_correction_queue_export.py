from copy import deepcopy
import json
import sys
import unittest
from unittest.mock import patch
from scripts import export_invented_correction_queue_snapshot as export


class SavedQueueExportTests(unittest.TestCase):
    def setUp(self):
        reports=[{'reportId':'private-'+str(index),'reportedAt':'2026-10-03T07:00:0'+str(index)+'Z',
            'publicationId':export.PUBLICATIONS[0 if index<2 else 1],'reviewState':'new'} for index in range(5)]
        self.pages=[{'offset':index*2,'total':5,'snapshotId':'private-ticket','capturedAt':'2026-10-03T07:01:00Z',
            'expiresAt':'2026-10-03T07:03:00Z','items':reports[index*2:index*2+2],
            'next':{'schemaVersion':1,'snapshotId':'private-ticket','offset':index*2+2} if index<2 else None} for index in range(3)]
        patched=patch.object(export,'checked_result',side_effect=lambda kind,request,result:result)
        patched.start();self.addCleanup(patched.stop)

    def test_redaction_preserves_member_order_editions_dates_and_no_private_identity(self):
        value=export.build_snapshot(self.pages)
        self.assertEqual([row['revision'] for row in value['reports']],[1,1,2,2,2])
        self.assertEqual([row['sample'] for row in value['reports']],list(range(1,6)))
        for word in ('private-','snapshotId','reportId','publicationId','expiresAt','items','next'):
            self.assertNotIn(word,json.dumps(value))

    def test_cross_page_capture_duplicates_and_state_drift_refuse(self):
        changes=[]
        for key,value in (('snapshotId','another-ticket'),('capturedAt','2026-10-03T07:01:01Z'),('total',4)):
            pages=deepcopy(self.pages);pages[1][key]=value;changes.append(pages)
        pages=deepcopy(self.pages);pages[1]['items'][0]['reportId']=pages[0]['items'][0]['reportId'];changes.append(pages)
        pages=deepcopy(self.pages);pages[1]['items'][0]['reviewState']='closed';changes.append(pages)
        pages=deepcopy(self.pages);pages[2]['next']={'offset':6};changes.append(pages)
        for pages in changes:
            with self.subTest(pages=pages),self.assertRaises(ValueError): export.build_snapshot(pages)

    def test_cli_selectors_refuse_before_read(self):
        with patch.object(sys,'argv',['fixed','--live']),patch.object(export,'private_read') as read:
            with self.assertRaises(ValueError): export.main()
            read.assert_not_called()


if __name__=='__main__': unittest.main()
