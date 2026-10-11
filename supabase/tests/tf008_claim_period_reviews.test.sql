\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into terra_private.jurisdictions (id, display_name)
values ('TF-PERIOD-TEST', 'Fictional period place');
insert into terra_private.issue_dossiers
  (id, jurisdiction_id, issue_key, title, affected_population,
   selection_rationale)
values
  ('11111111-1111-4111-8111-111111111111', 'TF-PERIOD-TEST',
   'first-period-issue', 'First fictional issue', 'Fictional group',
   'Local test'),
  ('22222222-2222-4222-8222-222222222222', 'TF-PERIOD-TEST',
   'other-period-issue', 'Other fictional issue', 'Fictional group',
   'Local test');
insert into terra_private.claims
  (id, issue_id, claim_type, assertion, created_at)
values
  ('33333333-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111', 'condition',
   'A fictional assertion.', '2026-09-25T12:00:00Z'),
  ('44444444-4444-4444-8444-444444444444',
   '22222222-2222-4222-8222-222222222222', 'condition',
   'Another fictional assertion.', '2026-09-25T12:00:00Z');
insert into terra_private.issue_publications
  (id, issue_id, revision, publication_kind, snapshot, dependency_manifest,
   created_at)
values
  ('55555555-5555-4555-8555-555555555555',
   '11111111-1111-4111-8111-111111111111', 1, 'accepted', '{}', '{}',
   '2026-09-25T12:00:00Z'),
  ('66666666-6666-4666-8666-666666666666',
   '22222222-2222-4222-8222-222222222222', 1, 'accepted', '{}', '{}',
   '2026-09-25T12:00:00Z');
insert into terra_private.claim_period_reviews
  (publication_id, claim_id, revision, decision, period_label,
   reviewed_at, review_reference)
values ('55555555-5555-4555-8555-555555555555',
        '33333333-3333-4333-8333-333333333333', 1, 'accepted',
        'Example year', '2026-09-25T12:30:00Z', 'synthetic-review');
select is((select count(*)::int from terra_private.claim_period_reviews), 1,
          'first accepted-looking period event is private');

do $$ begin
  begin
    insert into terra_private.claim_period_reviews
      (publication_id, claim_id, revision, decision, period_label,
       reviewed_at, review_reference)
    values ('55555555-5555-4555-8555-555555555555',
            '44444444-4444-4444-8444-444444444444', 1, 'accepted',
            'Wrong issue', '2026-09-25T12:30:00Z', 'synthetic-review');
    raise exception 'Cross-issue period unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'period review cannot pair a publication with another issue claim');

do $$ begin
  begin
    insert into terra_private.claim_period_reviews
      (publication_id, claim_id, revision, decision, period_label,
       reviewed_at, review_reference)
    values ('55555555-5555-4555-8555-555555555555',
            '33333333-3333-4333-8333-333333333333', 3, 'accepted',
            'Skipped', '2026-09-25T12:40:00Z', 'synthetic-review');
    raise exception 'Skipped period revision unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'period decisions cannot skip revisions');

do $$ begin
  begin
    insert into terra_private.claim_period_reviews
      (publication_id, claim_id, revision, decision, reviewed_at,
       review_reference)
    values ('66666666-6666-4666-8666-666666666666',
            '44444444-4444-4444-8444-444444444444', 1, 'withdrawn',
            '2026-09-25T12:30:00Z', 'synthetic-review');
    raise exception 'Initial withdrawal unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'first period event cannot be withdrawal');

do $$ begin
  begin
    insert into terra_private.claim_period_reviews
      (publication_id, claim_id, revision, decision, reviewed_at,
       review_reference)
    values ('55555555-5555-4555-8555-555555555555',
            '33333333-3333-4333-8333-333333333333', 2, 'withdrawn',
            '2026-09-25T11:59:59Z', 'synthetic-review');
    raise exception 'Early period review unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'period review cannot predate publication and claim');

do $$ begin
  begin
    update terra_private.claim_period_reviews set period_label='Mutated'
      where publication_id='55555555-5555-4555-8555-555555555555';
    raise exception 'Period event unexpectedly updated';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'period event cannot be updated');

do $$ begin
  begin
    delete from terra_private.claim_period_reviews
      where publication_id='55555555-5555-4555-8555-555555555555';
    raise exception 'Period event unexpectedly deleted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'period event cannot be deleted');

insert into terra_private.claim_period_reviews
  (publication_id, claim_id, revision, decision, reviewed_at, review_reference)
values ('55555555-5555-4555-8555-555555555555',
        '33333333-3333-4333-8333-333333333333', 2, 'withdrawn',
        '2026-09-25T12:40:00Z', 'synthetic-withdrawal');
select is((select decision from terra_private.claim_period_reviews
            where publication_id='55555555-5555-4555-8555-555555555555'
            order by revision desc limit 1), 'withdrawn',
          'latest event can withdraw a period label');

insert into terra_private.claim_period_reviews
  (publication_id, claim_id, revision, decision, period_label,
   reviewed_at, review_reference)
values ('55555555-5555-4555-8555-555555555555',
        '33333333-3333-4333-8333-333333333333', 3, 'accepted',
        'Corrected example year', '2026-09-25T12:45:00Z',
        'synthetic-correction');
select is((select period_label from terra_private.claim_period_reviews
            where publication_id='55555555-5555-4555-8555-555555555555'
            order by revision desc limit 1), 'Corrected example year',
          'later acceptance appends a new period event');

do $$ begin
  begin
    insert into terra_private.claim_period_reviews
      (publication_id, claim_id, revision, decision, reviewed_at,
       review_reference)
    values ('66666666-6666-4666-8666-666666666666',
            '44444444-4444-4444-8444-444444444444', 1, 'accepted',
            '2026-09-25T12:50:00Z', 'synthetic-review');
    raise exception 'Accepted empty period unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'accepted period requires a bounded label');

select ok((select relrowsecurity from pg_catalog.pg_class
           where oid='terra_private.claim_period_reviews'::regclass),
          'period review table has RLS');
select ok(has_table_privilege('terra_reviewer',
          'terra_private.claim_period_reviews', 'SELECT'),
          'private reviewer may inspect period decisions');
select ok(not has_table_privilege('anon',
          'terra_private.claim_period_reviews', 'SELECT'),
          'anonymous role cannot select period decisions');
select ok(not has_table_privilege('terra_issue_reader',
          'terra_private.claim_period_reviews', 'SELECT'),
          'issue reader cannot select private period history');
select ok(not has_function_privilege('terra_issue_reader',
          'terra_private.check_claim_period_review_insert()', 'EXECUTE'),
          'issue reader cannot invoke private period insert guard');

select * from finish();
rollback;
