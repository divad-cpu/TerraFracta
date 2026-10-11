-- Owner-only two-context pair proposal. Not an approved primary migration.
-- Preserve legacy same-registration pairs and raw-artifact foreign keys.
-- No source activation, runtime credential, writer grant or public eligibility.

alter table terra_private.source_response_pairs
 add column metadata_registration_id uuid references terra_private.source_registrations(id);
update terra_private.source_response_pairs set metadata_registration_id=registration_id;
alter table terra_private.source_response_pairs
 alter column metadata_registration_id set not null,
 drop constraint source_response_pairs_metadata_version_id_registration_id_fkey,
 add constraint response_pair_metadata_context_version_fkey
 foreign key(metadata_version_id,metadata_registration_id)
 references terra_private.source_versions(id,registration_id);
create index response_pair_metadata_context_idx on terra_private.source_response_pairs(metadata_registration_id,metadata_version_id);

create function terra_private.normalize_response_pair_metadata_context()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $normalize$
begin
 -- Old owner fixtures explicitly retain their one-registration interpretation.
 if new.metadata_registration_id is null then new.metadata_registration_id:=new.registration_id; end if;
 return new;
end;
$normalize$;
create trigger response_pair_context_default before insert on terra_private.source_response_pairs
 for each row execute function terra_private.normalize_response_pair_metadata_context();

create table terra_private.source_pair_run_bindings (
 pair_id uuid primary key references terra_private.source_response_pairs(id),
 run_id uuid not null references terra_private.update_runs(id),
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 metadata_source_key text not null check(metadata_source_key~'^[a-z0-9][a-z0-9:-]{0,119}$'),
 data_source_key text not null check(data_source_key~'^[a-z0-9][a-z0-9:-]{0,119}$'),
 bound_at timestamptz not null default clock_timestamp() check(isfinite(bound_at)),
 check(metadata_source_key<>data_source_key),
 unique(run_id,metadata_source_key,data_source_key)
);

create function terra_private.check_source_pair_run_binding()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $guard$
declare p terra_private.source_response_pairs%rowtype; r terra_private.update_runs%rowtype;
 c terra_private.update_run_source_checks%rowtype; v terra_private.source_versions%rowtype;
 registration terra_private.source_registrations%rowtype;
 reservation terra_private.source_response_reservations%rowtype;
 measured terra_private.source_response_settlements%rowtype;
 dispatched terra_private.source_response_dispatches%rowtype;
 kind text; context_registration_id uuid; version_id uuid; source_key text; retrieved_at timestamptz;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Response pair bindings require read committed isolation' using errcode='23514';
 end if;
 select * into r from terra_private.update_runs where id=new.run_id for update;
 perform terra_private.assert_update_run_work(r.id,r.request_fingerprint,new.work_claim_id);
 select * into p from terra_private.source_response_pairs where id=new.pair_id for share;
 if p.id is null or p.metadata_registration_id=p.registration_id
  or new.bound_at<greatest(p.created_at,r.created_at) or new.bound_at>clock_timestamp()
  or (tg_when='BEFORE' and (exists(select 1 from terra_private.update_run_manifests where run_id=r.id)
  or exists(select 1 from terra_private.machine_candidate_decisions where run_id=r.id))) then
  raise exception 'Response pair binding is outside open captured work' using errcode='23514';
 end if;
 -- Current fixed retrieval rights are locked through the binding transaction.
 perform 1 from terra_private.source_registrations where id in(p.metadata_registration_id,p.registration_id)
  order by id for share;
 foreach kind in array array['metadata','data'] loop
  context_registration_id:=case when kind='metadata' then p.metadata_registration_id else p.registration_id end;
  version_id:=case when kind='metadata' then p.metadata_version_id else p.data_version_id end;
  source_key:=case when kind='metadata' then new.metadata_source_key else new.data_source_key end;
  retrieved_at:=case when kind='metadata' then p.metadata_retrieved_at else p.data_retrieved_at end;
  select * into registration from terra_private.source_registrations where id=context_registration_id;
  select * into c from terra_private.update_run_source_checks where run_id=r.id and update_run_source_checks.registration_id=context_registration_id;
  select * into v from terra_private.source_versions where id=version_id;
  select * into reservation from terra_private.source_response_reservations
   where run_id=r.id and source_response_reservations.registration_id=context_registration_id order by reserved_at desc,id desc limit 1;
  select * into measured from terra_private.source_response_settlements where reservation_id=reservation.id;
  select * into dispatched from terra_private.source_response_dispatches where reservation_id=reservation.id;
  if registration.id is null or registration.source_key is distinct from source_key
   or registration.registration_state<>'approved' or not registration.allow_fetch or not registration.fetch_enabled
   or registration.reviewed_at is null or registration.reviewed_at>new.bound_at
   or c.run_id is null or c.source_key is distinct from source_key or c.source_version_id is distinct from version_id
   or c.work_claim_id is distinct from new.work_claim_id or c.outcome not in('captured','unchanged')
   or c.checked_at>new.bound_at or v.id is null or v.registration_id is distinct from context_registration_id
   or v.source_url is distinct from registration.exact_endpoint or v.content_sha256 is distinct from c.content_sha256
   or reservation.id is null or dispatched.reservation_id is null or measured.reservation_id is null
   or reservation.work_claim_id is distinct from new.work_claim_id or measured.outcome<>'measured'
   or measured.content_sha256 is distinct from v.content_sha256 or measured.body_bytes>reservation.max_body_bytes
   or reservation.endpoint_sha256 is distinct from encode(sha256(convert_to(registration.exact_endpoint,'UTF8')),'hex')
   or retrieved_at<dispatched.dispatched_at or retrieved_at>measured.settled_at
   or v.retrieved_at>retrieved_at or (c.outcome='captured' and v.retrieved_at<>retrieved_at)
   or c.total_response_bytes is distinct from (select coalesce(sum(case when s.outcome='measured' then s.body_bytes else q.max_body_bytes+1 end),0)
       from terra_private.source_response_reservations q left join terra_private.source_response_settlements s on s.reservation_id=q.id
       where q.run_id=r.id and q.registration_id=context_registration_id) then
   raise exception 'Response pair does not match both committed capture contexts' using errcode='23514';
  end if;
 end loop;
 return new;
end;
$guard$;
create trigger response_pair_run_binding_insert before insert on terra_private.source_pair_run_bindings
 for each row execute function terra_private.check_source_pair_run_binding();
create constraint trigger response_pair_run_binding_commit after insert on terra_private.source_pair_run_bindings
 deferrable initially deferred for each row execute function terra_private.check_source_pair_run_binding();
create trigger response_pair_run_binding_immutable before update or delete on terra_private.source_pair_run_bindings
 for each row execute function terra_private.block_automatic_decision_change();

create function terra_private.require_response_pair_context_binding()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $guard$
begin
 if new.metadata_registration_id<>new.registration_id and not exists(
  select 1 from terra_private.source_pair_run_bindings where pair_id=new.id) then
  raise exception 'Two-context response pair needs its committed run binding' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create constraint trigger response_pair_context_binding_commit after insert or update on terra_private.source_response_pairs
 deferrable initially deferred for each row execute function terra_private.require_response_pair_context_binding();

create function terra_private.block_bound_response_pair_change()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $guard$
begin
 if exists(select 1 from terra_private.source_pair_run_bindings where pair_id=old.id) then
  raise exception 'Bound response pair is immutable' using errcode='23514';
 end if;
 return case when tg_op='DELETE' then old else new end;
end;
$guard$;
create trigger bound_response_pair_immutable before update or delete on terra_private.source_response_pairs
 for each row execute function terra_private.block_bound_response_pair_change();

create function terra_private.check_response_pair_manifest_coverage()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $guard$
declare manifest jsonb; b record;
begin
 manifest:=terra_private.validate_run_manifest(new.canonical_manifest);
 for b in select binding.*,pair.metadata_registration_id,pair.registration_id,pair.metadata_version_id,pair.data_version_id
  from terra_private.source_pair_run_bindings binding join terra_private.source_response_pairs pair on pair.id=binding.pair_id
  where binding.run_id=new.run_id loop
  if not exists(select 1 from jsonb_array_elements(manifest->'sources') s
      where s->>'sourceKey'=b.metadata_source_key and (s->>'registrationId')::uuid=b.metadata_registration_id
       and (s->>'sourceVersionId')::uuid=b.metadata_version_id)
   or not exists(select 1 from jsonb_array_elements(manifest->'sources') s
      where s->>'sourceKey'=b.data_source_key and (s->>'registrationId')::uuid=b.registration_id
       and (s->>'sourceVersionId')::uuid=b.data_version_id) then
   raise exception 'Captured manifest must include both response pair contexts' using errcode='23514';
  end if;
 end loop;
 return new;
end;
$guard$;
create trigger response_pair_manifest_coverage before insert on terra_private.update_run_manifests
 for each row execute function terra_private.check_response_pair_manifest_coverage();

alter table terra_private.source_pair_run_bindings enable row level security;
revoke all on terra_private.source_pair_run_bindings from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
grant select on terra_private.source_pair_run_bindings to terra_operator,terra_reviewer;
create policy response_pair_binding_private_read on terra_private.source_pair_run_bindings
 for select to terra_operator,terra_reviewer using(true);
revoke all on function terra_private.normalize_response_pair_metadata_context(),terra_private.check_source_pair_run_binding(),
 terra_private.require_response_pair_context_binding(),terra_private.block_bound_response_pair_change(),terra_private.check_response_pair_manifest_coverage()
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
