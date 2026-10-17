"""Owner-only invented exact HTML request/output storage and cold rederivation.

This is a separate uninstalled laboratory port, never the old plain-text result
store, a provider/usage receipt, factual acceptance or publication. Both retained
HTML originals remain independently selected and rechecked at every read.
"""
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
import base64
import json
import re

from workers.html_original_custody import HtmlOriginalReopenExpected
from workers.html_private_extraction import HtmlPrivateExtraction, prepare_html_private_extraction, recheck_html_private_extraction
from workers.stored_html_change import compile_stored_html_request
from workers.model_proposal import AllowedEvidence, parse_untrusted_model_proposal
from workers.closed_pair_channel import _json as strict_json
from workers.feed_postgres_contract import HEAD, COMMIT_MARKER, MAX_CAPTURE_OUTPUT, MAX_CAPTURE_STATEMENT, _uuid, _utc, _time, _parse_time
from workers.pair_native_sql import _literal
from workers.passage_extraction_request import _canonical, _tokens

MAX_HTML_EXTRACTION_METADATA = 16384
RECEIPT_MARGIN = 4096
RECEIPT_KEYS = frozenset('schema_version kind operation_id artifact_id stored_at metadata_base64 request_base64 output_base64 metadata_sha256 request_sha256 output_sha256 metadata_bytes request_bytes output_bytes'.split())


class HtmlExtractionCustodyError(ValueError):
    """Fixed private failure, without output, source, request or backend details."""


def _b64(raw): return base64.b64encode(raw).decode('ascii')


def _decode(value, maximum):
    if type(value) is not str or not 4 <= len(value) <= 4*((maximum+2)//3): raise ValueError
    raw = base64.b64decode(value, validate=True)
    if not 1 <= len(raw) <= maximum or _b64(raw) != value: raise ValueError
    return raw


def _metadata(result):
    value = strict_json(result.canonical_input)
    return _canonical({key: item for key, item in value.items() if key not in ('request_base64', 'output_base64')})


@dataclass(frozen=True)
class PreparedHtmlExtractionStore:
    result: HtmlPrivateExtraction = field(repr=False)
    canonical_metadata: bytes = field(repr=False)

    def statement(self):
        checked = prepare_html_extraction_store(self.result)
        if type(self.canonical_metadata) is not bytes or checked != self: raise HtmlExtractionCustodyError('html_extraction_store_unavailable')
        sql = HEAD+"set time zone 'UTC';begin isolation level read committed read write;select tf_html_extraction.store_result(decode("+_literal(_b64(self.canonical_metadata))+",'base64'),decode("+_literal(_b64(self.result.plan.request.body))+",'base64'),decode("+_literal(_b64(self.result.output_raw))+",'base64'));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
        if len(sql.encode('utf8')) > MAX_CAPTURE_STATEMENT: raise HtmlExtractionCustodyError('html_extraction_store_unavailable')
        return sql


@dataclass(frozen=True)
class StoredHtmlExtraction:
    operation_id: str
    artifact_id: str
    stored_at: datetime
    result: HtmlPrivateExtraction = field(repr=False)
    canonical_metadata: bytes = field(repr=False)
    evidence_state: str = 'invented_html_exact_request_output_stored_still_unverified'


def _shape(operation, metadata, request, output):
    return dict(schema_version=1, kind='invented_html_extraction_stored', operation_id=operation,
        artifact_id='ffffffff-ffff-4fff-bfff-ffffffffffff', stored_at='9999-12-31T23:59:59.999999Z',
        metadata_base64=_b64(metadata), request_base64=_b64(request), output_base64=_b64(output),
        metadata_sha256=sha256(metadata).hexdigest(), request_sha256=sha256(request).hexdigest(), output_sha256=sha256(output).hexdigest(),
        metadata_bytes=len(metadata), request_bytes=len(request), output_bytes=len(output))


def prepare_html_extraction_store(result: HtmlPrivateExtraction) -> PreparedHtmlExtractionStore:
    try:
        result = recheck_html_private_extraction(result); metadata = _metadata(result)
        if len(metadata) > MAX_HTML_EXTRACTION_METADATA: raise ValueError
        shape = _shape(result.operation_id, metadata, result.plan.request.body, result.output_raw)
        if len(json.dumps(shape).encode('utf8'))+RECEIPT_MARGIN > MAX_CAPTURE_OUTPUT: raise ValueError
        if sum(len(_b64(value)) for value in (metadata, result.plan.request.body, result.output_raw))+1024 > MAX_CAPTURE_STATEMENT: raise ValueError
        return PreparedHtmlExtractionStore(result, metadata)
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, OverflowError, RecursionError):
        raise HtmlExtractionCustodyError('html_extraction_store_unavailable') from None


def _receipt(raw, operation, prepared_at, observed_at):
    if (type(raw) is not bytes or not 1 <= len(raw) <= MAX_CAPTURE_OUTPUT or not _utc(observed_at)
            or not _utc(prepared_at) or prepared_at > observed_at): raise ValueError
    value = strict_json(raw)
    if (type(value) is not dict or set(value) != RECEIPT_KEYS or type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['kind'] != 'invented_html_extraction_stored' or value['operation_id'] != operation or not _uuid(value['artifact_id'])): raise ValueError
    metadata = _decode(value['metadata_base64'], MAX_HTML_EXTRACTION_METADATA)
    request = _decode(value['request_base64'], 131072); output = _decode(value['output_base64'], 8192)
    for key, body in [('metadata', metadata), ('request', request), ('output', output)]:
        if (type(value[key+'_bytes']) is not int or value[key+'_bytes'] != len(body)
                or value[key+'_sha256'] != sha256(body).hexdigest()): raise ValueError
    stored = _parse_time(value['stored_at'])
    if not prepared_at <= stored <= observed_at: raise ValueError
    return value, metadata, request, output, stored


def parse_stored_html_extraction(raw: bytes, expected: PreparedHtmlExtractionStore, *, observed_at: datetime) -> StoredHtmlExtraction:
    try:
        if type(expected) is not PreparedHtmlExtractionStore or type(expected.canonical_metadata) is not bytes:
            raise ValueError
        checked = prepare_html_extraction_store(expected.result)
        if checked != expected or not _utc(observed_at) or observed_at < expected.result.observed_at: raise ValueError
        value, metadata, request, output, stored = _receipt(raw, expected.result.operation_id, expected.result.prepared_at, observed_at)
        if metadata != expected.canonical_metadata or request != expected.result.plan.request.body or output != expected.result.output_raw: raise ValueError
        return StoredHtmlExtraction(value['operation_id'], value['artifact_id'], stored, expected.result, metadata)
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, OverflowError, RecursionError):
        raise HtmlExtractionCustodyError('html_extraction_receipt_unavailable') from None


@dataclass(frozen=True)
class HtmlExtractionReopenExpected:
    operation_id: str
    artifact_id: str
    stored_at: datetime
    prepared_at: datetime
    current_expected: HtmlOriginalReopenExpected = field(repr=False)
    previous_expected: HtmlOriginalReopenExpected = field(repr=False)
    maximum_output_tokens: int
    canonical_metadata: bytes = field(repr=False)
    observed_at: datetime

    def statement(self):
        checked = prepare_html_extraction_reopen(operation_id=self.operation_id, artifact_id=self.artifact_id,
            stored_at=self.stored_at, prepared_at=self.prepared_at, current_expected=self.current_expected,
            previous_expected=self.previous_expected, maximum_output_tokens=self.maximum_output_tokens,
            canonical_metadata=self.canonical_metadata, observed_at=self.observed_at)
        if checked != self: raise HtmlExtractionCustodyError('html_extraction_reopen_unavailable')
        return HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_html_extraction.result_receipt("+_literal(self.operation_id)+"::uuid);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def prepare_html_extraction_reopen(*, operation_id, artifact_id, stored_at, prepared_at,
        current_expected, previous_expected, maximum_output_tokens, canonical_metadata, observed_at):
    try:
        if (not _uuid(operation_id) or not _uuid(artifact_id) or not _utc(stored_at) or not _utc(prepared_at)
                or not _utc(observed_at) or not _tokens(maximum_output_tokens)
                or type(current_expected) is not HtmlOriginalReopenExpected or type(previous_expected) is not HtmlOriginalReopenExpected
                or not max(current_expected.stored_at, previous_expected.stored_at) <= prepared_at <= stored_at <= observed_at
                or current_expected.intent.operation_id == previous_expected.intent.operation_id
                or current_expected.artifact_id == previous_expected.artifact_id): raise ValueError
        current_expected.statement(); previous_expected.statement()
        if type(canonical_metadata) is not bytes or not 1 <= len(canonical_metadata) <= MAX_HTML_EXTRACTION_METADATA: raise ValueError
        metadata = strict_json(canonical_metadata)
        keys = frozenset('schema_version kind operation_id prepared_at current_original previous_original request_sha256 selected_payload_sha256 maximum_output_tokens output_sha256 proposal'.split())
        if (type(metadata) is not dict or set(metadata) != keys or _canonical(metadata) != canonical_metadata
                or type(metadata['schema_version']) is not int or metadata['schema_version'] != 1
                or metadata['kind'] != 'invented_html_private_extraction_intent'
                or metadata['operation_id'] != operation_id or metadata['prepared_at'] != _time(prepared_at)
                or not _tokens(metadata['maximum_output_tokens']) or metadata['maximum_output_tokens'] != maximum_output_tokens): raise ValueError
        for key in ('request_sha256', 'selected_payload_sha256', 'output_sha256'):
            if type(metadata[key]) is not str or re.fullmatch('[a-f0-9]{64}', metadata[key]) is None: raise ValueError
        for key, source in [('current_original', current_expected), ('previous_original', previous_expected)]:
            original_metadata = strict_json(source.intent.canonical_metadata)
            reference = dict(operation_id=source.intent.operation_id, artifact_id=source.artifact_id,
                stored_at=_time(source.stored_at), source_version_id=source.document.source_version_id,
                content_sha256=source.document.content_sha256, metadata_sha256=sha256(source.intent.canonical_metadata).hexdigest(),
                derivation_manifest_sha256=original_metadata['derivation_manifest_sha256'])
            if metadata[key] != reference: raise ValueError
        proposal = metadata['proposal']
        if type(proposal) is not dict or proposal.get('review_state') != 'unverified': raise ValueError
        raw_proposal = _canonical({key: value for key, value in proposal.items() if key != 'review_state'} | dict(schema_version=1))
        checked_proposal = parse_untrusted_model_proposal(raw_proposal, AllowedEvidence(
            current_expected.document.source_version_id, current_expected.document.content_sha256,
            tuple(selection.locator for selection in current_expected.mapping.selections), current_expected.binding.language_code))
        from dataclasses import asdict
        if asdict(checked_proposal) != proposal: raise ValueError
        if max(current_expected.observed_at, previous_expected.observed_at) > observed_at: raise ValueError
        return HtmlExtractionReopenExpected(operation_id, artifact_id, stored_at, prepared_at,
            current_expected, previous_expected, maximum_output_tokens, canonical_metadata, observed_at)
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, OverflowError, RecursionError):
        raise HtmlExtractionCustodyError('html_extraction_reopen_unavailable') from None


def reopen_html_extraction(raw: bytes, expected: HtmlExtractionReopenExpected, *,
        current_receipt: bytes, previous_receipt: bytes, observed_at: datetime) -> StoredHtmlExtraction:
    """No original request/output bytes needed; independently retained intent does.

    Both original receipts must be freshly supplied. Recompile the full request,
    parse the stored untrusted output, and reproduce every exact metadata byte.
    This is historical custody, never current work or permission to resend.
    """
    try:
        if type(expected) is not HtmlExtractionReopenExpected: raise ValueError
        expected.statement()
        if not _utc(observed_at) or observed_at < expected.observed_at: raise ValueError
        value, metadata, request, output, stored = _receipt(raw, expected.operation_id, expected.prepared_at, observed_at)
        if (value['artifact_id'] != expected.artifact_id or stored != expected.stored_at
                or metadata != expected.canonical_metadata): raise ValueError
        plan = compile_stored_html_request(current_receipt, expected.current_expected, previous_receipt,
            expected.previous_expected, observed_at=observed_at, maximum_output_tokens=expected.maximum_output_tokens)
        if request != plan.request.body: raise ValueError
        result = prepare_html_private_extraction(current_receipt, expected.current_expected, previous_receipt,
            expected.previous_expected, request=plan.request, output_raw=output, operation_id=expected.operation_id,
            prepared_at=expected.prepared_at, observed_at=observed_at, maximum_output_tokens=expected.maximum_output_tokens)
        prepared = prepare_html_extraction_store(result)
        if metadata != prepared.canonical_metadata: raise ValueError
        return StoredHtmlExtraction(value['operation_id'], value['artifact_id'], stored, result, metadata)
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, OverflowError, RecursionError):
        raise HtmlExtractionCustodyError('html_extraction_reopen_unavailable') from None
