"""Fixed invented response child sharing the real bounded transport protocol.

No HTTP or database client is invoked. Fixture selection is fixed by kind; the
startup packet can supply only the parent's kind and remaining shared deadline.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from time import monotonic

from workers.ssb_14059_capture import CapturedResponse, METADATA_URL, DATA_URL
from workers.ssb_14059_pair_transport import _serve_child

ROOT = Path(__file__).resolve().parents[1]
FILES = {'metadata': 'ssb_14059_metadata_minimal_2024_2025.json',
         'data': 'ssb_14059_jsonstat_minimal_2024_2025.json'}


def fixed_fixture(kind, *, deadline):
    if kind not in FILES or monotonic() >= deadline:
        raise ValueError('Fixed fictional response deadline ended')
    body = json.dumps(json.loads((ROOT / 'fixtures' / FILES[kind]).read_text()), separators=(',', ':')).encode()
    endpoint = METADATA_URL if kind == 'metadata' else DATA_URL
    return CapturedResponse(endpoint, endpoint, 0, 200, 'application/json', body, datetime.now(timezone.utc))


if __name__ == '__main__':
    raise SystemExit(_serve_child(sys.argv[1:], fixed_fixture))
