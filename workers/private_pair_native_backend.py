"""Parent-only pending storage with exact raw/native reconciliation.

The caller supplies its bounded scoped native client and already held private
custody. No connection, credential, source fetch or default root is created.
The fixed reader must confirm native admission before any operation; raw store
is consumed once before filesystem/SQL work, including ambiguous failures.
Actual retention/copy authorization and independent review remain caller gates.
"""
from datetime import datetime, timezone
from hashlib import sha256

from workers.closed_pair_channel import _binary, validate_operation
from workers.native_pair_admission import confirm_native_pair_admission,parse_private_pair_context
from workers.private_pair_native_sql import (private_operation_sql, private_admission_sql,
    private_raw_binding_sql, private_retention_sql)
from workers.ssb_14059_capture import CapturedResponse, METADATA_URL, DATA_URL
from workers.ssb_14059_raw_custody import PrivateRawCustody
from workers.ssb_14059_recovery import ExpectedRawPair, reconcile_private_ssb_14059_pairs
from workers.ssb_14059_raw_binding_receipt import parse_raw_binding
from workers.retained_native_transaction import RetainedPairStore


class PrivatePairNativeBackend:
    def __init__(self, native_client, custody, raw_context, source_fingerprint,
            *, utc_now=lambda:datetime.now(timezone.utc), transactional_store=False):
        from workers.bounded_native_client import BoundedNativeClient
        if not callable(native_client) or type(custody) is not PrivateRawCustody or not callable(utc_now):
            raise ValueError('Invalid private native backend configuration')
        if type(transactional_store) is not bool or (transactional_store and type(native_client) is not BoundedNativeClient):
            raise ValueError('Invalid retained transaction configuration')
        self.transactional_store = transactional_store
        self.context = parse_private_pair_context(raw_context,source_fingerprint,now=utc_now())
        self.native_client, self.custody = native_client, custody
        self.raw_context, self.source_fingerprint, self.utc_now = raw_context, source_fingerprint, utc_now
        self.admission = None
        self.admission_receipt = None
        self.raw_expected = None
        self.raw_binding_receipt = None
        self.raw_reconciliation = None
        self.store_consumed = False
        self.closed = False

    def _call(self, sql):
        return self._receipt(self.native_client(sql))

    def _receipt(self, response):
        if type(response.returncode) is not int or response.returncode != 0 \
                or type(response.stdout) is not str:
            # Do not inspect/persist stderr or SQL: errors may contain body
            # literals and credentials supplied by a connection implementation.
            raise ValueError('Fixed private native operation is unavailable')
        raw = response.stdout.strip().encode('utf-8')
        if not 2 <= len(raw) <= 32768:
            raise ValueError('Fixed private native receipt is unavailable')
        return raw

    def confirm_admission(self):
        if self.closed or self.admission is not None:
            raise ValueError('Private native admission cannot be repeated')
        try:
            # Preserve orphan/partial previous attempts for recovery. A new
            # first private attempt must not silently work around that history.
            if not self.custody.is_empty():
                raise ValueError('Retained private attempts require recovery')
            raw = self._call(private_admission_sql())
            parsed = confirm_native_pair_admission(raw,self.raw_context,self.source_fingerprint,now=self.utc_now())
            self.admission, self.admission_receipt = parsed, raw
            return parsed
        except BaseException as error:
            self.closed = True
            if isinstance(error,Exception):
                raise ValueError('Private native admission refused') from None
            raise

    def execute_once(self, operation, arguments):
        try:
            if self.closed or self.admission is None:
                raise ValueError('Private native admission is not confirmed')
            validate_operation(operation,arguments)
            if self.utc_now() >= self.admission.expires_at:
                raise ValueError('Private native admission expired')
            if operation != 'store_pair':
                return self._call(private_operation_sql(operation,arguments))
            if self.store_consumed:
                raise ValueError('Private raw storage has already been consumed')
            self.store_consumed = True
            def prepare_store(retention_raw):
                retention = confirm_native_pair_admission(retention_raw,
                    self.raw_context,self.source_fingerprint,now=self.utc_now())
                if retention.expires_at > self.admission.expires_at:
                    raise ValueError('Retention observation extends admitted authority')
                captures = tuple(CapturedResponse(url,url,0,200,'application/json',_binary(arguments[kind],65536),
                    datetime.fromisoformat(arguments[kind+'RetrievedAt']))
                    for kind,url in (('metadata',METADATA_URL),('data',DATA_URL)))
                stored_at = self.utc_now()
                if stored_at >= retention.expires_at: raise ValueError('Retention observation expired before save')
                saved = self.custody.store(*captures,now=stored_at)
                self.raw_expected = ExpectedRawPair(saved.attempt_id,sha256(captures[0].body).hexdigest(),
                    sha256(captures[1].body).hexdigest(),saved.expires_at,captures[0].retrieved_at,
                    captures[1].retrieved_at,stored_at)
                reopened = self.custody.read(saved.attempt_id,now=self.utc_now())
                if (reopened.metadata_response,reopened.data_response) != captures:
                    raise ValueError('Reopened private raw pair differs')
                if self.utc_now() >= retention.expires_at: raise ValueError('Retention observation expired after save')
                return RetainedPairStore(arguments,saved.attempt_id,stored_at)
            if self.transactional_store:
                raw = self._receipt(self.native_client.store_pair_transaction(prepare_store))
            else:
                # Historical separately committed observations retain their
                # documented filesystem withdrawal gap. No implicit fallback.
                selected = prepare_store(self._call(private_retention_sql()))
                raw = self._call(selected.statement())
            binding = self._call(private_raw_binding_sql())
            parse_raw_binding(binding,pair_id=self.context.pair_id,
                versions={'metadata':self.context.metadata_version_id,'data':self.context.data_version_id},
                expected=self.raw_expected)
            reconciliation = reconcile_private_ssb_14059_pairs((self.raw_expected,),
                root=self.custody.root,now=self.utc_now())
            if len(reconciliation) != 1 or reconciliation[0].state != 'matched' or reconciliation[0].issues:
                raise ValueError('Private raw/native reconciliation differs')
            self.raw_binding_receipt, self.raw_reconciliation = binding, reconciliation
            return raw
        except BaseException as error:
            self.closed = True
            if isinstance(error,Exception):
                raise ValueError('Private native operation refused; preserved state requires recovery') from None
            raise
