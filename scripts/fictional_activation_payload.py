"""Emit fixed fictional input for the rollback-only database activation bridge.

No arguments, source fetch, database connection or publication authority. The
default public URL equals the retrieval URL for the legacy-reader case. The
separate fixed adapter also exercises the authorized distinct-target binding.
"""

from dataclasses import replace
import json

from scripts.update_rehearsal import fictional_request
from workers.automatic_publication_gate import propose_machine_disposition
from workers.fictional_publication_draft import build_fictional_publication_draft
from workers.offline_update_run import rehearse_update_run
from workers.update_request_identity import identify_update_request


def fictional_activation_payload(*, distinct_public_target: bool = False, scenario: str = "standard") -> dict[str, object]:
    if scenario not in {"standard", "revised_value"}:
        raise ValueError("Fixed activation payload supports only the two checked observations")
    request = fictional_request("manual", scenario=scenario)
    items = tuple(replace(
        item,
        source=replace(item.source, url=(item.source.url if distinct_public_target else item.source.retrieval_url)),
        structured_candidate=(replace(item.structured_candidate, qualification=replace(
            item.structured_candidate.qualification,
            public_citation_url=(item.source.url if distinct_public_target else item.source.retrieval_url),
        )) if item.structured_candidate is not None else None),
    ) for item in request.items)
    request = replace(request, items=items)
    report = rehearse_update_run(request)
    draft = build_fictional_publication_draft(report)
    candidate = replace(request.items[0].structured_candidate, mode="publish_eligible")
    decision = propose_machine_disposition(candidate)
    if draft is None or decision.disposition != "eligible_for_activation_check":
        raise ValueError("Fixed fictional activation input did not pass its checks")
    return {
        "fixtureKind": "rollback_only_machine_activation",
        "draft": draft,
        "requestFingerprint": identify_update_request(replace(
            request.invocation, mode="publish_eligible",
        )).request_fingerprint,
        "runId": request.run_id,
        "requestKey": request.invocation.request_key,
        "sourceKey": request.items[0].source.source_key,
        "retrievalUrl": candidate.evidence.source_url,
        "parserVersion": candidate.parser_version,
        "qualificationExpiresAt": candidate.qualification.qualification_expires_at.isoformat(),
        "decidedAt": decision.evaluated_at.isoformat(),
        "checkTrace": dict(decision.check_trace),
        "reasonCodes": list(decision.reason_codes),
    }


if __name__ == "__main__":
    print(json.dumps(fictional_activation_payload(), sort_keys=True))
