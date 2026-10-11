"""Fixed parent-only statements for the private pending-capture candidate.

The inherited worker channel never selects a schema or raw folder identity.
Unknown response bytes use the existing validated literal adapter; raw custody
identity/time is supplied separately by the trusted parent after its fsync.
No native client, account, source permission or public writer is created here.
"""
from datetime import datetime, timedelta
from re import fullmatch

from workers.pair_native_sql import operation_sql, SCHEMA as TRIAL_SCHEMA, _literal

PRIVATE_SCHEMA = 'terra_ssb_private_capture_api'
HEAD = "set standard_conforming_strings=on;set statement_timeout='3s';set lock_timeout='1s';select "


def private_operation_sql(operation, arguments, *, raw_attempt_id=None, stored_at=None):
    sql = operation_sql(operation, arguments)
    prefix = HEAD+TRIAL_SCHEMA+'.'
    if not sql.startswith(prefix):
        raise ValueError('Fixed private statement template changed')
    # Replace only the known leading statement head. A matching string in a
    # JSON literal must stay untouched, including in an untrusted source body.
    sql = HEAD+PRIVATE_SCHEMA+'.'+sql[len(prefix):]
    if operation != 'store_pair':
        if raw_attempt_id is not None or stored_at is not None:
            raise ValueError('Raw custody identity belongs only to pair storage')
        return sql
    if type(raw_attempt_id) is not str or fullmatch('[0-9a-f]{32}',raw_attempt_id) is None \
            or not isinstance(stored_at,datetime) or stored_at.utcoffset()!=timedelta(0):
        raise ValueError('Fixed private raw custody identity is unavailable')
    return sql[:-2]+','+_literal(raw_attempt_id)+','+_literal(stored_at.isoformat())+');'


def private_admission_sql():
    return HEAD+PRIVATE_SCHEMA+'.read_admitted_context();'


def private_raw_binding_sql():
    return HEAD+PRIVATE_SCHEMA+'.read_raw_pair_binding();'


def private_retention_sql():
    return HEAD+PRIVATE_SCHEMA+'.read_retention_context();'
