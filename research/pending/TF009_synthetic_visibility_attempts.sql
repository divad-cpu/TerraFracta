-- Owner-only synthetic visibility evidence. No rendered-view acceptance route.
-- No primary migration, LOGIN, application grant, source request or closeout rewrite.
create function terra_private.validate_synthetic_visibility_attempt(p_canonical text)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,pg_temp as $validate$
declare p jsonb;e jsonb;u jsonb;rebuilt text;source_text text;obs_text text;row_sources text;
 uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
 time_pattern constant text:='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}\+00:00$';
begin
 if p_canonical is null or octet_length(p_canonical) not between 2 and 16384 then
  raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
 end if;
 p:=p_canonical::jsonb;
 if jsonb_typeof(p) is distinct from 'object' then
  raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
 end if;
 if (select array_agg(key order by key collate "C") from jsonb_each(p)) is distinct from
  array['expectedSourceVersionIds','finishedAt','observations','publicationId','publicationSha256','runId','schemaVersion','scope','startedAt']::text[]
  or p->'schemaVersion' is distinct from '1'::jsonb or p->'scope' is distinct from '"synthetic"'::jsonb
  or jsonb_typeof(p->'runId') is distinct from 'string' or p->>'runId' !~ uuid_pattern
  or jsonb_typeof(p->'publicationId') is distinct from 'string' or p->>'publicationId' !~ uuid_pattern
  or jsonb_typeof(p->'publicationSha256') is distinct from 'string' or p->>'publicationSha256' !~ '^[0-9a-f]{64}$'
  or jsonb_typeof(p->'startedAt') is distinct from 'string' or p->>'startedAt' !~ time_pattern
  or jsonb_typeof(p->'finishedAt') is distinct from 'string' or p->>'finishedAt' !~ time_pattern
  or jsonb_typeof(p->'expectedSourceVersionIds') is distinct from 'array'
  or jsonb_typeof(p->'observations') is distinct from 'array' then
  raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
 end if;
 if jsonb_array_length(p->'expectedSourceVersionIds') not between 1 and 120
  or jsonb_array_length(p->'observations')>4
  or (p->>'finishedAt')::timestamptz<(p->>'startedAt')::timestamptz
  or (p->>'finishedAt')::timestamptz>(p->>'startedAt')::timestamptz+interval '60 seconds' then
  raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
 end if;
 for u in select value from jsonb_array_elements(p->'expectedSourceVersionIds') loop
  if jsonb_typeof(u) is distinct from 'string' or u#>>'{}' !~ uuid_pattern then
   raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
  end if;
 end loop;
 if (select count(*)<>count(distinct value) from jsonb_array_elements(p->'expectedSourceVersionIds')) then
  raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
 end if;
 for e in select value from jsonb_array_elements(p->'observations') loop
  if jsonb_typeof(e) is distinct from 'object' then
   raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
  end if;
  if (select array_agg(key order by key collate "C") from jsonb_each(e)) is distinct from
   array['checkedAt','observedPublicationId','observedPublicationSha256','outcome','sourceVersionIds','surface']::text[]
   or jsonb_typeof(e->'surface') is distinct from 'string' or e->>'surface' not in('issue','overview','search','sources')
   or jsonb_typeof(e->'outcome') is distinct from 'string' or e->>'outcome' not in('observed','absent','unavailable')
   or jsonb_typeof(e->'checkedAt') is distinct from 'string' or e->>'checkedAt' !~ time_pattern
   or jsonb_typeof(e->'sourceVersionIds') is distinct from 'array' then
   raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
  end if;
  if (e->>'checkedAt')::timestamptz not between (p->>'startedAt')::timestamptz and (p->>'finishedAt')::timestamptz
   or jsonb_array_length(e->'sourceVersionIds')>120 then
   raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
  end if;
  for u in select value from jsonb_array_elements(e->'sourceVersionIds') loop
   if jsonb_typeof(u) is distinct from 'string' or u#>>'{}' !~ uuid_pattern then
    raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
   end if;
  end loop;
  if (select count(*)<>count(distinct value) from jsonb_array_elements(e->'sourceVersionIds')) then
   raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
  end if;
  if e->>'outcome'='observed' then
   if jsonb_typeof(e->'observedPublicationId') is distinct from 'string' or e->>'observedPublicationId' !~ uuid_pattern
    or jsonb_typeof(e->'observedPublicationSha256') is distinct from 'string'
    or e->>'observedPublicationSha256' !~ '^[0-9a-f]{64}$' then
    raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
   end if;
  elsif e->'observedPublicationId' is distinct from 'null'::jsonb
   or e->'observedPublicationSha256' is distinct from 'null'::jsonb or jsonb_array_length(e->'sourceVersionIds')<>0 then
   raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
  end if;
 end loop;
 if (select count(*)<>count(distinct value->>'surface') from jsonb_array_elements(p->'observations')) then
  raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
 end if;
 select '['||string_agg(value::text,',' order by value#>>'{}' collate "C")||']'
  into source_text from jsonb_array_elements(p->'expectedSourceVersionIds');
 obs_text:='';
 for e in select value from jsonb_array_elements(p->'observations') order by value->>'surface' collate "C" loop
  select '['||coalesce(string_agg(value::text,',' order by value#>>'{}' collate "C"),'')||']'
   into row_sources from jsonb_array_elements(e->'sourceVersionIds');
  obs_text:=obs_text||case when obs_text='' then '' else ',' end||'{"checkedAt":'||(e->'checkedAt')::text||
   ',"observedPublicationId":'||(e->'observedPublicationId')::text||',"observedPublicationSha256":'||
   (e->'observedPublicationSha256')::text||',"outcome":'||(e->'outcome')::text||',"sourceVersionIds":'||row_sources||
   ',"surface":'||(e->'surface')::text||'}';
 end loop;
 rebuilt:='{"expectedSourceVersionIds":'||source_text||',"finishedAt":'||(p->'finishedAt')::text||
  ',"observations":['||obs_text||'],"publicationId":'||(p->'publicationId')::text||',"publicationSha256":'||
  (p->'publicationSha256')::text||',"runId":'||(p->'runId')::text||',"schemaVersion":1,"scope":"synthetic","startedAt":'||
  (p->'startedAt')::text||'}';
 if rebuilt is distinct from p_canonical then
  raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
 end if;
 return p;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 raise exception 'Synthetic visibility attempt is invalid' using errcode='23514';
end;
$validate$;

create table terra_private.synthetic_visibility_attempts (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references terra_private.update_run_closeouts(run_id),
 publication_id uuid not null references terra_private.issue_publications(id),
 publication_sha256 text not null check(publication_sha256~'^[0-9a-f]{64}$'),
 attempt_key text not null check(attempt_key~'^[a-z0-9][a-z0-9:_-]{0,159}$'),
 canonical_observations text not null,
 observations_sha256 text not null check(observations_sha256~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null default clock_timestamp() check(isfinite(recorded_at)),
 unique(run_id,publication_id,attempt_key)
);
alter table terra_private.synthetic_visibility_attempts enable row level security;
revoke all on terra_private.synthetic_visibility_attempts from public,anon,authenticated,service_role,terra_collector,
 terra_operator,terra_reviewer,terra_issue_reader;
grant select on terra_private.synthetic_visibility_attempts to terra_operator,terra_reviewer;
create policy operator_read on terra_private.synthetic_visibility_attempts for select to terra_operator using(true);
create policy reviewer_read on terra_private.synthetic_visibility_attempts for select to terra_reviewer using(true);
create trigger synthetic_visibility_immutable before update or delete on terra_private.synthetic_visibility_attempts
 for each row execute function terra_private.block_automatic_decision_change();

create function terra_private.check_synthetic_visibility_attempt()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare p jsonb;r terra_private.update_runs%rowtype;c terra_private.update_run_closeouts%rowtype;
 a terra_private.machine_publication_activations%rowtype;expected_sources jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Synthetic visibility writes require read committed isolation' using errcode='23514';
 end if;
 select * into r from terra_private.update_runs where id=new.run_id for update;
 select * into c from terra_private.update_run_closeouts where run_id=new.run_id;
 select * into a from terra_private.machine_publication_activations where run_id=new.run_id and publication_id=new.publication_id;
 p:=terra_private.validate_synthetic_visibility_attempt(new.canonical_observations);
 select jsonb_agg(id order by id) into expected_sources from
  (select distinct source_version_id::text as id from terra_private.issue_publication_citations where publication_id=new.publication_id) sources;
 if c.run_id is null or a.publication_id is null or a.publication_sha256 is distinct from new.publication_sha256
  or not(c.summary->'committedPublicationIds' ? new.publication_id::text)
  or p->>'runId' is distinct from new.run_id::text or p->>'publicationId' is distinct from new.publication_id::text
  or p->>'publicationSha256' is distinct from new.publication_sha256
  or p->'expectedSourceVersionIds' is distinct from expected_sources
  or new.observations_sha256 is distinct from encode(sha256(convert_to(new.canonical_observations,'UTF8')),'hex')
  or (p->>'startedAt')::timestamptz<greatest(c.finished_at,a.activated_at)
  or new.recorded_at<(p->>'finishedAt')::timestamptz or new.recorded_at>clock_timestamp()
  or (tg_when='BEFORE' and (select count(*) from terra_private.synthetic_visibility_attempts
      where run_id=new.run_id and publication_id=new.publication_id)>=50) then
  raise exception 'Synthetic visibility attempt differs from committed processing' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create trigger synthetic_visibility_insert_guard before insert on terra_private.synthetic_visibility_attempts
 for each row execute function terra_private.check_synthetic_visibility_attempt();
create constraint trigger synthetic_visibility_commit_guard after insert on terra_private.synthetic_visibility_attempts
 deferrable initially deferred for each row execute function terra_private.check_synthetic_visibility_attempt();

create function terra_private.summarize_synthetic_visibility(p jsonb,p_current_publication uuid)
returns jsonb language sql stable security invoker
set search_path=pg_catalog,pg_temp as $summary$
 with observed as(select value as e from jsonb_array_elements(p->'observations')),
 classified as(select e->>'surface' as surface,case when e->>'outcome'='unavailable' then 'unavailable'
  when e->>'outcome'='observed' and e->'observedPublicationId'=p->'publicationId'
   and e->'observedPublicationSha256'=p->'publicationSha256' and e->'sourceVersionIds'=p->'expectedSourceVersionIds' then 'matched'
  else 'mismatch' end as outcome from observed)
 select jsonb_build_object('scope','synthetic','runtimeVerified',false,
  'state',case when p_current_publication is null then 'unavailable' when p_current_publication::text<>p->>'publicationId' then 'superseded'
   when exists(select 1 from classified where outcome='mismatch') then 'mismatch'
   when exists(select 1 from classified where outcome='unavailable') then 'unavailable'
   when (select count(*) from classified)<4 then 'partial' else 'matched' end,
  'matchedSurfaces',(select coalesce(jsonb_agg(surface order by surface),'[]') from classified where outcome='matched'),
  'missingSurfaces',(select coalesce(jsonb_agg(surface order by surface),'[]') from unnest(array['issue','overview','search','sources']) surface
    where not exists(select 1 from classified c where c.surface=surface)),
  'mismatchedSurfaces',(select coalesce(jsonb_agg(surface order by surface),'[]') from classified where outcome='mismatch'),
  'unavailableSurfaces',(select coalesce(jsonb_agg(surface order by surface),'[]') from classified where outcome='unavailable'),
  'checkedThrough',p->'finishedAt');
$summary$;

create function terra_private.synthetic_visibility_receipt(p_id uuid,p_status text)
returns jsonb language sql stable security invoker
set search_path=pg_catalog,pg_temp as $receipt$
 select jsonb_build_object('schemaVersion',1,'status',p_status,'attemptId',v.id,'attemptKey',v.attempt_key,
  'runId',v.run_id,'publicationId',v.publication_id,'publicationSha256',v.publication_sha256,
  'observationsSha256',v.observations_sha256,'recordedAt',v.recorded_at,
  'summary',terra_private.summarize_synthetic_visibility(v.canonical_observations::jsonb,h.current_publication_id))
 from terra_private.synthetic_visibility_attempts v join terra_private.issue_publications p on p.id=v.publication_id
 left join terra_private.issue_heads h on h.issue_id=p.issue_id where v.id=p_id;
$receipt$;

create function terra_private.record_synthetic_visibility_attempt(p_run uuid,p_fingerprint text,p_publication uuid,
 p_publication_hash text,p_key text,p_canonical text)
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $record$
declare r terra_private.update_runs%rowtype;v terra_private.synthetic_visibility_attempts%rowtype;digest text;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Synthetic visibility writes require read committed isolation' using errcode='23514';
 end if;
 select * into r from terra_private.update_runs where id=p_run for update;
 if r.id is null or r.request_fingerprint is distinct from p_fingerprint or p_key is null
  or p_key!~'^[a-z0-9][a-z0-9:_-]{0,159}$' then
  raise exception 'Synthetic visibility request identity is invalid' using errcode='23514';
 end if;
 perform terra_private.validate_synthetic_visibility_attempt(p_canonical);
 digest:=encode(sha256(convert_to(p_canonical,'UTF8')),'hex');
 select * into v from terra_private.synthetic_visibility_attempts where run_id=p_run and publication_id=p_publication and attempt_key=p_key;
 if v.id is not null then
  if row(v.publication_sha256,v.canonical_observations,v.observations_sha256) is distinct from row(p_publication_hash,p_canonical,digest) then
   raise exception 'Synthetic visibility attempt key conflicts with original evidence' using errcode='23514';
  end if;
  return terra_private.synthetic_visibility_receipt(v.id,'existing');
 end if;
 insert into terra_private.synthetic_visibility_attempts(run_id,publication_id,publication_sha256,attempt_key,canonical_observations,observations_sha256)
  values(p_run,p_publication,p_publication_hash,p_key,p_canonical,digest) returning * into v;
 return terra_private.synthetic_visibility_receipt(v.id,'stored');
end;
$record$;

create function terra_private.read_latest_synthetic_visibility(p_run uuid,p_publication uuid)
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,pg_temp as $read$
declare newest timestamptz;chosen uuid;
begin
 select max((canonical_observations::jsonb->>'finishedAt')::timestamptz) into newest
  from terra_private.synthetic_visibility_attempts where run_id=p_run and publication_id=p_publication;
 if newest is null then return null;end if;
 if (select count(distinct observations_sha256) from terra_private.synthetic_visibility_attempts
    where run_id=p_run and publication_id=p_publication and (canonical_observations::jsonb->>'finishedAt')::timestamptz=newest)>1 then
  return jsonb_build_object('schemaVersion',1,'state','ambiguous','scope','synthetic','runtimeVerified',false);
 end if;
 select id into chosen from terra_private.synthetic_visibility_attempts where run_id=p_run and publication_id=p_publication
  and (canonical_observations::jsonb->>'finishedAt')::timestamptz=newest order by recorded_at desc,id desc limit 1;
 return terra_private.synthetic_visibility_receipt(chosen,'latest');
end;
$read$;
revoke all on function terra_private.validate_synthetic_visibility_attempt(text),terra_private.check_synthetic_visibility_attempt(),
 terra_private.summarize_synthetic_visibility(jsonb,uuid),terra_private.synthetic_visibility_receipt(uuid,text),
 terra_private.record_synthetic_visibility_attempt(uuid,text,uuid,text,text,text),terra_private.read_latest_synthetic_visibility(uuid,uuid)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
