"""One-shot fictional locking rehearsal on the fixed isolated replay only.

Commits invented seed/rights/qualification records to that retained TEST volume
so two sessions can see them. Every proposed publication rolls back. Refuses a
nonempty baseline; never resets, deletes, targets the primary, or accepts args.
"""

from __future__ import annotations

import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time

from scripts.fictional_activation_payload import fictional_activation_payload


CONTAINER = "supabase_db_terrafracta-replay25-20260930"
NETWORK = "terrafracta-replay25-loopback-20260930"
ROOT = Path(__file__).resolve().parents[1]
ARGS = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]
SOURCE = "33333333-3333-4333-8333-333333333333"


def run(args: list[str], sql: str | None = None) -> str:
    result = subprocess.run(args, input=sql, capture_output=True, text=True, timeout=15)
    if result.returncode or len(result.stdout) > 256 * 1024:
        raise RuntimeError("Fixed isolated inspection failed; no automatic recovery performed.")
    return result.stdout.strip()


def query(sql: str) -> str:
    return run(ARGS, sql)


class Session:
    def __init__(self, args: list[str] | None = None):
        # Reuse the bounded two-session test transport with another harness's
        # fixed isolated target. The original one-shot test keeps its target.
        self.lines = queue.Queue()
        self.errors = []
        readers = []
        self.process = subprocess.Popen(ARGS if args is None else args,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True, bufsize=1)
        try:
            def stdout():
                try:
                    for line in self.process.stdout:
                        self.lines.put(line.strip())
                finally:
                    self.process.stdout.close()
                    self.lines.put(None)
            def stderr():
                try:
                    for line in self.process.stderr:
                        self.errors[:] = (self.errors + [line[:240]])[-8:]
                finally:
                    self.process.stderr.close()
            for target, stream in ((stdout, self.process.stdout), (stderr, self.process.stderr)):
                reader = threading.Thread(target=target, daemon=True)
                readers.append((reader, stream))  # Own before start can fail.
                reader.start()
        except BaseException:
            # A caller cannot register an object whose constructor failed.
            # Own the already-created child here, before credential delivery.
            try:
                try: self.process.terminate()
                except OSError: pass  # Still verify exit; signal ACK may be lost.
                try: self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try: self.process.kill()
                    except OSError: pass
                    self.process.wait(timeout=5)
            finally:
                self.process.stdin.close()
                # Output readers own their buffered stream until EOF. Closing
                # a live reader's stream here can wait forever on its lock,
                # preventing the caller's role retirement/clone stop cleanup.
                for reader, _stream in readers:
                    if reader.ident is not None: reader.join(timeout=0.1)
                live_streams = {stream for reader, stream in readers if reader.is_alive()}
                for stream in (self.process.stdout, self.process.stderr):
                    if stream is not None and stream not in live_streams: stream.close()
            raise

    def send(self, sql: str, marker: str) -> None:
        assert marker.isalnum()
        self.process.stdin.write(sql + "\n\\echo " + marker + "\n")
        self.process.stdin.flush()

    def until(self, marker: str) -> list[str]:
        result = []
        deadline = time.monotonic() + 15
        while True:
            line = self.lines.get(timeout=max(0.001, deadline - time.monotonic()))
            if line is None:
                raise RuntimeError("Isolated SQL session failed; retained test data need inspection.")
            if line == marker:
                return result
            result.append(line)
            if len(result) > 64 or time.monotonic() >= deadline:
                raise RuntimeError("Isolated SQL output or wait exceeded its bound.")

    def execute(self, sql: str, marker: str) -> list[str]:
        self.send(sql, marker)
        return self.until(marker)

    def close(self):
        if self.process.poll() is None:
            try:
                self.process.stdin.write("\\q\n")
                self.process.stdin.flush()
                self.process.wait(timeout=5)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                # This is our own test client; disconnect rolls back its open tx.
                self.process.terminate()
                self.process.wait(timeout=5)


def wait_for_block(a_pid: int, b_pid: int) -> None:
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if query(f"select {b_pid}=any(pg_blocking_pids({a_pid}));") == "t":
            return
        time.sleep(0.05)
    raise RuntimeError("The intended real database lock wait was not observed.")


def state() -> dict:
    return json.loads(query("""select jsonb_build_object(
      'migrations',(select count(*) from supabase_migrations.schema_migrations),
      'versions',(select count(*) from terra_private.source_versions),
      'qualifications',(select count(*) from terra_private.automatic_route_qualifications),
      'decisions',(select count(*) from terra_private.machine_candidate_decisions),
      'claims',(select count(*) from terra_private.claims),
      'publications',(select count(*) from terra_private.issue_publications),
      'bindings',(select count(*) from terra_private.issue_publication_machine_bindings),
      'activeHeads',(select count(*) from terra_private.issue_heads where current_publication_id is not null));"""))


def main() -> int:
    if len(sys.argv) != 1:
        raise RuntimeError("The isolated concurrency rehearsal accepts no arguments.")
    inspected = json.loads(run(["docker", "inspect", "--format",
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}', CONTAINER]))
    assert inspected["ports"]["5432/tcp"] == [{"HostIp": "127.0.0.1", "HostPort": "64032"}]
    assert set(inspected["networks"]) == {NETWORK}
    baseline = state()
    assert baseline == {"migrations": 26, "versions": 0, "qualifications": 0, "decisions": 0,
                        "claims": 0, "publications": 0, "bindings": 0, "activeHeads": 0}, \
        "One-shot test requires the preserved empty 26-migration replay; never reset to rerun."
    payload = fictional_activation_payload(distinct_public_target=True)
    assert payload["fixtureKind"] == "rollback_only_machine_activation"
    fixture = (ROOT / "tests/fixtures/tf009_machine_activation_bridge.sql").read_text()
    fixture = fixture.replace("grant terra_issue_reader to postgres;", "")
    quoted = "'" + json.dumps(payload).replace("'", "''") + "'::jsonb"
    assert fixture.count("-- TF_ACTIVATION_INPUT") == 1
    fixture = fixture.replace("-- TF_ACTIVATION_INPUT", f"insert into activation_input values ({quoted});")
    assert fixture.count("or evidence->>'url' is distinct from v.source_url") == 1
    fixture = fixture.replace("or evidence->>'url' is distinct from v.source_url", "")
    assert fixture.count("-- TF_MACHINE_BINDING_INSERT") == 1
    fixture = fixture.replace("-- TF_MACHINE_BINDING_INSERT", """insert into
      terra_private.issue_publication_machine_bindings (publication_id,claim_id,decision_id)
      values (pub_id,fixture_claim_id,d.id);""")
    a = Session()
    b = Session()
    try:
        a.execute(fixture + "\ncommit;\nset statement_timeout='15s'; set lock_timeout='10s';", "SEEDED")
        b.execute("set statement_timeout='15s'; set lock_timeout='10s';", "READY")
        a_pid = int(a.execute("select pg_backend_pid();", "APID")[0])
        b_pid = int(b.execute("select pg_backend_pid();", "BPID")[0])
        revoke = f"begin; update terra_private.source_registrations set allow_public_derived=false where id='{SOURCE}';"
        activation = "begin; select pg_temp.try_fictional_activation(payload) from activation_input;"
        for label, setup, release, expected in [
            ("rights-change-rolled-back", revoke, "rollback;", "activated"),
            ("rights-change-committed", revoke, "commit;", "held"),
        ]:
            b.execute(setup, "LOCKED")
            a.send(activation, "ACTIVATION")
            wait_for_block(a_pid, b_pid)
            b.execute(release, "RELEASED")
            observed = json.loads(a.until("ACTIVATION")[0])
            assert observed["status"] == expected, label
            a.execute("rollback;", "RESET")
            assert state()["publications"] == 0 and state()["bindings"] == 0, label
            print(f"PASS {label}: lock observed, result {expected}, publication rolled back.")

        # Reinstatement concerns only the explicitly fictional isolated seed.
        b.execute(f"update terra_private.source_registrations set allow_public_derived=true where id='{SOURCE}';", "RESTORED")
        b.execute("""begin; insert into terra_private.automatic_route_qualifications
          (registration_id,change_class,revision,decision,exact_endpoint,policy_version,
           parser_version,decision_reference,decided_by,decided_at)
          select registration_id,change_class,2,'suspended',exact_endpoint,policy_version,
            parser_version,'fictional-race-suspension','fictional-test-owner',
            '2026-09-28T06:01:30Z' from terra_private.automatic_route_qualifications
          where revision=1;""", "LOCKED")
        a.send(activation, "ACTIVATION")
        wait_for_block(a_pid, b_pid)
        b.execute("commit;", "RELEASED")
        assert json.loads(a.until("ACTIVATION")[0])["status"] == "held"
        a.execute("rollback;", "RESET")
        after = state()
        assert after == {"migrations": 26, "versions": 1, "qualifications": 2, "decisions": 1,
                         "claims": 0, "publications": 0, "bindings": 0, "activeHeads": 0}
        print("PASS qualification-suspended: lock observed, stale qualification held.")
        print("Three real two-session fictional races passed. Invented seed and suspension retained only on isolated volume; zero publication/head/binding changes remain.")
        return 0
    finally:
        b.close()
        a.close()


if __name__ == "__main__":
    raise SystemExit(main())
