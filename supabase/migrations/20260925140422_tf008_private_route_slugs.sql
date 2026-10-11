-- TF-008 preparation: explicit, optional canonical route keys in private records.
-- No public read, slug writer, publication activation or route integration.

alter table terra_private.jurisdictions
  add column public_slug text
    check (public_slug is null or (
      char_length(public_slug) between 2 and 80
      and public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    )),
  add constraint jurisdictions_public_slug_unique unique (public_slug),
  add constraint jurisdictions_published_slug_required
    check (coverage_state <> 'published' or public_slug is not null);

alter table terra_private.issue_dossiers
  add column public_slug text
    check (public_slug is null or (
      char_length(public_slug) between 2 and 100
      and public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    )),
  add constraint issue_dossiers_jurisdiction_public_slug_unique
    unique (jurisdiction_id, public_slug);
