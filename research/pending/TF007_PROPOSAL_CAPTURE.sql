-- UNINSTALLED draft. Constructed private trials only; no primary or writer grant.
-- A capture is immutable review material, not a machine qualification/approval.
begin;
create table terra_private.proposal_captures (
  id uuid primary key,
  decision_id uuid not null unique references terra_private.machine_candidate_decisions(id),
  issue_id uuid not null references terra_private.issue_dossiers(id),
  base_publication_id uuid references terra_private.issue_publications(id),
  base_head_changed_at timestamptz,
  base_content_sha256 text,
  proposal_json text not null check(octet_length(proposal_json) between 2 and 16384),
  proposal_sha256 text not null check(proposal_sha256 ~ '^[0-9a-f]{64}$'),
  source_receipts jsonb not null,
  captured_at timestamptz not null default statement_timestamp(),
  check((base_publication_id is null)=(base_head_changed_at is null)),
  check((base_publication_id is null)=(base_content_sha256 is null))
);

-- Same exact representation is used by the insert guard and read-only query.
create function terra_private.proposal_base_json(p terra_private.issue_publications)
returns text language sql immutable security invoker set search_path='' as $base$
 select jsonb_build_object('id',p.id,'issueId',p.issue_id,'revision',p.revision,
  'kind',p.publication_kind,'snapshot',p.snapshot,'dependencyManifest',p.dependency_manifest)::text
$base$;

create function terra_private.check_proposal_capture_insert()
returns trigger language plpgsql security invoker set search_path='' as $guard$
declare
 d record; i record; h record; b terra_private.issue_publications;
 payload jsonb; ids uuid[]; cited uuid[]; v record; refs integer;
 receipts jsonb:='[]'::jsonb;
begin
 select md.*,r.jurisdiction_id,r.created_at as run_created,q.registration_id,
  q.decided_at as qualified_at,sv.registration_id as source_registration,sv.content_sha256 as source_hash,sv.retrieved_at
 into d from terra_private.machine_candidate_decisions md
 join terra_private.update_runs r on r.id=md.run_id
 join terra_private.automatic_route_qualifications q on q.id=md.qualification_id
 join terra_private.source_versions sv on sv.id=md.source_version_id
 where md.id=new.decision_id;
 if not found or d.disposition<>'held' or d.source_registration<>d.registration_id
  or d.content_sha256<>d.source_hash or not isfinite(d.decided_at)
  or d.decided_at<d.run_created or d.decided_at<d.qualified_at or d.decided_at<d.retrieved_at
  then raise exception 'Proposal decision dependency unavailable' using errcode='23514';end if;
 select dossier.*,j.public_slug as jurisdiction_slug into i from terra_private.issue_dossiers dossier
  join terra_private.jurisdictions j on j.id=dossier.jurisdiction_id where dossier.id=new.issue_id;
 if not found or i.jurisdiction_id<>d.jurisdiction_id or i.public_slug is null or i.jurisdiction_slug is null
  then raise exception 'Proposal target unavailable' using errcode='23514';end if;
 -- Witness an actual head row; NULL head is known absence, missing row is not.
 select * into h from terra_private.issue_heads where issue_id=new.issue_id for update;
 if not found or new.base_publication_id is distinct from h.current_publication_id
  then raise exception 'Proposal base changed or unavailable' using errcode='23514';end if;
 if new.captured_at is null or not isfinite(new.captured_at)
  or new.captured_at<d.decided_at or new.captured_at<d.retrieved_at or new.captured_at<i.created_at
  or new.captured_at>statement_timestamp() or new.captured_at<'0001-01-01Z'::timestamptz
  or new.captured_at>='10000-01-01Z'::timestamptz
  then raise exception 'Proposal capture chronology invalid' using errcode='23514';end if;
 new.base_head_changed_at:=h.changed_at;new.base_content_sha256:=null;
 if h.current_publication_id is not null then
  select * into b from terra_private.issue_publications where id=h.current_publication_id and issue_id=new.issue_id;
  if not found or b.publication_kind not in('accepted','correction') or not isfinite(b.created_at) or not isfinite(h.changed_at)
   or b.created_at>h.changed_at or h.changed_at>new.captured_at then raise exception 'Proposal base dependency unavailable' using errcode='23514';end if;
  new.base_content_sha256:=encode(sha256(convert_to(terra_private.proposal_base_json(b),'UTF8')),'hex');
 end if;
 payload:=new.proposal_json::jsonb;
 if jsonb_typeof(payload) is distinct from 'object'
  or jsonb_typeof(payload->'translation') is distinct from 'object'
  or jsonb_typeof(payload->'dependencyManifest') is distinct from 'object'
  or jsonb_typeof(payload->'snapshot') is distinct from 'object'
  then raise exception 'Proposal payload objects invalid' using errcode='23514';end if;
 if jsonb_typeof(payload)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(payload) k)
  is distinct from array['conflictCoverage','dependencyManifest','kind','schemaVersion','snapshot','translation']::text[]
  or payload->'schemaVersion' is distinct from '1'::jsonb or payload->>'kind' is distinct from 'review_only'
  or payload->'snapshot'->>'jurisdictionSlug' is distinct from i.jurisdiction_slug
  or payload->'snapshot'->>'issueSlug' is distinct from i.public_slug
  or (payload->>'conflictCoverage' in('not_recorded','recorded_partial')) is distinct from true
  or (payload->'translation'->>'status' in('not_recorded','unreviewed','not_required')) is distinct from true
  or (payload->'translation'->>'displayLanguage' ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$') is distinct from true
  or (select array_agg(k order by k) from jsonb_object_keys(payload->'translation') k) is distinct from array['displayLanguage','status']::text[]
  or (select array_agg(k order by k) from jsonb_object_keys(payload->'dependencyManifest') k) is distinct from array['sourceVersionIds']::text[]
  or jsonb_typeof(payload->'dependencyManifest'->'sourceVersionIds') is distinct from 'array'
  or jsonb_typeof(payload->'snapshot'->'claims') is distinct from 'array'
  then raise exception 'Proposal payload boundary invalid' using errcode='23514';end if;
 if jsonb_array_length(payload->'snapshot'->'claims') not between 1 and 30
  or (select count(distinct c->>'id') from jsonb_array_elements(payload->'snapshot'->'claims') c)<>jsonb_array_length(payload->'snapshot'->'claims')
  or exists(select 1 from jsonb_array_elements(payload->'snapshot'->'claims') c where
   jsonb_typeof(c->'evidence') is distinct from 'array' or jsonb_array_length(c->'evidence') not between 1 and 12
   or not exists(select 1 from jsonb_array_elements(c->'evidence') e where e->>'relation'='supports'))
  or (payload->>'conflictCoverage'='recorded_partial' and not exists(select 1 from jsonb_array_elements(payload->'snapshot'->'claims') c
   cross join lateral jsonb_array_elements(c->'evidence') e where e->>'relation'='contradicts'))
  then raise exception 'Proposal claim coverage invalid' using errcode='23514';end if;
 select array_agg(id order by id),count(*) into ids,refs
  from (select value::uuid as id from jsonb_array_elements_text(payload->'dependencyManifest'->'sourceVersionIds')) x;
 if refs not between 1 and 120 or refs<>(select count(distinct id) from unnest(ids) id)
  then raise exception 'Proposal dependency identities invalid' using errcode='23514';end if;
 select array_agg(distinct (e->>'sourceVersionId')::uuid order by (e->>'sourceVersionId')::uuid)
  into cited from jsonb_array_elements(payload->'snapshot'->'claims') c
  cross join lateral jsonb_array_elements(c->'evidence') e;
 if cited is distinct from ids or not exists(select 1 from jsonb_array_elements(payload->'snapshot'->'claims') c
   cross join lateral jsonb_array_elements(c->'evidence') e where e->>'sourceVersionId'=d.source_version_id::text
   and e->>'locator'=d.evidence_locator)
  then raise exception 'Proposal citation binding invalid' using errcode='23514';end if;
 for v in select id,content_sha256,language_code,retrieved_at from terra_private.source_versions where id=any(ids) order by id loop
  if v.retrieved_at>new.captured_at or not isfinite(v.retrieved_at) or v.retrieved_at<'0001-01-01Z'::timestamptz
   or v.retrieved_at>='10000-01-01Z'::timestamptz
   or (v.language_code is not null and v.language_code !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$')
   or exists(select 1 from jsonb_array_elements(payload->'snapshot'->'claims') c cross join lateral jsonb_array_elements(c->'evidence') e
    where e->>'sourceVersionId'=v.id::text and ((e->>'retrievedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$') is distinct from true
     or (e->>'retrievedAt')::timestamptz is distinct from v.retrieved_at))
   then raise exception 'Proposal evidence chronology invalid' using errcode='23514';end if;
  if payload->'translation'->>'status'='not_required' and v.language_code is distinct from payload->'translation'->>'displayLanguage'
   then raise exception 'Proposal translation is unresolved' using errcode='23514';end if;
  receipts:=receipts||jsonb_build_array(jsonb_build_object('sourceVersionId',v.id,'contentSha256',v.content_sha256,
   'retrievedAt',to_char(v.retrieved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'languageCode',v.language_code));
 end loop;
 if jsonb_array_length(receipts)<>refs then raise exception 'Proposal source missing' using errcode='23514';end if;
 new.source_receipts:=receipts;
 new.proposal_sha256:=encode(sha256(convert_to(new.proposal_json,'UTF8')),'hex');
 return new;
end;
$guard$;
create trigger proposal_capture_insert_guard before insert on terra_private.proposal_captures
 for each row execute function terra_private.check_proposal_capture_insert();
create trigger proposal_capture_immutable before update or delete on terra_private.proposal_captures
 for each row execute function terra_private.block_automatic_decision_change();
alter table terra_private.proposal_captures enable row level security;
revoke all on terra_private.proposal_captures from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_issue_reader;
grant select on terra_private.proposal_captures to terra_reviewer;
create policy reviewer_read on terra_private.proposal_captures for select to terra_reviewer using(true);
revoke all on function terra_private.check_proposal_capture_insert(),terra_private.proposal_base_json(terra_private.issue_publications)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_issue_reader;
grant execute on function terra_private.proposal_base_json(terra_private.issue_publications) to terra_reviewer;
commit;
