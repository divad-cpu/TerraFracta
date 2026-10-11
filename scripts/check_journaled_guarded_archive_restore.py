"""Restore private invented files and cold database to new owned destinations.

No original raw root is opened by custody. Fresh read-only native snapshots
reconcile the restored files, without admission, replay, repair or publication.
"""
from datetime import datetime, timezone
import json
import sys
from hashlib import sha256

from scripts import check_closed_worker_archive_restore as restore
from scripts.check_private_attempt_readiness import private_read
from scripts.fictional_trial_guard import fixed_trial_guard, trial_process_lock
from scripts.journaled_trial_files import (
    ARCHIVE, CASES, DATABASE_ARCHIVE, FILES_ARCHIVE, FILES_RESTORE, WEB,
    archived_files, copy_selected, manifest_for, rechecked_manifest, write_exact,
)
from workers.invented_operation_journal import inspect_invented_operation, JOURNALED_KIND
from workers.private_attempt_recovery import inspect_journaled_private_attempt_recovery
from workers.private_custodian_journal import FILENAME
from workers.private_recovery_sql import private_recovery_snapshot_sql
from workers.ssb_14059_raw_custody import PrivateRawCustody


def extra_readback(query):
    reports = []
    accounts = "select count(*) from pg_roles where rolname like 'terra_%' and rolcanlogin;"
    if query('postgres', accounts) != '0': raise ValueError('Restored application account is active')
    for label, suffix, journal_state, expected, charge in CASES:
        case = FILES_RESTORE/suffix; journal = case/'fixture-custodian-journal'
        admission = private_read(journal/FILENAME, limit=16384).rstrip(b'\n')
        sql = private_recovery_snapshot_sql(admission)
        head = 'begin isolation level repeatable read read only;\n'; tail = 'rollback;\n'
        if not sql.startswith(head) or not sql.endswith(tail): raise ValueError('Recovery SQL wrapper changed')
        statement = 'set transaction isolation level repeatable read;'+sql[len(head):-len(tail)]
        # A new coordination lock belongs only to this new restored directory.
        with PrivateRawCustody(case/'fixture-raw-store') as custody:
            raw = query('terra_ssb_pair_'+suffix, statement).encode()
            report = inspect_journaled_private_attempt_recovery(journal, raw, custody, now=datetime.now(timezone.utc))
        native = report['nativeRecovery']
        if report['state'] != expected or report['journalState'] != journal_state \
                or report['nativeSnapshotChecked'] is not True or native['readingChargeBytes'] != charge \
                or native['retainedRawPairs'] != (0 if label == 'owned_cancellation' else 1):
            raise ValueError('Restored invented journal/native/raw state differs')
        reports.append({'case':label, **report})
    if query('postgres', accounts) != '0': raise ValueError('Restored account retirement changed')
    databases = json.loads(query('postgres',
        "select coalesce(jsonb_agg(datname order by datname),'[]'::jsonb) from pg_database where datname like 'terra_%';"))
    if not all('terra_ssb_pair_'+suffix in databases for _, suffix, *_ in CASES):
        raise ValueError('Restored database inventory is incomplete')
    write_exact(restore.PROOF/'RESTORED_DATABASE_INVENTORY.json', (json.dumps(databases, indent=2)+'\n').encode())
    original, manifest = archived_files()
    if rechecked_manifest(original) != manifest: raise ValueError('Preserved files changed during recovery')
    restored = {row['path']:FILES_RESTORE/row['path'] for row in manifest['files']}
    if rechecked_manifest(restored) != manifest: raise ValueError('Restored file bytes changed during recovery')
    return {'journaledRecovery':reports, 'exactFilesystemFiles':30,
        'retainedDatabaseHistories':len(databases), 'restoredFilesystemUsed':True,
        'originalRawCustodyOpened':False, 'retiredRuntimeAccountsReactivated':False,
        'newAdmissionIssued':False, 'writeReplayed':False, 'repairPerformed':False,
        'sourceRequests':0, 'publicationEnabled':False, 'archivedCodeExecuted':False}


def main():
    if sys.argv[1:]: raise ValueError('Fixed invented archive restoration accepts no arguments')
    with fixed_trial_guard():
        receipt = json.loads(private_read(ARCHIVE/'PRESERVATION_RESULT.json', limit=65536))
        for path, field in ((FILES_ARCHIVE/'MANIFEST.json','filesystemManifestSha256'),
                (DATABASE_ARCHIVE/'CONNECTED_PRESERVATION_RESULT.json','databaseReceiptSha256')):
            if sha256(private_read(path, limit=65536)).hexdigest() != receipt[field]:
                raise ValueError('Fixed private preservation binding differs')
        original, manifest = archived_files()
        copy_selected(original, manifest, FILES_RESTORE)
        with trial_process_lock(FILES_RESTORE/WEB, create=True): pass
        if inspect_invented_operation(FILES_RESTORE/WEB, expected_kind=JOURNALED_KIND)['state'] != 'checked':
            raise ValueError('Restored v4 operation chain differs')
        restore.ARCHIVE = DATABASE_ARCHIVE
        restore.PROOF = restore.BASE/'journaled-guarded-archive-restore-20261004'
        restore.TARGET = 'terrafracta_restore_journaled_guarded_20261004'
        restore.RECOVERY_LABEL = 'terrafracta.journaled-guarded-recovery=20261004'
        restore.RAW_CASE = CASES[0][1]
        restore.EXTRA_CASES = {suffix:((0,0,1,0,0) if label == 'owned_cancellation' else (1,2,2,2,1))
            for label, suffix, *_ in CASES}
        return restore.main(extra_readback=extra_readback,
            evidence_kind='actual_restored_journaled_guarded_database_and_filesystem_recovery',
            raw_binding_path=FILES_RESTORE/CASES[0][1]/'RAW_POST_COMMIT_BINDING.json')


if __name__ == '__main__': raise SystemExit(main())
