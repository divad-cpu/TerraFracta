"""Reuse established fault controls against the new fixed writer runner only."""
from pathlib import Path
from unittest.mock import patch
import test_contact_free_native_cleanup as cleanup


class BoundWriterClosureBoundary(cleanup.NativeClosureBoundary):
    def probe(self, failure):
        source = Path(__file__).resolve().parents[1] / 'scripts/check_contact_free_bound_writer_native.py'
        with patch.object(cleanup, 'SOURCE', source):
            return super().probe(failure)
