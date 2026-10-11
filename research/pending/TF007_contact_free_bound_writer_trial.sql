-- Invented-only standalone atomic write experiment, NOT migration/installer.
-- Only a brand-new isolated cluster. No existing source/publication/role is used.
create role tf_bound_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role tf_bound_writer nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role tf_bound_public nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create schema tf_bound_trial authorization tf_bound_owner;
revoke all on schema tf_bound_trial from public;
set role tf_bound_owner;
alter default privileges revoke execute on functions from public;
create table tf_bound_trial.clock_state(singleton boolean primary key check(singleton), known boolean not null,
  now_ms bigint not null check(now_ms between 0 and 9007199254740991-15552000000));
create function tf_bound_trial.guard_clock() returns trigger language plpgsql set search_path=pg_catalog as $$
begin if new.now_ms<old.now_ms then raise exception 'Invented clock held';end if;return new;end $$;
create trigger monotonic_clock before update on tf_bound_trial.clock_state for each row execute function tf_bound_trial.guard_clock();
create table tf_bound_trial.current_targets(issue_id uuid primary key, target jsonb not null,
  claim_ids uuid[] not null, eligible_for_invented_trial boolean not null,
  check(jsonb_typeof(target)='object' and target->>'issueId'=issue_id::text and target->'claimId'='null'::jsonb));
create table tf_bound_trial.records(report_id uuid primary key, request_id uuid unique not null,
  target jsonb not null,received_at_ms bigint not null);
create table tf_bound_trial.payloads(report_id uuid primary key references tf_bound_trial.records(report_id) on delete cascade,
  kind text not null,details text not null,source_url text not null);
alter table tf_bound_trial.clock_state enable row level security;
alter table tf_bound_trial.current_targets enable row level security;
alter table tf_bound_trial.records enable row level security;
alter table tf_bound_trial.payloads enable row level security;
create function tf_bound_trial.valid_text(value text, minimum integer, maximum integer) returns boolean
language sql immutable set search_path=pg_catalog as $$
select value is not null and coalesce((select sum(case when ascii(substr(value,n,1))>65535 then 2 else 1 end)
 from generate_series(1,length(value)) n),0) between minimum and maximum
 and not exists(select from generate_series(1,length(value)) n where ascii(substr(value,n,1)) between 1 and 8
 or ascii(substr(value,n,1)) in(11,12,127) or ascii(substr(value,n,1)) between 14 and 31)
$$;
create function tf_bound_trial.valid_id(value text) returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(value ~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',false)
$$;
create function tf_bound_trial.trimmed(value text) returns text language sql immutable set search_path=pg_catalog as $$
 -- ECMAScript String.trim whitespace; reuse the established prepared-field rule.
 select btrim(value, E' \t\n\r\f\v' || chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)
  ||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))
$$;
create function tf_bound_trial.write_invented(packet jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare submitted_target jsonb; fields jsonb; selected tf_bound_trial.current_targets; prior tf_bound_trial.records;
 prior_body tf_bound_trial.payloads; at_ms bigint; request uuid; report uuid;
begin
 -- Native canonical wire/current-request validation remains a separate prerequisite.
 -- The role-facing function also bounds its own value, exact fields and submitted_target.
 if packet is null or octet_length(packet::text)>16384 or jsonb_typeof(packet)<>'object'
 or (select array_agg(k order by k) from jsonb_object_keys(packet) k) is distinct from array['draft','requestId','schemaVersion']
 or packet->'schemaVersion'<>'1'::jsonb or jsonb_typeof(packet->'requestId')<>'string'
 or not tf_bound_trial.valid_id(packet->>'requestId') or packet->>'requestId'<>lower(packet->>'requestId')
 or jsonb_typeof(packet->'draft')<>'object'
 or (select array_agg(k order by k) from jsonb_object_keys(packet->'draft') k) is distinct from array['fields','target'] then return '{"kind":"held"}';end if;
 request:=(packet->>'requestId')::uuid;submitted_target:=packet->'draft'->'target';fields:=packet->'draft'->'fields';
 if jsonb_typeof(submitted_target)<>'object' or jsonb_typeof(fields)<>'object'
 or (select array_agg(k order by k) from jsonb_object_keys(submitted_target) k) is distinct from array['claimId','issueId','issueSlug','jurisdictionSlug','publicationId','revision']
 or (select array_agg(k order by k) from jsonb_object_keys(fields) k) is distinct from array['details','kind','sourceUrl']
 or jsonb_typeof(fields->'kind')<>'string' or fields->>'kind' not in('incorrect_statement','missing_context','broken_source_link','accessibility_problem')
 or jsonb_typeof(fields->'details')<>'string' or fields->>'details'<>tf_bound_trial.trimmed(fields->>'details') or not tf_bound_trial.valid_text(fields->>'details',10,1000)
 or jsonb_typeof(fields->'sourceUrl')<>'string' or fields->>'sourceUrl'<>tf_bound_trial.trimmed(fields->>'sourceUrl') or not tf_bound_trial.valid_text(fields->>'sourceUrl',0,2048)
 or fields->>'sourceUrl' ~ '[[:space:][:cntrl:]]'
 or (fields->>'sourceUrl'<>'' and fields->>'sourceUrl' !~ '^https://[^/?#@[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$')
 or not tf_bound_trial.valid_id(submitted_target->>'issueId') or not tf_bound_trial.valid_id(submitted_target->>'publicationId')
 or jsonb_typeof(submitted_target->'revision')<>'number' or (submitted_target->>'revision')::numeric not between 1 and 9007199254740991
 or trunc((submitted_target->>'revision')::numeric)<>(submitted_target->>'revision')::numeric
 or jsonb_typeof(submitted_target->'jurisdictionSlug')<>'string' or length(submitted_target->>'jurisdictionSlug') not between 1 and 80
 or submitted_target->>'jurisdictionSlug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
 or jsonb_typeof(submitted_target->'issueSlug')<>'string' or length(submitted_target->>'issueSlug') not between 1 and 100
 or submitted_target->>'issueSlug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
 or jsonb_typeof(submitted_target->'claimId') not in('null','string')
 or (submitted_target->'claimId'<>'null'::jsonb and not tf_bound_trial.valid_id(submitted_target->>'claimId')) then return '{"kind":"held"}';end if;
 -- Clock and publication-row locks survive until transaction completion. Owner
 -- retirement/revision changes cannot slip between this check and insertion.
 select now_ms into at_ms from tf_bound_trial.clock_state where singleton and known for share;
 if at_ms is null then return '{"kind":"held"}';end if;
 select * into selected from tf_bound_trial.current_targets where issue_id=(submitted_target->>'issueId')::uuid for update;
 if not found or not selected.eligible_for_invented_trial
 or cardinality(selected.claim_ids) not between 1 and 30
 or array_ndims(selected.claim_ids)<>1
 or exists(select from unnest(selected.claim_ids) claim where not tf_bound_trial.valid_id(claim::text))
 or (select count(*) from unnest(selected.claim_ids))<>(select count(distinct claim) from unnest(selected.claim_ids) claim)
 or submitted_target-'claimId'<>selected.target-'claimId'
 or (submitted_target->'claimId'<>'null'::jsonb and not coalesce((submitted_target->>'claimId')::uuid=any(selected.claim_ids),false)) then return '{"kind":"held"}';end if;
 select * into prior from tf_bound_trial.records where request_id=request for update;
 if found then
   select * into prior_body from tf_bound_trial.payloads where report_id=prior.report_id;
   if not found or prior.target<>submitted_target or prior_body.kind<>fields->>'kind' or prior_body.details<>fields->>'details'
    or prior_body.source_url<>fields->>'sourceUrl' then return '{"kind":"held"}';end if;
   return jsonb_build_object('kind','recorded_invented','reportId',prior.report_id);
 end if;
 report:=gen_random_uuid();
 insert into tf_bound_trial.records values(report,request,submitted_target,at_ms);
 insert into tf_bound_trial.payloads values(report,fields->>'kind',fields->>'details',fields->>'sourceUrl');
 return jsonb_build_object('kind','recorded_invented','reportId',report);
exception when others then
 -- The function's exception subtransaction rolls back a partial private write.
 return '{"kind":"held"}';
end $$;
reset role;
revoke all on all functions in schema tf_bound_trial from public;
grant usage on schema tf_bound_trial to tf_bound_writer;
grant execute on function tf_bound_trial.write_invented(jsonb) to tf_bound_writer;
-- No table/read/review/erase/publisher grants. All identities/eligibility are
-- invented fixture authority; no source qualification or live acceptance exists.
