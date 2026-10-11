"""Fixed rollback-only candidate check on the new isolated 29-migration target."""

from pathlib import Path
import json
import re
import sys

from scripts.fictional_response_backend import verify_target,query,STATE
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_run_admission_cases import fictional_request
from workers.update_request_identity import canonical_update_request

ROOT = Path(__file__).resolve().parents[1]


def main():
    installed=sys.argv[1:]==['--installed']
    if sys.argv[1:] and not installed:raise RuntimeError('Only fixed installed rollback mode is accepted')
    verify_target(migration_count=31 if installed else 29);before=json.loads(query(STATE))
    assert (query("select to_regclass('terra_private.source_response_reservations') is null;")=='t') != installed
    overlay='' if installed else (ROOT/'research/pending/TF009_response_reservations.sql').read_text()
    outside=re.sub(r'--[^\n]*','',overlay)
    outside=re.sub(r'(\$[A-Za-z_0-9]*\$)[\s\S]*?\1',"''",outside)
    assert not re.search(r'(?:^|;)\s*(?:begin|commit|rollback|abort|end|prepare\s+transaction)\b',outside,re.I|re.M)
    assert not re.search(r'^\s*\\',outside,re.M)
    sql=(ROOT/'research/pending/TF009_response_reservations.test.sql').read_text()
    assert sql.count('-- TF_RESPONSE_RESERVATION_OVERLAY')==1
    assert sql.count('-- TF_RESPONSE_REQUEST_CANONICAL')==1
    sql=sql.replace('-- TF_RESPONSE_RESERVATION_OVERLAY',overlay).replace('-- TF_RESPONSE_REQUEST_CANONICAL',
        'create temporary table response_template(canonical text);insert into response_template values('+quote(canonical_update_request(fictional_request()))+');')
    try:
        tap=query(sql)
        passed=len(re.findall(r'^ok \d+\b',tap,re.M))
        plan=re.search(r'^1\.\.(\d+)$',tap,re.M)
        assert plan and int(plan.group(1))==passed and passed>=25,tap
        assert not re.search(r'^not ok|^# (?:Looks like|Failed)',tap,re.M),tap
        print(f'PASS {passed} rollback pgTAP response-reservation checks on verified isolated migration-{before["migrations"]} baseline.')
    finally:
        assert json.loads(query(STATE))==before
        assert (query("select to_regclass('terra_private.source_response_reservations') is null;")=='t') != installed
    print('All test mutations rolled back; existing objects/history preserved and primary untouched.')
    return 0


if __name__=='__main__':raise SystemExit(main())
