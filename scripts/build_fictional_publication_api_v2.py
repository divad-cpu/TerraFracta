"""Serialize one principal's fictional API operations before shared run locks.

Preserves the original successful/failed candidate. No new API/grant/identity.
"""
from pathlib import Path
import sys
from scripts.build_fictional_publication_api import build_publication_api
ROOT=Path(__file__).resolve().parents[1]

def build_publication_api_v2():
    body=build_publication_api()
    old='select * into p from terra_publication_test_api.principal_scopes where principal=session_user for share;'
    assert body.count(old)==1
    return '-- Fictional API revision 2: scope lock precedes run lock; original candidate preserved.\n'+body.replace(old,old.replace('for share','for no key update'))
def main():
    if sys.argv[1:]:raise RuntimeError('Fixed composer accepts no arguments')
    sys.stdout.write(build_publication_api_v2());return 0
if __name__=='__main__':raise SystemExit(main())
