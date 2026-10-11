"""Parse a bounded admission response from a future trusted database driver.

This pure consumer neither opens a connection nor authenticates a response.
An admission is not a lease, a completed update, or permission to publish.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from uuid import UUID, RFC_4122

from workers.update_request_identity import UpdateRequest, identify_update_request


MAX_ADMISSION_BYTES = 4096
FIELDS = frozenset({"schemaVersion","status","runId","requestKey","requestFingerprint",
                    "runState","commitState","visibilityState"})


@dataclass(frozen=True)
class RunAdmission:
    status: str
    run_id: UUID
    request_key: str
    request_fingerprint: str
    run_state: str
    commit_state: str
    visibility_state: str


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result = {}
    for key,value in pairs:
        if key in result:
            raise ValueError("Admission receipt is invalid")
        result[key]=value
    return result


def parse_run_admission(data: bytes, request: UpdateRequest) -> RunAdmission:
    """Bind the exact response to independently validated request identity."""

    identity=identify_update_request(request)
    if type(data) is not bytes or not 2 <= len(data) <= MAX_ADMISSION_BYTES:
        raise ValueError("Admission receipt is invalid")
    try:
        payload=json.loads(data.decode("utf-8"),object_pairs_hook=_unique_object)
        if not isinstance(payload,dict) or frozenset(payload) != FIELDS:
            raise ValueError
        if type(payload["schemaVersion"]) is not int or payload["schemaVersion"] != 1:
            raise ValueError
        if any(type(payload[field]) is not str for field in FIELDS-{"schemaVersion"}):
            raise ValueError
        run_id=UUID(payload["runId"])
        if str(run_id) != payload["runId"] or run_id.version != 4 or run_id.variant != RFC_4122:
            raise ValueError
        if payload["requestKey"] != identity.request_key or \
           payload["requestFingerprint"] != identity.request_fingerprint:
            raise ValueError
        if payload["status"] not in {"admitted","existing"} or \
           payload["runState"] not in {"queued","running","completed","partial","failed","rejected"} or \
           payload["commitState"] not in {"none","committed","partial"} or \
           payload["visibilityState"] not in {"not_required","pending","verified","failed","mixed"}:
            raise ValueError
        if payload["status"] == "admitted" and (
            payload["runState"],payload["commitState"],payload["visibilityState"]
        ) != ("queued","none","not_required"):
            raise ValueError
        if payload["commitState"] == "none":
            if payload["visibilityState"] != "not_required":
                raise ValueError
        elif request.mode != "publish_eligible" or \
             payload["visibilityState"] == "not_required" or \
             payload["runState"] in {"queued","rejected"}:
            raise ValueError
        return RunAdmission(payload["status"],run_id,payload["requestKey"],
            payload["requestFingerprint"],payload["runState"],payload["commitState"],
            payload["visibilityState"])
    except (ValueError,TypeError,UnicodeError,RecursionError) as exc:
        raise ValueError("Admission receipt is invalid") from exc
