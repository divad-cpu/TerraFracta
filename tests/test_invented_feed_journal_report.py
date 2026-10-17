"""Fixed CLI and one reopened report join the real local journal components."""

from contextlib import redirect_stdout,redirect_stderr
from io import StringIO
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.rehearse_invented_feed_journal import main,run
from workers.invented_feed_journal import InventedFeedJournal,FeedJournalError,NAME
from workers.invented_feed_journal_report import invented_feed_journal_report


class InventedFeedJournalReportTests(unittest.TestCase):
    def test_fixed_chain_reopens_into_actual_separate_discovery_and_processing_counts(self):
        with tempfile.TemporaryDirectory(prefix='tf-invented-feed-report-') as directory:
            p=Path(directory);result=run(p)
            self.assertEqual(result['kind'],'isolated_invented_feed_journal_report')
            self.assertEqual((result['pages_stored'],result['item_occurrences'],result['processing_outcomes_stored']),(2,4,3))
            self.assertEqual(result['processing'],{'pending':1,'failed':1,'processed':1,'parse_held':1})
            self.assertEqual(result['traversal'],{'revision':2,'state':'window_boundary','next_url_assertion':None})
            self.assertFalse(result['source_history_complete'])
            self.assertEqual((result['source_requests'],result['model_calls']),(0,0))
            self.assertFalse(result['publication_enabled']);self.assertFalse(result['source_permission_issued'])
            self.assertFalse(result['operational_backend_selected'])
            with InventedFeedJournal(p) as reopened:
                self.assertEqual(invented_feed_journal_report(reopened),result)
            text=json.dumps(result)
            self.assertNotIn('127.0.0.1',text);self.assertNotIn('<item>',text);self.assertNotIn(directory,text)

    def test_real_module_cli_emits_one_report_and_refuses_nonempty_reexecution(self):
        with tempfile.TemporaryDirectory(prefix='tf-invented-feed-cli-') as directory:
            args=[sys.executable,'-B','-m','scripts.rehearse_invented_feed_journal','--directory',directory]
            child=subprocess.run(args,capture_output=True,timeout=10)
            self.assertEqual(child.returncode,0,child.stderr)
            self.assertEqual(child.stderr,b'');self.assertEqual(len(child.stdout.splitlines()),1)
            self.assertEqual(json.loads(child.stdout)['processing']['failed'],1)
            before=(Path(directory)/NAME).read_bytes()
            again=subprocess.run(args,capture_output=True,timeout=10)
            self.assertEqual(again.returncode,2);self.assertEqual(again.stdout,b'')
            self.assertNotIn(directory.encode(),again.stderr)
            self.assertEqual(before,(Path(directory)/NAME).read_bytes())

    def test_help_unknown_arguments_and_missing_directory_do_not_create_storage(self):
        for args,expected in [(['--help'],0),([],2),(['--url','https://actual.example'],2),
                              (['--directory','relative'],2)]:
            with self.subTest(args=args),redirect_stdout(StringIO()) as out,redirect_stderr(StringIO()) as err:
                self.assertEqual(main(args),expected)
                self.assertNotIn('Traceback',err.getvalue())

    def test_corrupted_page_prevents_report_instead_of_rendering_coverage(self):
        with tempfile.TemporaryDirectory(prefix='tf-invented-feed-report-fault-') as directory:
            p=Path(directory);run(p)
            with InventedFeedJournal(p) as store:
                store.connection.execute("UPDATE pages SET raw=x'626164'")
                with self.assertRaisesRegex(FeedJournalError,'^journal_report_unavailable$'):
                    invented_feed_journal_report(store)

    def test_unexpected_cli_fault_keeps_exception_path_and_source_bodies_private(self):
        with patch('scripts.rehearse_invented_feed_journal.run',side_effect=RuntimeError('PRIVATE_CANARY')), \
             patch('workers.error_diagnostics.record_worker_error') as record, \
             redirect_stdout(StringIO()) as out,redirect_stderr(StringIO()) as err:
            self.assertEqual(main(['--directory','/private/not-opened']),1)
            self.assertEqual(out.getvalue(),'')
            self.assertNotIn('PRIVATE_CANARY',err.getvalue())
            self.assertNotIn('/private/not-opened',err.getvalue())
            record.assert_called_once_with('collector_worker',directory=None)

if __name__=='__main__':unittest.main()
