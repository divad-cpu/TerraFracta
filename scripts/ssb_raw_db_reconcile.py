"""Read-only audit of the local SSB raw-pair folder against private DB references.

Run only with TerraFracta's loopback Supabase development database. This uses the
local database owner for an audit and is not a collector, reviewer credential,
or production application connection. It never fetches a source or edits files.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
import subprocess
import sys

from workers.ssb_14059_recovery import (
    ExpectedRawPair,
    SSB14059RecoveryError,
    reconcile_private_ssb_14059_pairs,
)
from workers.ssb_14059_raw_store import SOURCE_ID, SSB14059RawStoreError

_CONTAINER = "supabase_db_terrafracta-local"
_MAX_ROWS = 1000
_MAX_OUTPUT = 256 * 1024
_QUERY = """select coalesce(jsonb_agg(jsonb_build_object(
  'source_key', source_key,
  'attempt_id', raw_attempt_id,
  'metadata_sha256', metadata_sha256,
  'data_sha256', data_sha256,
  'metadata_retrieved_at', metadata_retrieved_at,
  'data_retrieved_at', data_retrieved_at,
  'stored_at', stored_at,
  'expires_at', expires_at) order by raw_attempt_id), '[]'::jsonb)
from (select registration.source_key, artifact.raw_attempt_id,
             artifact.metadata_sha256, artifact.data_sha256,
             artifact.metadata_retrieved_at, artifact.data_retrieved_at,
             artifact.stored_at, artifact.expires_at
      from terra_private.source_raw_pair_artifacts artifact
      join terra_private.source_response_pairs pair on pair.id = artifact.pair_id
      join terra_private.source_registrations registration
        on registration.id = pair.registration_id
      where registration.source_key = 'SSB-14059-NO-HOUSING-COSTS'
      order by artifact.raw_attempt_id limit 1001) pairs;
"""


class RawDbAuditError(ValueError):
    """The local development audit cannot return a trustworthy comparison."""


def parse_artifact_rows(output: str) -> tuple[ExpectedRawPair, ...]:
    if not isinstance(output, str) or len(output.encode("utf-8")) > _MAX_OUTPUT:
        raise RawDbAuditError("Local artifact query exceeded its output bound")
    try:
        parsed = json.loads(output)
    except (json.JSONDecodeError, TypeError) as exc:
        raise RawDbAuditError("Local artifact query did not return JSON") from exc
    if not isinstance(parsed, list) or len(parsed) > _MAX_ROWS:
        raise RawDbAuditError("Local artifact query exceeded its row bound")
    rows = []
    for item in parsed:
        if not isinstance(item, dict) or set(item) != {
            "source_key", "attempt_id", "metadata_sha256", "data_sha256", "expires_at",
            "metadata_retrieved_at", "data_retrieved_at", "stored_at",
        } or any(not isinstance(item[key], str) for key in item) or item["source_key"] != SOURCE_ID:
            raise RawDbAuditError("Unexpected local artifact row shape")
        times = {}
        for field in (
            "metadata_retrieved_at", "data_retrieved_at", "stored_at", "expires_at"
        ):
            try:
                value = datetime.fromisoformat(item[field])
            except ValueError as exc:
                raise RawDbAuditError(f"Invalid local artifact {field}") from exc
            if value.utcoffset() != timezone.utc.utcoffset(None):
                raise RawDbAuditError(f"Local artifact {field} is not UTC")
            times[field] = value.astimezone(timezone.utc)
        rows.append(ExpectedRawPair(
            attempt_id=item["attempt_id"],
            metadata_sha256=item["metadata_sha256"],
            data_sha256=item["data_sha256"],
            expires_at=times["expires_at"],
            metadata_retrieved_at=times["metadata_retrieved_at"],
            data_retrieved_at=times["data_retrieved_at"],
            stored_at=times["stored_at"],
        ))
    return tuple(rows)


def read_local_artifact_rows() -> tuple[ExpectedRawPair, ...]:
    try:
        result = subprocess.run(
            ["docker", "exec", "-i", _CONTAINER, "psql", "-U", "postgres",
             "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
            input=_QUERY, text=True, capture_output=True, timeout=10, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RawDbAuditError("Local database query unavailable") from exc
    if result.returncode != 0:
        raise RawDbAuditError("Local database query failed; start the loopback DB first")
    return parse_artifact_rows(result.stdout.strip())


def main() -> int:
    try:
        first_rows = read_local_artifact_rows()
        findings = reconcile_private_ssb_14059_pairs(first_rows)
        counts = Counter(item.state for item in findings)
        attention = sum(
            count for state, count in counts.items()
            if state not in {"matched", "expired_local_absent"}
        )
        recheck = None
        recheck_rows = None
        if attention:
            # Database and filesystem cannot be read atomically together.
            # Recheck the references as well as the finding labels: a changed
            # hash can leave a missing-local finding unchanged. Equal
            # sequential reads are still not one atomic cross-store snapshot.
            recheck_rows = read_local_artifact_rows()
            recheck = reconcile_private_ssb_14059_pairs(recheck_rows)
    except (RawDbAuditError, SSB14059RecoveryError, SSB14059RawStoreError) as exc:
        print(json.dumps({"result": "BLOCKED", "reason": str(exc)}))
        return 2
    except OSError:
        print(json.dumps({"result": "BLOCKED", "reason": "Private raw storage unavailable"}))
        return 2
    changed = recheck is not None and (
        recheck_rows != first_rows or recheck != findings
    )
    result = "PASS" if not attention else (
        "CHANGED_DURING_AUDIT" if changed else "ATTENTION"
    )
    report = {"result": result, "total": len(findings),
              "states": dict(sorted(counts.items()))}
    if changed:
        report["recheck_states"] = dict(sorted(Counter(
            item.state for item in recheck
        ).items()))
    print(json.dumps(report, sort_keys=True))
    return 0 if attention == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
