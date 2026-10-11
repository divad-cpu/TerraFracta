"""Read only the separate supervised review journal; never start its child."""
import json
import sys
from scripts.persistent_supervised_correction_review import DIRECTORY
from workers.invented_operation_journal import SUPERVISED_REVIEW_KIND, inspect_invented_operation


def main():
    if sys.argv[1:]:raise ValueError('Fixed supervised review observer accepts no arguments')
    print(json.dumps(inspect_invented_operation(DIRECTORY,expected_kind=SUPERVISED_REVIEW_KIND),separators=(',',':')))
    return 0


if __name__=='__main__':raise SystemExit(main())
