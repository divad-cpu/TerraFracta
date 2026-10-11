-- CLOSED INVENTED PRIVATE REVIEW. Not a migration/live reviewer API.
-- Install after the unchanged intake and reliability candidates only in a
-- NEW fictional database. Historical review does not qualify publication.
create table terra_correction_test_api.reviewer_scopes (
 principal name primary key,
 issue_id uuid not null check(issue_id='718863b9-75b8-572b-9184-3bc18a13658a'),
 expires_at timestamptz not null check(isfinite(expires_at)),
 enabled boolean not null default false
);
create table terra_correction_test_api.review_events (
 report_id uuid not null references terra_private.correction_reports(id),
 sequence smallint not null check(sequence in (1,2)),
 reviewer name not null references terra_correction_test_api.reviewer_scopes(principal),
 event_id uuid not null,
 from_state text not null,
 to_state text not null,
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 resolution_note text,
 primary key(report_id,sequence),
 unique(reviewer,event_id),
 check((sequence=1 and from_state='new' and to_state='in_review' and resolution_note is null)
    or (sequence=2 and from_state='in_review' and to_state='closed'
      and resolution_note is not distinct from 'Invented technical closure; no public content was changed.'))
);
alter table terra_correction_test_api.reviewer_scopes enable row level security;
alter table terra_correction_test_api.review_events enable row level security;
revoke all on terra_correction_test_api.reviewer_scopes,terra_correction_test_api.review_events
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

create function terra_correction_test_api.reject_review_event_change()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $immutable$
begin
 raise exception 'Invented correction review event is append-only' using errcode='23514';
end;
$immutable$;
create trigger review_event_append_only before update or delete on terra_correction_test_api.review_events
 for each row execute function terra_correction_test_api.reject_review_event_change();

create function terra_correction_test_api.current_reviewer_scope()
returns terra_correction_test_api.reviewer_scopes language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $scope$
declare scope terra_correction_test_api.reviewer_scopes%rowtype;
begin
 if system_user is distinct from 'scram-sha-256:'||session_user::text then
  raise exception 'Invented correction reviewer authentication refused' using errcode='42501';
 end if;
 if current_setting('transaction_isolation') is distinct from 'read committed' then
  raise exception 'Invented correction review isolation refused' using errcode='23514';
 end if;
 select * into scope from terra_correction_test_api.reviewer_scopes where principal=session_user for update;
 if scope.principal is null or scope.enabled is distinct from true or scope.expires_at<=clock_timestamp() then
  raise exception 'Invented correction reviewer scope refused' using errcode='42501';
 end if;
 return scope;
end;
$scope$;

create function terra_correction_test_api.review_report(request jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $review$
declare
 -- Match the pinned Zod UUID contract, including Nil/Max, in lower case.
 canonical_uuid constant text:='^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$';
 scope terra_correction_test_api.reviewer_scopes%rowtype;
 report terra_private.correction_reports%rowtype;
 prior terra_correction_test_api.review_events%rowtype;
 event terra_correction_test_api.review_events%rowtype;
 selected_report uuid;
 selected_event uuid;
 selected_sequence smallint;
 at_time timestamptz;
 event_count integer;
 replayed boolean:=false;
begin
 if request is null or not terra_private.has_exact_json_keys(request,array['schemaVersion','eventId','reportId','expectedState','nextState','resolutionNote'])
  or request->'schemaVersion' is distinct from '1'::jsonb or octet_length(request::text)>4096
  or jsonb_typeof(request->'eventId') is distinct from 'string'
  or request->>'eventId' !~ canonical_uuid
  or jsonb_typeof(request->'reportId') is distinct from 'string'
  or request->>'reportId' !~ canonical_uuid
  or not ((request->'expectedState'='"new"'::jsonb and request->'nextState'='"in_review"'::jsonb and request->'resolutionNote'='null'::jsonb)
    or (request->'expectedState'='"in_review"'::jsonb and request->'nextState'='"closed"'::jsonb
      and request->'resolutionNote'='"Invented technical closure; no public content was changed."'::jsonb)) then
  raise exception 'Invented correction review input refused' using errcode='23514';
 end if;
 selected_report:=(request->>'reportId')::uuid;
 selected_event:=(request->>'eventId')::uuid;
 scope:=terra_correction_test_api.current_reviewer_scope();
 select * into report from terra_private.correction_reports c
  where c.id=selected_report and c.issue_id=scope.issue_id
   and exists(select 1 from terra_correction_test_api.request_receipts r where r.report_id=c.id)
  for update;
 if report.id is null or scope.expires_at<=clock_timestamp() then
  raise exception 'Invented correction review report unavailable' using errcode='42501';
 end if;
 select * into prior from terra_correction_test_api.review_events e
  where e.reviewer=session_user and e.event_id=selected_event;
 if prior.report_id is not null then
  if prior.report_id is distinct from selected_report or prior.from_state is distinct from request->>'expectedState'
   or prior.to_state is distinct from request->>'nextState' or prior.resolution_note is distinct from request->>'resolutionNote' then
   raise exception 'Invented correction review request conflicts' using errcode='23514';
  end if;
  event:=prior;
  replayed:=true;
 else
  if report.review_state is distinct from request->>'expectedState' then
   raise exception 'Invented correction review state changed' using errcode='23514';
  end if;
  selected_sequence:=case when report.review_state='new' then 1 else 2 end;
  select count(*) into event_count from terra_correction_test_api.review_events where report_id=selected_report;
  if event_count is distinct from selected_sequence-1 then
   raise exception 'Invented correction review history inconsistent' using errcode='23514';
  end if;
  at_time:=clock_timestamp();
  if at_time<report.reported_at or at_time<report.reviewed_at or scope.expires_at<=at_time then
   raise exception 'Invented correction review clock refused' using errcode='23514';
  end if;
  update terra_private.correction_reports set review_state=request->>'nextState',reviewed_at=at_time,
   resolution_note=request->>'resolutionNote' where id=selected_report;
  insert into terra_correction_test_api.review_events(report_id,sequence,reviewer,event_id,from_state,to_state,recorded_at,resolution_note)
   values(selected_report,selected_sequence,session_user,selected_event,request->>'expectedState',request->>'nextState',at_time,request->>'resolutionNote')
   returning * into event;
 end if;
 return jsonb_build_object('schemaVersion',1,'status','recorded_private_transition','eventId',event.event_id,'reportId',event.report_id,
  'sequence',event.sequence,'fromState',event.from_state,'toState',event.to_state,'recordedAt',event.recorded_at,'replayed',replayed);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'Invented correction review input refused' using errcode='23514';
end;
$review$;

create function terra_correction_test_api.read_review_status(selected_report uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $read$
declare
 scope terra_correction_test_api.reviewer_scopes%rowtype;
 report terra_private.correction_reports%rowtype;
 events jsonb;
begin
 scope:=terra_correction_test_api.current_reviewer_scope();
 select * into report from terra_private.correction_reports c where c.id=selected_report and c.issue_id=scope.issue_id
  and exists(select 1 from terra_correction_test_api.request_receipts r where r.report_id=c.id) for share;
 if report.id is null or scope.expires_at<=clock_timestamp() then
  raise exception 'Invented correction review report unavailable' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('sequence',sequence,'fromState',from_state,'toState',to_state,'recordedAt',recorded_at) order by sequence),'[]'::jsonb)
  into events from terra_correction_test_api.review_events where report_id=selected_report;
 if scope.expires_at<=clock_timestamp() then
  raise exception 'Invented correction reviewer scope refused' using errcode='42501';
 end if;
 return jsonb_build_object('schemaVersion',1,'status','private_review_snapshot','reportId',report.id,'publicationId',report.publication_id,
  'reviewState',report.review_state,'reportedAt',report.reported_at,'reviewedAt',report.reviewed_at,'events',events);
end;
$read$;
revoke all on function terra_correction_test_api.reject_review_event_change(),
 terra_correction_test_api.current_reviewer_scope(),terra_correction_test_api.review_report(jsonb),
 terra_correction_test_api.read_review_status(uuid)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
