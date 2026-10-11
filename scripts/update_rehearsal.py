"""Print a fictional, network-free shared-update rehearsal report."""

from __future__ import annotations

import argparse
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

from workers.automatic_publication_gate import (
    CandidateChecks, EvidenceReceipt, MachineDecisionInput, RouteQualification,
)
from workers.change_work_router import CapturedWorkItem, RoutingLimits
from workers.offline_update_run import (
    OfflineRunRequest, OfflineSourceRef, OfflineUpdateItem, rehearse_update_run,
)
from workers.structured_observation import (
    StructuredMapping, StructuredReceipt, extract_structured_observation,
    semantic_contract_fingerprint,
)
from workers.update_request_identity import RunLimits, UpdateRequest, scheduled_request_key
from workers.missing_run_monitor import oslo_weekly_due_at_utc
from workers.update_run_report import fictional_display_report
from workers.response_byte_budget import ResponseByteBudget
from workers.structured_observation import MAX_SOURCE_BYTES
from workers.error_diagnostics import diagnostic_worker


FICTIONAL_RUN_LIMITS = RunLimits(
    max_items=4, max_response_bytes=100_000,
    max_model_calls=0, max_model_input_tokens=0,
    max_model_output_tokens=0, max_retries=0,
    max_duration_seconds=60,
    run_cap_usd=Decimal(0), month_cap_usd=Decimal(0),
)


def fictional_request(trigger: str, *, mode: str = "shadow", scenario: str = "standard") -> OfflineRunRequest:
    if mode not in {"shadow", "publish_eligible"}:
        raise ValueError("Fictional rehearsal mode is invalid")
    if scenario not in {"standard", "missing_source", "invalid_citation", "revised_value"}:
        raise ValueError("Fictional rehearsal scenario is invalid")
    revised = scenario == "revised_value"
    fixture = "fictional_revised_structured_source.json" if revised else "fictional_structured_source.json"
    # Exercise the same pre-read reservation boundary on a fixed local file.
    # This neither opens a URL nor connects a real source to the operation.
    response_budget = ResponseByteBudget(FICTIONAL_RUN_LIMITS.max_response_bytes)
    with (Path(__file__).resolve().parents[1] / "fixtures" / fixture).open('rb') as source:
        raw = response_budget.read_body(source,max_body_bytes=MAX_SOURCE_BYTES)
    source_hash = sha256(raw).hexdigest()
    fetched_at = oslo_weekly_due_at_utc(2026, 40)
    if revised:
        fetched_at += timedelta(minutes=2)
    proposed_mapping = StructuredMapping(
        status="qualified", source_url="https://example.org/fictional-table/data?format=json",
        series_id="fictional-share", geography="fictional-country", unit="percent",
        valid_from=datetime(2026, 1, 1, tzinfo=timezone.utc),
        valid_until=datetime(2027, 1, 1, tzinfo=timezone.utc),
        minimum=Decimal(0), maximum=Decimal(100), decimal_places=1,
        accepted_contract_sha256="",
    )
    mapping = replace(
        proposed_mapping,
        accepted_contract_sha256=semantic_contract_fingerprint(proposed_mapping),
    )
    parsed_receipt = StructuredReceipt(
        source_version_id=("55555555-5555-4555-8555-555555555555" if revised
                           else "22222222-2222-4222-8222-222222222222"),
        source_url=mapping.source_url, content_sha256=source_hash,
        retrieved_at=fetched_at,
    )
    observations = {
        period: extract_structured_observation(
            raw, parsed_receipt, mapping, period=period
        ) for period in ("2023", "2024", "2025")
    }
    captured = CapturedWorkItem(
        item_key="fictional-period-2025",
        source_status="approved",
        fetch_enabled=True,
        current_sha256=source_hash,
        previous_sha256="b" * 64,
        extraction_route="structured",
        model_processing_allowed=False,
        estimated_model_input_tokens=0,
    )
    receipt = EvidenceReceipt(
        source_id="fictional-source",
        source_version_id=parsed_receipt.source_version_id,
        source_url=parsed_receipt.source_url,
        content_sha256=captured.current_sha256,
        locator=observations["2025"].locator,
        retrieved_at=fetched_at,
    )
    candidate = MachineDecisionInput(
        candidate_id=captured.item_key, mode=mode, policy_id="fictional-policy-v1",
        policy_status="active", source_status="approved", source_fetch_enabled=True,
        candidate_source_id=receipt.source_id, change_class="structured_observation",
        parser_version="fictional-parser-v1",
        semantic_contract_sha256=observations["2025"].semantic_contract_sha256,
        evidence=receipt,
        qualification=RouteQualification(
            qualification_id="fictional-qualification-v1",
            policy_id="fictional-policy-v1", source_id=receipt.source_id,
            source_url=receipt.source_url,
            public_citation_url="https://example.org/fictional-table",
            change_class="structured_observation",
            parser_version="fictional-parser-v1", status="active", public_use_allowed=True,
            qualification_expires_at=datetime(2027, 1, 1, tzinfo=timezone.utc),
            reviewed_sample_count=3, unresolved_sample_errors=0,
            semantic_contract_sha256=mapping.accepted_contract_sha256,
        ),
        checks=CandidateChecks(
            source_version_current=True,
            evidence_locator_verified=observations["2025"].source_version_id == receipt.source_version_id,
            identity_resolved=True,
            fields_dates_units_verified=observations["2025"].unit == mapping.unit,
            semantics_qualified=mapping.status == "qualified",
            no_material_conflict=True,
            public_snapshot_consistent=True,
            expected_predecessor_current=True,
            no_sensitive_data=True,
        ),
        evaluated_at=fetched_at + timedelta(minutes=1),
    )
    unchanged = replace(
        captured, item_key="fictional-unchanged", previous_sha256=source_hash,
    )
    held = replace(
        captured, item_key="fictional-period-2024",
        previous_sha256="d" * 64,
    )
    held_receipt = replace(
        receipt, locator=observations["2024"].locator,
    )
    held_candidate = replace(
        candidate, candidate_id=held.item_key, evidence=held_receipt,
        checks=replace(
            candidate.checks,
            evidence_locator_verified=(
                observations["2024"].source_version_id == held_receipt.source_version_id
            ),
            no_material_conflict=False,
        ),
    )
    changed_contract = replace(
        captured, item_key="fictional-contract-change", previous_sha256="e" * 64,
    )
    changed_contract_receipt = replace(
        receipt, locator=observations["2023"].locator,
    )
    changed_contract_candidate = replace(
        candidate, candidate_id=changed_contract.item_key,
        evidence=changed_contract_receipt,
        semantic_contract_sha256="d" * 64,
    )
    request = OfflineRunRequest(
        invocation=UpdateRequest(
            request_key=(scheduled_request_key(
                "fictional-country", oslo_weekly_due_at_utc(2026, 40)
            ) if trigger == "scheduled" else "fictional:manual:2026w40"),
            trigger=trigger,
            scheduled_due_at=(oslo_weekly_due_at_utc(2026, 40)
                              if trigger == "scheduled" else None),
            actor_id="runner:fictional", scope="fictional-country",
            mode=mode, strategy="incremental",
            code_version="local-rehearsal-v1", policy_version="fictional-policy-v1",
            limits=FICTIONAL_RUN_LIMITS,
        ),
        run_id="11111111-1111-4111-8111-111111111111",
        started_at=fetched_at,
        finished_at=fetched_at + timedelta(minutes=1),
        items=(
            OfflineUpdateItem(captured, OfflineSourceRef(
                receipt.source_version_id, "Fictional statistics office",
                "Fictional housing table", "https://example.org/fictional-table",
                receipt.source_url,
                receipt.locator, receipt.content_sha256, "fictional-source",
            ), candidate, observations["2025"]),
            OfflineUpdateItem(held, OfflineSourceRef(
                held_receipt.source_version_id, "Fictional statistics office",
                "Fictional housing table", "https://example.org/fictional-table",
                held_receipt.source_url,
                held_receipt.locator, held_receipt.content_sha256, "fictional-source",
            ), held_candidate, observations["2024"]),
            OfflineUpdateItem(unchanged, OfflineSourceRef(
                receipt.source_version_id,
                "Fictional statistics office",
                "Fictional housing table", "https://example.org/fictional-table",
                receipt.source_url,
                observations["2023"].locator, unchanged.current_sha256,
                "fictional-source",
            ), None),
            OfflineUpdateItem(changed_contract, OfflineSourceRef(
                changed_contract_receipt.source_version_id,
                "Fictional statistics office",
                "Fictional housing table", "https://example.org/fictional-table",
                changed_contract_receipt.source_url,
                changed_contract_receipt.locator,
                changed_contract_receipt.content_sha256, "fictional-source",
            ), changed_contract_candidate, observations["2023"]),
        ),
        due_source_keys=("fictional-source",),
        routing_limits=RoutingLimits(max_items=4, max_model_items=0, max_model_input_tokens=0),
    )
    if scenario == "missing_source":
        return replace(request, items=())
    if scenario == "invalid_citation":
        invalid = replace(request.items[0], source=replace(
            request.items[0].source, url="http://127.0.0.1/withheld-test-canary",
        ))
        return replace(request, items=(invalid, *request.items[1:]))
    return request


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trigger", choices=("manual", "scheduled"), required=True)
    parser.add_argument("--scenario", choices=("standard", "missing_source", "invalid_citation", "revised_value"), default="standard")
    args = parser.parse_args()
    report = rehearse_update_run(fictional_request(args.trigger, scenario=args.scenario))
    print(json.dumps(fictional_display_report(report), sort_keys=True))
    return 0


if __name__ == "__main__":
    with diagnostic_worker('update_worker'):
        raise SystemExit(main())
