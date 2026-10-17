"""One bounded private stdin PDF request-context check, never a live update.

Input supplies both packet/receipt/recipe expectations and the independent exact
historical request. Output is metadata only, not stored/authenticated custody,
source freshness, model execution, cost settlement or publication permission.
"""
import sys

from scripts.offline_pdf_report import _instant
from workers.closed_pair_channel import _json as strict_json, _binary as bounded_binary
from workers.error_diagnostics import diagnostic_worker
from workers.passage_extraction_request import _canonical, _tokens, MAX_REQUEST_BYTES
from workers.pdf_text_inspection import PdfDocumentReceipt
from workers.pdf_passage_binding import PdfPassageBinding, PdfPageSelection, PdfPageSelectionMap, _stamp
from workers.pdf_derivation_packet import PdfDerivationPacketExpected, MAX_PACKET_BYTES
from workers.pdf_extraction_request import OfflinePdfExtractionRequest, _request_snapshot
from workers.pdf_request_packet_context import PdfPacketReference, PdfRequestPacketContextError, reopen_pdf_request_packet_context

# Two512KiB packets need <=1,398,104 base64 bytes; a128KiB request needs174,764.
# The2MiB envelope includes those bodies plus independent bounded typed metadata.
# This does not raise any old process/transport/receipt limit.
MAX_INPUT_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 16384
HELP = ('Offline PDF historical request context: supply private_pdf_request_context_input v1 on stdin. '
        'Output is private metadata only; refusal is not a source-quality verdict. '
        'No storage, authentication, new source check, provider or publication occurs.\n')


class OfflinePdfRequestContextInputError(ValueError):
    """Malformed or unavailable supplied context, not a source-quality verdict."""


class OfflinePdfRequestContextTechnicalError(RuntimeError):
    """Fixed unexpected adapter failure without source/request/backend details."""


def _closed(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        raise ValueError
    return value


def _strings(value, keys):
    _closed(value, keys)
    if any(type(item) is not str for item in value.values()):
        raise ValueError
    return dict(value)


def _expected(e):
    e = _closed(e, ('document', 'binding', 'mapping', 'recorded_observed_at',
                                  'packet_sha256', 'inspection_sha256', 'derivation_sha256'))
    doc = _strings(e['document'], ('source_key', 'item_key', 'source_version_id', 'source_url',
                                  'content_sha256', 'retrieved_at', 'media_type'))
    binding = _strings(e['binding'], ('source_key', 'item_key', 'source_version_id', 'source_url',
                                     'content_sha256', 'mapping_sha256', 'language_code', 'retrieved_at'))
    mapping = _closed(e['mapping'], ('source_version_id', 'content_sha256', 'mapping_sha256', 'language_code', 'selections'))
    if (any(type(mapping[k]) is not str for k in ('source_version_id', 'content_sha256', 'mapping_sha256', 'language_code'))
            or type(mapping['selections']) is not list or len(mapping['selections']) > 8
            or any(type(e[k]) is not str for k in ('packet_sha256', 'inspection_sha256', 'derivation_sha256'))):
        raise ValueError
    selections = []
    for entry in mapping['selections']:
        _closed(entry, ('locator', 'page_number', 'page_text_sha256'))
        if type(entry['locator']) is not str or type(entry['page_number']) is not int or type(entry['page_text_sha256']) is not str:
            raise ValueError
        selections.append(PdfPageSelection(**entry))
    document = PdfDocumentReceipt(**{**doc, 'retrieved_at': _instant(doc['retrieved_at'])})
    bound = PdfPassageBinding(**{**binding, 'retrieved_at': _instant(binding['retrieved_at'])})
    selected = PdfPageSelectionMap(mapping['source_version_id'], mapping['content_sha256'], mapping['mapping_sha256'],
                                   mapping['language_code'], tuple(selections))
    expected = PdfDerivationPacketExpected(document, bound, selected, _instant(e['recorded_observed_at']),
        e['packet_sha256'], e['inspection_sha256'], e['derivation_sha256'])
    return expected


def _reference(value):
    _closed(value, ('packet_base64', 'expected'))
    packet = bounded_binary(value['packet_base64'], MAX_PACKET_BYTES)
    return PdfPacketReference(packet, _expected(value['expected']))

def _request(r):
    r = _closed(r, ('item_key', 'body_base64', 'request_sha256', 'selected_payload_sha256', 'maximum_output_tokens'))
    if any(type(r[k]) is not str for k in ('item_key', 'request_sha256', 'selected_payload_sha256')):
        raise ValueError
    request = _request_snapshot(OfflinePdfExtractionRequest(r['item_key'], bounded_binary(r['body_base64'], MAX_REQUEST_BYTES),
        r['request_sha256'], r['selected_payload_sha256'], r['maximum_output_tokens']))
    return request


def _decode(raw):
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_INPUT_BYTES:
        raise ValueError
    value = _closed(strict_json(raw), ('schema_version', 'kind', 'current', 'previous', 'request',
                                      'reopened_at', 'maximum_output_tokens'))
    if (type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['kind'] != 'private_pdf_request_context_input' or not _tokens(value['maximum_output_tokens'])):
        raise ValueError
    current = _reference(value['current'])
    previous = None if value['previous'] is None else _reference(value['previous'])
    request = _request(value['request'])
    if request.maximum_output_tokens != value['maximum_output_tokens']:
        raise ValueError
    return current, previous, request, _instant(value['reopened_at']), value['maximum_output_tokens']


def _summary(bound, packet_sha):
    return dict(packet_sha256=packet_sha, original_sha256=bound.document.content_sha256,
        source_version_id=bound.document.source_version_id, inspection_sha256=bound.inspection_report_sha256,
        derivation_sha256=bound.derivation_manifest_sha256)


def report_from_envelope(raw: bytes) -> bytes:
    """One core call: both originals/caller assertions captured before children."""
    try:
        current, previous, request, reopened_at, maximum_output_tokens = _decode(raw)
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, OverflowError, RecursionError):
        raise OfflinePdfRequestContextInputError('pdf_request_context_input_refused') from None
    except Exception:
        raise OfflinePdfRequestContextTechnicalError('pdf_request_context_unavailable') from None
    try:
        context = reopen_pdf_request_packet_context(current, previous, request=request,
            reopened_at=reopened_at, maximum_output_tokens=maximum_output_tokens)
    except PdfRequestPacketContextError:
        # The core intentionally curates input and derivation unavailability.
        # This cannot distinguish invalid material from a failed native check.
        raise OfflinePdfRequestContextInputError('pdf_request_context_unavailable') from None
    except Exception:
        raise OfflinePdfRequestContextTechnicalError('pdf_request_context_unavailable') from None
    try:
        report = dict(schema_version=1, kind='private_pdf_request_context_report',
            scope='supplied_unverified_pdf_request_context_rederivation_only',
            evidence_state='supplied_pdf_request_context_rederived_only_not_stored_or_authorized',
            recorded_observed_at=_stamp(context.recorded_observed_at), reopened_at=_stamp(context.reopened_at),
            current=_summary(context.current, context.current_packet_sha256),
            previous=None if context.previous is None else _summary(context.previous, context.previous_packet_sha256),
            request=dict(item_key=context.request.item_key, request_sha256=context.request.request_sha256,
                selected_payload_sha256=context.request.selected_payload_sha256, request_bytes=len(context.request.body),
                maximum_output_tokens=context.request.maximum_output_tokens),
            qualification=dict(storage_authenticated=False, source_authenticated=False, current_source_check=False,
                provider_execution=False, measured_tokens=False, publication_authorized=False))
        output = _canonical(report) + b'\n'
        if len(output) > MAX_OUTPUT_BYTES:
            raise ValueError
        return output
    except Exception:
        raise OfflinePdfRequestContextTechnicalError('pdf_request_context_unavailable') from None


def main(*, args=None, stdin=None, stdout=None, stderr=None) -> int:
    args = sys.argv[1:] if args is None else args
    stdin = sys.stdin.buffer if stdin is None else stdin
    stdout = sys.stdout.buffer if stdout is None else stdout
    stderr = sys.stderr if stderr is None else stderr
    try:
        with diagnostic_worker('collector_worker'):
            if args == ['--help']:
                stderr.write(HELP); return 0
            if args:
                stderr.write('offline_pdf_request_context_arguments_refused\n'); return 2
            try:
                output = report_from_envelope(stdin.read(MAX_INPUT_BYTES + 1))
            except OfflinePdfRequestContextInputError:
                stderr.write('offline_pdf_request_context_unavailable\n'); return 2
            if stdout.write(output) != len(output):
                raise OSError
            stdout.flush()
            return 0
    except Exception:
        try: stderr.write('offline_pdf_request_context_unavailable\n')
        except Exception: pass
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
