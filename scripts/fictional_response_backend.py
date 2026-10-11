"""Owner test adapter for the one fixed isolated response-reservation project.

No app import, runtime login, user-selected target, URL fetch or primary write.
Every method uses a separate psql autocommit and returns only after COMMIT.
This proves receipt/transaction behavior, not authenticated runtime access.
"""

import json
import subprocess

from scripts.check_run_admission_draft import query as owner_query
from scripts.check_run_admission_concurrency import quote
from workers.source_response_receipts import ResponseRequest, ResponseReservation
from workers.update_request_identity import identify_update_request

CONTAINER = 'supabase_db_terrafracta-response30-20261001'
NETWORK = 'terrafracta-response30-loopback-20261001'
PORT = '65032'
ARGS = ['docker','exec','-i',CONTAINER,'psql','-U','postgres','-d','postgres',
        '-X','-qAt','-v','ON_ERROR_STOP=1']
STATE = """select jsonb_build_object('migrations',(select count(*) from supabase_migrations.schema_migrations),
 'runs',(select count(*) from terra_private.update_runs),'versions',(select count(*) from terra_private.source_versions),
 'checks',(select count(*) from terra_private.update_run_source_checks),
 'manifests',(select count(*) from terra_private.update_run_manifests),
 'activations',(select count(*) from terra_private.machine_publication_activations),
 'closeouts',(select count(*) from terra_private.update_run_closeouts));"""


def verify_target(*, migration_count=29):
    inspected = subprocess.run(['docker','inspect','--format',
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}},"labels":{{json .Config.Labels}}}',
        CONTAINER],capture_output=True,text=True,check=True,timeout=10)
    meta = json.loads(inspected.stdout)
    assert meta['ports']['5432/tcp']==[{'HostIp':'127.0.0.1','HostPort':PORT}]
    assert set(meta['networks'])=={NETWORK}
    assert meta['labels']['com.supabase.cli.project']=='terrafracta-response30-20261001'
    assert json.loads(query(STATE))['migrations']==migration_count


def query(sql):
    return owner_query(CONTAINER,sql)


class FictionalCommittedResponseBackend:
    def __init__(self):
        verify_target(migration_count=31)

    def reserve(self, expected: ResponseRequest) -> bytes:
        fp = identify_update_request(expected.invocation).request_fingerprint
        values = ','.join(map(quote,(str(expected.work.run_id),fp,str(expected.work.lease_id),
                                     expected.registration_id,expected.request_key)))
        return query('select terra_private.reserve_source_response('+values+','+str(expected.max_body_bytes)+');').encode()

    def dispatch(self, expected: ResponseRequest, reservation: ResponseReservation) -> bytes:
        fp = identify_update_request(expected.invocation).request_fingerprint
        values = ','.join(map(quote,(str(expected.work.run_id),fp,str(expected.work.lease_id),reservation.reservation_id)))
        return query('select terra_private.dispatch_source_response('+values+');').encode()

    def settle(self, expected: ResponseRequest, reservation: ResponseReservation, *,
               outcome: str, body_bytes: int, content_sha256: str | None) -> bytes:
        fp = identify_update_request(expected.invocation).request_fingerprint
        values = ','.join(map(quote,(str(expected.work.run_id),fp,str(expected.work.lease_id),
                                     reservation.reservation_id,outcome)))
        h = 'null' if content_sha256 is None else quote(content_sha256)
        return query('select terra_private.settle_source_response('+values+','+str(body_bytes)+','+h+');').encode()
