-- Closed invented-only receipt lookup. No table/schema migration or live API.
-- Locks authenticate and serialize against transitions; no application DML.
create function terra_correction_test_api.lookup_review_event(request jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $lookup$
declare
 canonical_uuid constant text:='^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$';
 scope terra_correction_test_api.reviewer_scopes%rowtype;
 report terra_private.correction_reports%rowtype;
 prior terra_correction_test_api.review_events%rowtype;
 current_status jsonb;
 recorded jsonb:=null;
begin
 if request is null or not terra_private.has_exact_json_keys(request,array['schemaVersion','eventId','reportId','expectedState','nextState','resolutionNote'])
  or request->'schemaVersion' is distinct from '1'::jsonb or octet_length(request::text)>4096
  or jsonb_typeof(request->'eventId') is distinct from 'string' or request->>'eventId' !~ canonical_uuid
  or jsonb_typeof(request->'reportId') is distinct from 'string' or request->>'reportId' !~ canonical_uuid
  or not ((request->'expectedState'='"new"'::jsonb and request->'nextState'='"in_review"'::jsonb and request->'resolutionNote'='null'::jsonb)
    or (request->'expectedState'='"in_review"'::jsonb and request->'nextState'='"closed"'::jsonb
      and request->'resolutionNote'='"Invented technical closure; no public content was changed."'::jsonb)) then
  raise exception 'Invented review recovery input refused' using errcode='23514';
 end if;
 scope:=terra_correction_test_api.current_reviewer_scope();
 select * into report from terra_private.correction_reports c
  where c.id=(request->>'reportId')::uuid and c.issue_id=scope.issue_id
   and exists(select 1 from terra_correction_test_api.request_receipts r where r.report_id=c.id) for share;
 if report.id is null or scope.expires_at<=clock_timestamp() then
  raise exception 'Invented review recovery report unavailable' using errcode='42501';
 end if;
 select * into prior from terra_correction_test_api.review_events e
  where e.reviewer=session_user and e.event_id=(request->>'eventId')::uuid;
 if prior.report_id is not null then
  if prior.report_id is distinct from report.id or prior.from_state is distinct from request->>'expectedState'
   or prior.to_state is distinct from request->>'nextState' or prior.resolution_note is distinct from request->>'resolutionNote' then
   raise exception 'Invented review recovery request conflicts' using errcode='23514';
  end if;
  recorded:=jsonb_build_object('schemaVersion',1,'status','recorded_private_transition','eventId',prior.event_id,
   'reportId',prior.report_id,'sequence',prior.sequence,'fromState',prior.from_state,'toState',prior.to_state,
   'recordedAt',prior.recorded_at,'replayed',true);
 end if;
 current_status:=terra_correction_test_api.read_review_status(report.id);
 if scope.expires_at<=clock_timestamp() then
  raise exception 'Invented correction reviewer scope refused' using errcode='42501';
 end if;
 return jsonb_build_object('schemaVersion',1,'status','private_invented_review_recovery',
  'outcome',case when recorded is null then 'not_observed' else 'recorded' end,
  'recordedEvent',recorded,'current',current_status);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'Invented review recovery input refused' using errcode='23514';
end;
$lookup$;
revoke all on function terra_correction_test_api.lookup_review_event(jsonb)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
