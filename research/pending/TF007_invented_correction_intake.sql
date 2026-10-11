-- CLOSED INVENTED CORRECTION EXPERIMENT. Not a migration or live intake API.
-- Only the existing fictional first/successor issue and one text URL are in
-- scope. No contact, request metadata, network, notification or public write.
-- A separately provisioned ordinary account receives only submit_report.
create schema terra_correction_test_api;
revoke all on schema terra_correction_test_api from public,anon,authenticated,service_role;
create table terra_correction_test_api.principal_scopes(
 principal name primary key,
 issue_id uuid not null check(issue_id='718863b9-75b8-572b-9184-3bc18a13658a'),
 expires_at timestamptz not null check(isfinite(expires_at)),
 enabled boolean not null default false,
 expected_candidate_sha256 text not null check(expected_candidate_sha256~'^[0-9a-f]{64}$')
);
alter table terra_correction_test_api.principal_scopes enable row level security;
revoke all on terra_correction_test_api.principal_scopes from public,anon,authenticated,service_role,
 terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

create function terra_correction_test_api.submit_report(target jsonb,fields jsonb)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp
as $submit$
declare
 scope terra_correction_test_api.principal_scopes%rowtype;
 candidate jsonb;
 selected_publication uuid;
 selected_claim uuid;
 report_id uuid;
begin
 if system_user is distinct from 'scram-sha-256:'||session_user::text then
  raise exception 'Invented correction authentication refused' using errcode='42501';
 end if;
 -- SQL NULL and missing/extra keys must never turn a guard into UNKNOWN.
 if target is null or fields is null
  or not terra_private.has_exact_json_keys(target,array['issueId','publicationId','revision','jurisdictionSlug','issueSlug','claimId'])
  or not terra_private.has_exact_json_keys(fields,array['kind','details','sourceUrl'])
  or octet_length(target::text)>2048 or octet_length(fields::text)>8192
  or jsonb_typeof(target->'issueId') is distinct from 'string'
  or target->>'issueId' is distinct from '718863b9-75b8-572b-9184-3bc18a13658a'
  or target->>'jurisdictionSlug' is distinct from 'fictional-country'
  or target->>'issueSlug' is distinct from 'fictional-share'
  or target->'revision' not in ('1'::jsonb,'2'::jsonb)
  or jsonb_typeof(target->'publicationId') is distinct from 'string'
  or target->>'publicationId' not in ('92bb9213-05e0-550a-8b99-cbf65e786609','6ac005f4-f9a0-5021-a3b5-28e1f1607397')
  or jsonb_typeof(target->'claimId') not in ('string','null')
  or jsonb_typeof(fields->'kind') is distinct from 'string'
  or fields->>'kind' not in ('incorrect_statement','missing_context','broken_source_link','accessibility_problem')
  or jsonb_typeof(fields->'details') is distinct from 'string'
  or char_length(fields->>'details') not between 10 and 1000
  or fields->>'details' is distinct from btrim(fields->>'details',E' \t\n\r')
  or fields->>'details' ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  or jsonb_typeof(fields->'sourceUrl') is distinct from 'string'
  or fields->>'sourceUrl' not in ('','https://example.org/fictional-correction-evidence') then
  raise exception 'Invented correction input refused' using errcode='23514';
 end if;
 select * into scope from terra_correction_test_api.principal_scopes
  where principal=session_user for update;
 if scope.principal is null or scope.enabled is distinct from true
  or scope.issue_id is distinct from (target->>'issueId')::uuid
  or scope.expires_at<=clock_timestamp() then
  raise exception 'Invented correction principal refused' using errcode='42501';
 end if;
 -- Match the existing activation's source -> country -> dossier -> head ->
 -- publication lock order. This closed fixture has one fixed registration.
 perform s.id from terra_private.source_registrations s
  join terra_private.source_versions v on v.registration_id=s.id
  join terra_private.issue_publication_citations c on c.source_version_id=v.id
  where c.publication_id=(target->>'publicationId')::uuid order by s.id for share of s;
 perform id from terra_private.jurisdictions where public_slug='fictional-country' for share;
 perform id from terra_private.issue_dossiers where id=scope.issue_id for share;
 select current_publication_id into selected_publication from terra_private.issue_heads
  where issue_id=scope.issue_id for share;
 perform id from terra_private.issue_publications where id=selected_publication for share;
 candidate:=terra_private.read_issue_candidate('fictional-country','fictional-share');
 if candidate is null or candidate ? 'candidate_state'
  or encode(sha256(convert_to(candidate::text,'UTF8')),'hex') is distinct from scope.expected_candidate_sha256
  or jsonb_array_length(candidate->'sources') is distinct from 1
  or (candidate #>> '{sources,0,registration,registration_state}') is distinct from 'approved'
  or (candidate #> '{sources,0,registration,allow_public_derived}') is distinct from 'true'::jsonb
  or (candidate #>> '{sources,0,registration,reviewed_at}') is null
  or not isfinite((candidate #>> '{sources,0,registration,reviewed_at}')::timestamptz)
  or (candidate #>> '{sources,0,registration,reviewed_at}')::timestamptz>clock_timestamp()
  or selected_publication is distinct from (target->>'publicationId')::uuid
  or candidate #>> '{publication,id}' is distinct from target->>'publicationId'
  or candidate #> '{publication,revision}' is distinct from target->'revision'
  or scope.expires_at<=clock_timestamp() then
  raise exception 'Invented correction target is unavailable or changed' using errcode='23514';
 end if;
 selected_claim:=case when target->'claimId'='null'::jsonb then null else (target->>'claimId')::uuid end;
 if selected_claim is not null and (
  not exists(select 1 from jsonb_array_elements(candidate #> '{publication,snapshot,claims}') c
   where c->>'id'=selected_claim::text)
  or not exists(select 1 from terra_private.issue_publication_citations
   where publication_id=selected_publication and issue_id=scope.issue_id and claim_id=selected_claim)) then
  raise exception 'Invented correction claim is not displayed' using errcode='23514';
 end if;
 insert into terra_private.correction_reports(issue_id,publication_id,claim_id,report_kind,details,source_url)
  values(scope.issue_id,selected_publication,selected_claim,fields->>'kind',fields->>'details',nullif(fields->>'sourceUrl',''))
  returning id into report_id;
 return jsonb_build_object('schemaVersion',1,'status','recorded_private',
  'reportId',report_id,'publicationId',selected_publication,'revision',target->'revision');
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'Invented correction input refused' using errcode='23514';
end;
$submit$;
revoke all on all functions in schema terra_correction_test_api from public,anon,authenticated,service_role,
 terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
