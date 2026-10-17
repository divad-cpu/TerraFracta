"""Owner-only invented full-result custody; not a provider or held-issue writer.

Existing compiler limits stay unchanged. This adapter admits only results whose
complete request/output/readback fit the existing bounded native channel. Larger
otherwise valid requests are refused before SQL, not truncated or reclassified.
"""
from dataclasses import dataclass, field
from datetime import datetime
import base64
import json
from workers.private_extraction_result import (PrivateExtractionResult,
    recheck_private_extraction_result, _canonical)
from workers.feed_postgres_contract import (HEAD, COMMIT_MARKER, MAX_CAPTURE_STATEMENT,
    MAX_CAPTURE_OUTPUT, _uuid, _utc, _time, _parse_time)
from workers.closed_pair_channel import _json as strict_json
from workers.pair_native_sql import _literal
RECEIPT_MARGIN = 4096


class PrivateExtractionPostgresError(ValueError): pass


@dataclass(frozen=True)
class PrivateExtractionStoreRequest:
    result: PrivateExtractionResult = field(repr=False)
    canonical_metadata: bytes = field(repr=False)
    evidence_state: str = 'invented_private_extraction_store_request_only'

    def statement(self):
        _recheck(self)
        sql = HEAD+"set time zone 'UTC';begin;select tf_private_extraction.store_result("+_literal(self.canonical_metadata.decode('utf8'))+"::jsonb,decode("+_literal(base64.b64encode(self.result.request.body).decode('ascii'))+",'base64'),decode("+_literal(base64.b64encode(self.result.output_raw).decode('ascii'))+",'base64'));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
        if len(sql.encode('utf8')) > MAX_CAPTURE_STATEMENT:
            raise PrivateExtractionPostgresError('private_extraction_store_input_unavailable')
        return sql


@dataclass(frozen=True)
class StoredPrivateExtractionResult:
    operation_id: str
    artifact_id: str
    stored_at: datetime
    request_sha256: str
    output_sha256: str
    evidence_state: str = 'invented_exact_request_output_stored_still_unverified'


def _shape(metadata, request_raw, output_raw):
    return dict(schema_version=1, kind='invented_private_extraction_stored',
        operation_id=metadata['operation_id'], artifact_id='ffffffff-ffff-4fff-bfff-ffffffffffff',
        stored_at='9999-12-31T23:59:59.999999Z', input=metadata,
        request_base64=base64.b64encode(request_raw).decode('ascii'), output_base64=base64.b64encode(output_raw).decode('ascii'))


def prepare_private_extraction_store(result):
    try:
        result = recheck_private_extraction_result(result)
        value = strict_json(result.canonical_input)
        metadata = {key: value for key, value in value.items() if key not in ('request_base64', 'output_base64')}
        # Default JSON spacing and a separate margin conservatively cover JSONB
        # framing, UUID/UTC fields, COMMIT marker and complete stream output.
        estimated = json.dumps(_shape(metadata, result.request.body, result.output_raw), ensure_ascii=False).encode('utf8')
        if len(estimated)+RECEIPT_MARGIN > MAX_CAPTURE_OUTPUT: raise ValueError
        return PrivateExtractionStoreRequest(result, _canonical(metadata))
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise PrivateExtractionPostgresError('private_extraction_store_input_unavailable') from None


def _recheck(expected):
    if type(expected) is not PrivateExtractionStoreRequest or type(expected.canonical_metadata) is not bytes:
        raise PrivateExtractionPostgresError('private_extraction_store_input_unavailable')
    checked = prepare_private_extraction_store(expected.result)
    if checked != expected: raise PrivateExtractionPostgresError('private_extraction_store_input_unavailable')
    return checked


def private_extraction_read_statement(expected):
    _recheck(expected)
    return HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_private_extraction.result_receipt("+_literal(expected.result.operation_id)+"::uuid);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def parse_stored_private_extraction_result(raw, expected, *, observed_at):
    try:
        _recheck(expected)
        if (type(raw) is not bytes or not 1 <= len(raw) <= MAX_CAPTURE_OUTPUT or not _utc(observed_at)
                or observed_at < expected.result.observed_at): raise ValueError
        value = strict_json(raw)
        if (type(value) is not dict or set(value) != {'schema_version', 'kind', 'operation_id', 'artifact_id',
                'stored_at', 'input', 'request_base64', 'output_base64'}
                or type(value['schema_version']) is not int or value['schema_version'] != 1
                or value['kind'] != 'invented_private_extraction_stored'
                or value['operation_id'] != expected.result.operation_id or not _uuid(value['artifact_id'])
                or _canonical(value['input']) != expected.canonical_metadata): raise ValueError
        for key, original in [('request_base64', expected.result.request.body), ('output_base64', expected.result.output_raw)]:
            encoded = value[key]
            if type(encoded) is not str or encoded != base64.b64encode(original).decode('ascii'): raise ValueError
        stored = _parse_time(value['stored_at'])
        if not expected.result.prepared_at <= stored <= observed_at: raise ValueError
        metadata = strict_json(expected.canonical_metadata)
        return StoredPrivateExtractionResult(value['operation_id'], value['artifact_id'], stored,
            metadata['request_sha256'], metadata['output_sha256'])
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError, OverflowError):
        raise PrivateExtractionPostgresError('private_extraction_stored_result_unavailable') from None
