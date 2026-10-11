-- Constructed held-decision history in a fresh owned trial only.
-- Replica bypass is fixture preparation, not a qualified writer/decision proof.
begin;set local session_replication_role=replica;
insert into terra_private.source_registrations(id,source_key,publisher,exact_endpoint) values
 ('63000000-0000-4000-8000-000000000001','held-fixture-source','PRIVATE_HELD_PUBLISHER_CANARY','https://example.org/held-fixture');
insert into terra_private.source_versions(id,registration_id,item_key,source_url,retrieved_at,content_sha256) values
 ('64000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','PRIVATE_HELD_ITEM_CANARY',
  'https://example.org/held-fixture','2026-09-28T06:02:00.000001Z',repeat('9',64));
insert into terra_private.automatic_route_qualifications(id,registration_id,change_class,revision,decision,
 exact_endpoint,policy_version,parser_version,decision_reference,decided_by,decided_at) values
 ('65000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','structured_observation',1,'qualified',
 'https://example.org/held-fixture','PRIVATE_HELD_POLICY_CANARY','PRIVATE_HELD_PARSER_CANARY','PRIVATE_HELD_REVIEW_CANARY',
 'PRIVATE_HELD_QUALIFIER_CANARY','2026-09-27T06:00:00Z');
insert into terra_private.machine_candidate_decisions(id,run_id,qualification_id,source_version_id,candidate_key,disposition,
 content_sha256,evidence_locator,check_trace,reason_codes,machine_actor,decided_at)
select ('66000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,'41000000-0000-4000-8000-000000000001',
 '65000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','PRIVATE_HELD_CANDIDATE_CANARY-'||n,'held',
 repeat('9',64),'PRIVATE_HELD_LOCATOR_CANARY',
 '{"source_version_current":true,"evidence_locator_verified":false,"no_material_conflict":false,"no_sensitive_data":true,"PRIVATE_UNKNOWN_CHECK_CANARY":"PRIVATE_UNKNOWN_VALUE_CANARY","unmapped-nested":{"private":"PRIVATE_NESTED_CANARY"}}'::jsonb,
 array['material_conflict','PRIVATE_UNKNOWN_REASON_CANARY','material_conflict'],'PRIVATE_HELD_ACTOR_CANARY',
 '2026-09-28T06:03:00.000001Z'::timestamptz+(case when n=5 then 6 else least(n,24) end)*interval '1 second'
 from generate_series(1,25) n;
insert into terra_private.machine_candidate_decisions(id,run_id,qualification_id,source_version_id,candidate_key,disposition,
 content_sha256,evidence_locator,check_trace,reason_codes,machine_actor,decided_at)
select ('66000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,'41000000-0000-4000-8000-000000000001',
 '65000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','PRIVATE_NONHELD_CANDIDATE_CANARY-'||n,
 case when n=26 then 'rejected' else 'eligible' end,repeat('9',64),'PRIVATE_NONHELD_LOCATOR_CANARY',
 '{"source_version_current":true,"evidence_locator_verified":true,"identity_resolved":true,"fields_dates_units_verified":true,"semantics_qualified":true,"no_material_conflict":true,"public_snapshot_consistent":true,"expected_predecessor_current":true,"no_sensitive_data":true}'::jsonb,array['qualified_checks_passed'],'PRIVATE_NONHELD_ACTOR_CANARY','2026-09-28T06:04:00Z'
 from generate_series(26,27) n;
insert into terra_private.machine_candidate_decisions(id,run_id,qualification_id,source_version_id,candidate_key,disposition,
 content_sha256,evidence_locator,check_trace,reason_codes,machine_actor,decided_at) values
 ('66000000-0000-4000-8000-000000000030','41000000-0000-4000-8000-000000000002',
 '65000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','PRIVATE_OTHER_RUN_CANDIDATE_CANARY','held',
 repeat('9',64),'PRIVATE_OTHER_RUN_LOCATOR_CANARY','{}',array['predecessor_changed'],'PRIVATE_OTHER_RUN_ACTOR_CANARY','2026-09-28T06:04:00Z');
commit;
