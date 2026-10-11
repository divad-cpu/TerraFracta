"""Cold preserve one owned clone and five exact invented filesystem histories."""
import json
import sys
from hashlib import sha256

from scripts import preserve_connected_trial_databases as preserve
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.journaled_trial_files import (
    ARCHIVE, BASE, CASES, DATABASE_ARCHIVE, FILES_ARCHIVE, WEB,
    copy_selected, manifest_for, rechecked_manifest, selected_files, write_exact,
)
from workers.private_custodian_journal import read_private_custodian_journal


def main():
    if sys.argv[1:]: raise ValueError('Fixed invented preservation accepts no arguments')
    with fixed_trial_guard():
        selected = selected_files(lambda suffix:BASE/('authenticated-ssb-pair-'+suffix), BASE/WEB)
        for _, suffix, expected, *_ in CASES:
            journal = read_private_custodian_journal(BASE/('authenticated-ssb-pair-'+suffix)/'fixture-custodian-journal')
            if journal['state'] != expected or journal['nativeCleanupConfirmed'] is not True:
                raise ValueError('Invented journal must be reconciled before preservation')
        manifest = manifest_for(selected)
        ARCHIVE.mkdir(mode=0o700)
        copy_selected(selected, manifest, FILES_ARCHIVE)
        preserve.DEST = DATABASE_ARCHIVE
        preserve.TARGETS = {'terrafracta_authenticated_capture_v3_20261001':'terrafracta.capture-auth'}
        preserve.main(evidence_kind='one_owned_journaled_guarded_trial_cold_archive')
        if rechecked_manifest(selected) != manifest: raise ValueError('Invented originals changed')
        receipt = {'evidenceKind':'five_invented_histories_and_one_cold_database_archive',
            'filesystemManifestSha256':sha256((FILES_ARCHIVE/'MANIFEST.json').read_bytes()).hexdigest(),
            'databaseReceiptSha256':sha256((DATABASE_ARCHIVE/'CONNECTED_PRESERVATION_RESULT.json').read_bytes()).hexdigest(),
            'exactFilesystemFiles':30, 'actualRawStoreCopied':False, 'originalsRetained':True,
            'containsRetiredAuthenticationVerifiers':True, 'externalBackup':False, 'primaryChanged':False}
        write_exact(ARCHIVE/'PRESERVATION_RESULT.json', (json.dumps(receipt, indent=2)+'\n').encode())
    print('PASS private invented journals/raw files and cold database archive; originals retained.')
    return 0


if __name__ == '__main__': raise SystemExit(main())
