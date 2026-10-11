-- Synthetic recorded-reader fixture only, in a fresh owned isolated database.
-- Test owner bypasses writer triggers/FKs while constructing historical rows;
-- the audit function itself runs as the real nonprivileged RLS reviewer.
begin;
set local session_replication_role = replica;
insert into terra_private.jurisdictions(id,display_name) values
  ('audit-country','Invented audit jurisdiction'),('audit-other-country','Invented other jurisdiction');
insert into terra_private.issue_dossiers(id,jurisdiction_id,issue_key,title,affected_population,selection_rationale) values
  ('42000000-0000-4000-8000-000000000001','audit-country','audit-history','PRIVATE_ISSUE_CANARY','invented','invented'),
  ('42000000-0000-4000-8000-000000000002','audit-country','audit-empty','Invented empty history','invented','invented'),
  ('42000000-0000-4000-8000-000000000003','audit-other-country','audit-other','Invented other scope','invented','invented');
insert into terra_private.update_runs(id,request_key,request_fingerprint,jurisdiction_id,requested_by,
  mode,run_state,commit_state,visibility_state,created_at,finished_at) values
  ('41000000-0000-4000-8000-000000000001','PRIVATE_REQUEST_CANARY',repeat('a',64),'audit-country','PRIVATE_REQUESTER_CANARY',
    'shadow','completed','none','not_required','2026-09-28T06:00:00.000001Z','2026-09-28T06:05:00.000002Z'),
  ('41000000-0000-4000-8000-000000000002','invented-unknown-set',repeat('b',64),'audit-country','invented',
    'shadow','partial','none','not_required','2026-09-28T06:00:00Z','2026-09-28T06:05:00Z'),
  ('41000000-0000-4000-8000-000000000003','invented-empty-set',repeat('c',64),'audit-country','invented',
    'shadow','queued','none','not_required','2026-09-28T06:00:00Z',null);
insert into terra_private.source_registrations(id,source_key,publisher,exact_endpoint,registration_state,
  allow_fetch,fetch_enabled,reviewed_at) values
  ('43000000-0000-4000-8000-000000000001','audit-a','PRIVATE_PUBLISHER_CANARY','https://example.org/PRIVATE_ENDPOINT_CANARY','candidate',false,false,null),
  ('43000000-0000-4000-8000-000000000002','audit-b','invented','https://example.org/invented-b','approved',true,true,'2026-09-29T06:00:00Z'),
  ('43000000-0000-4000-8000-000000000003','audit-c','invented','https://example.org/invented-c','suspended',true,false,'2026-09-28T05:00:00Z'),
  ('43000000-0000-4000-8000-000000000004','audit-d','invented','https://example.org/invented-d','retired',false,false,'2026-09-28T05:00:00Z'),
  ('43000000-0000-4000-8000-000000000005','audit-e','invented','https://example.org/invented-e','approved',false,false,'2026-09-29T06:00:00Z');
insert into terra_private.source_versions(id,registration_id,item_key,source_url,retrieved_at,content_sha256) values
  ('44000000-0000-4000-8000-000000000002','43000000-0000-4000-8000-000000000002','invented-b',
    'https://example.org/PRIVATE_SOURCE_URL_CANARY','2026-09-28T06:02:00.000001Z',repeat('d',64)),
  ('44000000-0000-4000-8000-000000000003','43000000-0000-4000-8000-000000000003','invented-c',
    'https://example.org/invented-c','2026-09-27T06:00:00Z',repeat('e',64));
insert into terra_private.update_run_work_claims(id,run_id,attempt_key,attempt_no,claimed_at,initial_expires_at) values
  ('46000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',
    '47000000-0000-4000-8000-000000000001',1,'2026-09-28T06:00:01Z','2026-09-28T06:00:21Z'),
  ('46000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002',
    '47000000-0000-4000-8000-000000000002',1,'2026-09-28T06:00:01Z','2026-09-28T06:00:21Z');
insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,source_version_id,
  content_sha256,outcome,total_response_bytes,work_claim_id,checked_at) values
  ('41000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000002','audit-b',
    '44000000-0000-4000-8000-000000000002',repeat('d',64),'captured',1,'46000000-0000-4000-8000-000000000001','2026-09-28T06:03:00.000002Z'),
  ('41000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000003','audit-c',
    '44000000-0000-4000-8000-000000000003',repeat('e',64),'unchanged',1,'46000000-0000-4000-8000-000000000001','2026-09-28T06:03:00Z'),
  ('41000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000004','audit-d',
    null,null,'failed',0,'46000000-0000-4000-8000-000000000001','2026-09-28T06:03:00Z'),
  ('41000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000005','audit-e',
    null,null,'deferred',0,'46000000-0000-4000-8000-000000000001','2026-09-28T06:03:00Z'),
  ('41000000-0000-4000-8000-000000000002','43000000-0000-4000-8000-000000000003','audit-c',
    '44000000-0000-4000-8000-000000000003',repeat('e',64),'unchanged',1,'46000000-0000-4000-8000-000000000002','2026-09-28T06:03:00Z');
insert into terra_private.update_run_manifests(run_id,canonical_manifest,manifest_sha256,work_claim_id,captured_at)
select '41000000-0000-4000-8000-000000000001',body,encode(sha256(convert_to(body,'UTF8')),'hex'),
  '46000000-0000-4000-8000-000000000001','2026-09-28T06:04:00Z' from (values
  ('{"items":[],"mode":"shadow","requestFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","runId":"41000000-0000-4000-8000-000000000001","schemaVersion":1,"sources":[{"contentSha256":null,"registrationId":"43000000-0000-4000-8000-000000000001","sourceKey":"audit-a","sourceVersionId":null},{"contentSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","registrationId":"43000000-0000-4000-8000-000000000002","sourceKey":"audit-b","sourceVersionId":"44000000-0000-4000-8000-000000000002"},{"contentSha256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","registrationId":"43000000-0000-4000-8000-000000000003","sourceKey":"audit-c","sourceVersionId":"44000000-0000-4000-8000-000000000003"},{"contentSha256":null,"registrationId":"43000000-0000-4000-8000-000000000004","sourceKey":"audit-d","sourceVersionId":null},{"contentSha256":null,"registrationId":"43000000-0000-4000-8000-000000000005","sourceKey":"audit-e","sourceVersionId":null}]}')) data(body);
insert into terra_private.issue_publications(id,issue_id,revision,predecessor_id,publication_kind,snapshot,dependency_manifest,created_at)
select ('45000000-0000-4000-8000-' || lpad(to_hex(n),12,'0'))::uuid,
  '42000000-0000-4000-8000-000000000001',n,
  case when n = 1 then null else ('45000000-0000-4000-8000-' || lpad(to_hex(n-1),12,'0'))::uuid end,
  case when n = 3 then 'accepted' when n % 4 = 0 then 'suppression' when n % 4 = 1 then 'draft'
    when n % 4 = 2 then 'accepted' else 'correction' end,
  '{"private":"PRIVATE_SNAPSHOT_CANARY"}'::jsonb,'{"private":"PRIVATE_MANIFEST_CANARY"}'::jsonb,
  '2026-09-28T07:00:00Z'::timestamptz + n * interval '1 second' from generate_series(1,25) n;
insert into terra_private.issue_heads(issue_id,current_publication_id,changed_at) values
  ('42000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000003','2026-09-28T07:01:00Z');
commit;
