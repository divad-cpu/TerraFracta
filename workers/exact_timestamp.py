"""Exact seconds/microseconds JSON timestamps for existing private receipts.

Caller-specific offset, chronology and identity checks remain separate. This
parser provides no clock, backend authentication or operation authority.
"""
from datetime import datetime
from re import fullmatch


def parse_exact_timestamp(value: object) -> datetime:
    """Reject precision loss and unsupported forms before datetime conversion."""
    if type(value) is not str or not 20 <= len(value) <= 32 or fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
        r"(?:\.[0-9]{1,6})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])", value
    ) is None:
        raise ValueError("Receipt timestamp is invalid or loses precision")
    return datetime.fromisoformat(value)
