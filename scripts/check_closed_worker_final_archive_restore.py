"""Restore the closing archive, including later validated-log/custody cases."""
from scripts import check_closed_worker_archive_restore as restore

if __name__=='__main__':
    restore.ARCHIVE=restore.BASE/'closed-worker-final-database-preservation-20261001'
    restore.PROOF=restore.BASE/'closed-worker-final-archive-restore-20261001'
    restore.TARGET='terrafracta_restore_closed_worker_final_20261001'
    restore.RAW_CASE='20261001180041_1197b0'
    restore.EXTRA_CASES={
        '20261001180041_1197b0':(1,2,2,2,1),
        '20261001180311_9fb7c7':(0,0,2,2,0),
        '20261001180319_fe8f78':(1,2,2,2,1),
        '20261001180327_31cb19':(0,0,2,2,0)}
    raise SystemExit(restore.main())
