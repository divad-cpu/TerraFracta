"""Independently bind worker bodies to committed native capture measurements.

Reuses the existing SSB parsers and context manifest. Synthetic transport
metadata here is a parsing envelope, not evidence of HTTP origin or TLS truth.
This module opens no file, socket or database and issues no source permission.
"""
from datetime import datetime

from workers.closed_pair_channel import _binary, validate_operation
from workers.reserved_response_capture import ReservedCapture
from workers.reserved_ssb_capture import ReservedSSBResponse
from workers.ssb_14059_capture import (CapturedResponse, METADATA_URL, DATA_URL,
    parse_captured_ssb_14059, parse_captured_ssb_14059_metadata)
from workers.ssb_14059_context_manifest import build_ssb_context_manifest
from workers.update_run_completion import canonical_run_manifest


def validate_store_capture(arguments, requests, versions, checkpoints):
    validate_operation('store_pair', arguments)
    responses = {}
    for kind, endpoint, parser in (
            ('metadata', METADATA_URL, parse_captured_ssb_14059_metadata),
            ('data', DATA_URL, parse_captured_ssb_14059)):
        body = _binary(arguments[kind], 65536)
        capture = CapturedResponse(endpoint, endpoint, 0, 200, 'application/json', body,
            datetime.fromisoformat(arguments[kind+'RetrievedAt']))
        native = checkpoints[kind]
        receipt = ReservedCapture(body, native['reservation'], native['settlement'], native['dispatch'])
        responses[kind] = ReservedSSBResponse(kind, capture, receipt, parser(capture), requests[kind])
    context = build_ssb_context_manifest(requests['metadata'], requests['data'], responses['metadata'],
        responses['data'], versions['metadata'], versions['data'])
    if canonical_run_manifest(context.manifest) != arguments['manifest']:
        raise ValueError('Private worker capture manifest differs from native measurements')
    return context
