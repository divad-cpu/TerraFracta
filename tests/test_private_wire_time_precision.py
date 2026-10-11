"""Invented private wire times cannot borrow exact instants through truncation."""
from datetime import datetime, timedelta, timezone
from copy import deepcopy
from base64 import b64encode
import json
import unittest

from tests.frozen_ssb_support import admitted_context
from tests.test_native_pair_admission import admission_fixture
from workers.native_pair_admission import confirm_native_pair_admission
from workers.closed_ssb_worker import parse_closed_ssb_context
from workers.closed_pair_channel import validate_operation, PairChannelError
from workers.private_attempt_readiness import utc_time, cleanup_health, readiness_record
from workers.ssb_14059_raw_binding_receipt import parse_raw_binding
from workers.ssb_14059_recovery import ExpectedRawPair

NOW = datetime(2026, 10, 2, 10, tzinfo=timezone.utc)
PIN = 'a' * 64


def extra(value, fraction='0000001'):
    return value.replace('+00:00', '.' + fraction + '+00:00')


class PrivateWireTimePrecisionTests(unittest.TestCase):
    def setUp(self):
        self.raw_context, self.expected = admitted_context(PIN, now=NOW)
        self.admission = admission_fixture(self.raw_context, PIN, NOW)

    def confirm(self, value):
        return confirm_native_pair_admission(json.dumps(value).encode(), self.raw_context, PIN, now=NOW)

    def test_future_observation_and_changed_lease_deadline_scope_cannot_collapse(self):
        for field in ('observedAt', 'leaseExpiresAt', 'deadlineAt', 'scopeExpiresAt'):
            for fraction in ('0000001', '0000000', '000000000000001'):
                with self.subTest(field=field, fraction=fraction), self.assertRaises(ValueError):
                    self.confirm({**self.admission, field:extra(self.admission[field], fraction)})

    def test_supported_equivalent_native_spellings_preserve_all_identity(self):
        for fraction in ('', '.0', '.000001', '.123456'):
            # Exact nonzero observations need a matching independently supplied now/context.
            moment = NOW if not fraction else NOW.replace(microsecond=int((fraction[1:]+'000000')[:6]))
            raw, _ = admitted_context(PIN, now=moment)
            value = admission_fixture(raw, PIN, moment)
            for field in ('observedAt', 'leaseExpiresAt', 'deadlineAt', 'scopeExpiresAt'):
                value[field] = value[field].replace('+00:00', 'Z')
            result = confirm_native_pair_admission(json.dumps(value).encode(), raw, PIN, now=moment)
            self.assertEqual(result.observed_at, moment)
            self.assertEqual(result.context.metadata.work.observed_at, moment)
            self.assertEqual(result.source_fingerprint, PIN)

    def test_invented_work_context_rejects_precision_loss_before_response_admission(self):
        value = json.loads(self.raw_context)
        for field in ('observed_at', 'lease_expires_at', 'deadline_at'):
            changed=deepcopy(value); changed['work'][field]=extra(changed['work'][field])
            with self.subTest(field=field), self.assertRaises(ValueError):
                parse_closed_ssb_context(json.dumps(changed).encode(), now=NOW)

    def test_legacy_default_string_context_separator_remains_compatible(self):
        value=json.loads(self.raw_context)
        for key in ('observed_at','lease_expires_at','deadline_at'):
            self.assertEqual(value['work'][key][10], ' ')
        parsed=parse_closed_ssb_context(self.raw_context,now=NOW)
        self.assertEqual(parsed.metadata,self.expected['metadata'])
        self.assertEqual(parsed.data,self.expected['data'])

    def test_work_context_keeps_existing_valid_minute_offset_normalization(self):
        value=json.loads(self.raw_context); offset=timezone(timedelta(hours=5,minutes=45))
        for field in ('observed_at', 'lease_expires_at', 'deadline_at'):
            value['work'][field]=datetime.fromisoformat(value['work'][field]).astimezone(offset).isoformat()
        parsed=parse_closed_ssb_context(json.dumps(value).encode(),now=NOW)
        self.assertEqual(parsed.metadata,self.expected['metadata'])
        self.assertEqual(parsed.data,self.expected['data'])

    def test_pair_store_rejects_extra_precision_before_admitting_operation(self):
        value={'metadata':b64encode(b'{}').decode(),'data':b64encode(b'{}').decode(),
               'metadataRetrievedAt':NOW.isoformat(),'dataRetrievedAt':NOW.isoformat(),'manifest':'{}'}
        for field in ('metadataRetrievedAt','dataRetrievedAt'):
            for fraction in ('0000001','0000000'):
                with self.subTest(field=field,fraction=fraction), self.assertRaises(PairChannelError):
                    validate_operation('store_pair',{**value,field:extra(value[field],fraction)})

    def test_pair_store_preserves_exact_utc_forms_and_existing_order_checks(self):
        value={'metadata':b64encode(b'{}').decode(),'data':b64encode(b'{}').decode(),
               'metadataRetrievedAt':'2026-10-02T10:00:00.000001Z',
               'dataRetrievedAt':'2026-10-02T10:00:00.000002+00:00','manifest':'{}'}
        validate_operation('store_pair',value)
        with self.assertRaises(PairChannelError):
            validate_operation('store_pair',{**value,'dataRetrievedAt':'2026-10-02T10:00:00Z'})

    def test_unsupported_iso_spellings_cannot_form_native_receipts_or_readiness_times(self):
        values=('2026-10-02 10:00:00Z','2026-W40-5T10:00:00Z','20261002T100000Z',
                '2026-10-02T10:00:00,000001Z','2026-10-02T10:00:00+00:00:00',
                '2026-10-02T10:00:00+00:00:00.1')
        for value in values:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):utc_time(value)
                with self.assertRaises(ValueError):self.confirm({**self.admission,'observedAt':value})


class PrivateHealthTimePrecisionTests(unittest.TestCase):
    def setUp(self):
        base={'schemaVersion':1,'evidenceKind':'private_raw_cleanup_run',
              'runId':'20261002T100000000000Z-'+'b'*32,'startedAt':NOW.isoformat(),
              'sourceRequests':0,'databaseChanged':False,'physicalDeadlineGuaranteed':False}
        self.start={**base,'state':'running'}
        self.finish={**base,'state':'completed','finishedAt':NOW.isoformat(),'elapsedSeconds':0.01,
                     'expiredAttemptsObserved':0,'attemptsRemoved':0,'activeAttemptsRemaining':0}

    def test_future_finished_cleanup_does_not_become_a_recent_success(self):
        for fraction in ('0000001','0000000','0000000001'):
            finish={**self.finish,'finishedAt':extra(self.finish['finishedAt'],fraction)}
            result=cleanup_health(finish,self.start,finish,observed_at=NOW.isoformat())
            self.assertEqual(result['state'],'held')
            self.assertNotIn('finishedAt',result)

    def test_changed_start_cannot_borrow_the_run_id_timestamp(self):
        start={**self.start,'startedAt':extra(self.start['startedAt'])}
        finish={**self.finish,'startedAt':start['startedAt']}
        self.assertEqual(cleanup_health(finish,start,finish,observed_at=NOW.isoformat())['state'],'held')

    def test_observer_time_refuses_precision_loss_instead_of_certifying_health(self):
        with self.assertRaises(ValueError):
            cleanup_health(self.finish,self.start,self.finish,observed_at=extra(NOW.isoformat()))

    def test_supported_microseconds_keep_exact_health_age_limits(self):
        finish={**self.finish,'finishedAt':'2026-10-02T10:00:00.000001Z'}
        self.assertEqual(cleanup_health(finish,self.start,finish,observed_at='2026-10-02T10:20:00.000001Z')['state'],'observed')
        self.assertEqual(cleanup_health(finish,self.start,finish,observed_at='2026-10-02T10:20:00.000002Z')['state'],'held')

    def test_readiness_never_gains_permission_and_refuses_unrepresentable_time(self):
        options=dict(snapshot_verified=True,unit_bytes_verified=True,manager={},health={},raw_folder={},copy_policy={})
        with self.assertRaises(ValueError):readiness_record(observed_at=extra(NOW.isoformat()),**options)
        result=readiness_record(observed_at=NOW.isoformat(),**options)
        self.assertEqual(result['state'],'held');self.assertIs(result['machinePermissionIssued'],False)
        self.assertEqual(result['sourceRequests'],0);self.assertIs(result['publicationEnabled'],False)


class PrivateBindingTimePrecisionTests(unittest.TestCase):
    def setUp(self):
        self.pair='11111111-1111-4111-8111-111111111111'
        self.versions={'metadata':'22222222-2222-4222-8222-222222222222','data':'33333333-3333-4333-8333-333333333333'}
        self.expected=ExpectedRawPair('a'*32,'b'*64,'c'*64,NOW+timedelta(days=30),NOW,NOW+timedelta(seconds=1),NOW+timedelta(seconds=2))
        e=self.expected
        self.value={'schemaVersion':1,'pairId':self.pair,'rawAttemptId':e.attempt_id,
                    'metadataSha256':e.metadata_sha256,'dataSha256':e.data_sha256,
                    'metadataVersionId':self.versions['metadata'],'dataVersionId':self.versions['data'],
                    'metadataRetrievedAt':e.metadata_retrieved_at.isoformat(),'dataRetrievedAt':e.data_retrieved_at.isoformat(),
                    'storedAt':e.stored_at.isoformat(),'expiresAt':e.expires_at.isoformat()}

    def parse(self,value):
        return parse_raw_binding(json.dumps(value).encode(),pair_id=self.pair,versions=self.versions,expected=self.expected)

    def test_different_custody_times_cannot_borrow_exact_saved_identity(self):
        for field in ('metadataRetrievedAt','dataRetrievedAt','storedAt','expiresAt'):
            for fraction in ('0000001','0000000'):
                with self.subTest(field=field,fraction=fraction),self.assertRaises(ValueError):
                    self.parse({**self.value,field:extra(self.value[field],fraction)})

    def test_equivalent_zero_fraction_and_utc_forms_keep_exact_binding(self):
        for fraction in ('0','00','000000'):
            value={**self.value}
            for field in ('metadataRetrievedAt','dataRetrievedAt','storedAt','expiresAt'):
                value[field]=extra(value[field],fraction).replace('+00:00','Z')
            self.assertEqual(self.parse(value),self.expected)

    def test_non_utc_offsets_and_invalid_calendars_remain_refused(self):
        for value in ('2026-10-02T10:00:00+01:00','2026-02-30T10:00:00Z','2026-10-02T10:00:60Z',True,123,None):
            with self.subTest(value=value),self.assertRaises(ValueError):
                self.parse({**self.value,'metadataRetrievedAt':value})
