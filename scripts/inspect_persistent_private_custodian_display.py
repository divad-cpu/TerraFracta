"""Fixed read-only retained status; never import or start the native trial."""
import json
import sys

from scripts.persistent_private_custodian_display import DIRECTORY
from workers.invented_operation_journal import inspect_invented_operation


def main():
    if sys.argv[1:]:
        print('Fixed local inspection accepts no arguments.',file=sys.stderr);return 2
    print(json.dumps(inspect_invented_operation(DIRECTORY),separators=(',',':')));return 0


if __name__=='__main__':raise SystemExit(main())
