-- Constructed historical choice records in the fresh owned native trial only.
-- Replica bypass is fixture preparation, not qualified writer/publication proof.
begin;
set local session_replication_role=replica;
insert into terra_private.jurisdictions(id,display_name) values
  ('choice-empty-country','PRIVATE_CHOICE_DISPLAY_NAME_CANARY');
insert into terra_private.update_runs(id,request_key,request_fingerprint,jurisdiction_id,requested_by,
  mode,run_state,commit_state,visibility_state,created_at,finished_at)
select ('51000000-0000-4000-8000-' || lpad(to_hex(n),12,'0'))::uuid,
  'PRIVATE_CHOICE_REQUEST_CANARY-'||n,repeat('f',64),'audit-country','PRIVATE_CHOICE_REQUESTER_CANARY',
  'shadow',case when n%2=0 then 'queued' else 'partial' end,'none','not_required',
  -- n2/n3 tie straddles the first page's twentieth tuple; n21/n22
  -- retain the existing newest-page tie. IDs supply the unique boundary.
  '2026-10-04T06:00:00.000001Z'::timestamptz +
    (case when n=2 then 3 else least(n,21) end)*interval '1 second',null
  from generate_series(1,22) n;
insert into terra_private.update_runs(id,request_key,request_fingerprint,jurisdiction_id,requested_by,
  mode,run_state,commit_state,visibility_state,created_at,finished_at) values
  ('51000000-0000-4000-8000-000000000030','invented-choice-empty',repeat('f',64),
    'choice-empty-country','PRIVATE_EMPTY_REQUESTER_CANARY','shadow','queued','none','not_required','2026-09-27T06:00:00Z',null);
insert into terra_private.issue_dossiers(id,jurisdiction_id,issue_key,title,affected_population,selection_rationale)
select ('52000000-0000-4000-8000-' || lpad(to_hex(n),12,'0'))::uuid,
  'audit-country','choice-'||lpad(n::text,3,'0'),'PRIVATE_CHOICE_TITLE_CANARY',
  'PRIVATE_CHOICE_POPULATION_CANARY','PRIVATE_CHOICE_RATIONALE_CANARY'
  from generate_series(1,51) n;
commit;
