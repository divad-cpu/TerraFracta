"""Pure complete request/readback entry snapshots; never executes SQL."""
from dataclasses import replace
from datetime import timedelta
import json
import unittest

from tests.test_document_result_contract import request, stored_shape
from tests.test_plain_document_entry_snapshot import CallbackUtc
from workers.document_result_contract import (
    DocumentResultContractError, prepare_invented_document_result,
    invented_document_result_read_statement, parse_stored_invented_document_result,
)


def prepare(value, at):
    return prepare_invented_document_result(value.feed_capture, value.capture_receipt,
        document_raw=value.document_raw, document=value.document, binding=value.binding,
        mapping=value.mapping, association=value.association, operation_id=value.operation_id,
        expected_revision=value.expected_revision, observed_at=at)


class DocumentResultEntrySnapshotTests(unittest.TestCase):
    def test_invalid_original_hash_cannot_be_repaired_before_parent_validation(self):
        value = request()
        digest = value.document.content_sha256
        parts = (value.document, value.binding, value.mapping)
        for part in parts: object.__setattr__(part, 'content_sha256', '0' * 64)
        def repair():
            for part in parts: object.__setattr__(part, 'content_sha256', digest)
        at = value.observed_at.replace(tzinfo=CallbackUtc(repair))
        with self.assertRaises(DocumentResultContractError): prepare(value, at)

    def test_valid_original_survives_mutation_and_returned_context_is_owned(self):
        value = request()
        key = value.document.source_key
        at = value.observed_at.replace(tzinfo=CallbackUtc(
            lambda: object.__setattr__(value.document, 'source_key', 'fictional-foreign')))
        result = prepare(value, at)
        self.assertEqual(result.document.source_key, key)
        self.assertEqual(json.loads(result.canonical_input)['document']['source_key'], key)
        self.assertIsNot(result.document, value.document)
        self.assertIsNot(result.mapping.spans[0], value.mapping.spans[0])

    def test_language_assertion_cannot_be_relabelled_at_parent_entry(self):
        value = request()
        def relabel():
            for part in (value.binding, value.mapping): object.__setattr__(part, 'language_code', 'no')
        at = value.observed_at.replace(tzinfo=CallbackUtc(relabel))
        result = prepare(value, at)
        self.assertEqual(result.binding.language_code, 'en')
        self.assertEqual(json.loads(result.canonical_input)['snapshot']['language_code'], 'en')

    def test_statement_ports_use_valid_entry_copy_after_caller_context_changes(self):
        for operation in ('write', 'read'):
            with self.subTest(operation=operation):
                value = request()
                ordinary = value.statement() if operation == 'write' else invented_document_result_read_statement(value)
                value = replace(value, observed_at=value.observed_at.replace(tzinfo=CallbackUtc(
                    lambda: object.__setattr__(value, 'canonical_input', b'{}'))))
                actual = value.statement() if operation == 'write' else invented_document_result_read_statement(value)
                self.assertEqual(actual, ordinary)

    def test_invalid_canonical_entry_cannot_be_repaired_for_any_consumer(self):
        for operation in ('write', 'read', 'parse'):
            with self.subTest(operation=operation):
                value = request()
                raw = json.dumps(stored_shape(value)).encode()
                canonical = value.canonical_input
                value = replace(value, canonical_input=b'{}', observed_at=value.observed_at.replace(tzinfo=CallbackUtc(
                    lambda: object.__setattr__(value, 'canonical_input', canonical))))
                with self.assertRaises(DocumentResultContractError):
                    if operation == 'write': value.statement()
                    elif operation == 'read': invented_document_result_read_statement(value)
                    else: parse_stored_invented_document_result(raw, value, observed_at=value.observed_at + timedelta(seconds=3))

    def test_readback_clock_cannot_invalidate_verified_entry_or_source(self):
        value = request()
        raw = json.dumps(stored_shape(value)).encode()
        at = (value.observed_at + timedelta(seconds=3)).replace(tzinfo=CallbackUtc(
            lambda: object.__setattr__(value.document, 'source_key', 'fictional-foreign')))
        result = parse_stored_invented_document_result(raw, value, observed_at=at)
        self.assertEqual(result.result.document.source_key, 'fictional-document')
        self.assertEqual(result.result.snapshot.passages[0].text, 'Invented original passage.')

    def test_snapshot_faults_are_fixed_and_cancellation_keeps_identity(self):
        from asyncio import CancelledError
        for operation in ('prepare', 'write', 'read', 'parse'):
            for kind in (RuntimeError, KeyboardInterrupt, SystemExit, CancelledError):
                with self.subTest(operation=operation, kind=kind.__name__):
                    value = request()
                    raw = json.dumps(stored_shape(value)).encode()
                    error = kind('FICTIONAL_PRIVATE_CALLBACK')
                    def fail(): raise error
                    at = value.observed_at.replace(tzinfo=CallbackUtc(fail))
                    expected = DocumentResultContractError if kind is RuntimeError else kind
                    with self.assertRaises(expected) as caught:
                        if operation == 'prepare': prepare(value, at)
                        elif operation == 'write': replace(value, observed_at=at).statement()
                        elif operation == 'read': invented_document_result_read_statement(replace(value, observed_at=at))
                        else: parse_stored_invented_document_result(raw, value, observed_at=at + timedelta(seconds=3))
                    if kind is RuntimeError:
                        message = 'invented_document_result_input_invalid' if operation == 'prepare' else (
                            'invented_document_result_readback_invalid' if operation == 'parse' else 'invented_document_result_context_invalid')
                        self.assertEqual(str(caught.exception), message)
                        self.assertIsNone(caught.exception.__cause__)
                    else: self.assertIs(caught.exception, error)
