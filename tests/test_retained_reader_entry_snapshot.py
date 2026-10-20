"""Reader callback ownership over existing invented seven-route in-memory ports."""
from asyncio import CancelledError
from dataclasses import replace,asdict
from datetime import tzinfo,timedelta
import json
import unittest
from tests.test_retained_document_reader import fixture,Port
from workers.bounded_worker_process import WorkerOutput
from workers.feed_postgres_contract import COMMIT_MARKER
from workers.retained_document_reader import read_retained_document,RetainedDocumentReadError


def invoke(e,inventory,port,clock):
    return read_retained_document(inventory,binding=e.binding,mapping=e.mapping,
        association=e.association,query=port,utc_now=clock)

def output(raw,code=0):return WorkerOutput(raw+b'\n'+COMMIT_MARKER+b'\n',b'',code)


class RetainedReaderEntrySnapshotTests(unittest.TestCase):
    def test_invalid_initial_span_cannot_be_repaired_by_first_clock(self):
        e,inventory,bodies,at=fixture();span=e.mapping.spans[0];good=span.start
        object.__setattr__(span,'start',-1);calls=[]
        def repair():
            if not calls:object.__setattr__(span,'start',good)
            calls.append(True);return at
        with self.assertRaises(RetainedDocumentReadError):invoke(e,inventory,Port(bodies),repair)

    def test_valid_initial_graph_survives_later_clock_damage(self):
        e,inventory,bodies,at=fixture();baseline=invoke(e,inventory,Port(bodies),lambda:at);before=asdict(baseline);calls=[]
        def damage():
            if not calls:
                object.__setattr__(e.mapping.spans[0],'start',-1)
                object.__setattr__(e.association,'document_source_url','https://example.org/foreign')
            calls.append(True);return at
        port=Port(bodies);actual=invoke(e,inventory,port,damage)
        self.assertEqual(asdict(actual),before);self.assertEqual((actual.query_count,len(port.calls),len(calls)),(7,7,14))
        self.assertIsNot(actual.reopened.request.mapping,e.mapping)

    def test_invalid_query_output_cannot_be_repaired_at_any_post_read_clock(self):
        for index in range(7):
            e,inventory,bodies,at=fixture();bad=output(bodies[index],1);changed=list(bodies);changed[index]=bad
            calls=[]
            def repair():
                calls.append(True)
                if len(calls)==2*(index+1):object.__setattr__(bad,'returncode',0)
                return at
            port=Port(changed)
            with self.subTest(index=index):
                with self.assertRaises(RetainedDocumentReadError):invoke(e,inventory,port,repair)
                self.assertEqual(len(port.calls),index+1)

    def test_valid_query_output_is_owned_before_each_post_read_clock(self):
        for index in range(7):
            e,inventory,bodies,at=fixture();original=list(bodies);good=output(bodies[index]);changed=list(bodies);changed[index]=good;calls=[]
            def damage():
                calls.append(True)
                if len(calls)==2*(index+1):
                    object.__setattr__(good,'stdout',b'FICTIONAL_PRIVATE_SUBSTITUTION')
                    object.__setattr__(good,'returncode',1)
                return at
            port=Port(changed)
            with self.subTest(index=index):
                actual=invoke(e,inventory,port,damage)
                self.assertEqual(actual.status,'confirmed_original_and_complete_result')
                self.assertEqual(actual.full_receipt,original[-1]);self.assertEqual((len(port.calls),len(calls)),(7,14))

    def test_unknown_initial_namespace_and_foreign_output_refuse_before_later_hooks(self):
        with self.subTest(context='initial'):
            e,inventory,bodies,at=fixture();object.__setattr__(e.mapping,'foreign',object());calls=[];port=Port(bodies)
            def clock():calls.append(True);return at
            with self.assertRaises(RetainedDocumentReadError):invoke(e,inventory,port,clock)
            self.assertEqual(calls,[]);self.assertEqual(port.calls,[])
        with self.subTest(context='output'):
            e,inventory,bodies,at=fixture();calls=[];queries=[]
            class Foreign:
                @property
                def stdout(self):raise AssertionError('Foreign stdout getter must not run')
            def foreign_query(sql):queries.append(sql);return Foreign()
            with self.assertRaises(RetainedDocumentReadError):invoke(e,inventory,foreign_query,clock)
            self.assertEqual(len(queries),1);self.assertEqual(len(calls),1)

    def test_each_injected_clock_instant_is_normalized_once(self):
        e,inventory,bodies,at=fixture();ticks=[]
        class Zone(tzinfo):
            calls=0
            def utcoffset(self,value):self.calls+=1;return timedelta(0)
            def dst(self,value):return timedelta(0)
        zone=Zone();instant=at.replace(tzinfo=zone)
        def clock():ticks.append(True);return instant
        actual=invoke(e,inventory,Port(bodies),clock)
        self.assertEqual(actual.status,'confirmed_original_and_complete_result')
        self.assertEqual(len(ticks),14);self.assertEqual(zone.calls,14)

    def test_absence_and_selected_miss_keep_exact_query_clock_counts(self):
        e,inventory,bodies,at=fixture();ref=json.loads(bodies[1]);ref['reference']=None
        port=Port([bodies[0],json.dumps(ref).encode()]);ticks=[]
        def clock():ticks.append(True);return at
        actual=invoke(e,inventory,port,clock)
        self.assertEqual((actual.status,len(port.calls),len(ticks)),('absent_for_selected_occurrence',2,4))
        e,inventory,bodies,at=fixture();e=replace(e,association=replace(e.association,feed_item_id='90000000-0000-4000-8000-000000000001'))
        port=Port(bodies);ticks=[]
        with self.assertRaisesRegex(RetainedDocumentReadError,'^retained_document_outside_selected_page$'):
            invoke(e,inventory,port,clock)
        self.assertEqual((len(port.calls),len(ticks)),(1,2))

    def test_fixed_clock_fault_and_exact_cancellation_pre_and_post_read(self):
        for trigger in [1,2]:
            for kind in [RuntimeError,KeyboardInterrupt,SystemExit,CancelledError]:
                e,inventory,bodies,at=fixture();ticks=[];failure=kind('FICTIONAL_PRIVATE_CALLBACK');port=Port(bodies)
                def clock():
                    ticks.append(True)
                    if len(ticks)==trigger:raise failure
                    return at
                with self.subTest(trigger=trigger,kind=kind.__name__):
                    with self.assertRaises(RetainedDocumentReadError if kind is RuntimeError else kind) as caught:invoke(e,inventory,port,clock)
                    if kind is RuntimeError:
                        self.assertEqual(str(caught.exception),'retained_document_read_unavailable');self.assertIsNone(caught.exception.__cause__)
                    else:self.assertIs(caught.exception,failure)
                    self.assertEqual(len(port.calls),trigger-1)


if __name__=='__main__':unittest.main()
