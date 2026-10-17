"""Fixed invented stream-scoped read routes; never an arbitrary SQL adapter.

The trusted installer assigns existing allowed_streams independently. That old
scope also enables pre-existing writer operations; only these new routes read.
No login, actual target, source/right/recipe trust or publication is created.
"""
import base64
from workers.feed_capture_reopen import ReopenRequest,FeedReopenError
from workers.document_result_reopen import DocumentReopenRequest,DocumentReopenError
from workers.document_result_contract import InventedDocumentResult,invented_document_result_read_statement
from workers.feed_postgres_contract import InventedPgCapture,invented_pg_read_statement,HEAD,COMMIT_MARKER,MAX_CAPTURE_STATEMENT,_uuid
from workers.feed_postgres_processing import FeedPostgresProcessingError
from workers.pair_native_sql import _literal

class StreamReaderError(ValueError):pass


def _route(statement,original,target):
    # All callers compile a known exact request type first. This helper is not
    # a public free-text SQL transport and rewrites no literal/source material.
    before,separator,after=statement.partition('select '+original+'(')
    if not separator:raise StreamReaderError('stream_reader_route_invalid')
    result=before+'select '+target+'('+after
    if len(result.encode('utf8'))>MAX_CAPTURE_STATEMENT:raise StreamReaderError('stream_reader_statement_limit')
    return result


def stream_feed_original_statement(request):
    if type(request) is not ReopenRequest:raise StreamReaderError('stream_feed_request_invalid')
    return _route(request.statement(),'tf_feed_reopen.original','tf_feed_runtime.feed_original')


def stream_document_original_statement(request):
    if type(request) is not DocumentReopenRequest:raise StreamReaderError('stream_document_request_invalid')
    return _route(request.statement(),'tf_document_reopen.original','tf_feed_runtime.document_original')


def stream_page_statement(capture):
    if type(capture) is not InventedPgCapture:raise StreamReaderError('stream_page_request_invalid')
    return _route(invented_pg_read_statement(capture),'tf_feed_rehearsal.page_receipt','tf_feed_runtime.page_receipt')


def stream_result_statement(request):
    if type(request) is not InventedDocumentResult:raise StreamReaderError('stream_result_request_invalid')
    return _route(invented_document_result_read_statement(request),'tf_feed_rehearsal.document_result_receipt','tf_feed_runtime.document_result_receipt')


def stream_history_statement(capture,item_id):
    if type(capture) is not InventedPgCapture or not _uuid(item_id):raise StreamReaderError('stream_history_request_invalid')
    capture.statement() # Regenerate exact parser/context before accessing bytes.
    raw=base64.b64encode(capture.raw).decode('ascii')
    result=HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select tf_feed_runtime.item_history("+_literal(capture.operation_id)+'::uuid,'+_literal(item_id)+"::uuid,decode("+_literal(raw)+",'base64'));commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'
    if len(result.encode('utf8'))>MAX_CAPTURE_STATEMENT:raise StreamReaderError('stream_history_statement_limit')
    return result
