"""Fixed invented captured-work plan for owner-only rollback casebooks."""

from dataclasses import replace
from pathlib import Path

from scripts.fictional_activation_payload import fictional_activation_payload
from scripts.fictional_run_admission_cases import fictional_request
from scripts.fictional_staged_machine_publication import staged_machine_publication_sql
from workers.update_request_identity import identify_update_request
from workers.update_run_completion import PlannedItem, PlannedSource, RunManifest, canonical_run_manifest


def fictional_completion_manifest(*, duration: int = 300) -> RunManifest:
    payload = fictional_activation_payload(distinct_public_target=True)
    request = replace(fictional_request(), request_key=payload["requestKey"],
        scope="fictional-activation-country", mode="publish_eligible",
        limits=replace(fictional_request().limits, max_duration_seconds=duration))
    return RunManifest(payload["runId"], identify_update_request(request).request_fingerprint,
        "publish_eligible", (PlannedSource(payload["sourceKey"],
            "33333333-3333-4333-8333-333333333333", payload["draft"]["decision"]["sourceVersionId"],
            payload["draft"]["decision"]["contentSha256"]),),
        (PlannedItem(payload["draft"]["itemKey"], payload["sourceKey"],
                     payload["draft"]["decision"]["sourceVersionId"]),))


def completion_manifest_insert_sql(manifest: RunManifest) -> str:
    canonical = canonical_run_manifest(manifest)
    return """insert into terra_private.update_run_manifests(run_id,canonical_manifest,manifest_sha256,work_claim_id)
      select (payload->>'runId')::uuid,%MANIFEST%,encode(sha256(convert_to(%MANIFEST%,'UTF8')),'hex'),
        (response->>'leaseId')::uuid from activation_input,owned_work_claim;
    """.replace("%MANIFEST%", "'" + canonical.replace("'", "''") + "'")


def completion_source_check_insert_sql(manifest: RunManifest, *, outcome: str | None = None) -> str:
    source = manifest.sources[0]
    assert len(manifest.sources) == 1
    raw_bytes = len((Path(__file__).resolve().parents[1] / "fixtures/fictional_structured_source.json").read_bytes())
    version = "null" if source.source_version_id is None else "'" + source.source_version_id + "'::uuid"
    digest = "null" if source.content_sha256 is None else "'" + source.content_sha256 + "'"
    outcome = outcome or ("failed" if source.source_version_id is None else "captured")
    if outcome not in {"captured", "unchanged", "failed", "deferred"}:
        raise ValueError("Only fixed source-check outcomes are supported")
    return """insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,
      source_version_id,content_sha256,outcome,total_response_bytes,work_claim_id)
      select (payload->>'runId')::uuid,'33333333-3333-4333-8333-333333333333',payload->>'sourceKey',
        %VERSION%,%HASH%,'%OUTCOME%',%BYTES%,(response->>'leaseId')::uuid
        from activation_input,owned_work_claim;
    """.replace("%VERSION%", version).replace("%HASH%", digest).replace("%OUTCOME%", outcome).replace(
        "%BYTES%", str(0 if source.source_version_id is None else raw_bytes))


def staged_completion_sql(*, manifest: RunManifest | None = None, disposition: str | None = "eligible",
                          duration: int = 300, historical_version: bool = False,
                          source_check_outcome: str | None = None, include_source_check: bool = True) -> str:
    if disposition not in {"eligible", "held", "rejected", "unchanged", None}:
        raise ValueError("Only fixed completion fixture dispositions are supported")
    plan = manifest or fictional_completion_manifest(duration=duration)
    sql = staged_machine_publication_sql(duration=duration)
    marker = "insert into terra_private.machine_candidate_decisions"
    assert sql.count(marker) == 1
    offset = sql.index(marker)
    insertion = (completion_source_check_insert_sql(plan, outcome=source_check_outcome or (
        "unchanged" if historical_version else None)) if include_source_check else "") + completion_manifest_insert_sql(plan)
    if historical_version:
        marker = "'2026-09-28T06:00:00Z'::timestamptz"
        assert sql.count(marker) == 2
        sql = sql.replace(marker, "'2026-09-28T06:00:30Z'::timestamptz")
        offset = sql.index("insert into terra_private.machine_candidate_decisions")
    if disposition is None:
        # No decisions or publication staging: the missing planned item is
        # deliberate and remains independently visible in the stored plan.
        return sql[:offset] + insertion
    sql = sql[:offset] + insertion + sql[offset:]
    if disposition != "eligible":
        assert sql.count("payload #>> '{draft,itemKey}', 'eligible',") == 1
        sql = sql.replace("payload #>> '{draft,itemKey}', 'eligible',",
                          "payload #>> '{draft,itemKey}', '" + disposition + "',")
    return sql


CLOSE_SQL = """select terra_private.close_update_run_processing(
 (payload->>'runId')::uuid,payload->>'requestFingerprint',(response->>'leaseId')::uuid,
 (select manifest_sha256 from terra_private.update_run_manifests where run_id=(payload->>'runId')::uuid))
 from activation_input,owned_work_claim;
"""
