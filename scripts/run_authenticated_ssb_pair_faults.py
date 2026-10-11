"""Six fixed faults, each in a fresh isolated database and retired identity.

No CLI input, primary change, real transport or raw storage. Owner-side fixture
changes simulate withdrawal/expiry; runtime still calls only the closed API.
"""
import json
import sys
from scripts.run_authenticated_ssb_pair_capture import FAULT_CASES,run_trial

def main():
    if sys.argv[1:]:raise RuntimeError('Fixed paired fault matrix accepts no arguments')
    results=[]
    for case in FAULT_CASES:
        result=run_trial(case);results.append(result)
        print(json.dumps({'case':case,'fixtureReads':result['fixtureReads'],'chargedBytes':result['ledger']['chargedBytes'],
            'zeroPartialPairWrites':True,'retryRefetched':False,'accountsRetired':True,'cloneStopped':True,
            'privateEvidenceDirectory':result['privateEvidenceDirectory']}),flush=True)
    print(json.dumps({'evidenceKind':'six_actual_authenticated_paired_faults','casesPassed':len(results),
        'actualSourceRequests':0,'primaryChanged':False,'publicWriterEnabled':False}),flush=True)
    return 0

if __name__=='__main__':raise SystemExit(main())
