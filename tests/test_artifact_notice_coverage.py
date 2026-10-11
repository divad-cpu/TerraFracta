"""Actual packet ownership/notice integration, without executing package code."""
from hashlib import sha256
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts import artifact_notice_coverage as coverage
from scripts import prepare_local_web_candidate as candidate
from tests import test_local_web_candidate as support


class ArtifactNoticeCoverageTests(unittest.TestCase):
    def setUp(self):
        helper=support.LocalWebCandidateTests();helper.setUp();self.addCleanup(helper.doCleanups)
        self.root=helper.root;self.destination=helper.destination
        self.standalone=helper.standalone
        (self.standalone/'node_modules/example/package.json').write_bytes(
            (self.root/'node_modules/example/package.json').read_bytes())
        (self.standalone/'node_modules/example/index.js').write_bytes(
            (self.root/'node_modules/example/index.js').read_bytes())

    def add_package(self,name,*,notice=True,compiled=None,native=False):
        original=self.root/'node_modules'/name;shipped=self.standalone/'node_modules'/name
        original.mkdir(parents=True);shipped.mkdir(parents=True)
        meta=json.dumps({'name':name,'version':'1.0','license':'MIT'}).encode()
        for p in (original,shipped):
            (p/'package.json').write_bytes(meta);(p/'index.js').write_text('throw new Error("do not execute");')
        if notice:(original/'LICENSE').write_bytes(b'invented complete notice\n')
        if native:
            for p in (original,shipped):(p/'library.so.1').write_bytes(b'invented native bytes')
        if compiled:
            for p in (original,shipped):(p/'dist/compiled'/compiled).mkdir(parents=True)
            (original/'dist/compiled'/compiled/'LICENSE').write_bytes(b'invented compiled notice\n')
            for p in (original,shipped):(p/'dist/compiled'/compiled/'index.js').write_text('never execute')
        return original,shipped

    def test_untraced_package_and_scoped_compiled_notice_are_preserved_in_actual_packet(self):
        self.add_package('additional');self.add_package('next',compiled='@scope/component')
        manifest=candidate.prepare_candidate(self.root,self.destination)
        self.assertEqual(manifest['schemaVersion'],2)
        report=coverage.verify_artifact_notices(self.destination)
        self.assertEqual(report['packages'],3);self.assertEqual(report['compiledComponents'],1)
        saved=json.loads((self.destination/'artifact-notices/ARTIFACT_NOTICE_MANIFEST.json').read_bytes())
        copied=[r for r in saved['noticeFiles'] if r['storedPath'].startswith('artifact-notices/files/')]
        self.assertEqual(len(copied),3)
        self.assertEqual(saved['compiledComponents'][0]['component'],'dist/compiled/@scope/component')
        self.assertEqual((self.destination/copied[-1]['storedPath']).read_bytes(),b'invented compiled notice\n')
        self.assertFalse(report['releaseCleared']);self.assertFalse(saved['browserModuleProvenanceEstablished'])

    def test_missing_text_and_native_obligations_remain_explicitly_unresolved(self):
        self.add_package('missing',notice=False,native=True)
        candidate.prepare_candidate(self.root,self.destination)
        saved=json.loads((self.destination/'artifact-notices/ARTIFACT_NOTICE_MANIFEST.json').read_bytes())
        self.assertEqual(saved['packagesWithoutNamedNotice'],['node_modules/missing'])
        self.assertEqual(saved['nativeFiles'][0]['sha256'],sha256(b'invented native bytes').hexdigest())
        self.assertFalse(saved['nativeObligationsReviewed']);self.assertFalse(saved['releaseCleared'])
        self.assertEqual(len(saved['browserAssets']),1)

    def test_readback_needs_no_original_install_and_never_executes_dependencies(self):
        candidate.prepare_candidate(self.root,self.destination)
        with patch.object(coverage,'_source_notices',side_effect=AssertionError('Original installation opened')):
            self.assertEqual(coverage.verify_artifact_notices(self.destination)['packages'],1)
            self.assertFalse(candidate.verify_candidate(self.destination)['filesExecuted'])

    def test_actual_generated_assets_do_not_inherit_package_or_license_coverage(self):
        p=self.standalone/'.next/server/route.js';p.parent.mkdir(parents=True)
        p.write_text('invented application and dependency mixture')
        candidate.prepare_candidate(self.root,self.destination)
        saved=json.loads((self.destination/'artifact-notices/ARTIFACT_NOTICE_MANIFEST.json').read_bytes())
        self.assertEqual(saved['generatedApplicationAssets'][0]['path'],'.next/server/route.js')
        self.assertFalse(saved['generatedModuleProvenanceEstablished'])

    def test_native_outside_node_modules_is_still_reported_and_held(self):
        p=self.standalone/'.next/server/owned-addon.node';p.parent.mkdir(parents=True)
        p.write_bytes(b'invented native addon')
        candidate.prepare_candidate(self.root,self.destination)
        saved=json.loads((self.destination/'artifact-notices/ARTIFACT_NOTICE_MANIFEST.json').read_bytes())
        self.assertEqual(saved['nativeFiles'][0]['path'],'.next/server/owned-addon.node')
        self.assertFalse(saved['nativeObligationsReviewed'])

    def test_metadata_parse_and_hash_share_one_inventory_bound_body(self):
        candidate.prepare_candidate(self.root,self.destination)
        path=self.destination/'node_modules/example/package.json';original=path.read_bytes()
        read=coverage.private_read
        def changed(p,**kwargs):
            if p==path:
                alternate=json.loads(original);alternate['version']='9.9.9'
                path.write_text(json.dumps(alternate))
                try:return read(p,**kwargs)
                finally:path.write_bytes(original)
            return read(p,**kwargs)
        with patch.object(coverage,'private_read',side_effect=changed),self.assertRaises(ValueError):
            coverage.verify_artifact_notices(self.destination)

    def test_historical_v1_remains_readable_but_cannot_hide_present_v2_supplement(self):
        import shutil
        candidate.prepare_candidate(self.root,self.destination)
        manifest=self.destination/candidate.MANIFEST
        outer=json.loads(manifest.read_bytes());outer['schemaVersion']=1;outer.pop('artifactNoticeVerification')
        manifest.write_text(json.dumps(outer))
        with self.assertRaises(ValueError):candidate.verify_candidate(self.destination)
        # Synthetic reconstruction of the old contract, never a historical witness.
        shutil.rmtree(self.destination/'artifact-notices')
        inventory=candidate._inventory(self.destination,private=True)
        inventory['entries']=[r for r in inventory['entries'] if r['path']!=candidate.MANIFEST]
        inventory['bytes']-=manifest.stat().st_size
        outer['inventory']=inventory;manifest.write_text(json.dumps(outer))
        self.assertFalse(candidate.verify_candidate(self.destination)['releaseCleared'])

    def test_explicit_candidate_only_files_cannot_become_runtime_owners(self):
        original,_=self.add_package('next',compiled='@scope/runtime')
        absent=original/'dist/compiled/@scope/absent';absent.mkdir()
        (absent/'LICENSE').write_text('invented candidate-only notice')
        # Tracing an outer namespace creates a broader candidate selection.
        saved_path=self.root/'docs/OSS_PACKAGE_INVENTORY.json'
        saved=json.loads(saved_path.read_bytes())
        saved['packages'].append({'name':'next','version':'1.0','declared_license':'MIT','top_level_notice_files':[
            {'file':'LICENSE','bytes':25,'sha256':sha256(b'invented complete notice\n').hexdigest()}]})
        saved_path.write_text(json.dumps(saved))
        (self.root/'.next/test.nft.json').write_text(json.dumps({'version':1,'files':[
            '../node_modules/example/index.js','../node_modules/next/dist/compiled/@scope']}))
        candidate.prepare_candidate(self.root,self.destination)
        saved=json.loads((self.destination/'artifact-notices/ARTIFACT_NOTICE_MANIFEST.json').read_bytes())
        self.assertEqual([r['component'] for r in saved['compiledComponents']],['dist/compiled/@scope/runtime'])
        self.assertEqual(len(saved['candidateOnlyNoticeFiles']),1)

    def test_v2_cannot_remove_coverage_or_promote_authority_even_after_outer_rehash(self):
        candidate.prepare_candidate(self.root,self.destination)
        target=self.destination/'artifact-notices/ARTIFACT_NOTICE_MANIFEST.json'
        original=target.read_bytes()
        for change in (lambda v:v.update(releaseCleared=True),lambda v:v['packages'].clear(),
                       lambda v:v.update(nativeObligationsReviewed=True),lambda v:v.update(browserModuleProvenanceEstablished=True)):
            saved=json.loads(original);change(saved);target.write_text(json.dumps(saved))
            with self.assertRaises(ValueError):coverage.verify_artifact_notices(self.destination)
        target.write_bytes(original)
        manifest=self.destination/candidate.MANIFEST;outer=json.loads(manifest.read_bytes())
        outer.pop('artifactNoticeVerification');manifest.write_text(json.dumps(outer))
        with self.assertRaises(ValueError):candidate.verify_candidate(self.destination)

    def test_changed_or_unlisted_notice_payload_is_preserved_but_refused(self):
        self.add_package('additional');candidate.prepare_candidate(self.root,self.destination)
        saved=json.loads((self.destination/'artifact-notices/ARTIFACT_NOTICE_MANIFEST.json').read_bytes())
        copied=next(r for r in saved['noticeFiles'] if r['storedPath'].startswith('artifact-notices/files/'))
        p=self.destination/copied['storedPath'];p.write_bytes(b'changed')
        with self.assertRaises(ValueError):coverage.verify_artifact_notices(self.destination)
        self.assertEqual(p.read_bytes(),b'changed')

    def test_private_or_linked_source_notice_is_refused_without_opening_body(self):
        original,_=self.add_package('next',compiled='component')
        forbidden=original/'dist/compiled/component/.env.private/LICENSE'
        forbidden.parent.mkdir();forbidden.write_bytes(b'private-canary')
        with self.assertRaises(ValueError) as error:candidate.prepare_candidate(self.root,self.destination)
        self.assertNotIn('private-canary',str(error.exception))
        self.assertFalse((self.destination/candidate.MANIFEST).exists())

    def test_same_version_different_metadata_or_module_bytes_cannot_supply_notices(self):
        original,_=self.add_package('additional')
        (original/'index.js').write_text('different installed package content')
        with self.assertRaises(ValueError):candidate.prepare_candidate(self.root,self.destination)
        self.assertFalse((self.destination/candidate.MANIFEST).exists())

    def test_notice_drift_during_copy_keeps_partial_packet_and_refuses_completion(self):
        original,_=self.add_package('additional');write=coverage._exclusive
        def changed(path,body):
            write(path,body)
            if path.name=='LICENSE' and 'artifact-notices' in path.parts:
                (original/'LICENSE').write_bytes(b'changed during copy')
        with patch.object(coverage,'_exclusive',side_effect=changed),self.assertRaises(ValueError):
            candidate.prepare_candidate(self.root,self.destination)
        self.assertTrue(self.destination.is_dir());self.assertFalse((self.destination/candidate.MANIFEST).exists())


if __name__=='__main__':unittest.main()
