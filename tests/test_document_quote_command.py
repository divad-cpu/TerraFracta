"""Manual quote CLI public-main faults over private invented temporary files."""
import io
import os
from pathlib import Path
from hashlib import sha256
import tempfile
import unittest
from unittest.mock import patch

from scripts import prepare_document_quote as command


class DocumentQuoteCommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tf-quote-command-unit-')
        self.addCleanup(self.temp.cleanup)
        self.original = Path(self.temp.name) / 'original.txt'
        self.quote = Path(self.temp.name) / 'quote.txt'
        for p, raw in [(self.original, b'First Second First'), (self.quote, b'First')]:
            fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as f: f.write(raw)
        self.args = ['locate', '--original', str(self.original), '--quote', str(self.quote),
                     '--expected-original-sha256', sha256(self.original.read_bytes()).hexdigest(), '--locator', 'section:one']
        self.out, self.err = io.BytesIO(), io.StringIO()
        self.diagnostic = self.enterContext(patch('workers.error_diagnostics.record_worker_error', return_value=True))

    def invoke(self, args=None, stdout=None):
        return command.main(args=self.args if args is None else args,
                            stdout=self.out if stdout is None else stdout, stderr=self.err)

    def test_help_is_static_and_does_not_open_any_file(self):
        with patch.object(command.os, 'open', side_effect=AssertionError('No help I/O')):
            self.assertEqual(self.invoke(['--help']), 0)
        self.assertEqual(self.out.getvalue(), b'')
        self.assertTrue(self.err.getvalue())
        self.diagnostic.assert_not_called()

    def test_argument_refusals_are_fixed_and_do_not_open_files(self):
        vectors = [[], ['FICTIONAL_PRIVATE_ARGUMENT'], self.args + ['--unknown', 'FICTIONAL_PRIVATE_ARGUMENT'],
                   self.args + ['--occurrence-number', '1'], ['--help', 'FICTIONAL_PRIVATE_ARGUMENT'],
                   ['choose'] + self.args[1:],
                   ['choose'] + self.args[1:] + ['--occurrence-number', '0'],
                   ['choose'] + self.args[1:] + ['--occurrence-number', '129'],
                   ['choose'] + self.args[1:] + ['--occurrence-number', 'true']]
        for args in vectors:
            with self.subTest(args=args):
                self.out.seek(0);self.out.truncate();self.err.seek(0);self.err.truncate()
                with patch.object(command.os, 'open', side_effect=AssertionError('Invalid arguments opened file')):
                    self.assertEqual(self.invoke(args), 2)
                self.assertEqual(self.out.getvalue(), b'')
                self.assertEqual(self.err.getvalue(), 'document_quote_preparation_refused\n')
        self.diagnostic.assert_not_called()

    def test_digest_syntax_is_exact_lowercase_and_refuses_before_read(self):
        for digest in ['A' * 64, 'a' * 63, 'a' * 65, 'FICTIONAL_PRIVATE_HASH']:
            args = self.args[:];args[6] = digest
            self.err.seek(0);self.err.truncate()
            with self.subTest(digest=digest), patch.object(command.os, 'open', side_effect=AssertionError('Invalid hash opened file')):
                self.assertEqual(self.invoke(args), 2)
            self.assertEqual(self.err.getvalue(), 'document_quote_preparation_refused\n')
        self.diagnostic.assert_not_called()

    def test_open_flags_prevent_final_symlink_and_blocking_fifo(self):
        real_open=os.open; seen=[]
        def opened(path, flags, *args, **kwargs):
            seen.append(flags);return real_open(path, flags, *args, **kwargs)
        with patch.object(command.os, 'open', side_effect=opened):
            self.assertEqual(self.invoke(), 0)
        self.assertEqual(len(seen), 2)
        self.assertTrue(all(flags & os.O_NOFOLLOW and flags & os.O_NONBLOCK for flags in seen))

    def test_fds_close_after_success_and_input_refusal(self):
        for bad in [False, True]:
            self.out=io.BytesIO();self.err=io.StringIO();fds=[];real_open=os.open
            def opened(*args, **kwargs):
                fd=real_open(*args, **kwargs);fds.append(fd);return fd
            args=self.args[:]
            if bad:args[6]='0'*64
            with patch.object(command.os, 'open', side_effect=opened):
                self.assertEqual(self.invoke(args), 2 if bad else 0)
            self.assertTrue(1 <= len(fds) <= 2)
            for fd in fds:
                with self.assertRaises(OSError):os.fstat(fd)

    def test_changed_original_after_search_refuses_before_output(self):
        actual=command.locate_document_quote
        def changed(*args, **kwargs):
            found=actual(*args, **kwargs)
            self.original.write_bytes(b'FICTIONAL_PRIVATE_REPLACEMENT')
            return found
        with patch.object(command, 'locate_document_quote', side_effect=changed):
            self.assertEqual(self.invoke(), 2)
        self.assertEqual(self.out.getvalue(), b'')
        self.assertEqual(self.err.getvalue(), 'document_quote_preparation_refused\n')
        self.diagnostic.assert_not_called()

    def test_named_file_replacement_after_search_refuses_even_with_same_bytes(self):
        actual=command.locate_document_quote
        def replaced(*args, **kwargs):
            found=actual(*args, **kwargs)
            replacement=self.original.with_suffix('.replacement');replacement.write_bytes(self.original.read_bytes());replacement.replace(self.original)
            return found
        with patch.object(command, 'locate_document_quote', side_effect=replaced):
            self.assertEqual(self.invoke(), 2)
        self.assertEqual(self.out.getvalue(), b'')
        self.assertEqual(self.err.getvalue(), 'document_quote_preparation_refused\n')
        self.diagnostic.assert_not_called()

    def test_unexpected_search_fault_uses_fixed_diagnostic_no_private_text(self):
        with patch.object(command, 'locate_document_quote', side_effect=RuntimeError('FICTIONAL_PRIVATE_FAULT')):
            self.assertEqual(self.invoke(), 1)
        self.assertEqual(self.out.getvalue(), b'')
        self.assertEqual(self.err.getvalue(), 'document_quote_preparation_unavailable\n')
        self.diagnostic.assert_called_once_with('collector_worker', directory=None)

    def test_short_output_write_is_unavailable_and_diagnosed(self):
        class ShortOutput:
            def write(self, data): return 0
            def flush(self): pass
        self.assertEqual(self.invoke(stdout=ShortOutput()), 1)
        self.assertEqual(self.err.getvalue(), 'document_quote_preparation_unavailable\n')
        self.diagnostic.assert_called_once_with('collector_worker', directory=None)

    def test_operation_cancellation_identity_survives_and_all_fds_close(self):
        from asyncio import CancelledError
        for kind in [KeyboardInterrupt, SystemExit, CancelledError]:
            self.out=io.BytesIO();self.err=io.StringIO();fds=[];real_open=os.open;failure=kind('FICTIONAL_PRIVATE_CANCEL')
            def opened(*args, **kwargs):
                fd=real_open(*args, **kwargs);fds.append(fd);return fd
            with patch.object(command.os, 'open', side_effect=opened), patch.object(command, 'locate_document_quote', side_effect=failure):
                with self.assertRaises(kind) as caught:self.invoke()
            self.assertIs(caught.exception, failure)
            self.assertEqual(self.out.getvalue(), b'');self.assertEqual(self.err.getvalue(), '')
            self.assertEqual(len(fds), 2)
            for fd in fds:
                with self.assertRaises(OSError):os.fstat(fd)
        self.diagnostic.assert_not_called()


    def test_cancellation_wins_cleanup_fault_and_every_owned_fd_is_attempted(self):
        failure=KeyboardInterrupt('FICTIONAL_PRIVATE_CANCEL')
        opened_fds=[];closed_fds=[];real_open=os.open;real_close=os.close
        def opened(*args, **kwargs):
            fd=real_open(*args, **kwargs);opened_fds.append(fd);return fd
        def closed(fd):
            closed_fds.append(fd);real_close(fd)
            if len(closed_fds)==1:raise OSError('FICTIONAL_PRIVATE_CLOSE_FAULT')
        with patch.object(command.os, 'open', side_effect=opened), patch.object(command.os, 'close', side_effect=closed), patch.object(command, 'locate_document_quote', side_effect=failure):
            with self.assertRaises(KeyboardInterrupt) as caught:self.invoke()
        self.assertIs(caught.exception,failure)
        self.assertEqual(set(closed_fds),set(opened_fds));self.assertEqual(len(opened_fds),2)
        self.assertEqual(self.out.getvalue(),b'');self.assertEqual(self.err.getvalue(),'')
        self.diagnostic.assert_not_called()


    def test_hash_refusal_with_cleanup_fault_is_unavailable_and_attempts_every_fd(self):
        args=self.args[:];args[6]='0'*64
        opened_fds=[];closed_fds=[];real_open=os.open;real_close=os.close
        def opened(*values, **kwargs):
            descriptor=real_open(*values, **kwargs);opened_fds.append(descriptor);return descriptor
        def closed(descriptor):
            closed_fds.append(descriptor);real_close(descriptor)
            if len(closed_fds)==1:raise OSError('FICTIONAL_PRIVATE_CLEANUP_FAULT')
        with patch.object(command.os, 'open', side_effect=opened), patch.object(command.os, 'close', side_effect=closed):
            result=self.invoke(args)
        self.assertEqual(len(opened_fds),2)
        self.assertEqual(set(closed_fds),set(opened_fds))
        for descriptor in opened_fds:
            with self.assertRaises(OSError):os.fstat(descriptor)
        self.assertEqual(self.out.getvalue(),b'')
        self.assertEqual(result,1)
        self.assertEqual(self.err.getvalue(),'document_quote_preparation_unavailable\n')
        self.diagnostic.assert_called_once_with('collector_worker',directory=None)


if __name__ == '__main__':unittest.main()
