"""The fixed observer cannot start, retry or select another native journal."""
from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from scripts import inspect_current_supervised_correction_review as observer


class SupervisedReviewObserverTests(unittest.TestCase):
    def test_fixed_read_observes_without_writing_an_absent_journal(self):
        with TemporaryDirectory() as scratch:
            target=Path(scratch)/'absent'
            with patch.object(observer,'DIRECTORY',target),patch.object(observer.sys,'argv',['fixed-observer']):
                output=StringIO()
                with redirect_stdout(output):self.assertEqual(observer.main(),0)
            self.assertEqual(json.loads(output.getvalue()),{'state':'idle'})
            self.assertFalse(target.exists())

    def test_arguments_refuse_before_any_inspection(self):
        with patch.object(observer.sys,'argv',['fixed-observer','private-path']),patch.object(observer,'inspect_invented_operation') as inspect:
            with self.assertRaises(ValueError):observer.main()
            inspect.assert_not_called()


if __name__=='__main__':unittest.main()
