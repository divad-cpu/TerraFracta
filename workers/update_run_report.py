"""Bounded non-secret display export for the fictional shared operation."""

from __future__ import annotations

from datetime import datetime

from workers.offline_update_run import OfflineRunReport
from workers.fictional_publication_draft import build_fictional_publication_draft


def _instant(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value is not None else None


def fictional_display_report(report: OfflineRunReport) -> dict[str, object]:
    if report.mode != "shadow" or report.public_changes != 0:
        raise ValueError("Only a fictional shadow operation can use this exporter")
    items = []
    for item in report.items:
        # An invalid reference is withheld entirely. In particular its URL,
        # locator, title and publisher must not reach a reader/error message.
        source = None if "source_reference_invalid" in item.reason_codes else {
            "sourceVersionId": item.source.source_version_id,
            "publisher": item.source.publisher,
            "title": item.source.title,
            "url": item.source.url,
            "locator": item.source.locator,
            "contentSha256": item.source.content_sha256,
            "sourceKey": item.source.source_key,
        }
        items.append({
            "itemKey": item.item_key, "outcome": item.outcome,
            "reasonCodes": item.reason_codes,
            "sourceKey": item.source.source_key,
            "sourceBindingValid": item.source_binding_valid,
            "source": source, "publicUrl": None,
        })
    return {
        "schemaVersion": 3, "reportKind": "fictional_rehearsal",
        "runId": report.run_id, "requestKey": report.request_key,
        "requestFingerprint": report.request_fingerprint,
        "trigger": report.trigger, "scheduledDueAt": _instant(report.scheduled_due_at),
        "scope": report.scope, "dueSourceKeys": report.due_source_keys,
        "coveredSourceKeys": report.covered_source_keys,
        "mode": report.mode, "state": report.state,
        "startedAt": _instant(report.started_at), "finishedAt": _instant(report.finished_at),
        "publicChanges": report.public_changes, "items": items,
        "fictionalCandidate": build_fictional_publication_draft(report),
    }
