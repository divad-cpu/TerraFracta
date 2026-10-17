"""Plain whole-issue assertions captured before any accepted UTC callback."""
import unittest,json
from datetime import tzinfo,timedelta
from unittest.mock import patch
from tests.test_appended_issue_review import fixture,OBSERVED
import workers.appended_issue_review as m
FOREIGN='ca000000-0000-4000-8000-000000000999'
class UTC(tzinfo):
    def __init__(self,call):self.call=call;self.calls=0
    def utcoffset(self,value):self.calls+=1;self.call();return timedelta(0)
    def dst(self,value):return timedelta(0)
    def tzname(self,value):return 'UTC'
class PlainCompositionEntryCaptureTests(unittest.TestCase):
    def refuse(self,candidate,base,context,at):
        with self.assertRaisesRegex(m.AppendedIssueReviewError,'^appended_issue_review_unavailable$')as error:m.prepare_appended_issue_review(candidate,base,context,observed_at=at)
        self.assertIsNone(error.exception.__cause__)
    def test_initial_wrong_independent_request_cannot_be_repaired_by_outer_clock(self):
        candidate,base,context=fixture();req=candidate.result.extraction.request;good=req.operation_id;vars(req)['operation_id']=FOREIGN
        self.refuse(candidate,base,context,OBSERVED);clock=UTC(lambda:vars(req).update(operation_id=good));seen=[];real=m.parse_reopened_detached_proposal
        def observe(raw,intent,extraction,**kw):seen.append(extraction.request.operation_id);return real(raw,intent,extraction,**kw)
        with patch.object(m,'parse_reopened_detached_proposal',side_effect=observe):self.refuse(candidate,base,context,OBSERVED.replace(tzinfo=clock))
        self.assertEqual(seen,[FOREIGN]);self.assertGreater(clock.calls,0);self.assertEqual(req.operation_id,good)
    def test_valid_nested_context_survives_clock_damage_and_preserves_six_exact_parts(self):
        candidate,base,context=fixture();before=m.prepare_appended_issue_review(candidate,base,context,observed_at=OBSERVED);request=candidate.result.extraction.request
        def damage():vars(request).update(operation_id=FOREIGN);vars(candidate.result.intent).update(canonical_metadata=b'PRIVATE');vars(candidate.result.extraction.result.current.result_request.binding).update(content_sha256='f'*64)
        clock=UTC(damage);after=m.prepare_appended_issue_review(candidate,base,context,observed_at=OBSERVED.replace(tzinfo=clock))
        self.assertEqual(m.composition_parts(after),m.composition_parts(before));self.assertGreater(clock.calls,0);self.assertEqual(request.operation_id,FOREIGN)
        self.assertEqual(len(json.loads(after.proposal_raw)['snapshot']['claims']),3)
    def test_earlier_nested_clock_cannot_repair_later_original_metadata(self):
        candidate,base,context=fixture();request=candidate.result.extraction.request;binding=request.previous.result_request.binding;good=binding.content_sha256;vars(binding)['content_sha256']='f'*64
        clock=UTC(lambda:vars(binding).update(content_sha256=good));vars(candidate)['observed_at']=candidate.observed_at.replace(tzinfo=clock);seen=[];real=m.parse_reopened_detached_proposal
        def observe(raw,intent,extraction,**kw):seen.append(extraction.request.previous.result_request.binding.content_sha256);return real(raw,intent,extraction,**kw)
        with patch.object(m,'parse_reopened_detached_proposal',side_effect=observe):self.refuse(candidate,base,context,OBSERVED)
        self.assertEqual(seen,['f'*64]);self.assertGreater(clock.calls,0)
    def test_unknown_deep_namespaces_refuse_before_any_clock_or_downstream(self):
        for path in [(),('result',),('result','intent'),('result','extraction','request'),('result','extraction','request','current','result_request','mapping')]:
            candidate,base,context=fixture();value=candidate
            for key in path:value=getattr(value,key)
            vars(value)['unexpected']='PRIVATE';clock=UTC(lambda:None)
            with patch.object(m,'parse_reopened_detached_proposal',side_effect=AssertionError('No downstream'))as core:self.refuse(candidate,base,context,OBSERVED.replace(tzinfo=clock));core.assert_not_called()
            self.assertEqual(clock.calls,0)
    def _optional_inventory_candidate(self,*,outcome=False):
        import tests.test_feed_capture_reopen as feed_fixture
        from workers.feed_collection_inventory import prepare_inventory_request,_parse_cut
        from workers.private_extraction_held_proposal import _json
        real=feed_fixture.prepare_capture_reopen;constructed=[]
        def optional(request,raw,*,observed_at,item_id):
            value=json.loads(raw)
            if outcome:
                row=value['rows'][0]
                row['outcomes']=[dict(operation_id=FOREIGN,item_id=item_id,revision=1,state='failed',recorded_at=row['page_stored_at'].replace('Z','+00:00'))]
            else:
                request=prepare_inventory_request(request.scope,item_limit=request.item_limit,cut=_parse_cut(value['cut']),after=request.after)
                value['request']=json.loads(request.canonical_input)
            result=real(request,_json(value),observed_at=observed_at,item_id=item_id);constructed.append(result)
            return result
        with patch.object(feed_fixture,'prepare_capture_reopen',side_effect=optional):values=fixture()
        self.assertEqual(len(constructed),2)
        return values
    def test_existing_explicit_inventory_cut_remains_accepted(self):
        candidate,base,context=self._optional_inventory_candidate()
        result=m.prepare_appended_issue_review(candidate,base,context,observed_at=OBSERVED)
        self.assertEqual(len(json.loads(result.proposal_raw)['snapshot']['claims']),3)
        self.assertEqual(result.baseline_raw,base)
    def test_existing_inventory_outcome_history_remains_accepted(self):
        candidate,base,context=self._optional_inventory_candidate(outcome=True)
        result=m.prepare_appended_issue_review(candidate,base,context,observed_at=OBSERVED)
        self.assertEqual(len(json.loads(result.proposal_raw)['snapshot']['claims']),3)
        self.assertEqual(result.baseline_raw,base)
if __name__=='__main__':unittest.main()
