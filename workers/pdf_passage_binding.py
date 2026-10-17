"""Explicit full derived PDF pages, with original and derivation identity apart.

The existing fixed inspector processes the complete independently bound original
once. Page positions and derived UTF-8 offsets are not printed page labels or
original PDF offsets. No source/rights/visual/OCR/table/fact qualification, storage,
model planning, dispatch or publication follows from these offline mechanics.
"""
from workers.dispatch_input_snapshot import freeze_input, thaw_input
from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
import json
from re import fullmatch

from workers.pdf_text_inspection import (
    PdfDocumentReceipt, inspect_pdf_bytes, LIMITS, PARSER_IDENTITY, SCOPE,
    _native_reply, _encode,
)
from workers.prose_passage_selection import Passage, PassageSnapshot, _validate as validate_snapshot, _plain, _digest
from workers.public_source_url import public_https_source_url

ADAPTER_IDENTITY = 'terrafracta-selected-pdf-native-pages/v1'


class PdfPassageError(ValueError):
    """Fixed refusal without source, original, parser, receipt or path details."""


@dataclass(frozen=True)
class PdfPassageBinding:
    source_key: str
    item_key: str
    source_version_id: str
    source_url: str
    content_sha256: str
    mapping_sha256: str
    language_code: str
    retrieved_at: datetime


@dataclass(frozen=True)
class PdfPageSelection:
    locator: str
    page_number: int
    # Independently expected SHA of the whole derived page, not original PDF.
    page_text_sha256: str


@dataclass(frozen=True)
class PdfPageSelectionMap:
    source_version_id: str
    content_sha256: str
    mapping_sha256: str
    language_code: str
    selections: tuple[PdfPageSelection, ...]


@dataclass(frozen=True)
class PdfSelectedPage:
    locator: str
    page_number: int
    page_text_sha256: str
    derived_start_utf8: int
    derived_end_utf8: int
    derived_text_sha256: str


@dataclass(frozen=True)
class BoundPdfPassages:
    document: PdfDocumentReceipt
    snapshot: PassageSnapshot = field(repr=False)
    spans: tuple[PdfSelectedPage, ...]
    inspection_report_raw: bytes = field(repr=False)
    inspection_report_sha256: str
    derivation_manifest_raw: bytes = field(repr=False)
    derivation_manifest_sha256: str
    adapter_identity: str = ADAPTER_IDENTITY
    parser_identity: str = PARSER_IDENTITY
    coverage: str = 'selected_native_pdf_pages_only'
    evidence_state: str = 'offline_native_pdf_selected_page_text_bound_only_not_rendered_or_qualified'


@dataclass(frozen=True)
class PdfPassageInputs:
    raw: bytes = field(repr=False)
    document: PdfDocumentReceipt
    binding: PdfPassageBinding
    mapping: PdfPageSelectionMap
    observed_at: datetime


def _utc_copy(value):
    if (type(value) is not datetime or value.tzinfo is None
            or value.utcoffset() != timezone.utc.utcoffset(value)):
        raise ValueError
    # Do not retain a caller's mutable custom timezone object across the child.
    return datetime(value.year, value.month, value.day, value.hour, value.minute,
                    value.second, value.microsecond, tzinfo=timezone.utc)


def _stamp(value):
    return value.isoformat(timespec='microseconds').replace('+00:00', 'Z')


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(',', ':')).encode('utf8')


def _checked_report(report, raw, document_values, observed_at):
    keys = {'schema_version', 'kind', 'scope', 'document', 'observed_at', 'original_bytes',
            'parser_identity', 'limits', 'state', 'reason_code', 'page_count', 'pages'}
    expected = dict(document_values, retrieved_at=_stamp(document_values['retrieved_at']))
    if (type(report) is not dict or set(report) != keys
            or type(report['schema_version']) is not int or report['schema_version'] != 1
            or report['kind'] != 'private_pdf_text_inspection' or report['scope'] != SCOPE
            or type(report['document']) is not dict or report['document'] != expected
            or any(type(v) is not str for v in report['document'].values())
            or report['observed_at'] != _stamp(observed_at)):
        raise ValueError
    encoded = _encode(report)
    if len(encoded) > LIMITS['max_output_bytes']:
        raise ValueError
    # Reuse the inspector's exact original/hash/page/profile validator. This is
    # validation of its returned record, never a caller-supplied report input.
    native = {name: report[name] for name in ('schema_version', 'original_bytes',
              'parser_identity', 'limits', 'state', 'reason_code', 'page_count', 'pages')}
    native.update(kind='bounded_native_pdf_text', original_sha256=report['document']['content_sha256'])
    _native_reply(_encode(native), raw)
    # Keep immutable complete bytes rather than the mutable returned dictionary.
    return json.loads(encoded.decode('utf8')), encoded


def capture_pdf_passage_inputs(raw: bytes, document: PdfDocumentReceipt, *, binding: PdfPassageBinding,
                               mapping: PdfPageSelectionMap, observed_at: datetime) -> PdfPassageInputs:
    """Pure validated deep capture before any original's native inspection.

    A multi-original caller can capture both envelopes before invoking either
    inspector. This authenticates no independent source/mapping assertion.
    """
    try:
        if (type(raw) is not bytes or not 1 <= len(raw) <= LIMITS['max_input_bytes']
                or type(document) is not PdfDocumentReceipt or type(binding) is not PdfPassageBinding
                or type(mapping) is not PdfPageSelectionMap):
            raise ValueError
        raw, document, binding, mapping, observed_at = thaw_input(freeze_input(
            (raw, document, binding, mapping, observed_at),
            (PdfDocumentReceipt, PdfPassageBinding, PdfPageSelectionMap, PdfPageSelection)))
        at = _utc_copy(observed_at)
        names = ('source_key', 'item_key', 'source_version_id', 'source_url', 'content_sha256', 'retrieved_at', 'media_type')
        doc = {name: getattr(document, name) for name in names}
        bound = {name: getattr(binding, name) for name in ('source_key', 'item_key', 'source_version_id', 'source_url',
                 'content_sha256', 'mapping_sha256', 'language_code', 'retrieved_at')}
        chosen = {name: getattr(mapping, name) for name in ('source_version_id', 'content_sha256', 'mapping_sha256', 'language_code', 'selections')}
        doc['retrieved_at'] = _utc_copy(doc['retrieved_at'])
        bound['retrieved_at'] = _utc_copy(bound['retrieved_at'])
        if (not all(_plain(doc[name], 120) for name in ('source_key', 'item_key', 'source_version_id'))
                or fullmatch('[a-z0-9][a-z0-9:-]{0,119}', doc['source_key']) is None
                or fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', doc['source_version_id']) is None
                or type(doc['source_url']) is not str or not public_https_source_url(doc['source_url'])
                or not _digest(doc['content_sha256']) or sha256(raw).hexdigest() != doc['content_sha256']
                or doc['retrieved_at'] > at or type(doc['media_type']) is not str or doc['media_type'] != 'application/pdf'
                or not _digest(bound['mapping_sha256']) or type(bound['language_code']) is not str
                or fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?', bound['language_code']) is None):
            raise ValueError
        if (any(type(bound[name]) is not str or bound[name] != doc[name] for name in
                ('source_key', 'item_key', 'source_version_id', 'source_url', 'content_sha256'))
                or bound['retrieved_at'] != doc['retrieved_at']
                or any(type(chosen[name]) is not str or chosen[name] != bound[name] for name in
                       ('source_version_id', 'content_sha256', 'mapping_sha256', 'language_code'))
                or type(chosen['selections']) is not tuple or len(chosen['selections']) > LIMITS['max_pages']):
            raise ValueError
        selections = []; locators = set(); previous_page = 0
        for selection in chosen['selections']:
            if type(selection) is not PdfPageSelection:
                raise ValueError
            locator, number, digest = selection.locator, selection.page_number, selection.page_text_sha256
            if (not _plain(locator, 200) or locator in locators or type(number) is not int
                    or not previous_page < number <= LIMITS['max_pages'] or not _digest(digest)):
                raise ValueError
            selections.append(PdfPageSelection(locator, number, digest)); locators.add(locator); previous_page = number
        # All mutable caller containers/metadata have now been captured.
        copied_document = PdfDocumentReceipt(**doc)
        copied_binding = PdfPassageBinding(**bound)
        copied_mapping = PdfPageSelectionMap(chosen['source_version_id'], chosen['content_sha256'],
            chosen['mapping_sha256'], chosen['language_code'], tuple(selections))
        return PdfPassageInputs(raw, copied_document, copied_binding, copied_mapping, at)
    except Exception:
        raise PdfPassageError('pdf_passage_binding_unavailable') from None


def bind_pdf_passages(raw: bytes, document: PdfDocumentReceipt, *, binding: PdfPassageBinding,
                      mapping: PdfPageSelectionMap, observed_at: datetime) -> BoundPdfPassages:
    """Select complete inspected pages only; missing/held selections never drop.

    An empty selection retains no passages and claims no selected coverage. It
    does not mean all pages. Unselected held/textless pages remain in the full
    inspection record. Semantic recipe/language/hash assertions are independent
    inputs, not authentication or source/editorial/publication acceptance.
    """
    try:
        captured = capture_pdf_passage_inputs(raw, document, binding=binding, mapping=mapping, observed_at=observed_at)
        raw, copied_document, at = captured.raw, captured.document, captured.observed_at
        doc = {name: getattr(copied_document, name) for name in ('source_key', 'item_key', 'source_version_id',
               'source_url', 'content_sha256', 'retrieved_at', 'media_type')}
        bound = dict(mapping_sha256=captured.binding.mapping_sha256, language_code=captured.binding.language_code)
        selections = captured.mapping.selections
        report, inspection_raw = _checked_report(inspect_pdf_bytes(raw, copied_document, observed_at=at), raw, doc, at)
        if report['state'] != 'inspected':
            raise ValueError
        passages = []; spans = []
        for selected in selections:
            if selected.page_number > report['page_count']:
                raise ValueError
            page = report['pages'][selected.page_number - 1]
            if page['state'] != 'text_extracted' or page['text_sha256'] != selected.page_text_sha256:
                raise ValueError
            text = page['text']; digest = sha256(text.encode('utf8')).hexdigest()
            passages.append(Passage(selected.locator, text, digest))
            spans.append(PdfSelectedPage(selected.locator, selected.page_number, digest, 0, len(text.encode('utf8')), digest))
        snapshot = PassageSnapshot(doc['source_key'], doc['item_key'], doc['source_version_id'], doc['content_sha256'],
                                   bound['mapping_sha256'], bound['language_code'], tuple(passages))
        validate_snapshot(snapshot)
        inspection_sha = sha256(inspection_raw).hexdigest()
        manifest = dict(schema_version=1, adapter_identity=ADAPTER_IDENTITY, parser_identity=PARSER_IDENTITY,
            document=dict(doc, retrieved_at=_stamp(doc['retrieved_at'])), original_bytes=len(raw), observed_at=_stamp(at),
            mapping_sha256=bound['mapping_sha256'], language_code=bound['language_code'],
            inspection_report_sha256=inspection_sha, coverage='selected_native_pdf_pages_only',
            page_index_kind='physical_1_based', offset_space='derived_page_utf8', rendered_visibility_verified=False,
            spans=[dict(locator=s.locator, page_number=s.page_number, page_text_sha256=s.page_text_sha256,
                        derived_start_utf8=s.derived_start_utf8, derived_end_utf8=s.derived_end_utf8,
                        derived_text_sha256=s.derived_text_sha256) for s in spans])
        manifest_raw = _canonical(manifest)
        return BoundPdfPassages(copied_document, snapshot, tuple(spans), inspection_raw, inspection_sha,
                                manifest_raw, sha256(manifest_raw).hexdigest())
    except Exception:
        raise PdfPassageError('pdf_passage_binding_unavailable') from None
