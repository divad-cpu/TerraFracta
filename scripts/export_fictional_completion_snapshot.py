"""Export only display counts from the fixed three retained invented trials.

Readonly database projection; --write updates one checked-in development
fixture. No raw source, identity, lease, connection string or credential is
exported. The website reads the fixture and has no database connection.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

from scripts.check_run_completion_commit import CONTAINER, NETWORK, PORT, query
from scripts.check_final_completion_commit import CONTAINER as FINAL_CONTAINER, NETWORK as FINAL_NETWORK
from scripts.check_run_admission_draft import query as owner_query


ROOT = Path(__file__).resolve().parents[1]
PROJECTION = """select jsonb_build_object(
 'storedRuns',(select count(*) from terra_private.update_run_closeouts c join terra_private.update_runs r on r.id=c.run_id
   where r.request_key in('fictional:manual:2026w40','fictional:completion:decision-first','fictional:completion:closeout-first')),
 'sourceContentVersions',(select count(*) from terra_private.source_versions),
 'freshSourceChecks',(select count(*) from terra_private.update_run_source_checks c join terra_private.update_runs r on r.id=c.run_id
   where r.request_key in('fictional:manual:2026w40','fictional:completion:decision-first','fictional:completion:closeout-first')),
 'cases',(select jsonb_agg(jsonb_build_object(
   'caseKey',case r.request_key when 'fictional:manual:2026w40' then 'stored_fact'
     when 'fictional:completion:decision-first' then 'held_finished'
     when 'fictional:completion:closeout-first' then 'missing_decision' end,
   'finishedAt',c.finished_at,'runState',c.summary->>'runState','commitState',c.summary->>'commitState',
   'visibilityState',c.summary->>'visibilityState',
   'expectedSources',jsonb_array_length(c.summary->'dueSourceKeys'),
   'coveredSources',jsonb_array_length(c.summary->'coveredSourceKeys'),
   'expectedItems',(c.summary->>'expectedItems')::integer,'decidedItems',(c.summary->>'decidedItems')::integer,
   'heldItems',(c.summary->>'heldItems')::integer,'pendingItems',jsonb_array_length(c.summary->'pendingItemKeys'),
   'storedFacts',jsonb_array_length(c.summary->'committedPublicationIds'),
   'visibleFacts',jsonb_array_length(c.summary->'visiblePublicationIds'))
   order by case r.request_key when 'fictional:manual:2026w40' then 1
     when 'fictional:completion:decision-first' then 2 else 3 end)
   from terra_private.update_run_closeouts c join terra_private.update_runs r on r.id=c.run_id
   join terra_private.update_run_manifests m on m.run_id=c.run_id and m.manifest_sha256=c.manifest_sha256
   where r.request_key in('fictional:manual:2026w40','fictional:completion:decision-first','fictional:completion:closeout-first')
    and r.run_state=c.summary->>'runState' and r.commit_state=c.summary->>'commitState'
    and r.visibility_state=c.summary->>'visibilityState' and r.finished_at=c.finished_at));
"""


def main() -> int:
    if sys.argv[1:] not in ([], ["--write"], ["--check"]):
        raise RuntimeError("Only the fixed display-fixture write/check modes are supported")
    metadata = json.loads(subprocess.run(["docker", "inspect", "--format",
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',
        CONTAINER], text=True, capture_output=True, check=True, timeout=10).stdout)
    assert metadata["ports"]["5432/tcp"] == [{"HostIp": "127.0.0.1", "HostPort": PORT}]
    assert set(metadata["networks"]) == {NETWORK}
    data = json.loads(query(PROJECTION))
    assert (data["storedRuns"],data["sourceContentVersions"],data["freshSourceChecks"]) == (3,1,2)
    assert len(data["cases"]) == 3 and [entry["caseKey"] for entry in data["cases"]] == ["stored_fact","held_finished","missing_decision"]
    final_metadata = json.loads(subprocess.run(["docker","inspect","--format",
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',FINAL_CONTAINER],
        text=True,capture_output=True,check=True,timeout=10).stdout)
    assert final_metadata["ports"]["5432/tcp"] == [{"HostIp":"127.0.0.1","HostPort":"64832"}]
    assert set(final_metadata["networks"]) == {FINAL_NETWORK}
    final = json.loads(owner_query(FINAL_CONTAINER,PROJECTION))
    assert (final["storedRuns"],final["sourceContentVersions"],final["freshSourceChecks"]) == (1,1,1)
    assert len(final["cases"]) == 1 and final["cases"][0]["caseKey"] == "stored_fact"
    identity_sql = "select id::text||':'||content_sha256 from terra_private.source_versions;"
    assert query(identity_sql) == owner_query(FINAL_CONTAINER,identity_sql)
    # Show the corrected full-path result, keeping the older trial intact on
    # its volume. Three selected outcomes use one identical invented version.
    data = {"displayedRuns":3,"sourceContentVersions":1,"freshSourceChecks":3,"unchangedSourceChecks":2,
            "cases":[final["cases"][0],*data["cases"][1:]]}
    snapshot = {"schemaVersion":1,"evidenceKind":"isolated_fictional_closeouts", "recordedAt":datetime.now(timezone.utc).isoformat(),
        "liveCollectionEnabled":False,"livePublicationEnabled":False,**data}
    encoded = json.dumps(snapshot, indent=2) + "\n"
    assert len(encoded.encode()) <= 16384
    if sys.argv[1:] == ["--check"]:
        saved = json.loads((ROOT/"fixtures/fictional_completion_snapshot.json").read_text())
        assert set(saved) == set(snapshot) and saved['recordedAt'] <= snapshot['recordedAt']
        assert {key:value for key,value in saved.items() if key != 'recordedAt'} == {
            key:value for key,value in snapshot.items() if key != 'recordedAt'}
        assert all(datetime.fromisoformat(entry['finishedAt']) <= datetime.fromisoformat(saved['recordedAt'])
                   for entry in saved['cases'])
        print("Saved fixture matches the three selected immutable closeouts; later regression records remain untouched.")
    elif sys.argv[1:] == ["--write"]:
        (ROOT/"fixtures/fictional_completion_snapshot.json").write_text(encoded)
        print("Exported three selected fictional results, one identical content version and three fresh checks, including two unchanged checks; no private identity fields.")
    else:
        print(encoded,end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
