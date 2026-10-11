\set ON_ERROR_STOP on
begin;
-- Entirely synthetic rows; the transaction is rolled back after the one JSON read.
-- Local owner impersonates the NOLOGIN reader only inside this transaction.
grant terra_issue_reader to postgres;
insert into terra_private.jurisdictions
  (id, display_name, coverage_state, public_slug)
values ('TF-BRIDGE-SAMPLE', 'Fictional bridge place', 'published', 'fictional-place');
insert into terra_private.issue_dossiers
  (id, jurisdiction_id, issue_key, title, affected_population, selection_rationale,
   editorial_state, public_slug)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TF-BRIDGE-SAMPLE',
        'bridge-sample', 'Fictional bridge issue', 'Fictional group',
        'Structural local test', 'accepted', 'sample-issue');
insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint, registration_state, allow_public_derived, reviewed_at)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'fictional-bridge-source',
        'Fictional publisher', 'https://example.org/source', 'approved', true,
        '2026-09-24T12:00:00Z');
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, published_at, retrieved_at, content_sha256)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'fictional-item',
        'https://example.org/source', '2026-09-20T00:00:00Z',
        '2026-09-25T12:00:00Z', repeat('a', 64));
-- Synthetic accepted-looking decision is confined to this rolled-back test.
insert into terra_private.source_display_reviews
  (source_version_id, revision, decision, display_title, title_language,
   reviewed_at, review_reference)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1, 'accepted',
        'Fictional table', 'en', '2026-09-25T12:30:00Z',
        'synthetic-bridge-only');
insert into terra_private.claims
  (id, issue_id, claim_type, assertion, evidence_state, created_at)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'condition',
        'A fictional condition is stated for a sample period.', 'supported',
        '2026-09-25T12:00:00Z');
insert into terra_private.claim_evidence
  (claim_id, source_version_id, locator, relation, origin_group)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Example cell A1', 'supports',
        'fictional-original');
insert into terra_private.issue_publications
  (id, issue_id, revision, publication_kind, snapshot, dependency_manifest,
   created_at)
values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 'accepted',
  $json${
    "schemaVersion": 1,
    "jurisdictionSlug": "fictional-place",
    "issueSlug": "sample-issue",
    "title": "Fictional bridge issue",
    "summary": "Only synthetic database records are used in this local test.",
    "lastEvidenceReviewOn": "2026-09-25",
    "claims": [{
      "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "type": "condition",
      "assertion": "A fictional condition is stated for a sample period.",
      "periodLabel": "Example period",
      "evidence": [{
        "sourceVersionId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "publisher": "Fictional publisher",
        "title": "Fictional table",
        "url": "https://example.org/source",
        "locator": "Example cell A1",
        "relation": "supports",
        "sourcePublishedOn": "2026-09-20",
        "retrievedAt": "2026-09-25T12:00:00Z"
      }]
    }]
  }$json$::jsonb,
  '{"sourceVersionIds":["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]}'::jsonb,
  '2026-09-25T12:00:00Z'
);
-- Accepted-looking claim, period and issue text are fictional and rolled back.
insert into terra_private.claim_assertion_reviews
  (publication_id, claim_id, revision, decision, claim_type,
   display_assertion, reviewed_at, review_reference)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, 'accepted',
        'condition', 'A fictional condition is stated for a sample period.',
        '2026-09-25T12:50:00Z', 'synthetic-bridge-only');
insert into terra_private.claim_period_reviews
  (publication_id, claim_id, revision, decision, period_label,
   reviewed_at, review_reference)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, 'accepted',
        'Example period', '2026-09-25T12:40:00Z',
        'synthetic-bridge-only');
insert into terra_private.issue_text_reviews
  (publication_id, revision, decision, display_title, display_summary,
   reviewed_at, review_reference)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 1, 'accepted',
        'Fictional bridge issue',
        'Only synthetic database records are used in this local test.',
        '2026-09-25T13:00:00Z', 'synthetic-bridge-only');
insert into terra_private.issue_publication_citations
  (publication_id, issue_id, claim_id, source_version_id, locator, relation)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Example cell A1', 'supports');
insert into terra_private.issue_heads
  (issue_id, current_publication_id, changed_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '2026-09-25T13:00:00Z');
