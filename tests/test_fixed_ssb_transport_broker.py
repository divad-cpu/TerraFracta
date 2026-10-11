"""Fixed transport composition, without a network or process launch."""
from dataclasses import replace
import unittest
from unittest.mock import patch
from workers.fixed_ssb_transport_broker import FixedSSBTransportBroker
from workers.ssb_14059_capture import CapturedResponse, METADATA_URL, DATA_URL
from tests import test_reserved_ssb_capture as support

MODULE = 'workers.fixed_ssb_transport_broker.'


class FixedBrokerTests(unittest.TestCase):
    def setUp(self):
        self.shared = support.ReservedSSBTests()
        self.shared.setUp()
        self.responses = {kind: CapturedResponse(url, url, 0, 200, 'application/json',
                          self.shared.wires[kind], support.NOW)
                          for kind, url in (('metadata', METADATA_URL), ('data', DATA_URL))}

    def test_reserved_driver_confirms_each_dispatch_before_fixed_transport(self):
        def transport(kind, *, deadline):
            expected = support.contexts()[0 if kind == 'metadata' else 1]
            self.assertIn((expected.request_key, 'confirm:dispatch'), self.shared.events)
            self.assertEqual(deadline, 10)
            return self.responses[kind]
        with patch(MODULE+'monotonic', return_value=0), patch(MODULE+'_run_one', side_effect=transport) as fetch:
            first, second = self.shared.pair(fetcher=FixedSSBTransportBroker())
        self.assertEqual([c.args[0] for c in fetch.call_args_list], ['metadata', 'data'])
        self.assertEqual((first.capture, second.capture), (self.responses['metadata'], self.responses['data']))

    def test_wrong_order_invalid_deadline_and_replay_never_start_transport(self):
        for kind, deadline in (('data', 10), ('other', 10), ('metadata', True),
                               ('metadata', float('nan')), ('metadata', 11), ('metadata', 0)):
            broker = FixedSSBTransportBroker()
            with self.subTest(kind=kind, deadline=deadline), patch(MODULE+'monotonic', return_value=0), patch(MODULE+'_run_one') as fetch:
                with self.assertRaises(ValueError): broker(kind, deadline=deadline)
                with self.assertRaises(ValueError): broker('metadata', deadline=10)
                fetch.assert_not_called()
        broker = FixedSSBTransportBroker()
        with patch(MODULE+'monotonic', return_value=0), patch(MODULE+'_run_one', side_effect=self.responses.values()) as fetch:
            broker('metadata', deadline=10); broker('data', deadline=9)
            with self.assertRaises(ValueError): broker('data', deadline=9)
            self.assertEqual(fetch.call_count, 2)

    def test_failed_or_invalid_metadata_cannot_authorize_data_or_retry(self):
        for response in (TimeoutError('fixture failure'), replace(self.responses['metadata'], body=b'{}')):
            broker = FixedSSBTransportBroker()
            with self.subTest(response=type(response).__name__), patch(MODULE+'monotonic', return_value=0), \
                    patch(MODULE+'_run_one', side_effect=response if isinstance(response, Exception) else None,
                          return_value=response) as fetch:
                with self.assertRaises((TimeoutError, ValueError)): broker('metadata', deadline=10)
                for kind in ('metadata', 'data'):
                    with self.assertRaises(ValueError): broker(kind, deadline=10)
                self.assertEqual(fetch.call_count, 1)

    def test_second_deadline_cannot_extend_first_budget(self):
        broker = FixedSSBTransportBroker()
        with patch(MODULE+'monotonic', return_value=0), patch(MODULE+'_run_one', return_value=self.responses['metadata']) as fetch:
            broker('metadata', deadline=8)
            with self.assertRaises(ValueError): broker('data', deadline=9)
            self.assertEqual(fetch.call_count, 1)

    def test_late_metadata_validation_stops_before_data(self):
        broker = FixedSSBTransportBroker()
        with patch(MODULE+'monotonic', side_effect=[0, 10, 10]), patch(MODULE+'_run_one', return_value=self.responses['metadata']) as fetch:
            with self.assertRaises(ValueError): broker('metadata', deadline=10)
            with self.assertRaises(ValueError): broker('data', deadline=10)
            self.assertEqual(fetch.call_count, 1)


if __name__=='__main__': unittest.main()
