from copy import deepcopy
import unittest
from scripts.export_authenticated_publication_snapshot import build_snapshot

def proofs():
    boundary={'network':'none','actualSourceFetches':0,'primaryChanged':False,'runtimeUsesOwnerSql':False,'runtimeVisibilityVerified':False,'generalSqlTimingAccepted':False,'observedAt':'2026-10-01T10:00:00+00:00'}
    good={'case':'qualified_fact','counts':{'closeouts':1,'decisions':1,'activations':1,'fixtureVersions':1},'summary':{'runState':'partial','commitState':'committed','visibilityState':'pending','heldItems':0,'visiblePublicationIds':[]}}
    held={'case':'rights_withdrawn','counts':{'closeouts':1,'decisions':1,'activations':0,'fixtureVersions':1},'summary':{'runState':'completed','commitState':'none','visibilityState':'not_required','heldItems':1,'visiblePublicationIds':[]}}
    bad={'case':'bad_display','counts':{'closeouts':0,'activations':0,'activeHeads':0},'deniedBeforeCommit':True}
    record={**boundary,'evidenceKind':'actual_closed_scram_capture_decision_activation_closeout','cases':[good,held,bad]}
    commit={**boundary,'evidenceKind':'actual_scram_scope_expiry_and_activation_race','cases':{'expiryAtCommit':{'candidateCheckedBeforeCommit':True,'scopeExpiredDuringTransaction':True,'commitDenied':True,'counts':{'activations':0,'activeHeads':0,'closeouts':0}},'competingActivation':{'actualLockWait':True,'exactCloseoutReplay':True,'responses':['activated','already_activated'],'counts':{'activations':1,'activeHeads':1,'closeouts':1},'fixtureReads':1}}}
    return record,commit
class AuthenticatedPublicationExportTests(unittest.TestCase):
    def test_private_material_is_excluded_from_saved_display(self):
        r,c=proofs();r.update(principal='private',password='private',sql='private');c['cases']['expiryAtCommit']['sessionErrors']=['private']
        result=build_snapshot(r,c)
        self.assertEqual(result['qualifiedFactStored'],1)
        self.assertFalse(any(key in result for key in ('principal','password','sql','sessionErrors')))
        self.assertFalse(result['websiteVisibilityVerified'])
    def test_counter_coercion_or_live_claim_is_refused(self):
        for section,key,value in [('root','actualSourceFetches',True),('counts','activations',True),('root','runtimeVisibilityVerified',True)]:
            r,c=proofs();(r if section=='root' else r['cases'][0]['counts'])[key]=value
            with self.assertRaises(ValueError):build_snapshot(r,c)
    def test_missing_hold_duplicate_case_or_unproved_race_refuses(self):
        for mode in ('duplicate','hold','race','expiry'):
            r,c=proofs()
            if mode=='duplicate':r['cases'][2]=deepcopy(r['cases'][0])
            if mode=='hold':r['cases'][1]['summary']['heldItems']=0
            if mode=='race':c['cases']['competingActivation']['counts']['activations']=2
            if mode=='expiry':c['cases']['expiryAtCommit']['commitDenied']=False
            with self.assertRaises(ValueError):build_snapshot(r,c)
if __name__=='__main__':unittest.main()
