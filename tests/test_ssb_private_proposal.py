"""Accepted inactive annual representation: source/decision/base refusals."""
from dataclasses import replace
from datetime import timedelta
from unittest import TestCase
from tests.helpers.ssb_private_proposal_fixture import fixture, ident
from workers.ssb_14059_private_proposal import prepare_private_ssb_proposal


class PrivateProposalTests(TestCase):
    def test_valid_but_unwitnessed_metadata_uuid_refuses(self):
        args = fixture()
        args['sources'] = (replace(args['sources'][0], source_version_id=ident(99)), args['sources'][1])
        with self.assertRaises(ValueError):
            prepare_private_ssb_proposal(**args)

    def test_independent_pair_membership_is_required(self):
        args = fixture()
        for pair in (None, replace(args['pair'], run_id=ident(99)), replace(args['pair'], pair_id=ident(99)),
                replace(args['pair'], metadata_version_id=ident(99)), replace(args['pair'], data_version_id=ident(99))):
            with self.subTest(pair=pair), self.assertRaises(ValueError):
                prepare_private_ssb_proposal(**{**args, 'pair': pair})

    def test_two_annual_private_snapshots_use_exact_codes_and_decision_date(self):
        for year, lower, upper in ((2024, '30.1', '12.8'), (2025, '29.3', '11.6')):
            args = fixture(year); payload = prepare_private_ssb_proposal(**args)
            self.assertEqual(payload['kind'], 'review_only')
            self.assertEqual(payload['translation'], {'displayLanguage': 'en', 'status': 'unreviewed'})
            self.assertEqual(payload['conflictCoverage'], 'not_recorded')
            snap = payload['snapshot']; self.assertEqual(snap['lastEvidenceReviewOn'], '2026-10-06')
            self.assertNotEqual(snap['lastEvidenceReviewOn'], args['now'].date().isoformat())
            self.assertEqual(snap['title'], 'Private review: SSB 14059 housing-expense variables')
            self.assertIn('does not represent a human or editorial review of this proposal.', snap['summary'])
            self.assertEqual(len(snap['claims']), 1); claim = snap['claims'][0]
            self.assertEqual(claim['id'], args['claim_id'])
            self.assertEqual(claim['assertion'], f'For survey year {year}, the fixed SSB 14059 response for EierStatus=0 reports Boutg4={lower} percent and Boutg5={upper} percent. The English band-boundary meaning remains unreviewed.')
            self.assertEqual(claim['periodLabel'], f'Survey year {year}')
            self.assertEqual([e['relation'] for e in claim['evidence']], ['supports', 'context'])
            self.assertTrue(all(e['sourcePublishedOn'] is None for e in claim['evidence']))
            self.assertEqual(set(payload['dependencyManifest']['sourceVersionIds']), {ident(4), ident(5)})
            self.assertEqual(claim['evidence'][0]['locator'], args['decision'].evidence_locator)
            self.assertNotIn('733', claim['assertion']); self.assertNotIn('744', claim['assertion'])
            self.assertNotIn('42.9', claim['assertion']); self.assertNotIn('40.9', claim['assertion'])

    def test_foreign_missing_or_relabelled_source_witness_refuses(self):
        for change in ({'run_id': ident(99)}, {'pair_id': ident(99)}, {'source_key': 'unknown'},
                {'content_sha256': 'a'*64}, {'source_url': 'https://example.org/foreign'},
                {'retrieved_at': fixture()['now']}, {'retrieved_at': fixture()['now'].replace(tzinfo=None)}):
            args = fixture(); args['sources'] = (replace(args['sources'][0], **change), args['sources'][1])
            with self.subTest(change=change), self.assertRaises(ValueError): prepare_private_ssb_proposal(**args)
        for sources in ((), None, (fixture()['sources'][0],)*2, list(fixture()['sources'])):
            args = fixture(); args['sources'] = sources
            with self.subTest(sources=sources), self.assertRaises(ValueError): prepare_private_ssb_proposal(**args)

    def test_wrong_annual_committed_decision_refuses(self):
        args = fixture()
        for change in ({'run_id': ident(99)}, {'pair_id': ident(99)}, {'disposition': 'eligible'},
                {'item_key': 'ssb-14059-year-2026'}, {'content_sha256': 'a'*64}, {'source_version_id': ident(4)},
                {'semantic_contract_sha256': 'a'*64}, {'evidence_locator': 'other row'}, {'reason_codes': ()},
                {'decided_at': args['raw_binding'].stored_at-timedelta(microseconds=1)},
                {'decided_at': args['now']+timedelta(microseconds=1)}, {'decided_at': args['now'].replace(tzinfo=None)}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                prepare_private_ssb_proposal(**{**args, 'decision': replace(args['decision'], **change)})

    def test_missing_foreign_stale_and_incomplete_head_witness_refuses(self):
        args = fixture()
        for target in (None, replace(args['target'], jurisdiction_id='foreign'), replace(args['target'], issue_slug='foreign'),
                replace(args['target'], jurisdiction_slug='foreign'), replace(args['target'], observed_at=args['decision'].decided_at-timedelta(microseconds=1)),
                replace(args['target'], observed_at=args['now']+timedelta(microseconds=1)),
                replace(args['target'], publication_id=ident(70)), replace(args['target'], content_sha256='a'*64),
                replace(args['target'], issue_created_at=args['now']+timedelta(microseconds=1))):
            with self.subTest(target=target), self.assertRaises(ValueError): prepare_private_ssb_proposal(**{**args, 'target': target})

    def test_known_base_is_validated_without_changing_the_private_payload(self):
        args = fixture(); original = prepare_private_ssb_proposal(**args)
        base = replace(args['target'], publication_id=ident(70), content_sha256='a'*64, head_changed_at=args['decision'].decided_at)
        self.assertEqual(prepare_private_ssb_proposal(**{**args, 'target': base}), original)
        for changed in (replace(base, head_changed_at=args['now']+timedelta(microseconds=1)), replace(base, publication_id='invalid'), replace(base, content_sha256='bad')):
            with self.assertRaises(ValueError): prepare_private_ssb_proposal(**{**args, 'target': changed})

    def test_expired_and_changed_raw_custody_and_selected_semantics_refuse(self):
        args = fixture()
        for change in ({'now': args['raw_binding'].expires_at}, {'raw_binding': replace(args['raw_binding'], metadata_sha256='a'*64)},
                {'metadata_response': replace(args['metadata_response'], body=args['metadata_response'].body.replace(b'40-59', b'40-58'))},
                {'data_response': replace(args['data_response'], body=args['data_response'].body.replace(b'30.1', b'30.125'))}):
            with self.subTest(change=list(change)), self.assertRaises(ValueError): prepare_private_ssb_proposal(**{**args, **change})

    def test_output_is_detached_and_keeps_trusted_claim_identity(self):
        args = fixture(); one = prepare_private_ssb_proposal(**args); two = prepare_private_ssb_proposal(**args)
        one['snapshot']['claims'][0]['evidence'][0]['locator'] = 'changed'
        self.assertEqual(two['snapshot']['claims'][0]['evidence'][0]['locator'], args['decision'].evidence_locator)
        self.assertEqual(two['snapshot']['claims'][0]['id'], args['claim_id'])
