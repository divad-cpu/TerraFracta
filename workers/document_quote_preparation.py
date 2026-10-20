"""Prepare exact byte-position choices from already supplied plain UTF-8 bytes.

Transient operator assistance only: no source receipt, semantic mapping recipe,
language, rights, support or approval is established. A caller must explicitly
choose an occurrence and independently supply all existing binder inputs. The
original-byte binder remains the final admission gate for a selected span map.
"""
from workers.document_passage_binding import DocumentByteSpan, MAX_DOCUMENT_BYTES, _plain
from workers.prose_passage_selection import MAX_PASSAGES, MAX_PASSAGE_BYTES


class DocumentQuotePreparationError(ValueError):
    """Fixed refusal without original bytes, quote text, locator or local paths."""


def _refuse():
    raise DocumentQuotePreparationError('document_quote_preparation_invalid') from None


def locate_document_quote(raw: bytes, quote: bytes, *, locator: str) -> tuple[DocumentByteSpan, ...]:
    """Return every exact occurrence, in byte order, including overlaps.

    Zero matches is an explicit empty tuple. Too many candidates refuses the
    entire result; callers may not treat a truncated list as complete. All
    candidates preserve the supplied locator, so they are choices, not a ready
    multi-span map. No first occurrence is implicitly selected.
    """
    if (type(raw) is not bytes or type(quote) is not bytes
            or not 1 <= len(raw) <= MAX_DOCUMENT_BYTES
            or not 1 <= len(quote) <= MAX_PASSAGE_BYTES or not _plain(locator, 200)):
        _refuse()
    try:
        raw.decode('utf8', 'strict')
        if not quote.decode('utf8', 'strict').strip():
            _refuse()
    except UnicodeError:
        _refuse()
    candidates = []
    search_from = 0
    while True:
        start = raw.find(quote, search_from)
        if start == -1:
            return tuple(candidates)
        if len(candidates) == MAX_PASSAGES:
            _refuse()
        candidates.append(DocumentByteSpan(locator, start, start + len(quote)))
        # One byte, not quote length: overlapping exact matches remain visible.
        search_from = start + 1


def choose_document_quote_span(raw: bytes, quote: bytes, *, locator: str,
                               occurrence_number: int) -> DocumentByteSpan:
    """Choose an explicitly supplied one-based occurrence after full enumeration."""
    if type(occurrence_number) is not int or occurrence_number < 1:
        _refuse()
    candidates = locate_document_quote(raw, quote, locator=locator)
    if occurrence_number > len(candidates):
        _refuse()
    return candidates[occurrence_number - 1]
