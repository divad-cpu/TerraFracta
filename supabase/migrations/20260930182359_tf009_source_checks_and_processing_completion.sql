-- David explicitly approved this combined local bundle on 2026-09-30.
-- Three private tables, nineteen fields, eight invoker functions, nine triggers.
-- No writer credential, source collection, schedule or real publication enabled.
begin;
-- Owner-only captured-work and closeout candidate on installed migration 28.
-- No writer, collector, credentials, source approval or schedule is granted.
-- A fresh source check can confirm an unchanged historical content version.
-- A captured manifest is fixed before decisions; closeout never attests to
-- website visibility. Committed activations remain explicitly pending.

create function terra_private.validate_run_manifest(p_canonical text)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,pg_temp as $validate$
declare
 p jsonb; e jsonb; rebuilt text; sources_text text; items_text text;
 uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
 if p_canonical is null or octet_length(p_canonical) not between 2 and 40960 then
   raise exception 'Run manifest is invalid' using errcode='23514';
 end if;
 p:=p_canonical::jsonb;
 if jsonb_typeof(p) is distinct from 'object' then
   raise exception 'Run manifest is invalid' using errcode='23514';
 end if;
 if (select array_agg(key order by key collate "C") from jsonb_each(p)) is distinct from
    array['items','mode','requestFingerprint','runId','schemaVersion','sources']::text[]
    or p->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p->'mode') is distinct from 'string' or p->>'mode' not in('shadow','publish_eligible')
    or jsonb_typeof(p->'runId') is distinct from 'string' or p->>'runId' !~ uuid_pattern
    or jsonb_typeof(p->'requestFingerprint') is distinct from 'string'
    or p->>'requestFingerprint' !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p->'sources') is distinct from 'array'
    or jsonb_typeof(p->'items') is distinct from 'array' then
   raise exception 'Run manifest is invalid' using errcode='23514';
 end if;
 if jsonb_array_length(p->'sources') not between 1 and 50 or jsonb_array_length(p->'items')>50 then
   raise exception 'Run manifest is invalid' using errcode='23514';
 end if;
 for e in select value from jsonb_array_elements(p->'sources') loop
   if jsonb_typeof(e) is distinct from 'object' then
     raise exception 'Run manifest is invalid' using errcode='23514';
   end if;
   if (select array_agg(key order by key collate "C") from jsonb_each(e)) is distinct from
      array['contentSha256','registrationId','sourceKey','sourceVersionId']::text[]
      or jsonb_typeof(e->'sourceKey') is distinct from 'string' or e->>'sourceKey' !~ '^[a-z0-9][a-z0-9:-]{0,119}$'
      or jsonb_typeof(e->'registrationId') is distinct from 'string' or e->>'registrationId' !~ uuid_pattern
      or (e->'sourceVersionId' is distinct from 'null'::jsonb and
          (jsonb_typeof(e->'sourceVersionId') is distinct from 'string' or e->>'sourceVersionId' !~ uuid_pattern))
      or ((e->'sourceVersionId'='null'::jsonb) is distinct from (e->'contentSha256'='null'::jsonb))
      or (e->'contentSha256' is distinct from 'null'::jsonb and
          (jsonb_typeof(e->'contentSha256') is distinct from 'string' or e->>'contentSha256' !~ '^[0-9a-f]{64}$')) then
     raise exception 'Run manifest is invalid' using errcode='23514';
   end if;
 end loop;
 if (select count(*)<>count(distinct value->>'sourceKey') or count(*)<>count(distinct value->>'registrationId')
     from jsonb_array_elements(p->'sources')) then
   raise exception 'Run manifest is invalid' using errcode='23514';
 end if;
 for e in select value from jsonb_array_elements(p->'items') loop
   if jsonb_typeof(e) is distinct from 'object' then
     raise exception 'Run manifest is invalid' using errcode='23514';
   end if;
   if (select array_agg(key order by key collate "C") from jsonb_each(e)) is distinct from
      array['itemKey','sourceKey','sourceVersionId']::text[]
      or jsonb_typeof(e->'itemKey') is distinct from 'string' or e->>'itemKey' !~ '^[a-z0-9][a-z0-9:-]{0,119}$'
      or jsonb_typeof(e->'sourceKey') is distinct from 'string'
      or jsonb_typeof(e->'sourceVersionId') is distinct from 'string' or e->>'sourceVersionId' !~ uuid_pattern
      or not exists(select 1 from jsonb_array_elements(p->'sources') s
         where s->>'sourceKey'=e->>'sourceKey' and s->>'sourceVersionId'=e->>'sourceVersionId') then
     raise exception 'Run manifest is invalid' using errcode='23514';
   end if;
 end loop;
 if (select count(*)<>count(distinct value->>'itemKey') from jsonb_array_elements(p->'items')) then
   raise exception 'Run manifest is invalid' using errcode='23514';
 end if;
 -- Sorted, compact ASCII bytes match the independent Python encoder. Rebuild
 -- objects and arrays rather than stripping whitespace from untrusted text.
 select '['||coalesce(string_agg('{"contentSha256":'||(value->'contentSha256')::text||',"registrationId":'||(value->'registrationId')::text||
   ',"sourceKey":'||(value->'sourceKey')::text||',"sourceVersionId":'||(value->'sourceVersionId')::text||'}',
   ',' order by value->>'sourceKey' collate "C"),'')||']' into sources_text from jsonb_array_elements(p->'sources');
 select '['||coalesce(string_agg('{"itemKey":'||(value->'itemKey')::text||',"sourceKey":'||
   (value->'sourceKey')::text||',"sourceVersionId":'||(value->'sourceVersionId')::text||'}',
   ',' order by value->>'itemKey' collate "C"),'')||']' into items_text from jsonb_array_elements(p->'items');
 rebuilt:='{"items":'||items_text||',"mode":'||(p->'mode')::text||',"requestFingerprint":'||
   (p->'requestFingerprint')::text||',"runId":'||(p->'runId')::text||',"schemaVersion":1,"sources":'||sources_text||'}';
 if rebuilt is distinct from p_canonical then
   raise exception 'Run manifest is invalid' using errcode='23514';
 end if;
 return p;
exception when invalid_text_representation then
 raise exception 'Run manifest is invalid' using errcode='23514';
end;
$validate$;

create table terra_private.update_run_source_checks (
 run_id uuid not null references terra_private.update_runs(id),
 registration_id uuid not null references terra_private.source_registrations(id),
 source_key text not null check(source_key~'^[a-z0-9][a-z0-9:-]{0,119}$'),
 source_version_id uuid references terra_private.source_versions(id),
 content_sha256 text check(content_sha256~'^[0-9a-f]{64}$'),
 outcome text not null check(outcome in('captured','unchanged','failed','deferred')),
 total_response_bytes integer not null check(total_response_bytes between 0 and 50000000),
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 checked_at timestamptz not null default clock_timestamp() check(isfinite(checked_at)),
 primary key(run_id,registration_id), unique(run_id,source_key),
 check((outcome in('captured','unchanged') and source_version_id is not null and content_sha256 is not null)
    or (outcome in('failed','deferred') and source_version_id is null and content_sha256 is null))
);

create function terra_private.check_run_source_check_insert()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare r terra_private.update_runs%rowtype; s terra_private.source_registrations%rowtype;
 v terra_private.source_versions%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Processing writes require read committed isolation' using errcode='23514';
 end if;
 select * into r from terra_private.update_runs where id=new.run_id for update;
 perform terra_private.assert_update_run_work(r.id,r.request_fingerprint,new.work_claim_id);
 select * into s from terra_private.source_registrations where id=new.registration_id;
 if s.id is null or new.source_key is distinct from s.source_key
    or new.checked_at>clock_timestamp() or new.checked_at<r.created_at
    or new.checked_at<(select claimed_at from terra_private.update_run_work_claims where id=new.work_claim_id)
    or exists(select 1 from terra_private.update_run_manifests where run_id=r.id)
    or exists(select 1 from terra_private.machine_candidate_decisions where run_id=r.id)
    or (select count(*) from terra_private.update_run_source_checks where run_id=r.id)>=50
    or new.total_response_bytes+coalesce((select sum(total_response_bytes)
       from terra_private.update_run_source_checks where run_id=r.id),0)>(r.limits->>'max_response_bytes')::integer then
   raise exception 'Source check is outside the open capture and admitted byte bounds' using errcode='23514';
 end if;
 if (new.outcome in('captured','unchanged') or new.total_response_bytes>0) and
    (s.registration_state<>'approved' or not s.allow_fetch or not s.fetch_enabled
     or s.reviewed_at is null or not isfinite(s.reviewed_at) or s.reviewed_at>new.checked_at) then
   raise exception 'Source check has no registered fetch authority' using errcode='23514';
 end if;
 if new.source_version_id is not null then
   select * into v from terra_private.source_versions where id=new.source_version_id;
   if v.id is null or v.registration_id is distinct from new.registration_id
      or v.content_sha256 is distinct from new.content_sha256 or v.source_url is distinct from s.exact_endpoint
      or not isfinite(v.retrieved_at) or v.retrieved_at>new.checked_at
      or (new.outcome='captured' and v.retrieved_at<r.created_at)
      or v.id is distinct from (select id from terra_private.source_versions
         where registration_id=s.id and item_key=v.item_key order by retrieved_at desc,id desc limit 1) then
     raise exception 'Source check does not match the current captured content' using errcode='23514';
   end if;
 end if;
 return new;
end;
$guard$;
create trigger run_source_check_insert_guard before insert on terra_private.update_run_source_checks
 for each row execute function terra_private.check_run_source_check_insert();
create trigger run_source_check_immutable before update or delete on terra_private.update_run_source_checks
 for each row execute function terra_private.block_automatic_decision_change();

create table terra_private.update_run_manifests (
 run_id uuid primary key references terra_private.update_runs(id),
 canonical_manifest text not null check(octet_length(canonical_manifest) between 2 and 40960),
 manifest_sha256 text not null check(manifest_sha256~'^[0-9a-f]{64}$'),
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 captured_at timestamptz not null default clock_timestamp() check(isfinite(captured_at))
);
create table terra_private.update_run_closeouts (
 run_id uuid primary key references terra_private.update_runs(id),
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 manifest_sha256 text not null check(manifest_sha256~'^[0-9a-f]{64}$'),
 summary jsonb not null check(jsonb_typeof(summary)='object'),
 finished_at timestamptz not null default clock_timestamp() check(isfinite(finished_at))
);

create function terra_private.check_run_manifest_insert()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare p jsonb; e jsonb; r terra_private.update_runs%rowtype; v terra_private.source_versions%rowtype;
 c terra_private.update_run_source_checks%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Processing writes require read committed isolation' using errcode='23514';
 end if;
 select * into r from terra_private.update_runs where id=new.run_id for update;
 p:=terra_private.validate_run_manifest(new.canonical_manifest);
 perform terra_private.assert_update_run_work(r.id,r.request_fingerprint,new.work_claim_id);
 if p->>'runId' is distinct from r.id::text or p->>'requestFingerprint' is distinct from r.request_fingerprint
    or p->>'mode' is distinct from r.mode or new.manifest_sha256 is distinct from
       encode(sha256(convert_to(new.canonical_manifest,'UTF8')),'hex')
    or jsonb_array_length(p->'items')>(r.limits->>'max_items')::integer
    or (r.limits->>'max_model_calls')::integer<>0
    or coalesce((select sum(total_response_bytes) from terra_private.update_run_source_checks where run_id=r.id),0)>(r.limits->>'max_response_bytes')::integer
    or new.captured_at<r.created_at or new.captured_at>clock_timestamp()
    or new.captured_at<(select claimed_at from terra_private.update_run_work_claims where id=new.work_claim_id)
    or exists(select 1 from terra_private.update_run_source_checks existing_check where existing_check.run_id=r.id and not exists(
       select 1 from jsonb_array_elements(p->'sources') s where (s->>'registrationId')::uuid=existing_check.registration_id))
    or exists(select 1 from terra_private.machine_candidate_decisions where run_id=r.id)
    or exists(select 1 from terra_private.machine_publication_activations where run_id=r.id) then
   raise exception 'Captured manifest does not match the undecided run' using errcode='23514';
 end if;
 for e in select value from jsonb_array_elements(p->'sources') loop
   if not exists(select 1 from terra_private.source_registrations s where s.id=(e->>'registrationId')::uuid
       and s.source_key=e->>'sourceKey') then
     raise exception 'Manifest source does not match its registration' using errcode='23514';
   end if;
   select * into c from terra_private.update_run_source_checks where run_id=r.id and registration_id=(e->>'registrationId')::uuid;
   if c.run_id is not null and (c.source_key is distinct from e->>'sourceKey'
       or c.source_version_id::text is distinct from e->>'sourceVersionId'
       or c.content_sha256 is distinct from e->>'contentSha256' or c.checked_at>new.captured_at) then
     raise exception 'Manifest differs from its independently stored source check' using errcode='23514';
   end if;
   if e->>'sourceVersionId' is not null then
     select * into v from terra_private.source_versions where id=(e->>'sourceVersionId')::uuid;
     if c.run_id is null or c.outcome not in('captured','unchanged')
        or v.id is null or v.registration_id is distinct from (e->>'registrationId')::uuid
        or v.content_sha256 is distinct from e->>'contentSha256'
        or not isfinite(v.retrieved_at) or v.retrieved_at>c.checked_at
        or v.source_url is distinct from (select exact_endpoint from terra_private.source_registrations where id=v.registration_id) then
       raise exception 'Manifest source receipt is not bound to this capture' using errcode='23514';
     end if;
   end if;
 end loop;
 return new;
end;
$guard$;
create trigger run_manifest_insert_guard before insert on terra_private.update_run_manifests
 for each row execute function terra_private.check_run_manifest_insert();
create trigger run_manifest_immutable before update or delete on terra_private.update_run_manifests
 for each row execute function terra_private.block_automatic_decision_change();

create function terra_private.check_planned_machine_decision()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare p jsonb;
begin
 perform 1 from terra_private.update_runs where id=new.run_id for update;
 select canonical_manifest::jsonb into p from terra_private.update_run_manifests where run_id=new.run_id;
 if p is not null and (exists(select 1 from terra_private.update_run_closeouts where run_id=new.run_id)
    or not exists(select 1 from jsonb_array_elements(p->'items') i
       join jsonb_array_elements(p->'sources') s on s->>'sourceKey'=i->>'sourceKey'
       where i->>'itemKey'=new.candidate_key and (i->>'sourceVersionId')::uuid=new.source_version_id
       and s->>'contentSha256'=new.content_sha256)) then
   raise exception 'Decision is outside the open captured manifest' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create trigger planned_machine_decision_guard before insert on terra_private.machine_candidate_decisions
 for each row execute function terra_private.check_planned_machine_decision();

create function terra_private.summarize_run_processing(p_run uuid)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,pg_temp as $summary$
declare
 m terra_private.update_run_manifests%rowtype; p jsonb;
 due jsonb; covered jsonb; missing jsonb; invalid_sources jsonb; pending jsonb; committed jsonb;
 decided integer; held integer; complete boolean;
begin
 select * into m from terra_private.update_run_manifests where run_id=p_run;
 if m.run_id is null then raise exception 'Captured manifest is missing' using errcode='23514'; end if;
 p:=m.canonical_manifest::jsonb;
 select coalesce(jsonb_agg(s->>'sourceKey' order by s->>'sourceKey' collate "C"),'[]'::jsonb) into invalid_sources
      from jsonb_array_elements(p->'sources') s
      left join terra_private.source_versions v on v.id=(s->>'sourceVersionId')::uuid
      left join terra_private.source_registrations r on r.id=(s->>'registrationId')::uuid
      left join terra_private.update_run_source_checks c on c.run_id=p_run and c.registration_id=r.id
      where r.id is null or r.source_key is distinct from s->>'sourceKey' or
       (s->>'sourceVersionId' is not null and (c.run_id is null or c.outcome not in('captured','unchanged')
        or c.source_key is distinct from s->>'sourceKey' or c.source_version_id is distinct from v.id
        or c.content_sha256 is distinct from s->>'contentSha256' or c.checked_at>m.captured_at
        or v.id is null or v.registration_id is distinct from r.id
        or v.content_sha256 is distinct from s->>'contentSha256' or v.source_url is distinct from r.exact_endpoint
        or not isfinite(v.retrieved_at) or v.retrieved_at>c.checked_at));
 select coalesce(jsonb_agg(value->>'sourceKey' order by value->>'sourceKey' collate "C"),'[]'::jsonb),
   coalesce(jsonb_agg(value->>'sourceKey' order by value->>'sourceKey' collate "C") filter(where value->>'sourceVersionId' is not null and not invalid_sources ? (value->>'sourceKey')),'[]'::jsonb),
   coalesce(jsonb_agg(value->>'sourceKey' order by value->>'sourceKey' collate "C") filter(where value->>'sourceVersionId' is null or invalid_sources ? (value->>'sourceKey')),'[]'::jsonb)
   into due,covered,missing from jsonb_array_elements(p->'sources');
 select coalesce(jsonb_agg(i->>'itemKey' order by i->>'itemKey' collate "C"),'[]'::jsonb) into pending
   from jsonb_array_elements(p->'items') i
   left join terra_private.machine_candidate_decisions d on d.run_id=p_run and d.candidate_key=i->>'itemKey'
   left join terra_private.machine_publication_activations a on a.run_id=p_run and a.decision_id=d.id
   where d.id is null or invalid_sources ? (i->>'sourceKey') or (d.disposition='eligible' and a.publication_id is null);
 select count(*)::integer,count(*) filter(where disposition='held')::integer into decided,held
   from terra_private.machine_candidate_decisions where run_id=p_run;
 select coalesce(jsonb_agg(publication_id::text order by publication_id::text collate "C"),'[]'::jsonb)
   into committed from terra_private.machine_publication_activations where run_id=p_run;
 complete:=jsonb_array_length(missing)=0 and jsonb_array_length(pending)=0;
 return jsonb_build_object('manifestSha256',m.manifest_sha256,
   'runState',case when complete and jsonb_array_length(committed)=0 then 'completed' else 'partial' end,
   'commitState',case when jsonb_array_length(committed)=0 then 'none' when complete then 'committed' else 'partial' end,
   'visibilityState',case when jsonb_array_length(committed)=0 then 'not_required' else 'pending' end,
   'dueSourceKeys',due,'coveredSourceKeys',covered,'missingSourceKeys',missing,'invalidSourceKeys',invalid_sources,
   'expectedItems',jsonb_array_length(p->'items'),'decidedItems',decided,'heldItems',held,
   'pendingItemKeys',pending,'committedPublicationIds',committed,'visiblePublicationIds','[]'::jsonb,
   'pendingVisibilityPublicationIds',committed,'failedVisibilityPublicationIds','[]'::jsonb);
end;
$summary$;

create function terra_private.check_run_closeout()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
 m terra_private.update_run_manifests%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Processing writes require read committed isolation' using errcode='23514';
 end if;
 select * into r from terra_private.update_runs where id=new.run_id for update;
 select * into w from terra_private.update_run_work_state where run_id=new.run_id for update;
 select * into m from terra_private.update_run_manifests where run_id=new.run_id;
 if r.id is null or w.run_id is null or m.run_id is null or new.work_claim_id is distinct from w.claim_id
    or new.manifest_sha256 is distinct from m.manifest_sha256
    or new.finished_at<m.captured_at or new.finished_at<w.updated_at or new.finished_at>clock_timestamp()
    or clock_timestamp()>=w.lease_expires_at or clock_timestamp()>=w.deadline_at
    or new.summary is distinct from terra_private.summarize_run_processing(new.run_id) then
   raise exception 'Closeout does not match current work and stored receipts' using errcode='23514';
 end if;
 if tg_when='BEFORE' then
   if r.run_state<>'running' or r.finished_at is not null then
     raise exception 'Run is not open for closeout' using errcode='23514';
   end if;
 elsif r.run_state is distinct from new.summary->>'runState'
    or r.commit_state is distinct from new.summary->>'commitState'
    or r.visibility_state is distinct from new.summary->>'visibilityState'
    or r.finished_at is distinct from new.finished_at then
   raise exception 'Run and closeout differ at transaction end' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create trigger run_closeout_insert_guard before insert on terra_private.update_run_closeouts
 for each row execute function terra_private.check_run_closeout();
create constraint trigger run_closeout_commit_guard after insert on terra_private.update_run_closeouts
 deferrable initially deferred for each row execute function terra_private.check_run_closeout();
create trigger run_closeout_immutable before update or delete on terra_private.update_run_closeouts
 for each row execute function terra_private.block_automatic_decision_change();

create function terra_private.check_closed_run_change()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare c terra_private.update_run_closeouts%rowtype;
begin
 select * into c from terra_private.update_run_closeouts where run_id=old.id;
 if c.run_id is not null then
   if tg_op='DELETE' or old.finished_at is not null or new.finished_at is distinct from c.finished_at
      or new.run_state is distinct from c.summary->>'runState'
      or new.commit_state is distinct from c.summary->>'commitState'
      or new.visibility_state is distinct from c.summary->>'visibilityState' then
     raise exception 'Closed processing run is immutable' using errcode='23514';
   end if;
 elsif tg_op='UPDATE' and new.finished_at is not null and exists(
     select 1 from terra_private.update_run_manifests where run_id=old.id) then
   raise exception 'Manifest run needs a stored closeout' using errcode='23514';
 end if;
 return case when tg_op='DELETE' then old else new end;
end;
$guard$;
create trigger closed_run_change_guard before update or delete on terra_private.update_runs
 for each row execute function terra_private.check_closed_run_change();

create function terra_private.close_update_run_processing(p_run uuid,p_fingerprint text,p_lease uuid,p_manifest_sha256 text)
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $close$
declare r terra_private.update_runs%rowtype; c terra_private.update_run_closeouts%rowtype;
 m terra_private.update_run_manifests%rowtype; status text:='closed';
begin
 select * into r from terra_private.update_runs where id=p_run for update;
 select * into m from terra_private.update_run_manifests where run_id=p_run;
 if r.id is null or m.run_id is null or p_fingerprint is distinct from r.request_fingerprint
    or p_manifest_sha256 is distinct from m.manifest_sha256 or p_lease is null then
   raise exception 'Closeout request is invalid' using errcode='23514';
 end if;
 select * into c from terra_private.update_run_closeouts where run_id=p_run;
 if c.run_id is not null then
   if p_lease is distinct from c.work_claim_id then
     raise exception 'Closeout retry differs from original work claim' using errcode='23514';
   end if;
   status:='existing_closeout';
 else
   perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_lease);
   insert into terra_private.update_run_closeouts(run_id,work_claim_id,manifest_sha256,summary)
     values(p_run,p_lease,p_manifest_sha256,terra_private.summarize_run_processing(p_run)) returning * into c;
   update terra_private.update_runs set run_state=c.summary->>'runState',commit_state=c.summary->>'commitState',
     visibility_state=c.summary->>'visibilityState',finished_at=c.finished_at where id=p_run;
 end if;
 return jsonb_build_object('schemaVersion',1,'status',status,'runId',p_run,'requestFingerprint',r.request_fingerprint,
   'workClaimId',c.work_claim_id,'manifestSha256',c.manifest_sha256,'finishedAt',c.finished_at,'summary',c.summary);
end;
$close$;

alter table terra_private.update_run_manifests enable row level security;
alter table terra_private.update_run_closeouts enable row level security;
alter table terra_private.update_run_source_checks enable row level security;
revoke all on terra_private.update_run_manifests,terra_private.update_run_closeouts,terra_private.update_run_source_checks
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
grant select on terra_private.update_run_manifests,terra_private.update_run_closeouts,terra_private.update_run_source_checks to terra_operator,terra_reviewer;
create policy operator_read on terra_private.update_run_source_checks for select to terra_operator using(true);
create policy reviewer_read on terra_private.update_run_source_checks for select to terra_reviewer using(true);
create policy operator_read on terra_private.update_run_manifests for select to terra_operator using(true);
create policy reviewer_read on terra_private.update_run_manifests for select to terra_reviewer using(true);
create policy operator_read on terra_private.update_run_closeouts for select to terra_operator using(true);
create policy reviewer_read on terra_private.update_run_closeouts for select to terra_reviewer using(true);
revoke all on function terra_private.validate_run_manifest(text),terra_private.check_run_manifest_insert(),
 terra_private.check_run_source_check_insert(),
 terra_private.check_planned_machine_decision(),terra_private.summarize_run_processing(uuid),
 terra_private.check_run_closeout(),terra_private.check_closed_run_change(),
 terra_private.close_update_run_processing(uuid,text,uuid,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

commit;
