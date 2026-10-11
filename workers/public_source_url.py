"""Small URL shape guard for public source citations and qualified endpoints.

This is not an SSRF defense: a future fetcher must pin approved origins,
resolve redirects safely and enforce network policy independently.
"""

from __future__ import annotations

from ipaddress import ip_address
from re import fullmatch
from urllib.parse import parse_qsl, urlsplit


SENSITIVE_QUERY_KEYS = frozenset({
    "api_key", "apikey", "key", "access_token", "token", "secret",
    "client_secret", "password", "auth", "authorization",
})


def public_https_source_url(value: object) -> bool:
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= 2048
        or "\\" in value
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        return False
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        port = parsed.port
    except ValueError:
        return False
    if (
        parsed.scheme != "https" or not host
        or parsed.username is not None or parsed.password is not None
        or parsed.fragment
        or host.endswith(".") or "." not in host
        or host == "localhost" or host.endswith((".localhost", ".local", ".internal"))
        # A numeric final label invokes IPv4 interpretation in URL clients,
        # including hexadecimal/octal and shortened forms; never a public domain.
        or fullmatch(r"(?:[0-9]+|0x[0-9a-f]*)", host.rsplit(".", 1)[-1]) is not None
        or not all(fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                   for label in host.split("."))
        or (port is not None and port < 1)
        or any(name.lower() in SENSITIVE_QUERY_KEYS
               for name, _ in parse_qsl(parsed.query, keep_blank_values=True))
    ):
        return False
    try:
        ip_address(host)
    except ValueError:
        return True
    return False
