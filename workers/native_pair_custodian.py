"""Parent-only, one-shot operation state for a supplied paired native backend.

The trusted caller supplies independently admitted context and a bounded
callback for fixed operations. Parsing that context is not authenticating it.
This custodian independently checks operation order, native measurement and
post-COMMIT authority replies before releasing any receipt to the worker.
There is no connection, credential, source request, retry or publication here.
"""
from datetime import datetime, timezone

from workers.closed_pair_channel import FIELDS, MAX_RECEIPT_BYTES, _binary, _json, validate_operation
from workers.closed_ssb_worker import parse_closed_ssb_context
from workers.response_authority import parse_response_authority
from workers.source_response_receipts import (parse_response_reservation,
    parse_response_dispatch, parse_response_settlement, validate_response_request)
from workers.ssb_store_capture_validation import validate_store_capture
from workers.ssb_pair_processing import require_pending_pair_checkpoint
from workers.update_run_completion import reconcile_run_completion
from workers.update_run_closeout import parse_run_closeout

RESPONSE_STEPS = ('reserve_response', 'confirm_response', 'dispatch_response',
    'confirm_response', 'settle_response', 'confirm_response')
OPERATIONS = RESPONSE_STEPS * 2 + ('store_pair', 'read_pair_checkpoint', 'close_processing', 'read_closeout')
PHASES = {1:'reserve', 3:'dispatch', 5:'settle'}


class NativePairCustodian:
    def __init__(self, raw_context, execute_once, *, utc_now=lambda:datetime.now(timezone.utc), on_confirmed=None):
        if not callable(execute_once) or not callable(utc_now) \
                or (on_confirmed is not None and not callable(on_confirmed)):
            raise ValueError('Invalid private custodian configuration')
        self.context = parse_closed_ssb_context(raw_context, now=utc_now())
        self.requests = {'metadata':self.context.metadata, 'data':self.context.data}
        self.versions = {'metadata':self.context.metadata_version_id, 'data':self.context.data_version_id}
        self.execute_once, self.utc_now, self.on_confirmed = execute_once, utc_now, on_confirmed
        self.calls, self.committed_receipts, self.committed_times = [], {}, {}
        self.checkpoints = {kind:{} for kind in ('metadata', 'data')}
        self.response_receipts = {kind:{} for kind in ('metadata', 'data')}
        self.stored_context = None
        self._closeout = None
        self.closeout = None
        self.next_step = 0
        self.closed = False

    def operations(self):
        return {name:lambda arguments, name=name:self.invoke(name, arguments) for name in FIELDS}

    def _before(self, operation, arguments):
        validate_operation(operation, arguments)
        step = self.next_step
        if self.closed or step >= len(OPERATIONS) or operation != OPERATIONS[step]:
            raise ValueError('Private custodian operation sequence differs')
        for request in self.requests.values():
            validate_response_request(request, self.utc_now())
        if step < 12:
            kind = 'metadata' if step < 6 else 'data'
            if arguments['kind'] != kind:
                raise ValueError('Private custodian response context differs')
            offset = step % 6
            if offset in PHASES:
                phase = PHASES[offset]
                if arguments['phase'] != phase \
                        or _binary(arguments['receipt'], 4096) != self.response_receipts[kind][phase]:
                    raise ValueError('Private custodian confirmation differs from committed receipt')
            elif offset in (2, 4) and arguments['reservationId'] != self.checkpoints[kind]['reservation'].reservation_id:
                raise ValueError('Private custodian reservation differs')
        if operation == 'store_pair':
            return validate_store_capture(arguments, self.requests, self.versions, self.checkpoints)
        return None

    def _after(self, operation, arguments, raw, stored_context):
        if type(raw) is not bytes or not 2 <= len(raw) <= MAX_RECEIPT_BYTES or type(_json(raw)) is not dict:
            raise ValueError('Private native receipt is unavailable')
        now = self.utc_now()
        if operation in ('reserve_response', 'dispatch_response', 'settle_response', 'confirm_response'):
            kind = arguments['kind']; state = self.checkpoints[kind]; expected = self.requests[kind]
            if operation == 'reserve_response':
                state['reservation'] = parse_response_reservation(raw, expected, now=now)
                self.response_receipts[kind]['reserve'] = raw
            elif operation == 'dispatch_response':
                state['dispatch'] = parse_response_dispatch(raw, expected, state['reservation'], now=now)
                self.response_receipts[kind]['dispatch'] = raw
            elif operation == 'settle_response':
                state['settlement'] = parse_response_settlement(raw, expected, state['reservation'], state['dispatch'],
                    outcome=arguments['outcome'], body_bytes=arguments['bodyBytes'],
                    content_sha256=arguments['contentSha256'], now=now)
                self.response_receipts[kind]['settle'] = raw
            else:
                parse_response_authority(raw, expected, phase=arguments['phase'], principal=self.context.principal,
                    reservation_id=state['reservation'].reservation_id,
                    receipt=self.response_receipts[kind][arguments['phase']], now=now)
        elif operation == 'store_pair':
            receipt = _json(raw)
            if set(receipt) != {'stored','status'} or receipt['stored'] is not True \
                    or receipt['status'] not in ('created','existing'):
                raise ValueError('Private native store acknowledgment differs')
            self.stored_context = stored_context
            self.committed_times.update(metadataRetrievedAt=arguments['metadataRetrievedAt'],
                dataRetrievedAt=arguments['dataRetrievedAt'])
        elif operation == 'read_pair_checkpoint':
            require_pending_pair_checkpoint(raw, self.stored_context, self.context.pair_id,
                str(self.context.metadata.work.lease_id))
        elif operation in ('close_processing', 'read_closeout'):
            manifest = self.stored_context.manifest
            expected = reconcile_run_completion(manifest, (), (), (), now=now)
            parsed = parse_run_closeout(raw, manifest, str(self.context.metadata.work.lease_id), expected,
                started_at=self.context.metadata.work.observed_at, now=now)
            if operation == 'close_processing':
                self._closeout = parsed
            elif self._closeout is None or (parsed.finished_at, parsed.summary) \
                    != (self._closeout.finished_at, self._closeout.summary):
                raise ValueError('Private native closeout differs from its committed finish')
            self.closeout = parsed

    def invoke(self, operation, arguments):
        try:
            stored_context = self._before(operation, arguments)
            # Consume before the callback. Failure, ambiguous COMMIT or an
            # invalid/late receipt closes the capability without replay.
            self.next_step += 1
            raw = self.execute_once(operation, dict(arguments))
            self._after(operation, arguments, raw, stored_context)
            self.calls.append(operation)
            self.committed_receipts[operation] = raw
            if self.on_confirmed is not None:
                self.on_confirmed(operation, dict(arguments), raw)
            if self.next_step == len(OPERATIONS):
                self.closed = True
            return raw
        except BaseException as error:
            self.closed = True
            if isinstance(error, Exception):
                raise ValueError('Private custodian operation refused') from None
            raise
