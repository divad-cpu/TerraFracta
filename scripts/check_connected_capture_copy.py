"""Check the specifically approved migration-30 source copy without DB access."""
from hashlib import sha256
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
SOURCE='research/pending/TF009_local_connected_capture_bundle.sql'
DIGEST='e3d0d769e8816ba461591f160462d3b48b4252cdbb2f7346b72ee2d389e55fe3'
MIGRATION='supabase/migrations/20261001104654_tf009_connected_capture_controls.sql'
HEADER=('-- David explicitly approved this combined local bundle on 2026-10-01.\n'
'-- Five private tables, 31 table fields plus one existing field, 21 invoker functions, 20 triggers.\n'
'-- No authenticated experiment, writer LOGIN, source, schedule or runtime publication enabled.\n')
def check_artifacts(root=ROOT):
    source=(root/SOURCE).read_bytes()
    if sha256(source).hexdigest()!=DIGEST:raise ValueError('Approved connected-capture fingerprint differs')
    if (root/MIGRATION).read_bytes()!=HEADER.encode()+b'begin;\n'+source+b'\ncommit;\n':
        raise ValueError('Migration 30 differs from the specifically approved source copy')
def main():
    if sys.argv[1:]:raise RuntimeError('Fixed source-copy check accepts no arguments')
    check_artifacts();print('PASS exact approved connected-capture source and migration-30 copy.');return 0
if __name__=='__main__':raise SystemExit(main())
