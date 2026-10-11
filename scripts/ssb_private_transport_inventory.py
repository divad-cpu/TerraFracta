"""Fixed unconnected HTTP transport candidate inventory, no live permission.

Shares byte/interpreter verification with the invented worker inventory. Its
distinct roots and purpose cannot be substituted for that fictional source.
No CLI, worker import, response, account, dispatch or live grant is created.
"""
from scripts.ssb_execution_inventory import CONTRACT as BASE_CONTRACT, _inventory_for, _verify_for
from scripts.freeze_ssb_source import _freeze_reviewed_source

ROOTS = ('workers.ssb_frozen_private_transport',)
CONTRACT = {**BASE_CONTRACT, 'entryPurpose': 'unconnected_private_ssb_http_transport',
            'sourcePermissionIssued': False, 'credentialFreeTransport': True}


def inventory(root):
    return _inventory_for(root, ROOTS, CONTRACT)


def verify(root, expected_fingerprint):
    return _verify_for(root, expected_fingerprint, ROOTS, CONTRACT)


def freeze_private_transport_source(snapshot, expected_fingerprint):
    return _freeze_reviewed_source(snapshot, expected_fingerprint, verify, {})
