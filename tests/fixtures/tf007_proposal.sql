-- Invented historical metadata only in a fresh owned PG17 trial. Replica mode
-- constructs history, not qualification evidence. New capture guards stay ON.
begin;set local session_replication_role=replica;
insert into terra_private.jurisdictions(id,display_name,public_slug,created_at) values
 ('invented-country','Invented country','invented-country','2026-09-27Z'),
 ('invented-other','Invented other','invented-other','2026-09-27Z');
insert into terra_private.issue_dossiers(id,jurisdiction_id,issue_key,title,affected_population,selection_rationale,public_slug,created_at) values
 ('87000000-0000-4000-8000-000000000007','invented-country','invented-issue','Invented condition','invented','invented','invented-issue','2026-09-27Z'),
 ('87000000-0000-4000-8000-000000000017','invented-country','invented-empty','Invented empty','invented','invented','invented-empty','2026-09-27Z'),
 ('87000000-0000-4000-8000-000000000027','invented-other','invented-issue','Invented other','invented','invented','invented-issue','2026-09-27Z');
insert into terra_private.update_runs(id,request_key,request_fingerprint,jurisdiction_id,requested_by,mode,created_at) values
 ('87000000-0000-4000-8000-000000000001','invented-run',repeat('c',64),'invented-country','invented','shadow','2026-09-28T05:00Z');
insert into terra_private.source_registrations(id,source_key,publisher,exact_endpoint) values
 ('87000000-0000-4000-8000-000000000009','invented-source','Invented publisher','https://example.org/invented'),
 ('87000000-0000-4000-8000-000000000019','invented-other-source','Invented second publisher','https://example.org/contrasting');
insert into terra_private.source_versions(id,registration_id,item_key,source_url,content_sha256,language_code,retrieved_at) values
 ('87000000-0000-4000-8000-000000000004','87000000-0000-4000-8000-000000000009','invented','https://example.org/invented',repeat('a',64),'nb','2026-09-28T06:00:00.000001Z'),
 ('87000000-0000-4000-8000-000000000005','87000000-0000-4000-8000-000000000019','invented-other','https://example.org/contrasting',repeat('b',64),null,'2026-09-28T06:00:00.000001Z');
insert into terra_private.automatic_route_qualifications(id,registration_id,change_class,revision,decision,exact_endpoint,policy_version,parser_version,decision_reference,decided_by,decided_at) values
 ('87000000-0000-4000-8000-000000000010','87000000-0000-4000-8000-000000000009','structured_observation',1,'qualified','https://example.org/invented','invented-policy','invented-parser','invented-review','invented','2026-09-27T06:00Z');
insert into terra_private.machine_candidate_decisions(id,run_id,qualification_id,source_version_id,candidate_key,disposition,content_sha256,evidence_locator,check_trace,reason_codes,machine_actor,decided_at)
 select ('87000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'87000000-0000-4000-8000-000000000001',
 '87000000-0000-4000-8000-000000000010','87000000-0000-4000-8000-000000000004','invented-candidate-'||n,'held',repeat('a',64),
 'invented row 1','{}',array['material_conflict','PRIVATE_UNKNOWN_REASON_CANARY'],'invented','2026-09-28T06:30:00.000001Z'
 from unnest(array[2,12,22,32]) n;
insert into terra_private.issue_heads(issue_id) values ('87000000-0000-4000-8000-000000000007'),('87000000-0000-4000-8000-000000000017'),('87000000-0000-4000-8000-000000000027');
commit;
