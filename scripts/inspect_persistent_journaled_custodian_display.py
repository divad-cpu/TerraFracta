"""Read-only v4 observer; importing it cannot start a native trial."""
import json
import sys
from scripts.persistent_journaled_custodian_display import DIRECTORY
from workers.invented_operation_journal import inspect_invented_operation, JOURNALED_KIND


def main():
    if sys.argv[1:]:
        print('Fixed local inspection accepts no arguments.', file=sys.stderr); return 2
    print(json.dumps(inspect_invented_operation(DIRECTORY, expected_kind=JOURNALED_KIND), separators=(',', ':')))
    return 0


if __name__ == '__main__': raise SystemExit(main())
