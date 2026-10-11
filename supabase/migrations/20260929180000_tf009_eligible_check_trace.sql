-- An eligible machine decision must carry the exact bounded v1 check trace.
-- A later constrained writer still has to derive every value from trusted data.
begin;

alter table terra_private.machine_candidate_decisions
  add constraint machine_decision_trace_size
    check (octet_length(check_trace::text) <= 4096),
  add constraint machine_decision_reason_shape
    check (array_position(reason_codes, null) is null
           and octet_length(array_to_string(reason_codes, ',')) <= 3000);

alter table terra_private.machine_candidate_decisions
  add constraint eligible_machine_decision_v1_trace
    check (disposition <> 'eligible' or (
      check_trace = '{
        "source_version_current": true,
        "evidence_locator_verified": true,
        "identity_resolved": true,
        "fields_dates_units_verified": true,
        "semantics_qualified": true,
        "no_material_conflict": true,
        "public_snapshot_consistent": true,
        "expected_predecessor_current": true,
        "no_sensitive_data": true
      }'::jsonb
      and reason_codes = array['qualified_checks_passed']::text[]
    ));
commit;
