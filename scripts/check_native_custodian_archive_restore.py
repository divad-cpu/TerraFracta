"""Restore the new cold archive and read retained custodian cases, never replay."""
from datetime import datetime,timezone
import json
import sys

from scripts import check_closed_worker_archive_restore as restore
from scripts.check_private_attempt_recovery_native import CASES
from scripts.check_private_attempt_readiness import private_read
from scripts.captured_fictional_pipeline import private_file
from scripts.fictional_trial_guard import fixed_trial_guard
from workers.private_attempt_recovery import classify_private_attempt_recovery
from workers.private_recovery_sql import private_recovery_snapshot_sql
from workers.ssb_14059_raw_custody import PrivateRawCustody


def extra_readback(query):
    reports=[]
    for index,(suffix,expected) in enumerate(CASES,1):
        original=restore.BASE/('authenticated-ssb-pair-'+suffix)
        admission=private_read(original/'PRIVATE_NATIVE_ADMISSION.json',limit=16384).rstrip(b'\n')
        # The recovery helper already adds a read-only transaction. Remove only
        # this builder's exact outer BEGIN/ROLLBACK, retaining its fixed SELECT.
        sql=private_recovery_snapshot_sql(admission)
        head='begin isolation level repeatable read read only;\n'
        if not sql.startswith(head) or not sql.endswith('rollback;\n'):raise ValueError('Recovery SQL head changed')
        statement="set transaction isolation level repeatable read;"+sql[len(head):-len('rollback;\n')]
        with PrivateRawCustody(original/'fixture-raw-store') as custody:
            raw=query('terra_ssb_pair_'+suffix,statement).encode()
            report=classify_private_attempt_recovery(admission,raw,custody,now=datetime.now(timezone.utc))
        if report['state']!=expected:raise ValueError('Restored private attempt differs')
        private_file(restore.PROOF/(str(index).zfill(2)+'_RESTORED_PRIVATE_RECOVERY.json'),json.dumps(report,indent=2)+'\n')
        reports.append(report)
    histories=int(query('postgres',"select count(*) from pg_database where datname like 'terra_%';"))
    return {'retainedDatabaseHistories':histories,'privateAttemptRecovery':reports,
        'retiredRuntimeAccountsReactivated':False,'newAdmissionIssued':False,'writeReplayed':False,
        'rawCopiesCreated':False,'sourceRequests':0,'archivedCodeExecuted':False}


def main():
    if sys.argv[1:]:raise ValueError('Fixed custodian archive recovery accepts no arguments')
    restore.ARCHIVE=restore.BASE/'native-custodian-database-preservation-20261002'
    restore.PROOF=restore.BASE/'native-custodian-archive-restore-20261002'
    restore.TARGET='terrafracta_restore_native_custodian_20261002'
    restore.RECOVERY_LABEL='terrafracta.native-custodian-recovery=20261002'
    restore.RAW_CASE='20261002105101_0e5991'
    restore.EXTRA_CASES={suffix:((0,0,1,0,0) if index==0 else (1,2,2,2,1))
        for index,(suffix,_) in enumerate(CASES)}
    with fixed_trial_guard():return restore.main(extra_readback=extra_readback,
        evidence_kind='actual_native_custodian_and_read_only_recovery_archive_restore')


if __name__=='__main__':raise SystemExit(main())
