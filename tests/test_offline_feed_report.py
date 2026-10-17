"""Offline command through the actual parser and two-window producer."""

import base64
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO, StringIO
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from scripts.offline_feed_report import MAX_INPUT_BYTES, main, report_from_envelope
from tests.test_feed_discovery import entry, rss


def envelope():
    def window(raw, number, hour):
        return {"raw_base64": base64.b64encode(raw).decode(), "receipt": {
            "source_key": "fictional-feed", "source_version_id": f"10000000-0000-4000-8000-{number:012d}",
            "feed_url": "https://example.org/feed.xml", "content_sha256": sha256(raw).hexdigest(),
            "retrieved_at": datetime(2026, 10, 14, hour, tzinfo=timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")}}
    return {"schema_version": 1, "kind": "private_feed_window_input", "format": "rss20",
            "current": window(rss(entry(title="Invented revised title")), 2, 12),
            "previous": window(rss(entry(title="Invented earlier title")), 1, 11)}


def encode(value):
    return json.dumps(value).encode()


class OfflineFeedReportTests(unittest.TestCase):
    def execute(self, raw, args=None):
        out, err = BytesIO(), StringIO()
        status = main(args=[] if args is None else args, stdin=BytesIO(raw), stdout=out, stderr=err)
        return status, out.getvalue(), err.getvalue()

    def test_command_reports_actual_revision_with_both_vintages_and_no_network(self):
        with patch("urllib.request.urlopen", side_effect=AssertionError("No network")):
            status, raw, error = self.execute(encode(envelope()))
        self.assertEqual((status, error), (0, ""))
        report = json.loads(raw)
        self.assertEqual(report["changes"][0]["state"], "metadata_revised")
        self.assertEqual(report["changes"][0]["previous"]["title"], "Invented earlier title")
        self.assertEqual(report["review_state"], "unverified_discovery_comparison")

    def test_no_baseline_is_not_unchanged(self):
        value = envelope(); value["previous"] = None
        report = json.loads(report_from_envelope(encode(value)))
        self.assertIsNone(report["source_bytes_changed"])
        self.assertEqual(report["changes"][0]["state"], "first_observed")

    def test_invalid_unknown_duplicate_and_nested_input_refuses_without_echo_or_diagnostic(self):
        values = [b"PRIVATE_CANARY", b'\xff', b'{' + b'"a":1,' * 2 + b'"b":0}', b'[' * 2000,
                  b'{"schema_version":NaN}', b'x' * (MAX_INPUT_BYTES + 1)]
        for change in [lambda value: value.update(api_key="PRIVATE_CANARY"),
                       lambda value: value.update(schema_version=True),
                       lambda value: value["current"]["receipt"].update(content_sha256="PRIVATE_CANARY"),
                       lambda value: value["current"].update(raw_base64="%%%PRIVATE_CANARY"),
                       lambda value: value["current"]["receipt"].update(retrieved_at="2026-10-14T12:00:00Z")]:
            value = envelope(); change(value); values.append(encode(value))
        with patch("workers.error_diagnostics.record_worker_error") as record:
            for raw in values:
                with self.subTest(size=len(raw)):
                    status, out, err = self.execute(raw)
                    self.assertEqual((status, out, err), (2, b"", "offline_feed_report_input_refused\n"))
            record.assert_not_called()

    def test_input_is_read_with_one_explicit_byte_limit_and_no_filename_port(self):
        class Input(BytesIO):
            def read(self, size=-1):
                self.asserted_size = size
                return super().read(size)
        source = Input(encode(envelope())); out = BytesIO()
        self.assertEqual(main(args=[], stdin=source, stdout=out, stderr=StringIO()), 0)
        self.assertEqual(source.asserted_size, MAX_INPUT_BYTES + 1)
        for args in [["https://example.org/feed"], ["--file", "/PRIVATE_PATH"]]:
            self.assertEqual(self.execute(b"", args), (2, b"", "offline_feed_report_arguments_refused\n"))

    def test_help_never_reads_stdin_or_outputs_source_data(self):
        source = object(); out, err = BytesIO(), StringIO()
        self.assertEqual(main(args=["--help"], stdin=source, stdout=out, stderr=err), 0)
        self.assertEqual(out.getvalue(), b""); self.assertIn("no collection", err.getvalue())

    def test_unexpected_failure_keeps_curated_diagnostic_and_stderr_without_exception_body(self):
        with patch("scripts.offline_feed_report.feed_discovery_report", side_effect=RuntimeError("PRIVATE_CANARY")), \
             patch("workers.error_diagnostics.record_worker_error") as record:
            self.assertEqual(self.execute(encode(envelope())), (1, b"", "offline_feed_report_unavailable\n"))
            record.assert_called_once_with("collector_worker", directory=None)

    def test_logging_failure_and_output_failure_do_not_become_success(self):
        class Output(BytesIO):
            def write(self, value):
                raise OSError("PRIVATE_CANARY")
        err = StringIO()
        with patch("workers.error_diagnostics.record_worker_error", side_effect=RuntimeError("PRIVATE_LOG")):
            self.assertEqual(main(args=[], stdin=BytesIO(encode(envelope())), stdout=Output(), stderr=err), 1)
        self.assertEqual(err.getvalue(), "offline_feed_report_unavailable\n")

    def test_internal_value_error_is_a_technical_failure_not_invalid_input(self):
        with patch("scripts.offline_feed_report.feed_discovery_report", side_effect=ValueError("PRIVATE_INTERNAL")), \
             patch("workers.error_diagnostics.record_worker_error") as record:
            self.assertEqual(self.execute(encode(envelope())), (1, b"", "offline_feed_report_unavailable\n"))
            record.assert_called_once_with("collector_worker", directory=None)

    def test_real_module_subprocess_accepts_only_stdin_and_emits_one_complete_json_record(self):
        result = subprocess.run([sys.executable, "-B", "-m", "scripts.offline_feed_report"], input=encode(envelope()),
            cwd=Path(__file__).parent.parent, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0); self.assertEqual(result.stderr, b"")
        self.assertEqual(result.stdout.count(b"\n"), 1)
        self.assertEqual(json.loads(result.stdout), json.loads(report_from_envelope(encode(envelope()))))


if __name__ == "__main__":
    unittest.main()
