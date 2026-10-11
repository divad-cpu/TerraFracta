"""Read-only strict reconciliation of six retained actual SQL receipts.

No replay or new observation. Compare against independently saved canonical
bytes and the current head; ambiguous latest is held. Keep original closeout.
"""
from datetime import datetime,timezone
import json
import sys
from scripts.check_response_native_compatibility import DB,execute,TRIAL
from scripts.fictional_response_backend import verify_target
from scripts.check_synthetic_visibility_draft import inputs
from scripts.check_run_admission_concurrency import quote
from workers.visibility_attempts import parse_visibility_attempt,VisibilityExpectation
from workers.visibility_receipts import parse_synthetic_visibility_receipt


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed read-only reconciliation accepts no arguments')
    verify_target(migration_count=34);assert execute('select current_database();').strip()==DB
    evidence=TRIAL/'SYNTHETIC_VISIBILITY_RECEIPTS.json';assert not evidence.exists()
    data=inputs();expected=VisibilityExpectation(data['runId'],data['publicationId'],data['publicationHash'],tuple(data['sourceIds']),
      datetime.fromisoformat(data['activatedAt']),datetime.fromisoformat(data['finishedAt']))
    rows=json.loads(execute("select jsonb_agg(jsonb_build_object('canonical',canonical_observations,'key',attempt_key,'receipt',"
      "terra_private.synthetic_visibility_receipt(v.id,'stored'),'currentHead',h.current_publication_id) order by v.recorded_at,v.id) "
      "from terra_private.synthetic_visibility_attempts v join terra_private.issue_publications p on p.id=v.publication_id "
      'join terra_private.issue_heads h on h.issue_id=p.issue_id;'))
    assert len(rows)==6
    checked=[]
    for row in rows:
        attempt=parse_visibility_attempt(row['canonical'].encode())
        receipt=parse_synthetic_visibility_receipt(json.dumps(row['receipt']).encode(),attempt,expected,
          attempt_key=row['key'],expected_status='stored',current_publication_id=row['currentHead'],now=datetime.now(timezone.utc))
        assert not receipt.evaluation.runtime_verified
        checked.append({'attemptId':receipt.attempt_id,'key':receipt.attempt_key,'state':receipt.evaluation.state,'runtimeVerified':False})
    newest=json.loads(execute('select terra_private.read_latest_synthetic_visibility('+quote(data['runId'])+','+quote(data['publicationId'])+');'))
    try:parse_synthetic_visibility_receipt(json.dumps(newest).encode(),attempt,expected,attempt_key=row['key'],
      expected_status='latest',current_publication_id=row['currentHead'],now=datetime.now(timezone.utc))
    except ValueError:pass
    else:raise AssertionError('Ambiguous latest response accepted')
    assert inputs()['summary']==data['summary']
    evidence.write_text(json.dumps({'evidenceKind':'actual_readonly_synthetic_receipt_reconciliation',
      'observedAt':datetime.now(timezone.utc).isoformat(),'database':DB,'checked':checked,'latestAmbiguityHeld':True,
      'originalCloseoutUnchanged':True,'runtimeVerified':False,'actualSourceFetches':0,'primaryChanged':False},indent=2)+'\n');evidence.chmod(0o600)
    print('PASS six actual SQL visibility receipts match independent canonical attempts; ambiguous latest held, original closeout unchanged.')
    return 0

if __name__=='__main__':raise SystemExit(main())
