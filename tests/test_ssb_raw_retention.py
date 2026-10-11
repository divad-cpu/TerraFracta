"""Local retention CLI output and opt-in pruning boundaries."""

from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import unittest
from unittest.mock import patch

from scripts.ssb_raw_retention import main


class SSB14059RawRetentionCliTests(unittest.TestCase):
    def test_default_is_read_only_and_prune_requires_explicit_flag(self) -> None:
        output = StringIO()
        with patch("scripts.ssb_raw_retention.prune_expired_ssb_14059_pairs", return_value=2) as prune:
            with redirect_stdout(output):
                self.assertEqual(main([]), 0)
                self.assertEqual(main(["--prune-expired"]), 0)
        self.assertEqual(prune.call_args_list[0].kwargs, {"dry_run": True})
        self.assertEqual(prune.call_args_list[1].kwargs, {"dry_run": False})
        self.assertIn("Found 2", output.getvalue())
        self.assertIn("Pruned 2", output.getvalue())

    def test_storage_error_does_not_print_private_path(self) -> None:
        error = OSError("permission denied: /private/ssb/raw/secret.json")
        output = StringIO()
        with patch("scripts.ssb_raw_retention.prune_expired_ssb_14059_pairs", side_effect=error):
            with redirect_stderr(output):
                self.assertEqual(main([]), 1)
        self.assertIn("blocked", output.getvalue())
        self.assertNotIn("/private/ssb/raw", output.getvalue())


if __name__ == "__main__":
    unittest.main()
