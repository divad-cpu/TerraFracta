"""Fixed invented transport substitution for the private composition rehearsal.

The entire transport module is replaced by these literal bytes, which import no
HTTP/network client. The current HTTP candidate is refused by the test harness
before spawn. Its original preparation remains separate and never executed.
"""
from hashlib import sha256
from io import BytesIO
import json
from zipfile import ZipFile
from scripts.run_authenticated_ssb_pair_capture import fixture_body
from workers.ssb_frozen_private_collector import check_private_collector_source

TRANSPORT='workers/ssb_14059_transport.py'


def invented_transport_bytes():
    bodies={kind:fixture_body(kind) for kind in ('metadata','data')}
    return ('''"""INVENTED PRIVATE WIRING TRANSPORT; no HTTP or origin acceptance."""
from datetime import datetime, timezone
from time import monotonic
from workers.ssb_14059_capture import CapturedResponse, METADATA_URL, DATA_URL
class SSB14059TransportError(ValueError):
    """Invented transport failure; never network evidence."""
BODIES='''+repr(bodies)+'''
def fetch_ssb_14059_once(kind, *, deadline=None):
    if kind not in BODIES or type(deadline) not in (int, float) or monotonic() >= deadline:
        raise SSB14059TransportError('Invented wiring response refused')
    url = METADATA_URL if kind == 'metadata' else DATA_URL
    return CapturedResponse(url, url, 0, 200, 'application/json', BODIES[kind], datetime.now(timezone.utc))
''').encode('utf-8')


def check_private_wiring_source(source):
    check_private_collector_source(source)
    expected=invented_transport_bytes()
    with ZipFile(BytesIO(source.check())) as archive:
        manifest=json.loads(archive.read('MANIFEST.json'))
        actual=archive.read(TRANSPORT)
    if actual!=expected or manifest['files'][TRANSPORT]!=sha256(expected).hexdigest():
        raise ValueError('Wiring rehearsal requires the exact network-free invented transport')
