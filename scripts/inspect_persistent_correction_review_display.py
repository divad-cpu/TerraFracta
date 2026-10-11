"""Read-only retained invented review observation; no repair or native call."""
import json
import sys

from scripts.persistent_correction_review_display import DIRECTORY
from workers.invented_operation_journal import CORRECTION_REVIEW_KIND, inspect_invented_operation


def main():
    if sys.argv[1:]:raise ValueError('Fixed invented review observer accepts no arguments')
    print(json.dumps(inspect_invented_operation(DIRECTORY,expected_kind=CORRECTION_REVIEW_KIND),separators=(',',':')))
    return 0


if __name__=='__main__':raise SystemExit(main())
