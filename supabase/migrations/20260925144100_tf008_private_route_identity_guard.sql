-- TF-008 preparation: once assigned, a canonical route cannot silently move.
-- An explicit future redirect/change operation needs a separately reviewed design.
-- No public read, writer, publication activation or route integration.

create function terra_private.keep_jurisdiction_route_identity()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if old.public_slug is not null and new.public_slug is distinct from old.public_slug then
    raise exception 'Assigned country route slug cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger jurisdiction_route_identity_guard
before update of public_slug on terra_private.jurisdictions
for each row execute function terra_private.keep_jurisdiction_route_identity();

create function terra_private.keep_issue_route_identity()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if old.public_slug is not null and
     (new.public_slug is distinct from old.public_slug
      or new.jurisdiction_id is distinct from old.jurisdiction_id) then
    raise exception 'Assigned issue route cannot change country or slug' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger issue_route_identity_guard
before update of public_slug, jurisdiction_id on terra_private.issue_dossiers
for each row execute function terra_private.keep_issue_route_identity();

revoke all on function terra_private.keep_jurisdiction_route_identity() from public;
revoke all on function terra_private.keep_issue_route_identity() from public;
