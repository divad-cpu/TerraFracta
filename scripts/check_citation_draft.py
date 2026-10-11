"""Rehearse the fixed public-citation draft in one rollback-only local session.

No connection string, arbitrary SQL path or persistent-apply option is accepted.
The existing loopback development container must already be running.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "supabase_db_terrafracta-local"
DRAFT_NAMES = (
    "TF009_public_citation_binding.sql",
    "TF009_public_citation_binding.test.sql",
)
STATE_SQL = """
select jsonb_build_object(
  'migration_count', (select count(*) from supabase_migrations.schema_migrations),
  'citation_columns', (select count(*) from information_schema.columns
    where table_schema = 'terra_private'
      and table_name in ('automatic_route_qualifications','machine_candidate_decisions')
      and column_name = 'public_citation_url'),
  'qualifications', (select count(*) from terra_private.automatic_route_qualifications),
  'decisions', (select count(*) from terra_private.machine_candidate_decisions),
  'versions', (select count(*) from terra_private.source_versions),
  'draft_guard', to_regprocedure('terra_private.check_machine_public_citation_insert()') is not null
);
"""


def rollback_sql(parts: tuple[str, ...]) -> str:
    for part in parts:
        # These are developer-authored fixed files, never source/model output.
        # Reject transaction controls and psql meta-commands before wrapping.
        code = re.sub(r"--[^\n]*", "", part)
        code = re.sub(r"/\*.*?\*/", " ", code, flags=re.DOTALL)
        # Function bodies contain BEGIN/END blocks, not session transactions.
        code = re.sub(r"(?P<tag>\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$).*?(?P=tag)",
                      "''", code, flags=re.DOTALL)
        if re.search(r"(?:^|;)\s*(?:begin|commit|end|rollback|abort|prepare\s+transaction)\b",
                     code, re.MULTILINE | re.IGNORECASE):
            raise ValueError("Unexpected transaction control in fixed draft")
        if re.search(r"^\s*\\", code, re.MULTILINE):
            raise ValueError("Unexpected psql command in fixed draft")
    return (
        "begin;\nset local statement_timeout='20s';\n"
        "set local lock_timeout='3s';\n"
        + "\n".join(parts) + "\nrollback;\n"
    )


def query(sql: str) -> str:
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-qAt",
         "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
        input=sql, text=True, capture_output=True, timeout=35,
    )
    if result.returncode:
        # Do not expose arbitrary future database errors/rows in operator output.
        raise RuntimeError("Fixed local draft session failed; no commit was requested")
    return result.stdout


def tap_passed(output: str, expected: int) -> bool:
    lines = output.splitlines()
    return (
        f"1..{expected}" in lines
        and len([line for line in lines if re.match(r"^ok [0-9]+(?: -|$)", line)]) == expected
        and not any(line.startswith("not ok") or "Looks like you" in line for line in lines)
        and any(re.match(rf"^ok {expected}(?: -|$)", line) for line in lines)
    )


def main() -> int:
    ports = subprocess.run(
        ["docker", "inspect", "--format", '{{json .NetworkSettings.Ports}}', CONTAINER],
        check=True, text=True, capture_output=True, timeout=10,
    )
    if json.loads(ports.stdout).get("5432/tcp") != [
        {"HostIp": "127.0.0.1", "HostPort": "65432"}
    ]:
        raise RuntimeError("Expected fixed loopback database binding is absent")
    before = json.loads(query(STATE_SQL))
    if before != {
        "migration_count": 24, "citation_columns": 0, "qualifications": 0,
        "decisions": 0, "versions": 0, "draft_guard": False,
    }:
        raise RuntimeError("Draft rehearsal requires the unchanged empty 24-migration baseline")
    parts = tuple((ROOT / "research/pending" / name).read_text(encoding="utf-8")
                  for name in DRAFT_NAMES)
    output = query(rollback_sql(parts))
    after = json.loads(query(STATE_SQL))
    if after != before:
        raise RuntimeError("Post-rehearsal state differs from baseline; investigate before continuing")
    print(output.strip())
    if not tap_passed(output, 18):
        return 1
    print("PASS: 18 fictional checks; draft schema and rows rolled back; 24 migrations retained")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
