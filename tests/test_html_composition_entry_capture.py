"""Real HTML composition entry assertions survive accepted clock callbacks."""
from dataclasses import replace
from datetime import tzinfo,timedelta
import json,unittest
from unittest.mock import patch
from tests.test_html_appended_issue_review import fixture
import workers.html_appended_issue_review as m

FOREIGN='ca000000-0000-4000-8000-000000000999'
class UTC(tzinfo):
    def __init__(self,callback):self.callback=callback;self.calls=0
    def utcoffset(self,value):self.calls+=1;self.callback();return timedelta(0)
    def dst(self,value):return timedelta(0)
    def tzname(self,value):return 'UTC'

class HtmlCompositionEntryCaptureTests(unittest.TestCase):
    def refuse(self,values):
        with self.assertRaisesRegex(m.HtmlAppendedIssueReviewError,'^html_appended_issue_review_unavailable$')as error:m.prepare_html_appended_issue_review(**values)
        self.assertIsNone(error.exception.__cause__)

    def test_invalid_independent_artifact_cannot_be_repaired_by_accepted_outer_clock(self):
        v=fixture();good=v['expected'].artifact_id;wrong=replace(v['expected'],artifact_id=FOREIGN);v['expected']=wrong
        self.refuse(v);clock=UTC(lambda:vars(wrong).update(artifact_id=good));v['observed_at']=v['observed_at'].replace(tzinfo=clock)
        seen=[];real=m.reopen_stored_html_proposal
        def observe(raw,e,**kwargs):seen.append(e.artifact_id);return real(raw,e,**kwargs)
        with patch.object(m,'reopen_stored_html_proposal',side_effect=observe):self.refuse(v)
        self.assertGreater(clock.calls,0);self.assertEqual(seen,[FOREIGN]);self.assertEqual(wrong.artifact_id,good)

    def test_valid_context_survives_outer_callback_damage_to_nested_original_and_intent(self):
        v=fixture();baseline=m.prepare_html_appended_issue_review(**v);expected=v['expected'];document=v['extraction_expected'].current_expected.document
        def damage():vars(expected).update(artifact_id=FOREIGN);vars(document).update(content_sha256='f'*64);vars(expected.intent).update(canonical_metadata=b'PRIVATE')
        clock=UTC(damage);v['observed_at']=v['observed_at'].replace(tzinfo=clock)
        result=m.prepare_html_appended_issue_review(**v)
        self.assertEqual(result,baseline);self.assertGreater(clock.calls,0);self.assertEqual(expected.artifact_id,FOREIGN);self.assertEqual(document.content_sha256,'f'*64)
        self.assertEqual(len(json.loads(result.proposal_raw)['snapshot']['claims']),3)

    def test_earliest_nested_clock_cannot_repair_later_extraction_expectation(self):
        v=fixture();top=v['expected'];e=v['extraction_expected'];good=e.previous_expected.artifact_id
        wrong=replace(e.previous_expected,artifact_id=FOREIGN);v['extraction_expected']=replace(e,previous_expected=wrong)
        clock=UTC(lambda:vars(wrong).update(artifact_id=good));v['expected']=replace(top,observed_at=top.observed_at.replace(tzinfo=clock))
        seen=[];real=m.reopen_stored_html_proposal
        def observe(raw,e,**kwargs):seen.append(kwargs['extraction_expected'].previous_expected.artifact_id);return real(raw,e,**kwargs)
        with patch.object(m,'reopen_stored_html_proposal',side_effect=observe):self.refuse(v)
        self.assertGreater(clock.calls,0);self.assertEqual(seen,[FOREIGN]);self.assertEqual(wrong.artifact_id,good)

    def test_closed_namespaces_refuse_before_any_clock_or_downstream_hook(self):
        for path in [('expected',),('expected','intent'),('extraction_expected',),('extraction_expected','current_expected'),('extraction_expected','previous_expected','mapping')]:
            v=fixture();target=v[path[0]]
            for key in path[1:]:target=getattr(target,key)
            vars(target)['unexpected']='PRIVATE';clock=UTC(lambda:None);v['observed_at']=v['observed_at'].replace(tzinfo=clock)
            with patch.object(m,'reopen_stored_html_proposal',side_effect=AssertionError('No downstream'))as core:self.refuse(v);core.assert_not_called()
            self.assertEqual(clock.calls,0)

if __name__=='__main__':unittest.main()
