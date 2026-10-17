"""Fixed purely synthetic full-receipt vectors; never actual DB or source proof."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import json
from tests.test_html_extraction_custody import prepared,wire,encoded,cold,READ
from tests.test_html_private_extraction import inputs
from workers.html_private_extraction import prepare_html_private_extraction
from workers.html_extraction_custody import prepare_html_extraction_store
from workers.html_extraction_review_report import html_extraction_review_report


def project(selected):
    return json.loads(html_extraction_review_report(encoded(wire(selected)),cold(selected),
        current_receipt=selected.result.current_receipt,previous_receipt=selected.result.previous_receipt,observed_at=READ))


def changed_output(assertion,date=None):
    values=inputs();output=json.loads(values['output_raw']);output['proposed_assertion']=assertion;output['source_date_text']=date
    values['output_raw']=json.dumps(output,ensure_ascii=False,separators=(',',':')).encode()
    return project(prepare_html_extraction_store(prepare_html_private_extraction(**values)))


def vectors():
    return dict(base=project(prepared()),markup=changed_output('Invented <script>alert("quoted")</script> & <img src=x onerror=quoted> statement.','<b>unspecified date</b>'),
        unicode=changed_output('😀'*600,'\ufeff'+'日'*79),bom=changed_output('\ufeffAn invented boundary BOM remains valid.'),
        whitespace=changed_output('An invented\nstatement\twith interior\u0085NEL.'),date_none=changed_output('An invented statement has no source date.'))


if __name__=='__main__':print(json.dumps(vectors(),ensure_ascii=False,separators=(',',':')))
