"""One fixed nonowner private-artifact route with unchanged full read semantics.

The native prototype requires explicit private artifact disclosure AND both
actual original-stream assignments. This helper grants neither permission;
it only adapts one exact already-regenerated owner statement to a fixed route.
No connection, default backend, retry, source/model call, write or publication.
"""
from workers.private_extraction_reader import read_private_extraction,PrivateExtractionRead
from workers.feed_postgres_contract import HEAD,COMMIT_MARKER,_uuid
from workers.pair_native_sql import _literal


class RestrictedPrivateExtractionReadError(ValueError):pass


def _statement(operation_id,*,restricted):
    if type(operation_id)is not str or not _uuid(operation_id):raise ValueError
    function='tf_feed_runtime.private_result_receipt'if restricted else'tf_private_extraction.result_receipt'
    return HEAD+"set time zone 'UTC';begin isolation level repeatable read read only;select "+function+'('+_literal(operation_id)+"::uuid);commit;\n\\echo "+COMMIT_MARKER.decode()+'\n'


def restricted_private_extraction_statement(operation_id):
    try:return _statement(operation_id,restricted=True)
    except Exception:raise RestrictedPrivateExtractionReadError('restricted_private_extraction_read_unavailable')from None


def read_restricted_private_extraction(current,current_receipt,previous,previous_receipt,*,operation_id,
        maximum_output_tokens,query,utc_now)->PrivateExtractionRead:
    """Delegate original/request/output/tick checks; exactly one bounded query."""
    try:
        if not callable(query)or not callable(utc_now):raise ValueError
        owner=_statement(operation_id,restricted=False);restricted=_statement(operation_id,restricted=True)
        def dispatch(statement):
            # Compare a complete closed UUID-only statement. Never replace a
            # function name inside arbitrary SQL, source text or JSON literals.
            if type(statement)is not str or statement!=owner:raise ValueError
            return query(restricted)
        return read_private_extraction(current,current_receipt,previous,previous_receipt,
            operation_id=operation_id,maximum_output_tokens=maximum_output_tokens,query=dispatch,utc_now=utc_now)
    except Exception:
        raise RestrictedPrivateExtractionReadError('restricted_private_extraction_read_unavailable')from None
