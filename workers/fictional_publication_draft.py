"""Build one fictional page draft from the shared parser and shadow decision.

The fixed wording and identifiers apply only to the fictional fixture. This is
not a general statistical writer, an accepted snapshot or an activation plan.
"""

from __future__ import annotations

from decimal import Decimal
from re import fullmatch
from uuid import UUID, uuid5

from workers.offline_update_run import OfflineRunReport
from workers.public_source_url import public_https_source_url


NAMESPACE = UUID("886f8065-5f0d-4d7a-9b1b-30e782c48f96")


def build_fictional_publication_draft(report: OfflineRunReport) -> dict[str, object] | None:
    if report.mode != "shadow" or report.public_changes != 0:
        raise ValueError("Fictional page drafts require an unpublished shadow report")
    for item in report.items:
        decision = item.decision
        observation = item.observation
        if item.outcome != "shadow_only" or not item.source_binding_valid:
            continue
        if decision is None or observation is None:
            continue
        # Exact receipt, locator and mapping agreement; never turn a held item
        # into a page just because the number happens to fit the template.
        if (
            decision.disposition != "shadow_only"
            or decision.reason_codes != ("shadow_mode",)
            or len(decision.check_trace) != 9
            or any(passed is not True for _, passed in decision.check_trace)
            or decision.policy_id != "fictional-policy-v1"
            or decision.qualification_id != "fictional-qualification-v1"
            or item.source.source_key != "fictional-source"
            or decision.source_version_id != observation.source_version_id
            or observation.source_version_id != item.source.source_version_id
            or decision.content_sha256 != observation.content_sha256
            or observation.content_sha256 != item.source.content_sha256
            or decision.evidence_locator != observation.locator
            or observation.locator != item.source.locator
            or decision.semantic_contract_sha256 != observation.semantic_contract_sha256
            or decision.public_citation_url != item.source.url
            or not public_https_source_url(item.source.url)
            or item.source.url not in {
                "https://example.org/fictional-table",
                "https://example.org/fictional-table/data?format=json",
            }
            or observation.series_id != "fictional-share"
            or observation.geography != "fictional-country"
            or observation.unit != "percent"
            or not isinstance(observation.period, str)
            or not fullmatch(r"20[0-9]{2}", observation.period)
            or not isinstance(observation.value, Decimal)
            or not observation.value.is_finite()
            or not Decimal(0) <= observation.value <= Decimal(100)
            or observation.value.as_tuple().exponent < -1
        ):
            raise ValueError("Fictional draft differs from its checked observation")
        value = format(observation.value, "f")
        claim_id = str(uuid5(NAMESPACE, f"fictional-source:fictional-share:{observation.period}"))
        issue_id = str(uuid5(NAMESPACE, "fictional-country:fictional-share"))
        publication_id = str(uuid5(NAMESPACE, f"{issue_id}:{decision.content_sha256}:{observation.period}"))
        return {
            "schemaVersion": 1, "candidateKind": "fictional_structured_draft",
            "itemKey": item.item_key,
            "observation": {
                "seriesId": observation.series_id, "geography": observation.geography,
                "period": observation.period, "unit": "percent", "value": value,
                "semanticContractSha256": observation.semantic_contract_sha256,
            },
            "decision": {
                "disposition": "shadow_only", "policyId": decision.policy_id,
                "qualificationId": decision.qualification_id,
                "sourceVersionId": decision.source_version_id,
                "contentSha256": decision.content_sha256,
                "semanticContractSha256": decision.semantic_contract_sha256,
                "publicCitationUrl": decision.public_citation_url,
                "locator": decision.evidence_locator,
            },
            "publication": {
                "id": publication_id, "issueId": issue_id, "revision": 1,
                "kind": "draft", "previousPublicationId": None,
                "snapshot": {
                    "schemaVersion": 1, "jurisdictionSlug": "fictional-country",
                    "issueSlug": "fictional-share", "title": "Fictional share observation",
                    "summary": "A page draft calculated from invented source bytes. No fact about a real country is stated.",
                    "lastEvidenceReviewOn": decision.evaluated_at.date().isoformat(),
                    "claims": [{
                        "id": claim_id, "type": "condition",
                        "assertion": f"In {observation.period}, the fictional share was {value}%.",
                        "periodLabel": observation.period,
                        "evidence": [{
                            "sourceVersionId": decision.source_version_id,
                            "publisher": item.source.publisher, "title": item.source.title,
                            "url": item.source.url, "locator": item.source.locator,
                            "relation": "supports", "sourcePublishedOn": None,
                            "retrievedAt": decision.source_retrieved_at.isoformat().replace("+00:00", "Z"),
                        }],
                    }],
                },
                "dependencyManifest": {"sourceVersionIds": [decision.source_version_id]},
            },
        }
    return None
