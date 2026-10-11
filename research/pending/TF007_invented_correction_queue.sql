-- CLOSED INVENTED REVIEW DISCOVERY. Not a migration or live privacy policy.
-- Install after the three correction candidates in a NEW fictional database.
-- Membership is captured in one MVCC statement; states are observed per page.
create table terra_correction_test_api.queue_snapshots (
 id uuid primary key default gen_random_uuid(),
 principal name not null references terra_correction_test_api.reviewer_scopes(principal),
 issue_id uuid not null check(issue_id='718863b9-75b8-572b-9184-3bc18a13658a'),
 report_ids uuid[] not null check(cardinality(report_ids)<=64 and array_position(report_ids,null) is null),
 created_at timestamptz not null check(isfinite(created_at)),
 expires_at timestamptz not null check(isfinite(expires_at) and expires_at>created_at and expires_at<=created_at+interval '2 minutes')
);
alter table terra_correction_test_api.queue_snapshots enable row level security;
revoke all on terra_correction_test_api.queue_snapshots
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

create function terra_correction_test_api.reject_queue_snapshot_change()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $immutable$
begin
 raise exception 'Invented review snapshot is immutable' using errcode='23514';
end;
$immutable$;
create trigger queue_snapshot_immutable before update or delete on terra_correction_test_api.queue_snapshots
 for each row execute function terra_correction_test_api.reject_queue_snapshot_change();

create function terra_correction_test_api.checked_review_detail(selected_report uuid, selected_issue uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $detail$
declare
 report terra_private.correction_reports%rowtype;
 receipt terra_correction_test_api.request_receipts%rowtype;
 revision integer;
 expected_target jsonb;
 expected_fields jsonb;
begin
 select * into report from terra_private.correction_reports where id=selected_report and issue_id=selected_issue for share;
 if report.id is null or not isfinite(report.reported_at) or (report.reviewed_at is not null and not isfinite(report.reviewed_at)) then
  raise exception 'Invented review detail unavailable' using errcode='42501';
 end if;
 select * into receipt from terra_correction_test_api.request_receipts where report_id=report.id for share;
 select p.revision into revision from terra_private.issue_publications p where p.id=report.publication_id and p.issue_id=selected_issue;
 expected_target:=jsonb_build_object('issueId',report.issue_id,'publicationId',report.publication_id,'revision',revision,
  'jurisdictionSlug','fictional-country','issueSlug','fictional-share','claimId',report.claim_id);
 expected_fields:=jsonb_build_object('kind',report.report_kind,'details',report.details,'sourceUrl',coalesce(report.source_url,''));
 if receipt.report_id is null or receipt.target is distinct from expected_target or receipt.fields is distinct from expected_fields
  or report.publication_id not in ('92bb9213-05e0-550a-8b99-cbf65e786609','6ac005f4-f9a0-5021-a3b5-28e1f1607397')
  or revision is distinct from (case when report.publication_id='92bb9213-05e0-550a-8b99-cbf65e786609' then 1 else 2 end)
  or char_length(report.details) not between 10 and 1000 or report.details is distinct from btrim(report.details,E' \t\n\r')
  or report.details ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  or coalesce(report.source_url,'') not in ('','https://example.org/fictional-correction-evidence') then
  raise exception 'Invented review detail binding refused' using errcode='23514';
 end if;
 return jsonb_build_object('schemaVersion',1,'status','private_invented_review_detail',
  'report',terra_correction_test_api.read_review_status(selected_report),
  'draft',jsonb_build_object('target',expected_target,'fields',expected_fields));
end;
$detail$;

create function terra_correction_test_api.read_review_detail(request jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $read$
declare
 canonical_uuid constant text:='^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$';
 scope terra_correction_test_api.reviewer_scopes%rowtype;
 ticket terra_correction_test_api.queue_snapshots%rowtype;
 result jsonb;
begin
 if request is null or not terra_private.has_exact_json_keys(request,array['schemaVersion','snapshotId','reportId'])
  or request->'schemaVersion' is distinct from '1'::jsonb or octet_length(request::text)>4096
  or jsonb_typeof(request->'snapshotId') is distinct from 'string' or request->>'snapshotId' !~ canonical_uuid
  or jsonb_typeof(request->'reportId') is distinct from 'string' or request->>'reportId' !~ canonical_uuid then
  raise exception 'Invented review detail input refused' using errcode='23514';
 end if;
 scope:=terra_correction_test_api.current_reviewer_scope();
 select * into ticket from terra_correction_test_api.queue_snapshots
  where id=(request->>'snapshotId')::uuid and principal=session_user and issue_id=scope.issue_id for share;
 if ticket.id is null or ticket.expires_at<=clock_timestamp() or ticket.created_at>clock_timestamp()
  or not ((request->>'reportId')::uuid=any(ticket.report_ids)) then
  raise exception 'Invented review detail snapshot unavailable' using errcode='42501';
 end if;
 result:=terra_correction_test_api.checked_review_detail((request->>'reportId')::uuid,scope.issue_id);
 if scope.expires_at<=clock_timestamp() or ticket.expires_at<=clock_timestamp() then
  raise exception 'Invented review queue scope or snapshot expired' using errcode='42501';
 end if;
 return result||jsonb_build_object('snapshotId',ticket.id);
end;
$read$;

create function terra_correction_test_api.read_review_queue(request jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $queue$
declare
 canonical_uuid constant text:='^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$';
 scope terra_correction_test_api.reviewer_scopes%rowtype;
 ticket terra_correction_test_api.queue_snapshots%rowtype;
 members uuid[];
 offset_value numeric;
 selected_offset integer;
 selected_id uuid;
 detail jsonb;
 items jsonb:='[]'::jsonb;
 next_cursor jsonb:='null'::jsonb;
 at_time timestamptz;
begin
 if request is null or not terra_private.has_exact_json_keys(request,array['schemaVersion','snapshotId','offset'])
  or request->'schemaVersion' is distinct from '1'::jsonb or octet_length(request::text)>4096
  or jsonb_typeof(request->'offset') is distinct from 'number'
  or not (request->'snapshotId'='null'::jsonb or (jsonb_typeof(request->'snapshotId')='string' and request->>'snapshotId' ~ canonical_uuid)) then
  raise exception 'Invented review queue input refused' using errcode='23514';
 end if;
 offset_value:=(request->>'offset')::numeric;
 if offset_value<0 or offset_value>64 or offset_value<>trunc(offset_value) or mod(offset_value,2)<>0
  or (request->'snapshotId'='null'::jsonb and offset_value<>0) then
  raise exception 'Invented review queue input refused' using errcode='23514';
 end if;
 selected_offset:=offset_value::integer;
 scope:=terra_correction_test_api.current_reviewer_scope();
 if request->'snapshotId'='null'::jsonb then
  if (select count(*) from terra_correction_test_api.queue_snapshots where principal=session_user)>=2 then
   raise exception 'Invented review queue snapshot budget refused' using errcode='23514';
  end if;
  -- One statement captures membership. A late commit requires a new ticket;
  -- created-at or sequence high-water marks cannot provide that guarantee.
  select coalesce(array_agg(c.id order by c.reported_at,c.id),'{}'::uuid[]) into members
   from (select r.id,r.reported_at from terra_private.correction_reports r
    where r.issue_id=scope.issue_id and exists(select 1 from terra_correction_test_api.request_receipts p where p.report_id=r.id)
    order by r.reported_at,r.id limit 65) c;
  if cardinality(members)>64 then
   raise exception 'Invented review queue membership limit refused' using errcode='23514';
  end if;
  at_time:=clock_timestamp();
  if scope.expires_at<=at_time then raise exception 'Invented correction reviewer scope refused' using errcode='42501'; end if;
  insert into terra_correction_test_api.queue_snapshots(principal,issue_id,report_ids,created_at,expires_at)
   values(session_user,scope.issue_id,members,at_time,least(scope.expires_at,at_time+interval '2 minutes')) returning * into ticket;
 else
  select * into ticket from terra_correction_test_api.queue_snapshots
   where id=(request->>'snapshotId')::uuid and principal=session_user and issue_id=scope.issue_id for share;
  if ticket.id is null or ticket.expires_at<=clock_timestamp() or ticket.created_at>clock_timestamp()
   or selected_offset>=cardinality(ticket.report_ids) then
   raise exception 'Invented review queue snapshot unavailable' using errcode='42501';
  end if;
 end if;
 -- Hold the whole page before reading states/history. A competing reviewer
 -- follows the same report-lock discipline; a page is not a captured state.
 perform id from terra_private.correction_reports
  where id=any(ticket.report_ids[selected_offset+1:selected_offset+2]) order by id for share;
 foreach selected_id in array ticket.report_ids[selected_offset+1:selected_offset+2] loop
  detail:=terra_correction_test_api.checked_review_detail(selected_id,scope.issue_id);
  items:=items||jsonb_build_array(detail->'report');
 end loop;
 if scope.expires_at<=clock_timestamp() or ticket.expires_at<=clock_timestamp() then
  raise exception 'Invented review queue scope or snapshot expired' using errcode='42501';
 end if;
 if selected_offset+2<cardinality(ticket.report_ids) then
  next_cursor:=jsonb_build_object('schemaVersion',1,'snapshotId',ticket.id,'offset',selected_offset+2);
 end if;
 return jsonb_build_object('schemaVersion',1,'status','private_invented_review_queue','snapshotId',ticket.id,
  'capturedAt',ticket.created_at,'expiresAt',ticket.expires_at,'observedAt',clock_timestamp(),
  'offset',selected_offset,'total',cardinality(ticket.report_ids),'items',items,'next',next_cursor,
  'membershipFrozen',true,'statesObservedPerPage',true,'liveReviewEnabled',false);
end;
$queue$;
revoke all on function terra_correction_test_api.reject_queue_snapshot_change(),
 terra_correction_test_api.checked_review_detail(uuid,uuid),terra_correction_test_api.read_review_detail(jsonb),
 terra_correction_test_api.read_review_queue(jsonb)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
