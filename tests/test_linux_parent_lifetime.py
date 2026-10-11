"""Linux parent identity/race checks before request opening, no source access."""
import json
import os
import signal
import unittest
from types import SimpleNamespace
from unittest.mock import Mock,patch
from io import BytesIO
from workers.linux_parent_lifetime import arm_parent_lifetime
from workers.ssb_14059_pair_transport import _serve_child

MODULE='workers.linux_parent_lifetime.'


class LinuxParentLifetimeTests(unittest.TestCase):
    def test_fixed_kernel_signal_and_identity_checked_on_both_sides(self):
        prctl=Mock(return_value=0)
        with patch(MODULE+'ctypes.CDLL',return_value=SimpleNamespace(prctl=prctl)),patch(MODULE+'os.getppid',side_effect=[42,42]):
            arm_parent_lifetime(42)
        prctl.assert_called_once_with(1,signal.SIGKILL,0,0,0)

    def test_wrong_parent_bad_type_or_unsupported_platform_never_arms(self):
        for expected,platform in ((True,'linux'),(1,'linux'),(0,'linux'),(2**31,'linux'),(41,'linux'),(42,'darwin')):
            with self.subTest(expected=expected,platform=platform),patch(MODULE+'sys.platform',platform), \
                 patch(MODULE+'os.getppid',return_value=42),patch(MODULE+'ctypes.CDLL') as library:
                with self.assertRaises(ValueError):arm_parent_lifetime(expected)
                library.assert_not_called()

    def test_already_dead_parent_race_or_kernel_refusal_holds_request(self):
        for sequence,status in (([42,1],0),([42],-1)):
            with self.subTest(status=status),patch(MODULE+'os.getppid',side_effect=sequence), \
                 patch(MODULE+'ctypes.CDLL',return_value=SimpleNamespace(prctl=Mock(return_value=status))):
                with self.assertRaises(ValueError):arm_parent_lifetime(42)

    def test_unavailable_libc_reports_generic_refusal(self):
        with patch(MODULE+'os.getppid',return_value=42),patch(MODULE+'ctypes.CDLL',side_effect=OSError('private-canary')):
            with self.assertRaises(ValueError) as caught:arm_parent_lifetime(42)
        self.assertNotIn('private-canary',str(caught.exception))

    def test_arm_failure_or_time_consumed_by_setup_never_calls_fetcher(self):
        packet=json.dumps({'kind':'metadata','deadline':105,'parentPid':os.getppid()}).encode()
        for failure,times in ((ValueError('fixed unavailable'),[100]),(None,[100,105])):
            fetcher=Mock()
            with self.subTest(failure=type(failure).__name__), \
                 patch('workers.ssb_14059_pair_transport.sys.stdin',SimpleNamespace(buffer=BytesIO(packet))), \
                 patch('workers.ssb_14059_pair_transport.monotonic',side_effect=times), \
                 patch('workers.ssb_14059_pair_transport.arm_parent_lifetime',side_effect=failure):
                self.assertEqual(_serve_child(['--single-response-child','metadata'],fetcher),1)
                fetcher.assert_not_called()


if __name__=='__main__':unittest.main()
