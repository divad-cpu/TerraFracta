"""Run the current offline project checks without activating any service."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
UV_RUN = ("uv", "run", "--locked", "--offline", "--no-sync",
          "--no-python-downloads", "--no-env-file", "python", "-B")
CHECKS = (
    ("Approved runner-control source copy", (sys.executable, "-m", "scripts.check_runner_controls_copy")),
    ("Approved completion source copy", (sys.executable, "-m", "scripts.check_run_completion_copy")),
    ("Approved connected-capture source copy", (sys.executable, "-m", "scripts.check_connected_capture_copy")),
    ("Offline Python tests", (*UV_RUN, "-m", "unittest", "discover", "-s", "tests", "-q")),
    ("TypeScript typecheck", ("pnpm", "--config.verify-deps-before-run=error",
                              "--config.update-notifier=false", "run", "typecheck")),
    ("Installed package license declarations", (*UV_RUN, "-m", "scripts.oss_inventory", "--check")),
    ("Documentation links", (sys.executable, "scripts/check_docs.py")),
)


def main() -> int:
    if not (ROOT / "pyproject.toml").is_file() or not (ROOT / "pnpm-lock.yaml").is_file():
        print("Run this check from an intact TerraFracta checkout.", file=sys.stderr)
        return 2
    # These control package-manager bootstrap/sync, not arbitrary child networking.
    # Copy rather than mutate the caller's environment; retain its tool paths.
    environment = os.environ.copy()
    environment.update({
        "COREPACK_ENABLE_NETWORK": "0",
        "COREPACK_ENABLE_AUTO_PIN": "0",
        "COREPACK_ENV_FILE": "0",
        "UV_OFFLINE": "1",
        "UV_NO_SYNC": "1",
        "UV_NO_ENV_FILE": "1",
        "UV_PYTHON_DOWNLOADS": "never",
        "PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN": "error",
        "PNPM_CONFIG_UPDATE_NOTIFIER": "false",
        # pnpm scripts can inherit the lowercase spelling from their parent.
        "pnpm_config_verify_deps_before_run": "error",
        "pnpm_config_update_notifier": "false",
    })
    for label, command in CHECKS:
        print(f"Checking {label}...", flush=True)
        try:
            result = subprocess.run(command, cwd=ROOT, env=environment, check=False)
        except FileNotFoundError:
            print(f"Missing local prerequisite: {command[0]}", file=sys.stderr)
            return 2
        if result.returncode:
            print(f"Failed: {label} (exit {result.returncode})", file=sys.stderr)
            return result.returncode
    print("Local offline checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
