-- TF-008 preparation: private, append-only review history for displayed
-- claim period labels in a specific issue publication. No real approval,
-- app writer, login, public route or direct reader table grant is added.
begin;

create table terra_private.claim_period_reviews (
  publication_id uuid not null references terra_private.issue_publications(id),
  claim_id uuid not null references terra_private.claims(id),
  revision integer not null check (revision > 0),
  decision text not null check (decision in ('accepted', 'withdrawn')),
  period_label text,
  reviewed_at timestamptz not null,
  review_reference text not null
    check (length(btrim(review_reference)) between 1 and 160),
  created_at timestamptz not null default now(),
  primary key (publication_id, claim_id, revision),
  check (
    (decision = 'accepted'
      and period_label is not null
      and length(btrim(period_label)) between 1 and 160)
    or (decision = 'withdrawn' and period_label is null)
  )
);

create function terra_private.check_claim_period_review_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
declare publication_issue_id uuid;
declare claim_issue_id uuid;
declare publication_created_at timestamptz;
declare claim_created_at timestamptz;
declare prior_revision integer;
declare prior_reviewed_at timestamptz;
begin
  -- Lock publication to serialize concurrent first and later decisions.
  select issue_id, created_at into publication_issue_id, publication_created_at
    from terra_private.issue_publications
    where id = new.publication_id for update;
  if not found then
    raise exception 'Publication is missing for period review' using errcode = '23503';
  end if;
  select issue_id, created_at into claim_issue_id, claim_created_at
    from terra_private.claims where id = new.claim_id;
  if not found or claim_issue_id <> publication_issue_id then
    raise exception 'Claim is not in the reviewed publication issue'
      using errcode = '23514';
  end if;
  select revision, reviewed_at into prior_revision, prior_reviewed_at
    from terra_private.claim_period_reviews
    where publication_id = new.publication_id and claim_id = new.claim_id
    order by revision desc limit 1;
  if new.revision <> coalesce(prior_revision, 0) + 1
     or (prior_revision is null and new.decision <> 'accepted')
     or new.reviewed_at < greatest(publication_created_at, claim_created_at)
     or (prior_reviewed_at is not null and new.reviewed_at < prior_reviewed_at) then
    raise exception 'Period review must follow publication, claim and prior event'
      using errcode = '23514';
  end if;
  return new;
end;
$guard$;

create function terra_private.block_claim_period_review_change()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $guard$
begin
  raise exception 'Period review events are append-only' using errcode = '23514';
end;
$guard$;

create trigger claim_period_review_insert_guard
before insert on terra_private.claim_period_reviews
for each row execute function terra_private.check_claim_period_review_insert();
create trigger claim_period_review_immutable
before update or delete on terra_private.claim_period_reviews
for each row execute function terra_private.block_claim_period_review_change();

alter table terra_private.claim_period_reviews enable row level security;
revoke all on terra_private.claim_period_reviews
  from public, anon, authenticated, service_role, terra_collector,
       terra_operator, terra_issue_reader;
grant select on terra_private.claim_period_reviews to terra_reviewer;
create policy reviewer_read on terra_private.claim_period_reviews
  for select to terra_reviewer using (true);
revoke all on function terra_private.check_claim_period_review_insert()
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;
revoke all on function terra_private.block_claim_period_review_change()
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;

-- Retain the single STABLE candidate read and the closed JSON mask. Only
-- named fields of the latest period decision are emitted per selected claim.
create or replace function terra_private.read_issue_candidate(text, text)
returns jsonb
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
as $read$
with raw as materialized (
  select terra_private.read_issue_candidate_unfiltered($1, $2) as candidate
), shape as (
  select candidate,
    candidate is not null and coalesce(terra_private.is_closed_public_issue_payload(
      candidate #> '{publication,snapshot}',
      candidate #> '{publication,dependency_manifest}'), false) as valid
  from raw
), closed as (
  select valid,
    case when candidate is null then null
      when valid then candidate
      else jsonb_set(
        jsonb_set(candidate, '{publication,snapshot}', 'null'::jsonb),
        '{publication,dependency_manifest}', 'null'::jsonb)
    end as candidate
  from shape
), sources_added as (
  select valid,
    case when valid then jsonb_set(candidate, '{sources}', coalesce((
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
    ), '[]'::jsonb)) else candidate end as candidate
  from closed
), text_added as (
  select valid,
    case when valid then candidate || jsonb_build_object(
      'publication_display_review', (
        select jsonb_build_object(
          'publication_id', review.publication_id,
          'revision', review.revision,
          'decision', review.decision,
          'display_title', review.display_title,
          'display_summary', review.display_summary,
          'reviewed_at', review.reviewed_at)
        from terra_private.issue_text_reviews review
        where review.publication_id =
          (candidate #>> '{publication,id}')::uuid
        order by review.revision desc limit 1
      )) else candidate end as candidate
  from sources_added
)
select case when valid then jsonb_set(candidate, '{claims}', coalesce((
  select jsonb_agg(
    claim_row.item || jsonb_build_object('period_review', (
      select jsonb_build_object(
        'publication_id', review.publication_id,
        'claim_id', review.claim_id,
        'revision', review.revision,
        'decision', review.decision,
        'period_label', review.period_label,
        'reviewed_at', review.reviewed_at)
      from terra_private.claim_period_reviews review
      where review.publication_id =
        (candidate #>> '{publication,id}')::uuid
        and review.claim_id = (claim_row.item->>'id')::uuid
      order by review.revision desc limit 1
    )) order by claim_row.ordinality)
  from jsonb_array_elements(candidate->'claims')
    with ordinality as claim_row(item, ordinality)
), '[]'::jsonb)) else candidate end
from text_added
$read$;

revoke all on function terra_private.read_issue_candidate(text, text)
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator;
grant execute on function terra_private.read_issue_candidate(text, text)
  to terra_issue_reader;
commit;
