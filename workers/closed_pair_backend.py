"""Paired capture adapters using only a supplied private channel capability.

No SQL builder, role selector, credential, connection string or HTTP client is
present. The custodian independently pins authority and execution semantics.
"""
import base64

from workers.closed_pair_channel import PairChannelClient
from workers.update_run_completion import canonical_run_manifest


def _encoded(value):
    return base64.b64encode(value).decode('ascii')


class ChannelResponseBackend:
    def __init__(self, client: PairChannelClient, expected, kind):
        if kind not in ('metadata', 'data'):
            raise ValueError('Unknown fixed response context')
        self.client, self.expected, self.kind = client, expected, kind

    def _check(self, expected):
        if expected != self.expected:
            raise ValueError('Private response context changed')

    def reserve(self, expected):
        self._check(expected)
        return self.client.call('reserve_response', {'kind': self.kind})

    def dispatch(self, expected, reservation):
        self._check(expected)
        return self.client.call('dispatch_response', {'kind': self.kind, 'reservationId': reservation.reservation_id})

    def settle(self, expected, reservation, *, outcome, body_bytes, content_sha256):
        self._check(expected)
        return self.client.call('settle_response', {'kind': self.kind, 'reservationId': reservation.reservation_id,
            'outcome': outcome, 'bodyBytes': body_bytes, 'contentSha256': content_sha256})

    def confirm(self, phase, receipt):
        return self.client.call('confirm_response', {'kind': self.kind, 'phase': phase, 'receipt': _encoded(receipt)})


class ChannelPendingPairBackend:
    def __init__(self, client: PairChannelClient):
        self.client = client
        self.checkpoint = None
        self.closeout = None

    def store_pair(self, context, metadata, data):
        self.client.call('store_pair', {
            'metadata': _encoded(metadata.capture.body), 'data': _encoded(data.capture.body),
            'metadataRetrievedAt': metadata.capture.retrieved_at.isoformat(),
            'dataRetrievedAt': data.capture.retrieved_at.isoformat(),
            'manifest': canonical_run_manifest(context.manifest)})
        self.checkpoint = self.client.call('read_pair_checkpoint', {})
        return self.checkpoint

    def close_pair(self, _context):
        self.client.call('close_processing', {})
        self.closeout = self.client.call('read_closeout', {})
        return self.closeout
