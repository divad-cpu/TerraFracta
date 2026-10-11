\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into terra_private.jurisdictions (id, display_name)
values ('TF-CORRECTION', 'Synthetic correction jurisdiction');
insert into terra_private.issue_dossiers
  (id, jurisdiction_id, issue_key, title, affected_population, selection_rationale)
values
  ('11111111-1111-4111-8111-111111111111', 'TF-CORRECTION', 'one', 'First synthetic issue', 'Synthetic', 'Test'),
  ('22222222-2222-4222-8222-222222222222', 'TF-CORRECTION', 'two', 'Second synthetic issue', 'Synthetic', 'Test');
insert into terra_private.claims (id, issue_id, claim_type, assertion)
values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'condition', 'First synthetic claim'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'condition', 'Second synthetic claim');
insert into terra_private.issue_publications
  (id, issue_id, revision, publication_kind, snapshot, dependency_manifest)
values
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 1, 'accepted', '{}', '{}'),
  ('66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', 1, 'accepted', '{}', '{}');

insert into terra_private.correction_reports
  (issue_id, publication_id, report_kind, details)
values ('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555',
        'missing_context', 'Synthetic report for page-level context.');
select is((select count(*)::int from terra_private.correction_reports), 1,
          'page-level report can refer to an exact issue revision');

insert into terra_private.correction_reports
  (issue_id, publication_id, claim_id, report_kind, details, source_url)
values ('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555',
        '33333333-3333-4333-8333-333333333333', 'incorrect_statement',
        'Synthetic report for one claim.', 'https://example.org/source');
select is((select count(*)::int from terra_private.correction_reports), 2,
          'claim-level report can refer to a claim in the same issue');

do $$ begin
  begin
    insert into terra_private.correction_reports
      (issue_id, publication_id, report_kind, details)
    values ('22222222-2222-4222-8222-222222222222', '55555555-5555-4555-8555-555555555555',
            'missing_context', 'Synthetic cross-issue publication report.');
    raise exception 'Cross-issue publication unexpectedly accepted';
  exception when foreign_key_violation then null;
  end;
end $$;
select ok(true, 'report cannot target a publication from another issue');

do $$ begin
  begin
    insert into terra_private.correction_reports
      (issue_id, publication_id, claim_id, report_kind, details)
    values ('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555',
            '44444444-4444-4444-8444-444444444444', 'missing_context',
            'Synthetic cross-issue claim report.');
    raise exception 'Cross-issue claim unexpectedly accepted';
  exception when foreign_key_violation then null;
  end;
end $$;
select ok(true, 'report cannot target a claim from another issue');

do $$ begin
  begin
    insert into terra_private.correction_reports
      (issue_id, publication_id, report_kind, details)
    values ('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555',
            'missing_context', 'short');
    raise exception 'Short report unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'report explanation must meet the lower bound');

do $$ begin
  begin
    insert into terra_private.correction_reports
      (issue_id, publication_id, report_kind, details, source_url)
    values ('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555',
            'missing_context', 'Synthetic non-HTTPS report.', 'http://example.org/source');
    raise exception 'Non-HTTPS source unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'optional report source URL must be HTTPS');

do $$ begin
  begin
    insert into terra_private.correction_reports
      (issue_id, publication_id, report_kind, details, review_state, reviewed_at)
    values ('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555',
            'missing_context', 'Synthetic premature review timestamp.', 'new', now());
    raise exception 'New state unexpectedly had a review timestamp';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'new report cannot masquerade as reviewed');

do $$ begin
  begin
    insert into terra_private.correction_reports
      (issue_id, publication_id, report_kind, details, review_state, reviewed_at)
    values ('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555',
            'missing_context', 'Synthetic closed report without reason.', 'closed', now());
    raise exception 'Closed report unexpectedly had no resolution note';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'closed report requires a review date and resolution note');

select ok((select relrowsecurity from pg_class where oid = 'terra_private.correction_reports'::regclass),
          'private correction table has RLS');
select ok(has_table_privilege('terra_reviewer', 'terra_private.correction_reports', 'SELECT'),
          'reviewer can read private corrections');
select ok(not has_table_privilege('anon', 'terra_private.correction_reports', 'SELECT'),
          'anonymous role cannot read corrections');
select ok(not has_table_privilege('terra_reviewer', 'terra_private.correction_reports', 'INSERT'),
          'reviewer cannot insert a correction through this schema');

select * from finish();
rollback;
