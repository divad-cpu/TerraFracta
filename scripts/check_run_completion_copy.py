"""Read-only exact-copy check for David's specifically approved migration 29."""

from hashlib import sha256
from pathlib import Path
import sys


ROOT=Path(__file__).resolve().parents[1]
SOURCE='research/pending/TF009_run_completion.sql'
DIGEST='ccdf78fd9d091bea0b8082a60159b11c57bb7d6206724f176ec0d399e229c792'
MIGRATION='supabase/migrations/20260930182359_tf009_source_checks_and_processing_completion.sql'
HEADER=('-- David explicitly approved this combined local bundle on 2026-09-30.\n'
        '-- Three private tables, nineteen fields, eight invoker functions, nine triggers.\n'
        '-- No writer credential, source collection, schedule or real publication enabled.\n')


def check_artifacts(root: Path):
    source=(root/SOURCE).read_bytes()
    if sha256(source).hexdigest()!=DIGEST:
        raise ValueError('Approved completion source fingerprint differs')
    expected=HEADER.encode()+b'begin;\n'+source+b'\ncommit;\n'
    if (root/MIGRATION).read_bytes()!=expected:
        raise ValueError('Migration 29 differs from its specifically approved source copy')


def main():
    if sys.argv[1:]:
        print('The fixed completion copy check accepts no arguments',file=sys.stderr)
        return 2
    try:
        check_artifacts(ROOT)
    except (OSError,ValueError) as error:
        print(str(error),file=sys.stderr)
        return 1
    print('Approved completion source fingerprint and exact migration-29 copy match.')
    return 0


if __name__=='__main__': raise SystemExit(main())
