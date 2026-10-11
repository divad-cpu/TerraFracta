\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create temporary table _reader_sample as
select jsonb_build_object(
  'requestedRoute', jsonb_build_object(
    'jurisdictionSlug', 'fictional-place', 'issueSlug', 'sample-issue'),
  'country', jsonb_build_object('id', 'TF-SYNTHETIC'),
  'claims', jsonb_build_array(jsonb_build_object(
    'assertion', 'A fictional bounded assertion.')),
  'citations', jsonb_build_array(jsonb_build_object(
    'locator', 'Example cell A1')),
  'sources', jsonb_build_array(jsonb_build_object(
    'registration', jsonb_build_object('publisher', 'Fictional publisher'),
    'version', jsonb_build_object('source_url',
      'https://example.org/fictional-source')))
) as candidate;

select ok(terra_private.is_bounded_reader_candidate(candidate),
          'fixed short candidate row fields fit the reader budget')
from _reader_sample;
select ok(not terra_private.is_bounded_reader_candidate(
            jsonb_set(candidate, '{claims,0,assertion}',
              to_jsonb(repeat('a', 1201)))),
          'oversized claim assertion is rejected before reader output')
from _reader_sample;
select ok(not terra_private.is_bounded_reader_candidate(
            jsonb_set(candidate, '{sources,0,registration,publisher}',
              to_jsonb(repeat('a', 161)))),
          'oversized publisher is rejected before reader output')
from _reader_sample;
select ok(not terra_private.is_bounded_reader_candidate(
            jsonb_set(candidate, '{sources,0,version,source_url}',
              to_jsonb('https://example.org/' || repeat('a', 2049)))),
          'oversized source URL is rejected before reader output')
from _reader_sample;
select ok(not terra_private.is_bounded_reader_candidate(
            jsonb_set(candidate, '{citations,0,locator}',
              to_jsonb(repeat('a', 301)))),
          'oversized exact locator is rejected before reader output')
from _reader_sample;
select ok(not terra_private.is_bounded_reader_candidate(
            candidate || jsonb_build_object('synthetic-large-field',
              repeat('a', 1310721))),
          'total candidate byte budget is enforced')
from _reader_sample;

select ok(not has_function_privilege('terra_issue_reader',
          'terra_private.read_issue_candidate_prebound(text,text)', 'EXECUTE'),
          'reader cannot call the prebound owner function');
select ok(not has_function_privilege('terra_issue_reader',
          'terra_private.is_bounded_reader_candidate(jsonb)', 'EXECUTE'),
          'reader cannot call the private bound helper');
select ok(has_function_privilege('terra_issue_reader',
          'terra_private.read_issue_candidate(text,text)', 'EXECUTE'),
          'reader keeps only the bounded candidate entry point');
select ok(not has_function_privilege('anon',
          'terra_private.read_issue_candidate(text,text)', 'EXECUTE'),
          'anonymous role cannot call the bounded candidate entry point');
select ok(not (select rolcanlogin from pg_catalog.pg_roles
               where rolname='terra_issue_reader'),
          'candidate reader still has no login');
select ok((select prosecdef and provolatile='s'
                 and proconfig @> array['search_path=pg_catalog, pg_temp']
           from pg_catalog.pg_proc
           where oid='terra_private.read_issue_candidate(text,text)'::regprocedure),
          'bounded wrapper keeps stable owner execution and trusted search path');

select * from finish();
rollback;
