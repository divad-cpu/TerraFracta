"""Bounded read-only parent/child channel, with no SQL or credential inputs.

The inherited private Unix socket is the capability. No listener, path, TCP,
credential file, actor/role selector or source operation is provided here.
The custodian supplies an already materialized projection callback. This is
local protocol separation, not an OS sandbox or hosted authorization system.
"""
import json
import socket

REQUEST_BYTES=4096
RESPONSE_BYTES=65536


class ProjectionChannelError(ValueError):pass


def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ProjectionChannelError('Duplicate channel field')
        result[key]=value
    return result


def _parse(raw):
    def invalid_constant(_value):raise ProjectionChannelError('Nonfinite channel value')
    try:return json.loads(raw.decode('utf-8'),object_pairs_hook=_unique,parse_constant=invalid_constant)
    except (ValueError,UnicodeError,RecursionError):raise ProjectionChannelError('Invalid channel JSON') from None


def _sequence(value):return type(value) is int and 1<=value<=32


def serve_projection_request(connection,read_projection):
    """Serve one packet; invalid input never reaches the supplied callback."""
    raw,_ancillary,flags,_address=connection.recvmsg(REQUEST_BYTES+1)
    if not raw:raise ProjectionChannelError('Projection channel closed')
    sequence=0
    try:
        if flags&socket.MSG_TRUNC or len(raw)>REQUEST_BYTES:raise ProjectionChannelError('Oversized request')
        request=_parse(raw)
        if isinstance(request,dict) and _sequence(request.get('requestId')):sequence=request['requestId']
        if not isinstance(request,dict) or set(request)!={'schemaVersion','requestId','operation'} \
          or type(request['schemaVersion']) is not int or request['schemaVersion']!=1 \
          or not _sequence(request['requestId']) or request['operation']!='read_current':
            raise ProjectionChannelError('Invalid request')
    except (ValueError,UnicodeError,RecursionError):
        response={'schemaVersion':1,'requestId':sequence,'state':'refused','reason':'invalid_request'}
    else:
        try:
            issue=read_projection()
            if not isinstance(issue,dict):raise ProjectionChannelError('Projection missing')
            response={'schemaVersion':1,'requestId':sequence,'state':'issue','issue':issue}
            encoded=json.dumps(response,allow_nan=False,separators=(',',':')).encode()
            if len(encoded)>RESPONSE_BYTES:raise ProjectionChannelError('Projection oversized')
        except Exception:
            # Never send exception text, SQL errors, paths or credentials.
            response={'schemaVersion':1,'requestId':sequence,'state':'refused','reason':'unavailable'}
    encoded=json.dumps(response,allow_nan=False,separators=(',',':')).encode()
    if connection.send(encoded)!=len(encoded):raise ProjectionChannelError('Incomplete response')
    return response['state']


def request_projection(connection,request_id):
    if not _sequence(request_id):raise ProjectionChannelError('Invalid request identity')
    request={'schemaVersion':1,'requestId':request_id,'operation':'read_current'}
    encoded=json.dumps(request,separators=(',',':')).encode()
    if connection.send(encoded)!=len(encoded):raise ProjectionChannelError('Incomplete request')
    raw,_ancillary,flags,_address=connection.recvmsg(RESPONSE_BYTES+1)
    if flags&socket.MSG_TRUNC or not 1<=len(raw)<=RESPONSE_BYTES:raise ProjectionChannelError('Invalid response size')
    response=_parse(raw)
    if not isinstance(response,dict) or type(response.get('schemaVersion')) is not int \
      or response['schemaVersion']!=1 or type(response.get('requestId')) is not int \
      or response['requestId']!=request_id:raise ProjectionChannelError('Response identity changed')
    if set(response)=={'schemaVersion','requestId','state','reason'} and response['state']=='refused' \
      and response['reason'] in ('invalid_request','unavailable'):raise ProjectionChannelError('Projection unavailable')
    if set(response)!={'schemaVersion','requestId','state','issue'} or response['state']!='issue' \
      or not isinstance(response['issue'],dict):raise ProjectionChannelError('Invalid response shape')
    return response['issue']
