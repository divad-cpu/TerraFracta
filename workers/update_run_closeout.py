"""Consume an exact processing closeout against separate trusted expectations.

No connection or authentication is performed. Version one processing receipts
cannot claim website visibility; the later read verification has its own
evidence. Replay acknowledges the original finished time and work claim.
"""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
from re import fullmatch, sub

from workers.update_run_completion import CompletionSummary, RunManifest, canonical_run_manifest, _uuid


MAX_CLOSEOUT_BYTES = 16384
FIELDS = frozenset({"schemaVersion", "status", "runId", "requestFingerprint", "workClaimId",
                    "manifestSha256", "finishedAt", "summary"})


@dataclass(frozen=True)
class RunCloseout:
    status: str
    run_id: str
    work_claim_id: str
    finished_at: datetime
    summary: CompletionSummary


def completion_summary_payload(summary: CompletionSummary) -> dict:
    if not isinstance(summary, CompletionSummary):
        raise ValueError("Completion expectation is invalid")
    payload = {sub(r"_([a-z])", lambda match: match[1].upper(), key): value
               for key, value in asdict(summary).items()}
    return json.loads(json.dumps(payload))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Closeout receipt is invalid")
        result[key] = value
    return result


def parse_run_closeout(data: bytes, manifest: RunManifest, work_claim_id: str,
                      expected: CompletionSummary, *, started_at: datetime, now: datetime) -> RunCloseout:
    """Reject altered counters, identities, private fields and visibility claims."""

    from hashlib import sha256

    canonical = canonical_run_manifest(manifest)
    expected_sha = sha256(canonical.encode("ascii")).hexdigest()
    if not _uuid(work_claim_id) or not isinstance(expected, CompletionSummary) or \
       expected.manifest_sha256 != expected_sha or expected.visibility_state not in {"not_required", "pending"} or \
       not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() != timezone.utc.utcoffset(now) or \
       not isinstance(started_at, datetime) or started_at.tzinfo is None or \
       started_at.utcoffset() != timezone.utc.utcoffset(started_at) or started_at > now or \
       type(data) is not bytes or not 2 <= len(data) <= MAX_CLOSEOUT_BYTES:
        raise ValueError("Closeout receipt is invalid")
    expected_payload = completion_summary_payload(expected)
    try:
        payload = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object)
        if type(payload) is not dict or frozenset(payload) != FIELDS or \
           type(payload["schemaVersion"]) is not int or payload["schemaVersion"] != 1 or \
           type(payload["status"]) is not str or payload["status"] not in {"closed", "existing_closeout"} or \
           payload["runId"] != manifest.run_id or payload["requestFingerprint"] != manifest.request_fingerprint or \
           payload["workClaimId"] != work_claim_id or payload["manifestSha256"] != expected_sha or \
           type(payload["finishedAt"]) is not str or not fullmatch(
               r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)", payload["finishedAt"]) or \
           type(payload["summary"]) is not dict:
            raise ValueError
        # JSON bool compares equal to Python integer 1. Compare the normalized
        # encoding too so booleans/floats cannot masquerade as exact counters.
        if json.dumps(payload["summary"], sort_keys=True, separators=(",", ":"), allow_nan=False) != \
           json.dumps(expected_payload, sort_keys=True, separators=(",", ":"), allow_nan=False):
            raise ValueError
        finished = datetime.fromisoformat(payload["finishedAt"])
        if finished.tzinfo is None or finished.utcoffset() != timezone.utc.utcoffset(finished) or not started_at <= finished <= now:
            raise ValueError
        return RunCloseout(payload["status"], manifest.run_id, work_claim_id, finished, expected)
    except (ValueError, TypeError, UnicodeError, RecursionError) as exc:
        raise ValueError("Closeout receipt is invalid") from exc
