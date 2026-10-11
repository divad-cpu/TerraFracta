"""Encoding a startup packet cannot renew its parent's authorization time."""

import unittest
from unittest.mock import patch

from tests import test_pair_transport_clock as support
from workers import ssb_14059_pair_transport as transport


class PairStartupEncodingTests(unittest.TestCase):
    def test_encoding_expiry_invalid_or_backward_clock_never_sends_startup(self):
        for value in [105.0, float('nan'), 99.0]:
            with self.subTest(value=value):
                helper = support.PairTransportClockTests()
                helper.setUp()
                clock = [100.0]
                process = helper.fixture.process()
                process.poll.return_value = None
                real_dumps = transport.json.dumps

                def encode_startup(record, **kwargs):
                    packet = real_dumps(record, **kwargs)
                    if set(record) == {'kind', 'deadline', 'parentPid'}:
                        clock[0] = value
                    return packet

                result = helper.fixture.result('metadata', helper.fixture.metadata_body)
                with patch.object(transport.json, 'dumps', side_effect=encode_startup), \
                        patch.object(transport, 'communicate_bounded', return_value=result) as communicate:
                    with self.assertRaises(transport.SSB14059PairTransportError):
                        helper.run_parent(clock, launch=lambda *a, **kw: process, communicate=communicate)
                communicate.assert_not_called()
                process.kill.assert_called_once()
                process.wait.assert_called_once()
                for name in ['stdin', 'stdout', 'stderr']:
                    getattr(process, name).close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
