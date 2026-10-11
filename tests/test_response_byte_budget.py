from io import BytesIO
from threading import Event, Thread
import unittest

from workers.response_byte_budget import ResponseBudgetError, ResponseByteBudget


class ResponseByteBudgetTests(unittest.TestCase):
    def test_two_responses_share_measured_bytes_and_release_unused_reservations(self):
        budget = ResponseByteBudget(20)
        self.assertEqual(budget.read_body(BytesIO(b'abc'),max_body_bytes=10),b'abc')
        self.assertEqual(budget.read_body(BytesIO(b'defg'),max_body_bytes=10),b'defg')
        self.assertEqual((budget.snapshot().charged_bytes,budget.snapshot().reserved_bytes,budget.snapshot().remaining_bytes),(7,0,13))

    def test_exact_body_limit_succeeds_but_oversize_probe_counts(self):
        budget = ResponseByteBudget(11)
        self.assertEqual(budget.read_body(BytesIO(b'1234567890'),max_body_bytes=10),b'1234567890')
        self.assertEqual(budget.snapshot().charged_bytes,10)
        exceeded = ResponseByteBudget(11)
        with self.assertRaisesRegex(ResponseBudgetError,'exceeds'):
            exceeded.read_body(BytesIO(b'12345678901more'),max_body_bytes=10)
        self.assertEqual(exceeded.snapshot().charged_bytes,11)
        self.assertEqual(exceeded.snapshot().uncertain_attempts,0)

    def test_budget_refusal_happens_before_any_stream_read(self):
        class NeverRead:
            def read(self,size):
                raise AssertionError('Budget refusal must precede stream reads')
        with self.assertRaisesRegex(ResponseBudgetError,'insufficient'):
            ResponseByteBudget(10).read_body(NeverRead(),max_body_bytes=10)

    def test_failed_read_keeps_full_uncertain_charge_without_private_error(self):
        class Failed:
            def read(self,size):
                raise OSError('fictional-private-response-detail')
        budget = ResponseByteBudget(11)
        with self.assertRaises(ResponseBudgetError) as caught:
            budget.read_body(Failed(),max_body_bytes=10)
        self.assertNotIn('private',str(caught.exception))
        self.assertEqual((budget.snapshot().charged_bytes,budget.snapshot().uncertain_attempts,budget.snapshot().reserved_bytes),(11,1,0))
        with self.assertRaisesRegex(ResponseBudgetError,'insufficient'):
            budget.read_body(BytesIO(b'a'),max_body_bytes=1)

    def test_partial_read_then_failure_is_not_reported_as_success_or_refunded(self):
        class Partial:
            def __init__(self): self.calls=0
            def read(self,size):
                self.calls+=1
                if self.calls==1: return b'abc'
                raise TimeoutError('invented timeout')
        budget = ResponseByteBudget(11)
        with self.assertRaises(ResponseBudgetError): budget.read_body(Partial(),max_body_bytes=10)
        self.assertEqual(budget.snapshot().charged_bytes,11)

    def test_nonbytes_or_overreturn_from_adapter_retains_uncertain_reservation(self):
        for result in ('abc',bytearray(b'abc'),b'x'*12):
            class Bad:
                def read(self,size): return result
            budget=ResponseByteBudget(11)
            with self.assertRaisesRegex(ResponseBudgetError,'contract'): budget.read_body(Bad(),max_body_bytes=10)
            self.assertEqual((budget.snapshot().charged_bytes,budget.snapshot().uncertain_attempts),(11,1))

    def test_cancellation_keeps_reservation_charged(self):
        class Cancelled:
            def read(self,size): raise KeyboardInterrupt()
        budget=ResponseByteBudget(11)
        with self.assertRaises(KeyboardInterrupt): budget.read_body(Cancelled(),max_body_bytes=10)
        self.assertEqual((budget.snapshot().charged_bytes,budget.snapshot().uncertain_attempts),(11,1))

    def test_concurrent_reads_cannot_reserve_the_same_capacity(self):
        entered,release=Event(),Event()
        results=[]
        class Paused(BytesIO):
            def read(self,size):
                entered.set()
                if not release.wait(2): raise TimeoutError()
                return super().read(size)
        budget=ResponseByteBudget(11)
        def work():
            try: results.append(budget.read_body(Paused(b'abc'),max_body_bytes=10))
            except BaseException as error: results.append(error)
        thread=Thread(target=work); thread.start()
        try:
            self.assertTrue(entered.wait(2))
            self.assertEqual(budget.snapshot().reserved_bytes,11)
            with self.assertRaisesRegex(ResponseBudgetError,'insufficient'):
                budget.read_body(BytesIO(b'other'),max_body_bytes=1)
        finally:
            release.set(); thread.join(3)
        self.assertFalse(thread.is_alive()); self.assertEqual(results,[b'abc'])
        self.assertEqual(budget.snapshot().remaining_bytes,8)
        self.assertEqual(budget.read_body(BytesIO(b'other'),max_body_bytes=5),b'other')
        self.assertEqual(budget.snapshot().charged_bytes,8)

    def test_invalid_bounds_fail_closed_without_reservation(self):
        for value in (True,0,-1,50_000_001,1.5,'10',None):
            with self.assertRaises(ResponseBudgetError): ResponseByteBudget(value)
            budget=ResponseByteBudget(20)
            with self.assertRaises(ResponseBudgetError): budget.read_body(BytesIO(b'a'),max_body_bytes=value)
            self.assertEqual(budget.snapshot().remaining_bytes,20)


if __name__=='__main__': unittest.main()
