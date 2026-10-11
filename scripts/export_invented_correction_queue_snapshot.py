"""Redacted dated membership for the development desk; no private detail."""
from hashlib import sha256
import json
import sys
from scripts.captured_fictional_pipeline import ROOT
from scripts.check_private_attempt_readiness import private_read
from scripts.check_invented_correction_queue import checked_result, START
from scripts.export_invented_correction_review_snapshot import exact_time, PUBLICATIONS
from scripts.export_invented_correction_recovery_snapshot import PROOF
from workers.closed_pair_channel import _json


def build_snapshot(pages):
    if type(pages) is not list or len(pages)!=3: raise ValueError('Saved queue pages differ')
    request=START; reports=[]; seen=set(); previous=None; capture=None; ticket=None; expiry=None
    for index,page in enumerate(pages):
        value=checked_result('queue',request,page)
        if value['total']!=5 or value['offset']!=index*2: raise ValueError('Saved queue membership differs')
        if capture is None:
            capture=value['capturedAt'];ticket=value['snapshotId'];expiry=value['expiresAt']
        elif value['capturedAt']!=capture or value['snapshotId']!=ticket or value['expiresAt']!=expiry:
            raise ValueError('Saved queue capture changed')
        for item in value['items']:
            at=exact_time(item['reportedAt']);order=(at,item['reportId'])
            if item['reportId'] in seen or previous is not None and order<=previous \
                or item['reviewState']!='new' or item['publicationId'] not in PUBLICATIONS:
                raise ValueError('Saved queue report differs')
            seen.add(item['reportId']);previous=order
            reports.append({'sample':len(reports)+1,'revision':PUBLICATIONS.index(item['publicationId'])+1,
                            'reportedAt':item['reportedAt'],'reviewState':'new'})
        request=value['next']
        if index<2 and request is None or index==2 and request is not None: raise ValueError('Saved queue continuation differs')
    if len(reports)!=5 or [row['revision'] for row in reports]!=[1,1,2,2,2]: raise ValueError('Saved queue editions differ')
    return {'schemaVersion':1,'evidenceKind':'saved_invented_correction_queue_membership','capturedAt':capture,
        'liveStatus':False,'earlierCapturedMembers':4,'capturedMembers':5,'reports':reports,
        'privateDetailsExported':False,'reviewActionsEnabled':False,'sourceRequests':0,'realReports':0,'publicContentChanged':False}


def main():
    if sys.argv[1:]: raise ValueError('Fixed saved queue export accepts no arguments')
    receipt=_json(private_read(PROOF/'CORRECTION_QUEUE_RESULT.json',limit=65536))
    assert all(receipt[key] is False for key in ('primaryChanged','liveReviewEnabled','privacyPolicySelected','publicContentChangedByQueue','browserVerified'))
    assert all(receipt[key] is True for key in ('temporaryAccountsRetired','ownedCloneStopped','lateCommitRequiresNewSnapshot','actualTypeScriptContractsChecked'))
    assert type(receipt['firstCapturedMembers']) is int and receipt['firstCapturedMembers']==4
    assert type(receipt['freshCapturedMembers']) is int and receipt['freshCapturedMembers']==5
    assert type(receipt['actualSourceRequests']) is int and receipt['actualSourceRequests']==0
    assert type(receipt['realReports']) is int and receipt['realReports']==0
    names={'TF007_invented_correction_intake.sql','TF007_invented_correction_reliability.sql',
           'TF007_invented_correction_review.sql','TF007_invented_correction_queue.sql','TF007_invented_correction_review_recovery.sql'}
    assert set(receipt['candidateSha256'])==names
    for name,pin in receipt['candidateSha256'].items():
        assert sha256(private_read(PROOF/('EXACT_'+name),limit=65536)).hexdigest()==pin
    recorded=_json(private_read(PROOF/'QUEUE_MEMBERSHIP_PAGES.json',limit=65536))
    value=build_snapshot(recorded['fresh'])
    with (ROOT/'fixtures/fictional_correction_queue_snapshot.json').open('x',encoding='utf-8') as out:
        out.write(json.dumps(value,indent=2)+'\n')
    print('Saved five dated invented members; no private identity, text, URL, actor or action authority exported.')
    return 0


if __name__=='__main__': raise SystemExit(main())
