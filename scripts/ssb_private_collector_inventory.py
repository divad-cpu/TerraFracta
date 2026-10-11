"""Fixed unconnected collector inventory, source-only and no live permission."""
from scripts.ssb_execution_inventory import CONTRACT as BASE_CONTRACT, _inventory_for, _verify_for
from scripts.freeze_ssb_source import _freeze_reviewed_source

ROOTS=('workers.ssb_frozen_private_collector',)
CONTRACT={**BASE_CONTRACT,'entryPurpose':'unconnected_private_ssb_collector',
    'sourcePermissionIssued':False,'credentialFreeCollector':True}


def inventory(root):return _inventory_for(root,ROOTS,CONTRACT)
def verify(root,pin):return _verify_for(root,pin,ROOTS,CONTRACT)
def freeze_private_collector_source(snapshot,pin):return _freeze_reviewed_source(snapshot,pin,verify,{})
