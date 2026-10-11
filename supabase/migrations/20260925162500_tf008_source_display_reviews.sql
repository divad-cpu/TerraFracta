-- TF-008 preparation: immutable, versioned private decisions for source titles.
-- These records alone cannot approve a source, claim or publication. No writer,
-- login credential, public route or public table grant is introduced.
begin;

create table terra_private.source_display_reviews (
  source_version_id uuid not null references terra_private.source_versions(id),
  revision integer not null check (revision > 0),
  decision text not null check (decision in ('accepted', 'withdrawn')),
  display_title text,
  title_language text,
  reviewed_at timestamptz not null,
  review_reference text not null
    check (length(btrim(review_reference)) between 1 and 160),
  created_at timestamptz not null default now(),
  primary key (source_version_id, revision),
  check (
    (decision = 'accepted'
      and display_title is not null
      and length(btrim(display_title)) between 1 and 240
      and title_language is not null
      and title_language ~ '^[a-z]{2,3}(-[A-Z]{2})?$')
    or (decision = 'withdrawn' and display_title is null and title_language is null)
  )
);

create function terra_private.check_source_display_review_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
declare source_retrieved_at timestamptz;
declare prior_revision integer;
declare prior_reviewed_at timestamptz;
begin
  -- Serialize revisions for this source version, including concurrent first inserts.
  select retrieved_at into source_retrieved_at
    from terra_private.source_versions
    where id = new.source_version_id for update;
  if not found then
    raise exception 'Source version is missing for display review' using errcode = '23503';
  end if;
  select revision, reviewed_at into prior_revision, prior_reviewed_at
    from terra_private.source_display_reviews
    where source_version_id = new.source_version_id
    order by revision desc limit 1;
  if new.revision <> coalesce(prior_revision, 0) + 1
     or (prior_revision is null and new.decision <> 'accepted')
     or new.reviewed_at < source_retrieved_at
     or (prior_reviewed_at is not null and new.reviewed_at < prior_reviewed_at) then
    raise exception 'Display review must follow source retrieval and prior revision'
      using errcode = '23514';
  end if;
  return new;
end;
$guard$;

create function terra_private.block_source_display_review_change()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
begin
  raise exception 'Display review events are append-only' using errcode = '23514';
end;
$guard$;

create trigger source_display_review_insert_guard
before insert on terra_private.source_display_reviews
for each row execute function terra_private.check_source_display_review_insert();
create trigger source_display_review_immutable
before update or delete on terra_private.source_display_reviews
for each row execute function terra_private.block_source_display_review_change();

alter table terra_private.source_display_reviews enable row level security;
revoke all on terra_private.source_display_reviews
  from public, anon, authenticated, service_role, terra_collector,
       terra_operator, terra_issue_reader;
grant select on terra_private.source_display_reviews to terra_reviewer;
create policy reviewer_read on terra_private.source_display_reviews
  for select to terra_reviewer using (true);
revoke all on function terra_private.check_source_display_review_insert()
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;
revoke all on function terra_private.block_source_display_review_change()
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;

-- The reader sees only the current event's display fields, never the private
-- review reference. This remains one STABLE statement snapshot.
create or replace function terra_private.read_issue_candidate(text, text)
returns jsonb
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
as $read$
with raw as materialized (
  select terra_private.read_issue_candidate_unfiltered($1, $2) as candidate
)
select case
  when candidate is null then null
  when not terra_private.is_closed_public_issue_payload(
    candidate #> '{publication,snapshot}',
    candidate #> '{publication,dependency_manifest}') then jsonb_set(
      jsonb_set(candidate, '{publication,snapshot}', 'null'::jsonb),
      '{publication,dependency_manifest}', 'null'::jsonb)
  else jsonb_set(candidate, '{sources}', coalesce((
    select jsonb_agg(
      source_row.item || jsonb_build_object('display_review', (
        select jsonb_build_object(
          'source_version_id', review.source_version_id,
          'revision', review.revision,
          'decision', review.decision,
          'display_title', review.display_title,
          'title_language', review.title_language,
          'reviewed_at', review.reviewed_at)
        from terra_private.source_display_reviews review
        where review.source_version_id =
          (source_row.item #>> '{version,id}')::uuid
        order by review.revision desc limit 1
      )) order by source_row.ordinality)
    from jsonb_array_elements(candidate->'sources')
      with ordinality as source_row(item, ordinality)
  ), '[]'::jsonb))
  end
from raw
$read$;

-- CREATE OR REPLACE preserves the old ACL; assert the intended scope here.
revoke all on function terra_private.read_issue_candidate(text, text)
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator;
grant execute on function terra_private.read_issue_candidate(text, text)
  to terra_issue_reader;
commit;
