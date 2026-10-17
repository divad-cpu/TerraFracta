"""Only invented full receipts; no actual storage, source or provider witness."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from datetime import timedelta
from hashlib import sha256
import json
from tests.test_html_preparation_review_report import illustrative_selection
from tests.test_html_proposal_postgres import wire,encode,STORED,LATER
from workers.html_proposal_custody import prepare_html_proposal_custody
from workers.html_proposal_postgres import prepare_html_proposal_store,prepare_html_preparation_reopen
from workers.html_preparation_review_report import html_preparation_review_report


def vector(known=False,markup=False):
    p=illustrative_selection(known_head=known).prepared
    if markup:
        context=json.loads(p.parts.context_raw)
        context['content']['title']='Invented <script>alert("quoted")</script> title'
        context['content']['summary']='An invented <img src=x onerror=quoted> summary remains unverified.'
        p=prepare_html_proposal_custody(p.receipt,p.extraction_expected,json.dumps(context).encode(),current_receipt=p.current_receipt,previous_receipt=p.previous_receipt,
            operation_id=json.loads(p.intent.canonical_metadata)['operation_id'],observed_at=p.observed_at)
    if known:p=prepare_html_proposal_custody(p.receipt,p.extraction_expected,p.parts.context_raw,current_receipt=p.current_receipt,previous_receipt=p.previous_receipt,
        operation_id='a1000000-0000-4000-8000-000000000002',observed_at=p.observed_at)
    request=prepare_html_proposal_store(p);body=wire(request)
    artifact='b1000000-0000-4000-8000-000000000002' if known else body['artifact_id'];stored=STORED+timedelta(microseconds=1) if known else STORED
    body['artifact_id']=artifact;body['stored_at']=stored.isoformat(timespec='microseconds').replace('+00:00','Z')
    expected=prepare_html_preparation_reopen(intent=p.intent,artifact_id=artifact,stored_at=stored,observed_at=LATER)
    raw=html_preparation_review_report(encode(body),expected,extraction_receipt=p.receipt,extraction_expected=p.extraction_expected,current_receipt=p.current_receipt,previous_receipt=p.previous_receipt,observed_at=LATER)
    return dict(operationId=json.loads(p.intent.canonical_metadata)['operation_id'],label='Known-head preparation example' if known else 'Empty-head preparation example',reportJson=raw.decode(),
        expected=dict(reportSha256=sha256(raw).hexdigest(),preparationIntentJson=p.intent.canonical_metadata.decode()))


def vectors():return dict(schema_version=1,kind='fictional_html_preparation_history',reports=[vector(),vector(True)])


if __name__=='__main__':print(json.dumps(vector(markup=True) if sys.argv[1:]==['--markup'] else vectors(),ensure_ascii=False,separators=(',',':')))
