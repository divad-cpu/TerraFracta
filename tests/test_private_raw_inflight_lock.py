"""Actual advisory lock must outlive an already running owned storage call."""
import threading
import unittest
from unittest.mock import patch

from tests import test_ssb_14059_raw_custody as support
from workers.ssb_14059_raw_custody import PrivateRawCustody,PrivateRawCustodyError
from workers.ssb_14059_raw_store import store_private_ssb_14059_pair


class InflightRawLockTests(unittest.TestCase):
    def setUp(self):
        helper=support.PrivateRawCustodyTests();helper.setUp();self.addCleanup(helper.doCleanups)
        self.root,self.responses,self.now=helper.root,helper.responses,helper.now

    def test_inflight_storage_keeps_os_lock_after_caller_context_has_closed(self):
        entered=threading.Event();release=threading.Event();saved=[];errors=[]
        custody=PrivateRawCustody(self.root,utc_now=lambda:self.now);custody.__enter__()
        def delayed(*args,**options):
            entered.set()
            if not release.wait(timeout=2):raise ValueError('Invented delayed operation timed out')
            return store_private_ssb_14059_pair(*args,**options)
        def store():
            try:saved.append(custody.store(*self.responses,now=self.now))
            except BaseException as error:errors.append(type(error).__name__)
        thread=threading.Thread(target=store)
        with patch('workers.ssb_14059_raw_custody.store_private_ssb_14059_pair',side_effect=delayed):
            thread.start()
            try:
                self.assertTrue(entered.wait(timeout=1));custody.__exit__()
                # A terminal caller must not expose the root to another
                # coordinated client while its original fsync is still active.
                with self.assertRaises(PrivateRawCustodyError):
                    with PrivateRawCustody(self.root,utc_now=lambda:self.now):pass
                with self.assertRaises(PrivateRawCustodyError):custody.inventory(now=self.now)
            finally:
                custody.__exit__();release.set();thread.join(timeout=2)
        self.assertFalse(thread.is_alive());self.assertEqual(errors,[]);self.assertEqual(len(saved),1)
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as next_custody:
            self.assertEqual(next_custody.read(saved[0].attempt_id,now=self.now).data_response,self.responses[1])


if __name__=='__main__':unittest.main()
