"""Only new pure HTML preparation vectors; no old suite or real storage."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import json
from datetime import timedelta
from tests.test_html_extraction_held_proposal import context,prepare,prepared,UID,READ
from tests.test_html_private_extraction import prepare as extraction
from workers.html_extraction_custody import prepare_html_extraction_store
from workers.feed_postgres_contract import _time


def vectors():
    cases=[]
    for name in ('empty-head','known-head','unicode-assertion'):
        selected=prepared()
        if name=='unicode-assertion':
            out=json.loads(selected.result.output_raw);out.update(proposed_assertion='🙂'*600,source_date_text='Raw source date\n\tstill unparsed')
            selected=prepare_html_extraction_store(extraction(output_raw=json.dumps(out,ensure_ascii=False).encode()))
        ctx=context(selected)
        if name=='known-head':ctx['issue']['head']=dict(publication_id=UID(9),content_sha256='d'*64,changed_at=_time(READ-timedelta(days=1)))
        result=prepare(selected,ctx)
        cases.append(dict(name=name,payloadJson=result.payload_raw.decode(),selectionJson=result.selection_raw.decode(),provenanceJson=result.provenance_raw.decode(),contextJson=result.context_raw.decode()))
    return cases


if __name__=='__main__':print(json.dumps(vectors(),ensure_ascii=False,separators=(',',':')))
