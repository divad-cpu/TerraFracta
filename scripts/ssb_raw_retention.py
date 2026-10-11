"""Inspect or explicitly prune expired private SSB 14059 response pairs.

This command is local-only. It has no source-fetch, timer, database or public
output route. The default mode checks without deleting anything.
"""

from __future__ import annotations

import argparse
import sys

from workers.ssb_14059_raw_store import (
    SSB14059RawStoreError,
    prune_expired_ssb_14059_pairs,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prune-expired",
        action="store_true",
        help="delete only validated response-pair folders at or beyond their 30-day expiry",
    )
    args = parser.parse_args(argv)
    try:
        count = prune_expired_ssb_14059_pairs(dry_run=not args.prune_expired)
    except (SSB14059RawStoreError, OSError):
        # Storage exceptions may carry a private absolute path or raw bytes.
        # Keep command output safe for a local log or support transcript.
        print("Private SSB retention check blocked; inspect storage locally.", file=sys.stderr)
        return 1
    action = "Pruned" if args.prune_expired else "Found"
    print(f"{action} {count} expired private SSB response-pair folders.")
    if not args.prune_expired:
        print("No files were changed. Use --prune-expired to delete eligible folders.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
