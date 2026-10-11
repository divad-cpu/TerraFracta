"""Fixed SQL adapter for the isolated closed paired-capture API.

Only eight named operations are admitted. The trusted parent supplies the
connection; this module creates no account, connection, schema or source grant.
The schema is fixed in code, not a caller/worker-selected identifier. Existing
psql execution uses standard-conforming literals with independently validated
arguments; a later client with parameter binding can use a separate adapter.
"""
from workers.closed_pair_channel import _binary, validate_operation

SCHEMA = 'terra_pair_capture_test_api'


def _literal(value):
    if type(value) is not str or '\x00' in value:
        raise ValueError('Invalid fixed native literal')
    return "'" + value.replace("'", "''") + "'"


def operation_sql(operation, arguments):
    validate_operation(operation, arguments)
    a = arguments
    if operation == 'reserve_response':
        values = [_literal(a['kind'])]
    elif operation == 'dispatch_response':
        values = [_literal(a['kind']), _literal(a['reservationId'])]
    elif operation == 'settle_response':
        values = [_literal(a['kind']), _literal(a['reservationId']), _literal(a['outcome']),
            str(a['bodyBytes']), 'null' if a['contentSha256'] is None else _literal(a['contentSha256'])]
    elif operation == 'confirm_response':
        values = [_literal(a['kind']), _literal(a['phase']), _literal(_binary(a['receipt'], 4096).decode('utf-8'))]
    elif operation == 'store_pair':
        values = [_literal(_binary(a['metadata'], 65536).hex()), _literal(_binary(a['data'], 65536).hex()),
            _literal(a['metadataRetrievedAt']), _literal(a['dataRetrievedAt']), _literal(a['manifest'])]
    else:
        values = []
    return "set standard_conforming_strings=on;set statement_timeout='3s';set lock_timeout='1s';select " \
        + SCHEMA + '.' + operation + '(' + ','.join(values) + ');'
