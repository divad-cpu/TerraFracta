"""Native private-collector wiring rehearsal with one explicit fixture module.

Current collector source is retained; a fresh private copy substitutes the
entire HTTP module with a literal network-free fixture implementation. The
changed full inventory is independently pinned in this new fictional database.
This proves wiring, not execution of the original HTTP module or TLS origin.
"""
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
import secrets
import sys
from scripts.captured_fictional_pipeline import ROOT,private_file
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_ssb_pair_capture import PRIVATE,_run_trial
from scripts.run_raw_unknown_pair_trial import runtime_with_raw
from scripts.ssb_private_collector_inventory import inventory,verify,freeze_private_collector_source
from scripts.private_collector_wiring_source import TRANSPORT,invented_transport_bytes,check_private_wiring_source


def main():
    if sys.argv[1:]:raise ValueError('Fixed invented private wiring trial accepts no arguments')
    with fixed_trial_guard():
        os.umask(0o077)
        proof=PRIVATE/('private-collector-wiring-source-'+datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')+'_'+secrets.token_hex(3))
        staged=proof/'source';staged.mkdir(mode=0o700,parents=True)
        original_raw=inventory(ROOT);original=json.loads(original_raw);stub=invented_transport_bytes()
        for name,expected in original['files'].items():
            body=(ROOT/name).read_bytes()
            if sha256(body).hexdigest()!=expected:raise ValueError('Collector source changed before staging')
            path=staged/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            private_file(path,(stub if name==TRANSPORT else body).decode('utf-8'))
        raw=inventory(staged);pin=sha256(raw).hexdigest();private_file(staged/'MANIFEST.json',raw.decode('ascii'))
        checked=verify(staged,pin);source=freeze_private_collector_source(staged,pin)
        try:
            check_private_wiring_source(source)
            (proof/'SEALED_SOURCE.zip').write_bytes(source.check());(proof/'SEALED_SOURCE.zip').chmod(0o600)
            private_file(proof/'SOURCE_BINDING.json',json.dumps({**checked,'originalCollectorInventorySha256':sha256(original_raw).hexdigest(),
                'substitutedModule':TRANSPORT,'substitutedModuleSha256':sha256(stub).hexdigest(),
                'simulatedHttpTransport':True,'actualTlsAcceptance':False,'sourceRequests':0,
                'sourceArchiveSha256':source.archive_sha256,'runtimePermissionCreated':False},indent=2)+'\n')
            def runner(*args):return runtime_with_raw(*args,transport_children=True,private_collector_source=source)
            result=_run_trial('nominal',runtime_runner=runner,unknown_response_mode=True,raw_custody_mode=True,code_fingerprint=pin)
            result.update(evidenceKind='actual_private_collector_wiring_with_invented_transport',
                simulatedHttpTransport=True,actualTlsAcceptance=False,sourceFingerprint=pin,sourceFiles=source.source_files,
                sourceEvidenceDirectory=str(proof),originalHttpModuleExecuted=False)
            private_file(proof/'RESULT.json',json.dumps(result,indent=2)+'\n')
        finally:source.close()
    print(json.dumps(result,indent=2));return 0


if __name__=='__main__':raise SystemExit(main())
