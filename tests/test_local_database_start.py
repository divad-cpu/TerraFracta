"""Exercise startup/privacy/failure paths with fake executables, no Docker."""

from pathlib import Path
import os
import stat
import subprocess
import tempfile
import unittest


ROOT=Path(__file__).resolve().parents[1]
CANARY="SYNTHETIC_STARTUP_CREDENTIAL_CANARY"


class LocalDatabaseStartTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory(prefix="terrafracta-start-test-")
        self.addCleanup(self.directory.cleanup)
        self.root=Path(self.directory.name)
        self.bin=self.root/"bin";self.bin.mkdir()
        self.logs=self.root/"logs";self.logs.mkdir(mode=0o700)
        self.commands=self.root/"commands"
        self.cli=self.bin/"verified cli"
        self.write_executable(self.cli,"""#!/bin/sh
printf '%s\n' "$1" >> "$TEST_COMMAND_LOG"
printf '%s\n' 'SYNTHETIC_STARTUP_CREDENTIAL_CANARY'
if [ "$1" = start ]; then exit "$TEST_START_EXIT"; fi
exit 0
""")
        self.write_executable(self.bin/"python3","#!/bin/sh\nexit 0\n")
        self.write_executable(self.bin/"docker","""#!/bin/sh
case "$*" in
  'network inspect terrafracta-local-loopback') exit 0 ;;
  *'{{.Driver}}'*) printf '%s\n' bridge ;;
  *'com.docker.network.bridge.host_binding_ipv4'*) printf '%s\n' 127.0.0.1 ;;
  'container inspect supabase_db_terrafracta-local')
    [ "$TEST_RUNNING" = true ] ;;
  *'{{.State.Running}}'*) printf '%s\n' "$TEST_RUNNING" ;;
  *'.HostIp'*) printf '%s\n' "$TEST_HOST_IP" ;;
  *) exit 91 ;;
esac
""")
        self.env=dict(os.environ,PATH=str(self.bin)+os.pathsep+os.defpath,
                      TMPDIR=str(self.logs),TERRAFRACTA_SUPABASE_CLI=str(self.cli),
                      TEST_COMMAND_LOG=str(self.commands),TEST_RUNNING="false",
                      TEST_START_EXIT="0",TEST_HOST_IP="127.0.0.1")

    def write_executable(self,path: Path,text: str):
        path.write_text(text);path.chmod(0o700)

    def run_start(self):
        return subprocess.run(["bash",str(ROOT/"scripts/start-local-db.sh")],
            env=self.env,text=True,capture_output=True,timeout=10)

    def assert_private(self,result):
        self.assertNotIn(CANARY,result.stdout+result.stderr)
        logs=list(self.logs.glob("terrafracta-db-start.*.log"))
        self.assertEqual(len(logs),1)
        self.assertEqual(stat.S_IMODE(logs[0].stat().st_mode),0o600)
        self.assertIn(CANARY,logs[0].read_text())

    def test_successful_start_keeps_diagnostics_private_and_quotes_cli_with_spaces(self):
        result=self.run_start()
        self.assertEqual(result.returncode,0)
        self.assert_private(result)
        self.assertEqual(self.commands.read_text().splitlines(),["start"])

    def test_failed_start_retains_private_diagnosis_and_stops_only_its_own_attempt(self):
        self.env["TEST_START_EXIT"]="1"
        result=self.run_start()
        self.assertNotEqual(result.returncode,0)
        self.assert_private(result)
        self.assertEqual(self.commands.read_text().splitlines(),["start","stop"])

    def test_existing_database_is_verified_without_start_or_stop(self):
        self.env["TEST_RUNNING"]="true"
        result=self.run_start()
        self.assertEqual(result.returncode,0)
        self.assertFalse(self.commands.exists())
        self.assertEqual(list(self.logs.iterdir()),[])

    def test_unsafe_existing_port_is_refused_without_stopping_existing_database(self):
        self.env.update(TEST_RUNNING="true",TEST_HOST_IP="0.0.0.0")
        result=self.run_start()
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(self.commands.exists())

    def test_unavailable_selected_cli_is_reported_before_startup(self):
        self.env["TERRAFRACTA_SUPABASE_CLI"]=str(self.root/"absent-cli")
        result=self.run_start()
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(self.commands.exists())


if __name__=="__main__":
    unittest.main()
