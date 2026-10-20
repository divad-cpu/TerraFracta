"""Manual bounded local quote preparation; outputs existing span fields only.

Reads only explicitly selected local regular files. It is not a collector,
server upload, source receipt, mapping qualification or publication operation.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
from hashlib import sha256
import json
import os
from re import fullmatch
import stat
import sys

from workers.document_passage_binding import MAX_DOCUMENT_BYTES, _plain
from workers.document_quote_preparation import (
    DocumentQuotePreparationError, locate_document_quote, choose_document_quote_span,
)
from workers.error_diagnostics import diagnostic_worker
from workers.prose_passage_selection import MAX_PASSAGE_BYTES, MAX_PASSAGES

MAX_OUTPUT_BYTES = 128 * 1024
HELP = (
    'Manual local UTF-8 quote preparation. No collection, source approval or publication.\n'
    'Modes: locate | choose\n'
    'Required: --original PATH --quote PATH --expected-original-sha256 HEX --locator LABEL\n'
    'choose also requires --occurrence-number N; locate forbids that option.\n'
    'Output is existing unqualified span fields; retain and qualify original receipts separately.\n'
)


class QuoteCommandRefusal(ValueError):
    """Fixed expected refusal, without arguments, paths or file contents."""


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise QuoteCommandRefusal() from None


class _Once(argparse.Action):
    def __call__(self, parser, namespace, values, option_string=None):
        if getattr(namespace, self.dest, None) is not None:
            raise QuoteCommandRefusal()
        setattr(namespace, self.dest, values)


def _options(args):
    if type(args) not in (list, tuple) or not 1 <= len(args) <= 11 or any(
            type(part) is not str or not 1 <= len(part) <= 4096 for part in args):
        raise QuoteCommandRefusal()
    parser = _Parser(add_help=False, allow_abbrev=False, exit_on_error=False)
    parser.add_argument('mode', choices=('locate', 'choose'))
    for name in ('original', 'quote', 'expected-original-sha256', 'locator'):
        parser.add_argument('--' + name, required=True, action=_Once)
    parser.add_argument('--occurrence-number', action=_Once)
    try:
        options = parser.parse_args(args)
    except argparse.ArgumentError:
        raise QuoteCommandRefusal() from None
    if (not _plain(options.locator, 200)
            or fullmatch('[a-f0-9]{64}', options.expected_original_sha256) is None
            or any(not path or '\x00' in path for path in (options.original, options.quote))):
        raise QuoteCommandRefusal()
    if options.mode == 'locate':
        if options.occurrence_number is not None:
            raise QuoteCommandRefusal()
    else:
        if (options.occurrence_number is None
                or fullmatch('[0-9]{1,3}', options.occurrence_number) is None
                or not 1 <= int(options.occurrence_number) <= MAX_PASSAGES):
            raise QuoteCommandRefusal()
        options.occurrence_number = int(options.occurrence_number)
    return options


def _identity(info):
    return tuple(getattr(info, name) for name in ('st_dev', 'st_ino', 'st_mode',
        'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def _read_file(path, maximum, descriptors):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        raise QuoteCommandRefusal() from None
    descriptors.append(descriptor)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or not 1 <= before.st_size <= maximum:
            raise QuoteCommandRefusal()
        chunks = []
        size = 0
        while size <= maximum:
            block = os.read(descriptor, maximum + 1 - size)
            if not block:
                break
            chunks.append(block)
            size += len(block)
        data = b''.join(chunks)
        if size != before.st_size or _identity(before) != _identity(os.fstat(descriptor)):
            raise QuoteCommandRefusal()
        return data, (descriptor, path, _identity(before))
    except OSError:
        raise QuoteCommandRefusal() from None


def _confirm(observations):
    try:
        for descriptor, path, identity in observations:
            if (identity != _identity(os.fstat(descriptor))
                    or identity != _identity(os.stat(path, follow_symlinks=False))):
                raise QuoteCommandRefusal()
    except OSError:
        raise QuoteCommandRefusal() from None


def _output(options):
    descriptors = []
    primary = None
    try:
        raw, original = _read_file(options.original, MAX_DOCUMENT_BYTES, descriptors)
        quote, selected = _read_file(options.quote, MAX_PASSAGE_BYTES, descriptors)
        if sha256(raw).hexdigest() != options.expected_original_sha256:
            raise QuoteCommandRefusal()
        if options.mode == 'locate':
            value = [asdict(span) for span in locate_document_quote(raw, quote, locator=options.locator)]
        else:
            value = asdict(choose_document_quote_span(raw, quote, locator=options.locator,
                occurrence_number=options.occurrence_number))
        output = (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf8')
        if len(output) > MAX_OUTPUT_BYTES:
            raise QuoteCommandRefusal()
        _confirm((original, selected))
        return output
    except BaseException as error:
        primary = error
        raise
    finally:
        failures = []
        for descriptor in reversed(descriptors):
            try:
                os.close(descriptor)
            except BaseException as error:
                failures.append(error)
        cancellation = next((error for error in failures if not isinstance(error, Exception)), None)
        if cancellation is not None and (primary is None or isinstance(primary, Exception)):
            raise cancellation
        if failures and (primary is None or isinstance(primary,
                (QuoteCommandRefusal, DocumentQuotePreparationError))):
            raise failures[0]


def main(*, args=None, stdout=None, stderr=None):
    args = sys.argv[1:] if args is None else args
    stdout = sys.stdout.buffer if stdout is None else stdout
    stderr = sys.stderr if stderr is None else stderr
    try:
        with diagnostic_worker('collector_worker'):
            if type(args) in (list, tuple) and len(args) == 1 and type(args[0]) is str and args[0] == '--help':
                stderr.write(HELP)
                return 0
            try:
                output = _output(_options(args))
            except (QuoteCommandRefusal, DocumentQuotePreparationError):
                stderr.write('document_quote_preparation_refused\n')
                return 2
            written = stdout.write(output)
            if type(written) is not int or written != len(output):
                raise OSError('quote_output_incomplete')
            stdout.flush()
            return 0
    except Exception:
        try:
            stderr.write('document_quote_preparation_unavailable\n')
        except Exception:
            pass
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
