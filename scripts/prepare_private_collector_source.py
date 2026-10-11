"""Preserve the unconnected private collector candidate; start no worker or HTTP."""
import json
import sys
from scripts.prepare_private_transport_source import _prepare_fixed_source
from scripts.ssb_private_collector_inventory import inventory,verify,freeze_private_collector_source


def main():
    if sys.argv[1:]:raise ValueError('Fixed private collector preparation accepts no arguments')
    result=_prepare_fixed_source(inventory,verify,freeze_private_collector_source,
        'private-collector-source-','unconnected_private_collector_source_preparation',
        'unconnected_private_ssb_collector')
    print(json.dumps(result,indent=2));return 0


if __name__=='__main__':raise SystemExit(main())
