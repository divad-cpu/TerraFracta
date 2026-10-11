\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into terra_private.jurisdictions (id, display_name)
values ('TF-ASSERTION-TEST', 'Fictional assertion place');
insert into terra_private.issue_dossiers
  (id, jurisdiction_id, issue_key, title, affected_population, selection_rationale)
values
  ('11111111-1111-4111-8111-111111111111', 'TF-ASSERTION-TEST',
   'first-assertion-issue', 'First fictional issue', 'Fictional group', 'Test'),
  ('22222222-2222-4222-8222-222222222222', 'TF-ASSERTION-TEST',
   'other-assertion-issue', 'Other fictional issue', 'Fictional group', 'Test');
insert into terra_private.claims (id, issue_id, claim_type, assertion, created_at)
values
  ('33333333-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111', 'condition',
   'A fictional claim.', '2026-09-25T12:00:00Z'),
  ('44444444-4444-4444-8444-444444444444',
   '22222222-2222-4222-8222-222222222222', 'condition',
   'Another fictional claim.', '2026-09-25T12:00:00Z');
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
insert into terra_private.claim_assertion_reviews
  (publication_id, claim_id, revision, decision, claim_type,
   display_assertion, reviewed_at, review_reference)
values ('55555555-5555-4555-8555-555555555555',
        '33333333-3333-4333-8333-333333333333', 1, 'accepted',
        'condition', 'A fictional claim.', '2026-09-25T12:30:00Z', 'test');
select is((select count(*)::int from terra_private.claim_assertion_reviews), 1,
          'first accepted-looking assertion decision is private');

select throws_ok($$insert into terra_private.claim_assertion_reviews
  (publication_id, claim_id, revision, decision, claim_type,
   display_assertion, reviewed_at, review_reference)
values ('55555555-5555-4555-8555-555555555555',
        '44444444-4444-4444-8444-444444444444', 1, 'accepted',
        'condition', 'Wrong issue', '2026-09-25T12:30:00Z', 'test')$$,
  '23514', 'Claim is not in the reviewed publication issue',
  'cross-issue claim review is rejected');
select throws_ok($$insert into terra_private.claim_assertion_reviews
  (publication_id, claim_id, revision, decision, claim_type,
   display_assertion, reviewed_at, review_reference)
values ('55555555-5555-4555-8555-555555555555',
        '33333333-3333-4333-8333-333333333333', 3, 'accepted',
        'condition', 'Skipped', '2026-09-25T12:40:00Z', 'test')$$,
  '23514', 'Assertion review must follow publication, claim and prior event',
  'revision cannot skip a prior event');
select throws_ok($$insert into terra_private.claim_assertion_reviews
  (publication_id, claim_id, revision, decision, reviewed_at, review_reference)
values ('66666666-6666-4666-8666-666666666666',
        '44444444-4444-4444-8444-444444444444', 1, 'withdrawn',
        '2026-09-25T12:30:00Z', 'test')$$,
  '23514', 'Assertion review must follow publication, claim and prior event',
  'first decision cannot be a withdrawal');
select throws_ok($$update terra_private.claim_assertion_reviews
  set display_assertion='Mutated'
  where publication_id='55555555-5555-4555-8555-555555555555'$$,
  '23514', 'Assertion review events are append-only',
  'accepted decision cannot be updated');

insert into terra_private.claim_assertion_reviews
  (publication_id, claim_id, revision, decision, reviewed_at, review_reference)
values ('55555555-5555-4555-8555-555555555555',
        '33333333-3333-4333-8333-333333333333', 2, 'withdrawn',
        '2026-09-25T12:40:00Z', 'withdrawal');
select is((select decision from terra_private.claim_assertion_reviews
            where publication_id='55555555-5555-4555-8555-555555555555'
            order by revision desc limit 1), 'withdrawn',
          'latest decision can withdraw the assertion');
select ok((select relrowsecurity from pg_catalog.pg_class
           where oid='terra_private.claim_assertion_reviews'::regclass),
          'private assertion decisions have RLS');
select ok(has_table_privilege('terra_reviewer',
          'terra_private.claim_assertion_reviews', 'SELECT'),
          'private reviewer may inspect decision history');
select ok(not has_table_privilege('anon',
          'terra_private.claim_assertion_reviews', 'SELECT'),
          'anonymous role cannot select assertion decisions');
select ok(not has_table_privilege('terra_issue_reader',
          'terra_private.claim_assertion_reviews', 'SELECT'),
          'candidate reader cannot inspect decision history');
select ok(not has_function_privilege('terra_issue_reader',
          'terra_private.check_claim_assertion_review_insert()', 'EXECUTE'),
          'candidate reader cannot invoke the private insert guard');
select ok(not has_function_privilege('terra_issue_reader',
          'terra_private.read_issue_candidate_prebound(text,text)', 'EXECUTE'),
          'candidate reader cannot call the modified internal reader');

select * from finish();
rollback;
