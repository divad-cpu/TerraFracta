"""Bound one in-memory SSB response to a fixed HTTPS request.

This transport primitive has no scheduler, registry loader, retry, storage or
database path. Source approval and a total attempt deadline are still required
before it is used for a private collection run.
"""

from __future__ import annotations

from datetime import datetime, timezone
from fractions import Fraction
from ssl import create_default_context
from math import isfinite
from time import monotonic
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import (
    HTTPRedirectHandler,
    HTTPSHandler,
    OpenerDirector,
    ProxyHandler,
    Request,
    build_opener,
)

from workers.ssb_14059_capture import (
    CapturedResponse,
    DATA_URL,
    MAX_RESPONSE_BYTES,
    METADATA_URL,
)


ResponseKind = Literal["metadata", "data"]
SOCKET_TIMEOUT_SECONDS = 10
_URLS = {"metadata": METADATA_URL, "data": DATA_URL}
_APPROVED_HOST = "data.ssb.no"


class SSB14059TransportError(ValueError):
    """The exact single-response request did not produce an acceptable capture."""


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _build_opener() -> OpenerDirector:
    # An empty proxy map prevents inherited environment proxies from changing
    # the connection route. The TLS context verifies the server certificate.
    return build_opener(
        ProxyHandler({}),
        HTTPSHandler(context=create_default_context()),
        _NoRedirects(),
    )


def fetch_ssb_14059_once(kind: ResponseKind, *, deadline: float | None = None) -> CapturedResponse:
    """Fetch one exact SSB URL into bounded memory, with no retry or persistence.

    This is a lower-level transport primitive, not an approved collector. The
    10-second urllib timeout applies to socket operations, not the full run.
    """
    if kind not in _URLS:
        raise SSB14059TransportError("Unknown fixed response kind")
    try:
        valid_deadline = deadline is None or (
            type(deadline) in (int, float) and isfinite(deadline)
        )
    except OverflowError as exc:
        raise SSB14059TransportError("Invalid fixed request deadline") from exc
    if not valid_deadline:
        raise SSB14059TransportError("Invalid fixed request deadline")
    exact_deadline = None if deadline is None else Fraction(deadline)
    previous_tick: Fraction | None = None

    def remaining() -> float:
        nonlocal previous_tick
        if exact_deadline is None:
            return SOCKET_TIMEOUT_SECONDS
        try:
            tick = monotonic()
            valid_tick = type(tick) in (int, float) and isfinite(tick)
        except Exception as exc:
            raise SSB14059TransportError("Invalid fixed request monotonic clock") from exc
        if not valid_tick:
            raise SSB14059TransportError("Invalid fixed request monotonic clock")
        exact_tick = Fraction(tick)
        if previous_tick is not None and exact_tick < previous_tick:
            raise SSB14059TransportError("Fixed request monotonic clock moved backward")
        previous_tick = exact_tick
        budget = exact_deadline - exact_tick
        if budget <= 0:
            raise SSB14059TransportError("Fixed request deadline expired")
        # Compare the supplied native values exactly; only the bounded timeout
        # passed to urllib needs a float representation.
        return float(min(SOCKET_TIMEOUT_SECONDS, budget))
    remaining()
    url = _URLS[kind]
    try:
        origin = urlsplit(url)
        if (origin.scheme != "https" or origin.hostname != _APPROVED_HOST
                or origin.port is not None or origin.username is not None
                or origin.password is not None or origin.fragment):
            raise SSB14059TransportError("Fixed source URL has an unexpected origin")
    except ValueError as exc:
        raise SSB14059TransportError("Fixed source URL has an unexpected origin") from exc
    request = Request(url, headers={"Accept": "application/json", "Accept-Encoding": "identity"}, method="GET")
    try:
        opener = _build_opener()
        # TLS context construction also consumes the shared parent budget.
        with opener.open(request, timeout=remaining()) as response:
            final_url = response.geturl()
            if final_url != url:
                raise SSB14059TransportError("Final URL differs from the exact source URL")
            status = response.status
            if type(status) is not int or status != 200:
                raise SSB14059TransportError("Source did not return HTTP 200")
            content_encoding = response.headers.get("Content-Encoding")
            if content_encoding is not None and (
                not isinstance(content_encoding, str)
                or content_encoding.lower() != "identity"
            ):
                raise SSB14059TransportError("Unexpected compressed response")
            content_type = response.headers.get("Content-Type", "")
            if not isinstance(content_type, str) or [
                part.strip().lower() for part in content_type.split(";")
            ] not in (["application/json"], ["application/json", "charset=utf-8"]):
                raise SSB14059TransportError("Unexpected response content type")
            announced_length = response.headers.get("Content-Length")
            declared_length: int | None = None
            if announced_length is not None:
                try:
                    declared_length = int(announced_length)
                except ValueError as exc:
                    raise SSB14059TransportError("Invalid content length") from exc
                if declared_length < 0 or declared_length > MAX_RESPONSE_BYTES:
                    raise SSB14059TransportError("Declared response exceeds byte limit")
            body = bytearray()
            while True:
                remaining()
                chunk = response.read(min(8192, MAX_RESPONSE_BYTES + 1 - len(body)))
                remaining()
                if type(chunk) is not bytes:
                    raise SSB14059TransportError("Response body is not bytes")
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise SSB14059TransportError("Response exceeds byte limit")
            if declared_length is not None and len(body) != declared_length:
                raise SSB14059TransportError("Received body length differs from Content-Length")
            remaining()
            retrieved_at = datetime.now(timezone.utc)
    except HTTPError as exc:
        exc.close()
        raise SSB14059TransportError(f"Source returned HTTP {exc.code}; no retry was attempted") from exc
    except URLError as exc:
        raise SSB14059TransportError("Source connection failed; no retry was attempted") from exc
    except OSError as exc:
        raise SSB14059TransportError("Source response read failed; no retry was attempted") from exc
    # Closing the owned response is part of the attempt. A valid pre-close tick
    # cannot authorize releasing a capture after that boundary expires.
    remaining()
    return CapturedResponse(
        requested_url=url,
        final_url=final_url,
        redirect_count=0,
        status=status,
        content_type=content_type,
        body=bytes(body),
        retrieved_at=retrieved_at,
    )
