"""Network-free checks for the fixed SSB HTTPS transport primitive."""

from __future__ import annotations

from ssl import CERT_REQUIRED
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, ProxyHandler

from workers.ssb_14059_capture import DATA_URL, MAX_RESPONSE_BYTES, METADATA_URL
from workers.ssb_14059_transport import (
    SOCKET_TIMEOUT_SECONDS,
    SSB14059TransportError,
    _NoRedirects,
    _build_opener,
    fetch_ssb_14059_once,
)


class FakeResponse:
    def __init__(self, url: str, body: bytes = b"{}", *, headers=None, status: int = 200):
        self.url = url
        self.body = body
        self.offset = 0
        self.status = status
        self.headers = {"Content-Type": "application/json"} if headers is None else headers
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        self.closed = True

    def geturl(self):
        return self.url

    def read(self, size: int):
        next_offset = min(self.offset + size, len(self.body))
        chunk = self.body[self.offset:next_offset]
        self.offset = next_offset
        return chunk


class FakeOpener:
    def __init__(self, result):
        self.result = result
        self.requests = []

    def open(self, request, *, timeout):
        self.requests.append((request, timeout))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class SSB14059TransportTests(unittest.TestCase):
    def test_default_opener_disables_proxy_and_redirects_and_verifies_tls(self) -> None:
        with patch("workers.ssb_14059_transport.ProxyHandler", wraps=ProxyHandler) as proxy_factory:
            handlers = _build_opener().handlers
        proxy_factory.assert_called_once_with({})
        https = next(item for item in handlers if isinstance(item, HTTPSHandler))
        self.assertTrue(any(isinstance(item, _NoRedirects) for item in handlers))
        self.assertTrue(https._context.check_hostname)
        self.assertEqual(https._context.verify_mode, CERT_REQUIRED)

    def test_fixed_get_request_returns_bounded_in_memory_capture(self) -> None:
        for kind, url in (("metadata", METADATA_URL), ("data", DATA_URL)):
            with self.subTest(kind=kind):
                response = FakeResponse(url, b'{"source":"Statistics Norway"}')
                opener = FakeOpener(response)
                with patch("workers.ssb_14059_transport._build_opener", return_value=opener):
                    capture = fetch_ssb_14059_once(kind)
                request, timeout = opener.requests[0]
                self.assertEqual((request.full_url, request.get_method(), timeout), (url, "GET", SOCKET_TIMEOUT_SECONDS))
                self.assertEqual(request.get_header("Accept"), "application/json")
                self.assertEqual(request.get_header("Accept-encoding"), "identity")
                self.assertEqual((capture.requested_url, capture.final_url, capture.status), (url, url, 200))
                self.assertEqual(capture.body, response.body)
                self.assertEqual(capture.retrieved_at.utcoffset().total_seconds(), 0)
                self.assertTrue(response.closed)

    def test_shared_deadline_is_strict_and_never_opens_expired_requests(self):
        for deadline in (True, float("nan"), float("inf"), 100):
            with self.subTest(deadline=deadline), patch("workers.ssb_14059_transport.monotonic", return_value=100), patch("workers.ssb_14059_transport._build_opener") as factory:
                with self.assertRaises(SSB14059TransportError):
                    fetch_ssb_14059_once("metadata", deadline=deadline)
                factory.assert_not_called()

    def test_tls_setup_cannot_open_a_request_after_its_shared_deadline(self):
        opener = FakeOpener(FakeResponse(METADATA_URL))
        with patch("workers.ssb_14059_transport.monotonic", side_effect=[100,106]), patch("workers.ssb_14059_transport._build_opener", return_value=opener):
            with self.assertRaisesRegex(SSB14059TransportError,"deadline expired"):
                fetch_ssb_14059_once("metadata", deadline=105)
        self.assertEqual(opener.requests, [])

    def test_residual_socket_timeout_and_stream_deadline_close_partial_response(self):
        response = FakeResponse(METADATA_URL, b"{}")
        opener = FakeOpener(response)
        with patch("workers.ssb_14059_transport.monotonic", side_effect=[100,101,102,106]), patch("workers.ssb_14059_transport._build_opener", return_value=opener):
            with self.assertRaisesRegex(SSB14059TransportError,"deadline expired"):
                fetch_ssb_14059_once("metadata", deadline=105)
        self.assertEqual(opener.requests[0][1],4)
        self.assertEqual(response.offset,2)
        self.assertTrue(response.closed)

    def test_unknown_kind_never_opens_a_connection(self) -> None:
        with patch("workers.ssb_14059_transport._build_opener") as factory:
            with self.assertRaises(SSB14059TransportError):
                fetch_ssb_14059_once("other")
            factory.assert_not_called()

    def test_unexpected_origin_never_opens_a_connection(self) -> None:
        for url in (
            "http://data.ssb.no/api/pxwebapi/v2/tables/14059/metadata?lang=en",
            "https://data.ssb.no.evil.invalid/api/pxwebapi/v2/tables/14059/metadata?lang=en",
            "https://data.ssb.no@evil.invalid/api/pxwebapi/v2/tables/14059/metadata?lang=en",
        ):
            with self.subTest(url=url):
                with patch.dict("workers.ssb_14059_transport._URLS", {"metadata": url}):
                    with patch("workers.ssb_14059_transport._build_opener") as factory:
                        with self.assertRaises(SSB14059TransportError):
                            fetch_ssb_14059_once("metadata")
                        factory.assert_not_called()

    def test_exact_fixed_urls_match_the_approved_first_attempt_scope(self) -> None:
        self.assertEqual(
            METADATA_URL,
            "https://data.ssb.no/api/pxwebapi/v2/tables/14059/metadata?lang=en",
        )
        self.assertEqual(
            DATA_URL,
            "https://data.ssb.no/api/pxwebapi/v2/tables/14059/data?lang=en"
            "&valueCodes%5BEierStatus%5D=0"
            "&valueCodes%5BContentsCode%5D=Boutg4%2CBoutg5%2CAntHushSvar"
            "&valueCodes%5BTid%5D=2024%2C2025",
        )

    def test_changed_url_status_or_encoding_is_rejected_before_read(self) -> None:
        cases = (
            FakeResponse("https://example.invalid/", b"{}"),
            FakeResponse(METADATA_URL, b"{}", status=204),
            FakeResponse(METADATA_URL, b"{}", headers={"Content-Type": "application/json", "Content-Encoding": "gzip"}),
            FakeResponse(METADATA_URL, b"{}", headers={"Content-Type": "text/html"}),
            FakeResponse(METADATA_URL, b"{}", headers={"Content-Type": "application/json", "Content-Length": str(MAX_RESPONSE_BYTES + 1)}),
        )
        for response in cases:
            with self.subTest(response=response):
                with patch("workers.ssb_14059_transport._build_opener", return_value=FakeOpener(response)):
                    with self.assertRaises(SSB14059TransportError):
                        fetch_ssb_14059_once("metadata")
                self.assertEqual(response.offset, 0)
                self.assertTrue(response.closed)

    def test_streamed_body_is_limited_even_without_content_length(self) -> None:
        response = FakeResponse(DATA_URL, b"x" * (MAX_RESPONSE_BYTES + 1))
        with patch("workers.ssb_14059_transport._build_opener", return_value=FakeOpener(response)):
            with self.assertRaises(SSB14059TransportError):
                fetch_ssb_14059_once("data")
        self.assertEqual(response.offset, MAX_RESPONSE_BYTES + 1)

    def test_declared_length_must_match_received_bytes(self) -> None:
        response = FakeResponse(
            METADATA_URL, b"{}",
            headers={"Content-Type": "application/json", "Content-Length": "3"},
        )
        with patch("workers.ssb_14059_transport._build_opener", return_value=FakeOpener(response)):
            with self.assertRaisesRegex(SSB14059TransportError, "differs from Content-Length"):
                fetch_ssb_14059_once("metadata")
        self.assertEqual(response.offset, 2)
        self.assertTrue(response.closed)

    def test_http_and_connection_failures_do_not_retry(self) -> None:
        for error in (
            HTTPError(METADATA_URL, 302, "redirect", {}, None),
            HTTPError(METADATA_URL, 429, "rate limit", {}, None),
            URLError("unavailable"),
        ):
            with self.subTest(error=error):
                opener = FakeOpener(error)
                with patch("workers.ssb_14059_transport._build_opener", return_value=opener):
                    with self.assertRaises(SSB14059TransportError):
                        fetch_ssb_14059_once("metadata")
                self.assertEqual(len(opener.requests), 1)


if __name__ == "__main__":
    unittest.main()
