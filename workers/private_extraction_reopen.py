"""Reopen stored untrusted output without retaining an old Python/output object.

The operation and both original-document bindings are independently supplied;
the complete offline request is regenerated. Historical preparation metadata
and newly read output cannot create current source/rights/provider/factual trust.
An authenticated constrained custody transport remains an external prerequisite.
"""
from dataclasses import dataclass, field
from datetime import datetime
import base64
from workers.feed_postgres_contract import HEAD, COMMIT_MARKER, MAX_CAPTURE_OUTPUT, _uuid, _utc, _parse_time
from workers.document_result_reopen import ReopenedDocumentResult
from workers.reopened_document_change import prepare_reopened_document_change
from workers.passage_extraction_request import OfflineExtractionRequest, _regenerate
from workers.model_proposal import MAX_OUTPUT_BYTES
from workers.private_extraction_result import PrivateExtractionResult, prepare_private_extraction_result, _canonical, _document_ref
from workers.private_extraction_postgres import (PrivateExtractionStoreRequest, StoredPrivateExtractionResult,
    prepare_private_extraction_store, parse_stored_private_extraction_result)
from workers.closed_pair_channel import _json as strict_json
from workers.pair_native_sql import _literal


class PrivateExtractionReopenError(ValueError): pass


@dataclass(frozen=True)
class PrivateExtractionReopenRequest:
    operation_id: str
    current: ReopenedDocumentResult = field(repr=False)
    current_receipt: bytes = field(repr=False)
    previous: ReopenedDocumentResult = field(repr=False)
    previous_receipt: bytes = field(repr=False)
    request: OfflineExtractionRequest = field(repr=False)
    maximum_output_tokens: int
    observed_at: datetime
    canonical_input: bytes = field(repr=False)

    def statement(self):
        _recheck(self)
        return HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_private_extraction.result_receipt("+_literal(self.operation_id)+"::uuid);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


@dataclass(frozen=True)
class ReopenedPrivateExtractionResult:
    request: PrivateExtractionReopenRequest = field(repr=False)
    result: PrivateExtractionResult = field(repr=False)
    store_request: PrivateExtractionStoreRequest = field(repr=False)
    stored: StoredPrivateExtractionResult = field(repr=False)
    full_receipt: bytes = field(repr=False)
    observed_at: datetime
    evidence_state: str = 'invented_private_extraction_reopened_still_unverified'


def prepare_private_extraction_reopen(current, current_receipt, previous, previous_receipt, *,
        request, operation_id, maximum_output_tokens, observed_at):
    try:
        if not _uuid(operation_id) or not _utc(observed_at): raise ValueError
        pair=prepare_reopened_document_change(current,current_receipt,previous,previous_receipt,observed_at=observed_at)
        if (current.result_request.operation_id == previous.result_request.operation_id
                or current.artifact_id == previous.artifact_id): raise ValueError
        _regenerate(request,pair.current,pair.previous,observed_at,maximum_output_tokens)
        body=_canonical(dict(operation_id=operation_id,current_document=_document_ref(current),
            previous_document=_document_ref(previous),request_sha256=request.request_sha256,
            selected_payload_sha256=request.selected_payload_sha256,maximum_output_tokens=maximum_output_tokens))
        return PrivateExtractionReopenRequest(operation_id,current,current_receipt,previous,previous_receipt,
            request,maximum_output_tokens,observed_at,body)
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise PrivateExtractionReopenError('private_extraction_reopen_unavailable') from None


def _recheck(expected):
    if type(expected) is not PrivateExtractionReopenRequest or type(expected.canonical_input) is not bytes:
        raise PrivateExtractionReopenError('private_extraction_reopen_unavailable')
    checked=prepare_private_extraction_reopen(expected.current,expected.current_receipt,expected.previous,expected.previous_receipt,
        request=expected.request,operation_id=expected.operation_id,maximum_output_tokens=expected.maximum_output_tokens,
        observed_at=expected.observed_at)
    if checked != expected: raise PrivateExtractionReopenError('private_extraction_reopen_unavailable')
    return checked


def parse_reopened_private_extraction(raw, expected, *, observed_at):
    """Reparse newly read output; a stored proposal object is never adopted."""
    try:
        _recheck(expected)
        if (type(raw) is not bytes or not 1<=len(raw)<=MAX_CAPTURE_OUTPUT or not _utc(observed_at)
                or observed_at<expected.observed_at): raise ValueError
        value=strict_json(raw)
        if type(value) is not dict or type(value.get('input')) is not dict: raise ValueError
        output=value.get('output_base64')
        if type(output) is not str or not 4<=len(output)<=4*((MAX_OUTPUT_BYTES+2)//3): raise ValueError
        original=base64.b64decode(output,validate=True)
        if not 1<=len(original)<=MAX_OUTPUT_BYTES or base64.b64encode(original).decode('ascii')!=output: raise ValueError
        # This is historical intent from the admitted stored artifact. It does
        # not authenticate a provider dispatch or renew any current approval.
        prepared=_parse_time(value['input']['prepared_at'])
        result=prepare_private_extraction_result(expected.current,expected.current_receipt,
            expected.previous,expected.previous_receipt,request=expected.request,output_raw=original,
            operation_id=expected.operation_id,prepared_at=prepared,observed_at=observed_at,
            maximum_output_tokens=expected.maximum_output_tokens)
        store=prepare_private_extraction_store(result)
        stored=parse_stored_private_extraction_result(raw,store,observed_at=observed_at)
        return ReopenedPrivateExtractionResult(expected,result,store,stored,raw,observed_at)
    except (ValueError,TypeError,AttributeError,KeyError,UnicodeError,OverflowError):
        raise PrivateExtractionReopenError('private_extraction_reopen_unavailable') from None
