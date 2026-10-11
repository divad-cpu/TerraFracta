"""Read-only reconciliation of the specifically approved migration-28 copy.

Checks source files, not the running database, authentication or publication.
No SQL execution, arbitrary CLI path, credentials, writes or generated churn.
"""

from hashlib import sha256
from pathlib import Path
import sys


ROOT=Path(__file__).resolve().parents[1]
APPROVED={
 "TF009_run_admission.sql":"315ef947ce961464aa5838f70b689f71e0ceff6afee285e6fc50b7e4d00c64bd",
 "TF009_run_work_lease.sql":"fbe7129d306c7d14aa33f1154e973ea0afe036bfb82905995316faa914b32b78",
 "TF009_machine_activation.sql":"6d7812e0b0d96548828f068d455528168afff5bd6fa24b82c34f25befe1b3289",
}
MIGRATION="supabase/migrations/20260930151028_tf009_owner_runner_controls.sql"
HEADER=("-- David explicitly approved this combined local bundle on 2026-09-30.\n"
        "-- Four private tables, 23 fields, fourteen invoker functions, twelve triggers.\n"
        "-- No application writer, source fetch, schedule or real publication enabled.\n")


def check_artifacts(root: Path) -> None:
    parts=[]
    for name,digest in APPROVED.items():
        data=(root/"research/pending"/name).read_bytes()
        if sha256(data).hexdigest()!=digest:
            raise ValueError("Approved runner-control source fingerprint differs")
        parts.append(data.decode("utf-8"))
    expected=HEADER+"begin;\n"+"\n".join(parts)+"\ncommit;\n"
    if (root/MIGRATION).read_bytes()!=expected.encode("utf-8"):
        raise ValueError("Migration 28 differs from its specifically approved source copy")


def main() -> int:
    if sys.argv[1:]:
        print("The fixed copy check accepts no arguments",file=sys.stderr)
        return 2
    try:
        check_artifacts(ROOT)
    except (OSError,UnicodeError,ValueError) as error:
        print(str(error),file=sys.stderr)
        return 1
    print("Approved runner-control source fingerprints and exact migration-28 copy match.")
    return 0


if __name__=="__main__":
    raise SystemExit(main())
