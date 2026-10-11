-- Review candidate only. Apply inside a caller-owned rollback transaction for
-- rehearsal; persistent application requires separate authorization.
-- No writer, API exposure, source approval or publication authority is added.

alter table terra_private.automatic_route_qualifications
  add column public_citation_url text
    constraint qualification_public_citation_shape check (
      length(public_citation_url) between 12 and 2048
      and public_citation_url ~ '^https://[^/@#[:space:]]+([/?][^#[:space:]]*)?$'
      and public_citation_url !~ '[[:cntrl:]]'
      and position(chr(92) in public_citation_url) = 0
    );

-- The selected link belongs to the immutable decision as well as the
-- qualification. Exact comparison refuses normalization or redirect substitution.
alter table terra_private.machine_candidate_decisions
  add column public_citation_url text
    constraint machine_public_citation_size check (
      length(public_citation_url) between 1 and 2048
    );

create function terra_private.check_machine_public_citation_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
declare accepted_url text;
begin
  if new.disposition <> 'eligible' then
    return new;
  end if;
  select public_citation_url into accepted_url
    from terra_private.automatic_route_qualifications
    where id = new.qualification_id;
  if accepted_url is null
     or new.public_citation_url is distinct from accepted_url then
    raise exception 'Selected public citation differs from qualification'
      using errcode = '23514';
  end if;
  return new;
end;
$guard$;

create trigger machine_public_citation_insert_guard
before insert on terra_private.machine_candidate_decisions
for each row execute function terra_private.check_machine_public_citation_insert();
revoke all on function terra_private.check_machine_public_citation_insert()
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;

-- This deliberately enforces only bounded basic HTTPS string shape. Trusted
-- qualification must separately reject local hosts, secret query parameters,
-- unapproved publisher origins and misleading targets. No URL is fetched here.
