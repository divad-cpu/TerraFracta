"""Bounded developer-command dispatch checks; no real suite or service starts."""

from __future__ import annotations

import contextlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts import check_local


class OfflineCheckRunnerTests(unittest.TestCase):
    def run_with(self, invoke):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "pyproject.toml").write_text("[project]\n")
            (root / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
            output, errors = io.StringIO(), io.StringIO()
            with patch.object(check_local, "ROOT", root), \
                    patch.object(check_local.subprocess, "run", side_effect=invoke), \
                    contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                result = check_local.main()
            return result, output.getvalue(), errors.getvalue()

    def test_all_seven_existing_checks_keep_order_and_disable_manager_side_effects(self):
        calls = []

        def invoke(command, **kwargs):
            calls.append((command, kwargs))
            env = kwargs["env"]
            for key, value in {
                "COREPACK_ENABLE_NETWORK": "0",
                "COREPACK_ENABLE_AUTO_PIN": "0",
                "COREPACK_ENV_FILE": "0",
                "UV_OFFLINE": "1",
                "UV_NO_SYNC": "1",
                "UV_NO_ENV_FILE": "1",
                "UV_PYTHON_DOWNLOADS": "never",
                "PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN": "error",
                "PNPM_CONFIG_UPDATE_NOTIFIER": "false",
                "pnpm_config_verify_deps_before_run": "error",
                "pnpm_config_update_notifier": "false",
            }.items():
                self.assertEqual(env[key], value)
            self.assertFalse(kwargs["check"])
            return subprocess.CompletedProcess(command, 0)

        hostile = {"COREPACK_ENABLE_NETWORK": "1", "UV_OFFLINE": "0",
                   "UV_NO_SYNC": "0", "PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN": "install",
                   "pnpm_config_verify_deps_before_run": "install",
                   "PATH": "/invented/unchanged/tool/path"}
        before = os.environ.copy()
        with patch.dict(os.environ, hostile):
            expected_environment = os.environ.copy()
            result, output, errors = self.run_with(invoke)
            self.assertEqual(os.environ, expected_environment)
        self.assertEqual(os.environ, before)
        self.assertEqual(result, 0)
        self.assertEqual(errors, "")
        self.assertIn("Local offline checks passed.", output)
        self.assertEqual(len(calls), 7)
        self.assertEqual([command for command, _ in calls],
                         [command for _, command in check_local.CHECKS])
        for _, options in calls:
            self.assertEqual(options["env"]["PATH"], hostile["PATH"])
        self.assertEqual([label for label, _ in check_local.CHECKS], [
            "Approved runner-control source copy", "Approved completion source copy",
            "Approved connected-capture source copy", "Offline Python tests",
            "TypeScript typecheck", "Installed package license declarations",
            "Documentation links",
        ])

    def test_python_and_inventory_commands_refuse_sync_download_and_env_files(self):
        commands = dict(check_local.CHECKS)
        for label in ("Offline Python tests", "Installed package license declarations"):
            command = commands[label]
            self.assertEqual(command[0:2], ("uv", "run"))
            python_index = command.index("python")
            for option in ("--locked", "--offline", "--no-sync",
                           "--no-python-downloads", "--no-env-file"):
                self.assertIn(option, command[2:python_index])
        self.assertEqual(commands["Installed package license declarations"][-3:],
                         ("-m", "scripts.oss_inventory", "--check"))
        typecheck = commands["TypeScript typecheck"]
        self.assertIn("--config.verify-deps-before-run=error", typecheck)
        self.assertIn("--config.update-notifier=false", typecheck)
        self.assertEqual(typecheck[-2:], ("run", "typecheck"))

    def test_failure_is_preserved_and_later_checks_do_not_dispatch(self):
        calls = []

        def invoke(command, **kwargs):
            calls.append(command)
            return subprocess.CompletedProcess(command, 17 if len(calls) == 4 else 0)

        result, output, errors = self.run_with(invoke)
        self.assertEqual(result, 17)
        self.assertEqual(len(calls), 4)
        self.assertIn("Failed: Offline Python tests (exit 17)", errors)
        self.assertNotIn("Local offline checks passed.", output)

    def test_missing_command_stops_without_attempting_an_install(self):
        calls = []

        def invoke(command, **kwargs):
            calls.append(command)
            if len(calls) == 4:
                raise FileNotFoundError("invented missing uv")
            return subprocess.CompletedProcess(command, 0)

        result, output, errors = self.run_with(invoke)
        self.assertEqual(result, 2)
        self.assertEqual(len(calls), 4)
        self.assertIn("Missing local prerequisite: uv", errors)
        self.assertNotIn("Local offline checks passed.", output)

    def test_incomplete_checkout_never_dispatches(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(check_local, "ROOT", Path(directory)), \
                patch.object(check_local.subprocess, "run") as invoke, \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(check_local.main(), 2)
            invoke.assert_not_called()
            self.assertIn("intact TerraFracta checkout", errors.getvalue())

    def test_actual_child_observes_offline_policy_and_preserves_parent_environment(self):
        # Exercise the real subprocess boundary with only a closed invented check.
        probe = (
            "import os,sys; "
            "expected={'COREPACK_ENABLE_NETWORK':'0','COREPACK_ENABLE_AUTO_PIN':'0',"
            "'COREPACK_ENV_FILE':'0','UV_OFFLINE':'1','UV_NO_SYNC':'1',"
            "'UV_NO_ENV_FILE':'1','UV_PYTHON_DOWNLOADS':'never',"
            "'PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN':'error',"
            "'PNPM_CONFIG_UPDATE_NOTIFIER':'false',"
            "'pnpm_config_verify_deps_before_run':'error',"
            "'pnpm_config_update_notifier':'false'}; "
            "sys.exit(0 if all(os.environ.get(k)==v for k,v in expected.items()) else 103)"
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "pyproject.toml").write_text("[project]\n")
            (root / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
            with patch.object(check_local, "ROOT", root), \
                    patch.object(check_local, "CHECKS", (("Invented policy probe",
                                                        (sys.executable, "-B", "-c", probe)),)), \
                    patch.dict(os.environ, {"UV_OFFLINE": "0",
                                            "pnpm_config_verify_deps_before_run": "install"}), \
                    contextlib.redirect_stdout(io.StringIO()):
                before = os.environ.copy()
                self.assertEqual(check_local.main(), 0)
                self.assertEqual(os.environ, before)


if __name__ == "__main__":
    unittest.main()
