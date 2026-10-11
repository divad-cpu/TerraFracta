"""Fixed child used only by the isolated successor channel trial.

Receives a private inherited descriptor, not a password/account/DB target.
This is a local read-only protocol test, not a hosted or hostile-code sandbox.
"""
import json
import os
import socket
import sys
from workers.closed_projection_channel import request_projection


def main():
    assert len(sys.argv)==2 and sys.argv[1].isdigit()
    assert not any(key.startswith(('PG','SUPABASE','NEXT_PUBLIC_')) for key in os.environ)
    with socket.socket(fileno=int(sys.argv[1])) as channel:
        channel.settimeout(15)
        first=request_projection(channel,1)
        refused=[]
        probes=(
            b'{"schemaVersion":1,"requestId":2,"operation":"read_current","sql":"SET CONSTRAINTS ALL IMMEDIATE"}',
            b'{"schemaVersion":1,"requestId":3,"operation":"sql"}',
            b'{"schemaVersion":1,"requestId":4,"operation":"read_current","role":"postgres"}',
            b'{"schemaVersion":1,"schemaVersion":1,"requestId":5,"operation":"read_current"}',
            b'\xff',b'x'*4097)
        for raw in probes:
            channel.send(raw)
            response=json.loads(channel.recv(65537))
            assert response['state']=='refused' and response['reason']=='invalid_request'
            assert set(response)=={'schemaVersion','requestId','state','reason'}
            refused.append(True)
        last=request_projection(channel,8)
        assert first==last and first['revision']==2 and '28.1%' in first['claims'][0]['assertion']
    print(json.dumps({'evidenceKind':'actual_inherited_read_only_child_channel','validReads':2,
        'protocolDenials':len(refused),'publicationId':first['publicationId'],
        'databaseCredentialProvided':False,'databaseEnvironmentInherited':False,
        'sqlAccepted':False,'listenerCreated':False,'hostNetworkUsed':False,
        'hostileCodeSandboxAccepted':False}));return 0

if __name__=='__main__':raise SystemExit(main())
