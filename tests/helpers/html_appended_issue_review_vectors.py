"""Fresh synthetic full HTML receipts and independently bound whole-issue context."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from copy import deepcopy
from hashlib import sha256
import json
from tests.test_html_appended_issue_review import fixture,UID
from workers.html_appended_issue_review import prepare_html_appended_issue_review,html_composition_parts,PART_KEYS
from workers.feed_postgres_contract import _time


def vector(**changes):
    arguments=fixture(**changes);prepared=prepare_html_appended_issue_review(**arguments)
    b={key:raw.decode() for key,raw in zip(('candidateReportJson','baselineJson','canonicalBaselineJson','contextJson','proposalJson','compositionJson'),html_composition_parts(prepared))}
    report=json.loads(b['candidateReportJson'])
    expected=dict(compositionSha256=sha256(prepared.composition_raw).hexdigest(),candidateReportSha256=sha256(prepared.candidate_report_raw).hexdigest(),preparationIntentJson=report['intent_json'],baselineSha256=sha256(prepared.baseline_raw).hexdigest(),contextSha256=sha256(prepared.context_raw).hexdigest(),observedAt=_time(arguments['observed_at']))
    return dict(bundle=b,expected=expected)


def vectors():
    default=vector()
    def upper(b):b['snapshot']['claims'][0]['id']='ABCDEF00-0000-4000-8000-000000000950'
    def maximum(b):
        first=deepcopy(b['snapshot']['claims'][0]);b['snapshot']['claims']=[dict(first,id=UID(1000+i)) for i in range(29)];b['dependencyManifest']['sourceVersionIds']=[UID(960)]
    def markup(c):c['page']['title']='Invented <script>alert("quoted")</script> whole title';c['page']['summary']='An invented <img src=x onerror=quoted> whole summary.'
    return dict(schema_version=1,kind='fictional_html_appended_issue_review',**default,cases=[default,vector(baseline_change=upper),vector(baseline_change=maximum),vector(context_change=markup)])
if __name__=='__main__':print(json.dumps(vectors(),ensure_ascii=False,separators=(',',':')))
