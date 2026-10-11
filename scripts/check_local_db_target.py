"""Inspect the fixed local Docker target without credentials or mutations."""

from __future__ import annotations

import argparse
import json
import subprocess

from workers.local_database_target import DatabaseTargetError, validate_database_network


def inspect_json(args: list[str]) -> object:
    result = subprocess.run(
        ["docker", *args], capture_output=True, text=True, timeout=10, check=False
    )
    if result.returncode or len(result.stdout) > 256 * 1024:
        raise DatabaseTargetError("The fixed Docker metadata inspection failed.")
    return json.loads(result.stdout)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before-start", action="store_true")
    args = parser.parse_args(argv)
    try:
        network = inspect_json(["network", "inspect", "terrafracta-local-loopback"])[0]
        members = network.get("Containers", {})
        if len(members) > 32:
            raise DatabaseTargetError("The local network exceeds this bounded inspection.")
        # Select only network/port/state metadata; do not request container env.
        template = ('{"id":{{json .Id}},"name":{{json .Name}},'
                    '"running":{{json .State.Running}},'
                    '"ports":{{json .NetworkSettings.Ports}},'
                    '"networks":{{json .NetworkSettings.Networks}}}')
        containers = []
        for identity in members:
            item = inspect_json(["inspect", "--format", template, identity])
            item["name"] = item["name"].removeprefix("/")
            containers.append(item)
        validate_database_network(network, containers, before_start=args.before_start)
        print("Fixed local database target and network aliases verified.")
        return 0
    except (DatabaseTargetError, OSError, ValueError, TypeError, KeyError,
            IndexError, subprocess.TimeoutExpired):
        print("Local database target check failed. Check loopback ports and keep each test database on its own network.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
