"""Causal HTML entry assertions across direct and supplied-response paths."""
from datetime import timedelta
from dataclasses import replace
import unittest
from unittest.mock import patch

from tests.test_html_response_capture import values as old_values
from tests.test_html_passage_binding import inputs as old_inputs
from tests.test_response_entry_capture import CallbackUtc
from workers.html_response_capture import bind_supplied_html_response, HtmlResponseError
from workers.html_passage_binding import bind_html_passages, HtmlPassageError


def fresh_mapping(data):
    data['mapping']=replace(data['mapping'],selections=tuple(replace(x) for x in data['mapping'].selections))
    return data

def values():return fresh_mapping(old_values())
def inputs(raw):return fresh_mapping(old_inputs(raw))


class HtmlEntryCaptureTests(unittest.TestCase):
    def run_case(self, mode, direct):
        d=values(); original=inputs(d['body']); target=d['binding']; error=HtmlResponseError
        if direct:
            data=original;data['observed_at']=d['observed_at'];call=lambda:bind_html_passages(**data)
            target=data['binding'];mapping=data['mapping'];error=HtmlPassageError
        else:
            data=d;mapping=data['mapping'];call=lambda:bind_supplied_html_response(**data)
        if mode=='hash': obj=target;name='content_sha256';bad='f'*64
        elif mode=='source': obj=target;name='source_url';bad='https://example.org/foreign'
        elif mode=='retrieval': obj=target;name='retrieved_at';bad=target.retrieved_at+timedelta(days=1)
        elif mode=='selection':obj=mapping.selections[0];name='element_id';bad='missing'
        elif mode=='language':obj=mapping;name='language_code';bad='xx'
        good=getattr(obj,name);object.__setattr__(obj,name,bad)
        def repair():object.__setattr__(obj,name,good)
        data['observed_at']=data['observed_at'].replace(tzinfo=CallbackUtc(repair))
        with self.assertRaises(error):call()
    def test_denied_original_hash_cannot_repair(self):
        for direct in (False,True):
            with self.subTest(direct=direct):self.run_case('hash',direct)
    def test_denied_source_cannot_repair(self):
        for direct in (False,True):
            with self.subTest(direct=direct):self.run_case('source',direct)
    def test_denied_retrieval_cannot_repair(self):
        for direct in (False,True):
            with self.subTest(direct=direct):self.run_case('retrieval',direct)
    def test_denied_nested_selection_cannot_repair(self):
        for direct in (False,True):
            with self.subTest(direct=direct):self.run_case('selection',direct)
    def test_denied_language_mapping_cannot_repair(self):
        for direct in (False,True):
            with self.subTest(direct=direct):self.run_case('language',direct)
    def test_valid_entries_survive_later_caller_mutation(self):
        for direct in (False,True):
            d=values();data=inputs(d['body']) if direct else d
            at=d['observed_at'];error=HtmlPassageError if direct else HtmlResponseError
            original=data['binding'].content_sha256
            def mutate():
                object.__setattr__(data['binding'],'content_sha256','f'*64)
                object.__setattr__(data['mapping'].selections[0],'element_id','missing')
            data['observed_at']=at.replace(tzinfo=CallbackUtc(mutate))
            with self.subTest(direct=direct):
                result=bind_html_passages(**data) if direct else bind_supplied_html_response(**data)
                bound=result if direct else result.bound
                self.assertEqual(bound.document.content_sha256,original)
                self.assertEqual(bound.snapshot.passages[0].text,'Invented current wording.')
                if not direct:self.assertEqual(result.capture.mapping.selections[0].element_id,'chosen')
    def test_unexpected_private_clock_failure_curated(self):
        def fail():raise RuntimeError('PRIVATE_HTML_ENTRY_CANARY')
        for direct in (False,True):
            d=values();data=inputs(d['body']) if direct else d
            data['observed_at']=d['observed_at'].replace(tzinfo=CallbackUtc(fail))
            with self.subTest(direct=direct),self.assertRaisesRegex(HtmlPassageError if direct else HtmlResponseError,
                    '^html_passage_binding_unavailable$' if direct else '^supplied_html_response_unavailable$'):
                bind_html_passages(**data) if direct else bind_supplied_html_response(**data)
    def test_unknown_namespaces_refuse_before_any_clock(self):
        for direct in (False,True):
            called=[];d=values();data=inputs(d['body']) if direct else d
            object.__setattr__(data['binding'],'foreign_private_field','PRIVATE')
            data['observed_at']=d['observed_at'].replace(tzinfo=CallbackUtc(lambda:called.append(True)))
            with self.subTest(direct=direct):
                with self.assertRaises(HtmlPassageError if direct else HtmlResponseError):
                    bind_html_passages(**data) if direct else bind_supplied_html_response(**data)
                self.assertEqual(called,[])

if __name__=='__main__':unittest.main()
