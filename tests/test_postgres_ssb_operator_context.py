"""Bounded actual-SSR navigation extraction; no browser, database or network."""
import unittest

from scripts.postgres_ssb_operator_fixture import Navigation, exact_link, selected_link


class SSBOperatorNavigationTests(unittest.TestCase):
    def test_get_form_and_html_escaped_proposal_scope_are_consumed(self):
        html = '''<a href="/editorial-preview/held/proposal?runId=run%3Aone&amp;decisionId=decision%3Atwo">Inspect</a>
          <form method="GET" action="/editorial-preview/audit">
          <input type="hidden" name="runId" value="run:one">
          <select name="issueId"><option value="issue:three">Issue</option></select>
          <button type="submit">Inspect</button></form>'''
        navigation = Navigation(html)
        self.assertEqual(selected_link(navigation, '/editorial-preview/held/proposal',
            {'runId': 'run:one', 'decisionId': 'decision:two'}),
            {'runId': 'run:one', 'decisionId': 'decision:two'})
        self.assertEqual(navigation.forms, [{'method': 'get',
            'action': '/editorial-preview/audit',
            'fields': {'runId': 'run:one', 'issueId': 'issue:three'}}])

    def test_navigation_does_not_invent_an_unrendered_selection(self):
        navigation = Navigation('<a href="/editorial-preview/held?runId=another">Other</a>')
        with self.assertRaises(AssertionError):
            selected_link(navigation, '/editorial-preview/held', {'runId': 'wanted'})

    def test_foreign_origin_fragment_duplicate_or_extra_scope_is_refused(self):
        for href in ('https://example.test/editorial-preview/held?runId=r',
            '//example.test/editorial-preview/held?runId=r',
            '/editorial-preview/held?runId=r#other',
            '/editorial-preview/held?runId=r&runId=r',
            '/editorial-preview/held?runId=r&extra=s',
            '/other?runId=r'):
            with self.subTest(href=href), self.assertRaises(AssertionError):
                exact_link(href, '/editorial-preview/held', {'runId'})

    def test_ambiguous_form_fields_are_refused(self):
        for html in ('<form><input name="runId" value="a"><input name="runId" value="b"></form>',
            '<form><select name="issueId"><option value="a"></option><option value="b"></option></select></form>'):
            with self.subTest(html=html), self.assertRaises(AssertionError):
                Navigation(html)


if __name__ == '__main__':
    unittest.main()
