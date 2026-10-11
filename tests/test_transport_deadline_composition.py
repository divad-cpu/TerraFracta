"""Current transport components compose using invented ledgers/bodies only."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic
import unittest
from unittest.mock import patch

from tests import test_reserved_ssb_capture as ledger_fixtures
from tests import test_ssb_14059_transport as http_fixtures
from tests.frozen_ssb_support import frozen_at
from workers import reserved_ssb_capture as reserved
from workers import ssb_14059_pair_transport as pair
from workers import ssb_14059_transport as http
from workers import ssb_sealed_transport as sealed
from workers import fixed_ssb_transport_broker as fixed
from workers.fixed_ssb_transport_broker import FixedSSBTransportBroker
from workers.ssb_14059_capture import CapturedResponse, METADATA_URL, DATA_URL
from workers.ssb_frozen_runtime import FrozenFixtureTransportBroker


class TransportDeadlineCompositionTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc)
        self.helper = ledger_fixtures.ReservedSSBTests()
        self.helper.setUp()
        self.helper.ticks = monotonic()
        first, second = ledger_fixtures.contexts()
        work = replace(first.work, observed_at=self.now, lease_expires_at=self.now+timedelta(seconds=30),
                       deadline_at=self.now+timedelta(seconds=300))
        self.contexts = [replace(item, work=work) for item in [first, second]]
        self.children = []

    def capture_pair(self, broker, *, clock=monotonic):
        with patch.object(ledger_fixtures, 'NOW', self.now):
            return reserved.capture_reserved_ssb_pair(*self.contexts, self.helper.factory, broker,
                utc_now=lambda: datetime.now(timezone.utc), monotonic=clock)

    def assert_measured(self, responses):
        self.assertEqual([response.kind for response in responses], ['metadata', 'data'])
        for expected, response in zip(self.contexts, responses, strict=True):
            charge = self.helper.ledgers[expected.request_key].charge
            self.assertEqual(charge['outcome'], 'measured')
            self.assertEqual(charge['body_bytes'], len(response.capture.body))
            self.assertEqual(charge['content_sha256'], sha256(response.capture.body).hexdigest())
            self.assertIn((expected.request_key, 'confirm:dispatch'), self.helper.events)

    def launch_invented(self, original_popen):
        def launch(argv, **kwargs):
            kind = argv[-1]
            url = METADATA_URL if kind == 'metadata' else DATA_URL
            capture = CapturedResponse(url, url, 0, 200, 'application/json', self.helper.wires[kind], self.now)
            packet = pair._encode_capture(kind, capture)
            code = ('import sys,json\nfrom datetime import datetime,timezone\n'
                    'sys.stdin.buffer.read()\nrecord=json.loads('+repr(packet)+')\n'
                    'record["retrieved_at"]=datetime.now(timezone.utc).isoformat()\n'
                    'sys.stdout.buffer.write(json.dumps(record,separators=(",",":")).encode("ascii"))\n')
            child = original_popen([sys.executable, '-B', '-c', code], **kwargs)
            self.children.append(child)
            return child
        return launch

    def assert_children_closed(self):
        self.assertEqual(len(self.children), 2)
        for child in self.children:
            self.assertEqual(child.returncode, 0)
            self.assertTrue(all(getattr(child, name).closed for name in ['stdin', 'stdout', 'stderr']))

    def test_reserved_fixed_parent_and_actual_invented_pipes_measure_exact_bodies(self):
        original_popen = subprocess.Popen
        with patch.object(pair.subprocess, 'Popen', side_effect=self.launch_invented(original_popen)):
            responses = self.capture_pair(FixedSSBTransportBroker())
        self.assert_measured(responses)
        self.assert_children_closed()

    def test_reserved_fixed_single_https_primitives_compose_without_http(self):
        class InMemoryBroker(FixedSSBTransportBroker):
            def _capture(self, kind, *, deadline):
                return http.fetch_ssb_14059_once(kind, deadline=deadline)

        def opener():
            class FixedOpener:
                def open(_self, request, *, timeout):
                    kind = 'metadata' if request.full_url == METADATA_URL else 'data'
                    self.assertIn(request.full_url, [METADATA_URL, DATA_URL])
                    self.assertTrue(0 < timeout <= 10)
                    return http_fixtures.FakeResponse(request.full_url, self.helper.wires[kind])
            return FixedOpener()

        with patch.object(http, '_build_opener', side_effect=opener):
            responses = self.capture_pair(InMemoryBroker())
        self.assert_measured(responses)
        self.assertEqual(self.children, [])

    def test_advancing_authority_and_elapsed_metadata_preserve_tighter_pair_deadline(self):
        for data_authority, expected_deadlines in [(10, [9, 9]), (3, [9, 2.5])]:
            with self.subTest(data_authority=data_authority):
                self.setUp()
                tick=[0.]
                observations=[0]
                def now():
                    observations[0]+=1
                    return self.now+timedelta(seconds=tick[0],microseconds=observations[0])
                def factory(expected):
                    backend=self.helper.factory(expected)
                    backend.utc_now=now
                    backend.monotonic=lambda:tick[0]
                    original=backend.confirmer.confirm
                    def confirm(phase,receipt):
                        value=json.loads(original(phase,receipt))
                        observed=now()
                        duration=10 if expected.endpoint==METADATA_URL else data_authority
                        value['observedAt']=observed.isoformat()
                        value['authorityExpiresAt']=(observed+timedelta(seconds=duration)).isoformat()
                        return json.dumps(value).encode()
                    backend.confirmer.confirm=confirm
                    return backend
                calls=[]
                class InMemoryBroker(FixedSSBTransportBroker):
                    def _capture(_self,kind,*,deadline):
                        calls.append(deadline)
                        return http.fetch_ssb_14059_once(kind,deadline=deadline)
                class LocalDateTime:
                    @staticmethod
                    def now(zone):
                        self.assertIs(zone,timezone.utc)
                        return now()
                def opener():
                    class Response(http_fixtures.FakeResponse):
                        def __exit__(_self,*args):
                            super().__exit__(*args)
                            if _self.url==METADATA_URL:tick[0]=.5
                    class Open:
                        def open(_self,request,*,timeout):
                            kind='metadata' if request.full_url==METADATA_URL else 'data'
                            self.assertIn(request.full_url,[METADATA_URL,DATA_URL])
                            self.assertTrue(0<timeout<=10)
                            return Response(request.full_url,self.helper.wires[kind])
                    return Open()
                with patch.object(ledger_fixtures,'NOW',self.now), \
                        patch.object(fixed,'monotonic',side_effect=lambda:tick[0]), \
                        patch.object(http,'monotonic',side_effect=lambda:tick[0]), \
                        patch.object(http,'datetime',LocalDateTime), \
                        patch.object(http,'_build_opener',side_effect=opener):
                    responses=reserved.capture_reserved_ssb_pair(*self.contexts,factory,InMemoryBroker(),
                        utc_now=now,monotonic=lambda:tick[0])
                self.assertEqual(calls,expected_deadlines)
                self.assert_measured(responses)

    def test_reserved_sealed_source_and_actual_fixed_invented_children_compose(self):
        with TemporaryDirectory(prefix='tf-current-transport-composition-') as temporary:
            source = frozen_at(Path(temporary)/'source')
            try:
                original_popen = subprocess.Popen
                def launch(*args, **kwargs):
                    child = original_popen(*args, **kwargs)
                    self.children.append(child)
                    return child
                broker = FrozenFixtureTransportBroker(source, context_sha256='a'*64)
                with patch.object(sealed.subprocess, 'Popen', side_effect=launch):
                    responses = self.capture_pair(broker)
                self.assert_measured(responses)
                self.assertEqual(broker.response_kinds, ['metadata', 'data'])
                self.assertEqual(sha256(source.check()).hexdigest(), source.archive_sha256)
                self.assert_children_closed()
            finally:
                source.close()

    def test_final_parser_refusal_preserves_measured_debt_after_actual_invented_pipes(self):
        clock = [monotonic()]
        self.helper.ticks = clock[0]
        original_popen = subprocess.Popen
        parser = reserved.parse_captured_ssb_14059

        def invalid_clock(capture):
            parsed = parser(capture)
            clock[0] = float('nan')
            return parsed

        with patch.object(pair.subprocess, 'Popen', side_effect=self.launch_invented(original_popen)), \
                patch.object(reserved, 'parse_captured_ssb_14059', side_effect=invalid_clock):
            with self.assertRaises(ValueError):
                self.capture_pair(FixedSSBTransportBroker(), clock=lambda: clock[0])
        for expected in self.contexts:
            charge = self.helper.ledgers[expected.request_key].charge
            self.assertEqual(charge['outcome'], 'measured')
        self.assert_children_closed()


if __name__ == '__main__':
    unittest.main()
