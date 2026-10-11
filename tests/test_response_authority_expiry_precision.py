"""Exact expiry fencing before any authorized response opener."""
from datetime import timedelta, timezone
import io
import json
import unittest

from tests.test_source_response_receipts import (
    NOW, RID, context, reservation_payload, dispatch_payload, settlement_payload,
)
from tests.test_response_authority import PRINCIPAL, authority_payload
from tests.test_reserved_response_capture import FakeCommittedBackend
from tests.test_confirmed_response_backend import Confirmer
from workers.response_authority import parse_response_authority
from workers.confirmed_response_backend import ConfirmedResponseBackend
from workers.reserved_response_capture import capture_reserved_response


class AuthorityExpiryPrecisionTests(unittest.TestCase):
    def parse(self, stamp, phase='reserve'):
        receipt = {
            'reserve': reservation_payload,
            'dispatch': dispatch_payload,
            'settle': settlement_payload,
        }[phase]()
        return parse_response_authority(
            authority_payload(receipt, phase, authorityExpiresAt=stamp), context(),
            phase=phase, principal=PRINCIPAL, reservation_id=RID, receipt=receipt, now=NOW,
        )

    def test_every_phase_refuses_unrepresentable_expiry_at_lease_boundary(self):
        base = (NOW + timedelta(seconds=30)).strftime('%Y-%m-%dT%H:%M:%S')
        for phase in ('reserve', 'dispatch', 'settle'):
            for fraction in ('0000001', '0000000', '00000000000000000001'):
                with self.subTest(phase=phase, fraction=fraction):
                    with self.assertRaises(ValueError):
                        self.parse(base + '.' + fraction + '+00:00', phase)

    def test_supported_equivalent_exact_lease_boundaries_remain_valid(self):
        expires = NOW + timedelta(seconds=30)
        base = expires.strftime('%Y-%m-%dT%H:%M:%S')
        for fraction in ('', '.0', '.00', '.000', '.0000', '.00000', '.000000'):
            for suffix in ('Z', '+00:00'):
                with self.subTest(fraction=fraction, suffix=suffix):
                    authority = self.parse(base + fraction + suffix)
                    self.assertEqual(authority.expires_at, expires)
                    self.assertEqual(authority.remaining_seconds(NOW), 30)

    def test_existing_minute_offset_normalization_preserves_exact_microseconds(self):
        expires = NOW + timedelta(seconds=10, microseconds=654321)
        for offset in (timedelta(0), timedelta(hours=5, minutes=45), -timedelta(hours=9, minutes=30)):
            with self.subTest(offset=offset):
                stamp = expires.astimezone(timezone(offset)).isoformat()
                authority = self.parse(stamp)
                self.assertEqual(authority.expires_at, expires)
                self.assertEqual(authority.remaining_seconds(NOW), 10)

    def test_exact_microsecond_overrun_and_short_remaining_window(self):
        with self.assertRaises(ValueError):
            self.parse((NOW + timedelta(seconds=30, microseconds=1)).isoformat())
        authority = self.parse((NOW + timedelta(seconds=1, microseconds=1)).isoformat())
        self.assertEqual(authority.remaining_seconds(NOW), 1)
        self.assertEqual(authority.remaining_seconds(NOW + timedelta(microseconds=2)), 0)

    def test_invalid_expiry_after_fake_commit_never_calls_opener(self):
        stamp = (NOW + timedelta(seconds=30)).strftime('%Y-%m-%dT%H:%M:%S') + '.0000001+00:00'
        for invalid_phase in ('reserve', 'dispatch'):
            with self.subTest(phase=invalid_phase):
                raw = FakeCommittedBackend()
                confirmer = Confirmer(raw)
                valid_confirm = confirmer.confirm

                def confirm(phase, receipt):
                    payload = json.loads(valid_confirm(phase, receipt))
                    if phase == invalid_phase:
                        payload['authorityExpiresAt'] = stamp
                    return json.dumps(payload).encode()

                confirmer.confirm = confirm
                backend = ConfirmedResponseBackend(
                    context(), PRINCIPAL, raw, confirmer,
                    utc_now=lambda: NOW, monotonic=lambda: 0,
                )
                opened = []

                def opener(*args):
                    opened.append(args)
                    return io.BytesIO(b'abc')

                with self.assertRaises(ValueError):
                    capture_reserved_response(
                        context(), backend, backend.authorized_opener(opener),
                        utc_now=lambda: NOW, monotonic=lambda: 0,
                    )
                self.assertEqual(opened, [])
                self.assertNotIn('settle-committed', raw.events)
                self.assertIsNone(backend.authority)

    def test_unsupported_iso_forms_and_non_strings_refuse(self):
        for stamp in (
            '2026-10-01 06:00:10+00:00', '2026-W40-4T06:00:10+00:00',
            '20261001T060010+0000', '2026-10-01T06:00:10,1+00:00',
            '2026-10-01T06:00:10+00:00:00', None, True, 20261001,
        ):
            with self.subTest(stamp=stamp):
                with self.assertRaises(ValueError):
                    self.parse(stamp)


if __name__ == '__main__':
    unittest.main()
