"""Bind separately supplied original plain-text bytes to exact passage spans.

Pure offline mechanics, not a source/language/mapping/rights qualification,
HTML/PDF parser, feed-to-document identity inference or storage proof. A trusted
caller supplies the independent document binding and semantic mapping identity.
The returned snapshot becomes eligible for existing planning only under that
caller's separately established source/mapping/route/rights/token/cost gates.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
from re import fullmatch

from workers.dispatch_input_snapshot import freeze_input, thaw_input
from workers.public_source_url import public_https_source_url
from workers.prose_passage_selection import (
    MAX_PASSAGES,MAX_PASSAGE_BYTES,MAX_CAPTURE_TEXT_BYTES,
    Passage,PassageSnapshot,PassageSelectionError,_validate as validate_snapshot,
)

MAX_DOCUMENT_BYTES=64*1024
ADAPTER_IDENTITY='terrafracta-utf8-byte-spans/v1'


class DocumentPassageError(ValueError):
    """Curated refusal; never include source text, URL or local paths."""


@dataclass(frozen=True)
class PlainDocumentReceipt:
    source_key: str
    item_key: str
    source_version_id: str
    source_url: str
    content_sha256: str
    retrieved_at: datetime
    media_type: str = 'text/plain'
    encoding: str = 'utf-8'


@dataclass(frozen=True)
class DocumentPassageBinding:
    # Independently supplied from the trusted document/source/mapping record.
    # Equal fields or hashes do not themselves authenticate that record.
    source_key: str
    item_key: str
    source_version_id: str
    source_url: str
    content_sha256: str
    mapping_sha256: str
    language_code: str
    retrieved_at: datetime


@dataclass(frozen=True)
class DocumentByteSpan:
    locator: str
    start: int
    end: int


@dataclass(frozen=True)
class DocumentSpanMap:
    source_version_id: str
    content_sha256: str
    mapping_sha256: str
    language_code: str
    spans: tuple[DocumentByteSpan,...]


@dataclass(frozen=True)
class BoundDocumentPassages:
    document: PlainDocumentReceipt
    snapshot: PassageSnapshot
    spans: tuple[DocumentByteSpan,...]
    span_manifest_sha256: str
    adapter_identity: str = ADAPTER_IDENTITY
    coverage: str = 'selected_spans_only'
    evidence_state: str = 'offline_original_document_bytes_bound_only'


def _plain(value,maximum):
    if type(value) is not str or not 1<=len(value)<=maximum or value!=value.strip() or any(ord(c)<32 for c in value):return False
    try:value.encode('utf8');return True
    except UnicodeError:return False


def _digest(value):return type(value) is str and fullmatch('[a-f0-9]{64}',value) is not None


def _utc(value):
    return type(value) is datetime and value.tzinfo is not None and value.utcoffset()==timezone.utc.utcoffset(value)


def bind_document_passages(raw: bytes,document: PlainDocumentReceipt,*,binding: DocumentPassageBinding,
        mapping: DocumentSpanMap,observed_at: datetime):
    """Slice actual bytes without changing text; keep recipe and span hashes apart.

    mapping_sha256 identifies the externally accepted semantic mapping recipe,
    not version-specific byte positions. span_manifest_sha256 binds this exact
    document/version and span map. Thus changed prefixes/byte positions do not
    falsely change recipe identity, and existing removal/relocation gates remain.
    Empty maps explicitly select no passages; they never imply full coverage.
    """
    try:
        # Copy all original assertions before any supplied timezone callback.
        try:
            raw, document, binding, mapping, observed_at = thaw_input(freeze_input(
                (raw, document, binding, mapping, observed_at),
                (PlainDocumentReceipt, DocumentPassageBinding, DocumentSpanMap, DocumentByteSpan)))
        except Exception:
            raise DocumentPassageError('document_passage_binding_invalid') from None
        if (type(raw) is not bytes or not 1<=len(raw)<=MAX_DOCUMENT_BYTES or type(document) is not PlainDocumentReceipt
                or type(binding) is not DocumentPassageBinding or type(mapping) is not DocumentSpanMap
                or not _utc(observed_at) or not _utc(document.retrieved_at) or document.retrieved_at>observed_at
                or document.media_type!='text/plain' or document.encoding!='utf-8'
                or not public_https_source_url(document.source_url)
                or not all(_plain(getattr(document,k),120) for k in ('source_key','item_key','source_version_id'))
                or not _digest(document.content_sha256) or sha256(raw).hexdigest()!=document.content_sha256
                or not _digest(binding.mapping_sha256) or type(binding.language_code) is not str
                or fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?',binding.language_code) is None):
            raise DocumentPassageError('document_source_input_invalid')
        if (any(getattr(document,k)!=getattr(binding,k) for k in ('source_key','item_key','source_version_id','source_url','content_sha256','retrieved_at'))
                or any(getattr(mapping,k)!=getattr(binding,k) for k in ('source_version_id','content_sha256','mapping_sha256','language_code'))):
            raise DocumentPassageError('document_source_mapping_binding_mismatch')
        # Validate the full source, including bytes outside selected spans. Decode
        # each bounded slice again to reject split multi-byte code points.
        raw.decode('utf8','strict')
        if type(mapping.spans) is not tuple or len(mapping.spans)>MAX_PASSAGES:
            raise DocumentPassageError('document_span_scope_invalid')
        passages=[];seen=set();previous_end=0;total=0;manifest=[]
        for span in mapping.spans:
            if (type(span) is not DocumentByteSpan or not _plain(span.locator,200) or span.locator in seen
                    or type(span.start) is not int or type(span.end) is not int
                    or not previous_end<=span.start<span.end<=len(raw) or span.end-span.start>MAX_PASSAGE_BYTES):
                raise DocumentPassageError('document_span_invalid')
            body=raw[span.start:span.end];text=body.decode('utf8','strict')
            if not text.strip():raise DocumentPassageError('document_span_empty')
            total+=len(body)
            if total>MAX_CAPTURE_TEXT_BYTES:raise DocumentPassageError('document_span_capture_limit')
            digest=sha256(body).hexdigest();passages.append(Passage(span.locator,text,digest));seen.add(span.locator);previous_end=span.end
            manifest.append({'locator':span.locator,'start':span.start,'end':span.end,'text_sha256':digest})
        snapshot=PassageSnapshot(document.source_key,document.item_key,document.source_version_id,document.content_sha256,
            binding.mapping_sha256,binding.language_code,tuple(passages))
        validate_snapshot(snapshot)
        encoded=json.dumps({'schema_version':1,'adapter_identity':ADAPTER_IDENTITY,'source_key':document.source_key,
            'item_key':document.item_key,'source_version_id':document.source_version_id,'source_url':document.source_url,
            'content_sha256':document.content_sha256,'retrieved_at':document.retrieved_at.isoformat(timespec='microseconds'),
            'media_type':document.media_type,'encoding':document.encoding,'mapping_sha256':binding.mapping_sha256,
            'language_code':binding.language_code,'spans':manifest},sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf8')
        return BoundDocumentPassages(document,snapshot,mapping.spans,sha256(encoded).hexdigest())
    except DocumentPassageError:raise
    except UnicodeError:raise DocumentPassageError('document_utf8_or_span_boundary_invalid') from None
    except (ValueError,TypeError,AttributeError,KeyError,OverflowError):
        raise DocumentPassageError('document_passage_binding_invalid') from None
