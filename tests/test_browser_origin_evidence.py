"""Compiler data compared with direct/embedded source witnesses; no code evaluation."""
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import prepare_browser_origin_evidence as evidence


class BrowserOriginEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'source';self.root.mkdir()
        self.destination=Path(self.temp.name)/'proof'
        (self.root/'.next/static/chunks').mkdir(parents=True);(self.root/'docs').mkdir()
        (self.root/'.next/BUILD_ID').write_text('invented-audit')
        (self.root/'.next/required-server-files.json').write_text(json.dumps({
            'config':{'output':'standalone','productionBrowserSourceMaps':True,'env':{}}}))
        (self.root/'pnpm-lock.yaml').write_text('invented lock')
        rows=[]
        for name in ('next','zod'):
            package=self.root/'node_modules'/name;package.mkdir(parents=True)
            (package/'package.json').write_text(json.dumps({'name':name,'version':'1.0','license':'MIT'}))
            (package/'LICENSE').write_text('invented notice\n')
            rows.append({'name':name,'version':'1.0','declared_license':'MIT'})
        (self.root/'docs/OSS_PACKAGE_INVENTORY.json').write_text(json.dumps({
            'pnpm_lock_sha256':sha256(b'invented lock').hexdigest(),'packages':rows}))
        self.direct='throw new Error("never evaluate");\n'
        (self.root/'node_modules/zod/index.js').write_text(self.direct)
        self.embedded='export const example = 1;\n'
        p=self.root/'node_modules/next/dist/lib/example.js.map';p.parent.mkdir(parents=True)
        p.write_text(json.dumps({'version':3,'sources':['../../src/lib/example.ts'],
            'sourcesContent':[self.embedded],'mappings':''}))
        self.names=[evidence.PROJECT+'node_modules/zod/index.js',
            evidence.PROJECT+'node_modules/next/src/lib/example.ts']
        self.contents=[self.direct,self.embedded]
        self.map_path=self.root/'.next/static/chunks/origin.js.map'
        self.code_path=self.root/'.next/static/chunks/bundle.js'
        self.code_path.write_text('throw new Error("do not execute");\n//# sourceMappingURL=origin.js.map\n')
        self.write_map()

    def write_map(self):
        self.map_path.write_text(json.dumps({'version':3,'sources':self.names,
            'sourcesContent':self.contents,'mappings':''}))

    def prepare(self):return evidence.prepare_browser_evidence(self.root,self.destination)

    def test_exact_direct_and_embedded_origins_and_available_notices_reopen_without_original(self):
        result=self.prepare()
        self.assertEqual(result['sourceStates'],{'direct_source_match':1,'embedded_installed_map_match':1})
        self.assertEqual(result['packages'],2);self.assertEqual(result['noticeFiles'],2)
        self.assertFalse(result['releaseCleared'])
        with patch.object(evidence,'ROOT',Path('/unavailable/original')):
            self.assertEqual(evidence.verify_browser_evidence(self.destination),result)
        self.assertEqual(self.code_path.read_text().splitlines()[-1],'//# sourceMappingURL=origin.js.map')

    def test_virtual_missing_content_and_generated_loader_remain_unresolved(self):
        self.names.extend(['turbopack:///[turbopack]/runtime.ts',evidence.PROJECT+'src/missing.ts',
            evidence.PROJECT+'fixtures/example.json.[json].cjs/turbopack:///fixtures/example.json'])
        self.contents.extend(['virtual code',None,'generated JSON loader'])
        self.write_map();result=self.prepare()
        self.assertEqual(result['sourceStates']['unresolved_virtual_or_other_source'],1)
        self.assertEqual(result['sourceStates']['missing_source_content'],1)
        self.assertEqual(result['sourceStates']['unresolved_generated_source'],1)

    def test_map_filename_is_bound_by_annotation_and_missing_link_refuses(self):
        self.map_path.rename(self.map_path.with_name('unlinked.js.map'))
        with self.assertRaises(ValueError):self.prepare()
        self.assertFalse(self.destination.exists())

    def test_external_annotation_and_private_source_refuse_before_original_body_reads(self):
        self.code_path.write_text('//# sourceMappingURL=https://invalid.example/source.js.map\n')
        with self.assertRaises(ValueError):self.prepare()
        self.code_path.write_text('//# sourceMappingURL=origin.js.map\n')
        self.names=[evidence.PROJECT+'.env.private'];self.contents=['private-canary'];self.write_map()
        with self.assertRaises(ValueError) as error:self.prepare()
        self.assertNotIn('private-canary',str(error.exception));self.assertFalse(self.destination.exists())

    def test_diagnostic_source_and_generated_identity_refuse_before_archive_read_or_copy(self):
        relative='.local-error-log/events.json';secret=self.root/relative
        secret.parent.mkdir();secret.write_text('invented-private-diagnostic')
        for name in (relative,relative+'.[json].cjs/turbopack:///'+relative):
            with self.subTest(identity=name):
                self.names=[evidence.PROJECT+name];self.contents=['invented-private-diagnostic'];self.write_map()
                original=evidence._body
                def read(path):
                    if path==secret:raise AssertionError('Private diagnostic source opened')
                    return original(path)
                with patch.object(evidence,'_body',side_effect=read),self.assertRaisesRegex(ValueError,'Private material'):
                    self.prepare()
                self.assertFalse(self.destination.exists())
                self.assertEqual(secret.read_text(),'invented-private-diagnostic')

    def test_absent_source_content_does_not_exempt_private_project_identity(self):
        for index,folder in enumerate(('.local-error-log','.local-connected-reader','.env.private')):
            relative=folder+'/events.json'
            for generated,name in enumerate((relative,relative+'.[json].cjs/turbopack:///'+relative)):
                with self.subTest(identity=name):
                    self.destination=Path(self.temp.name)/f'proof-private-{index}-{generated}'
                    self.names=[evidence.PROJECT+name];self.contents=[None];self.write_map()
                    with self.assertRaisesRegex(ValueError,'Private material'):self.prepare()
                    self.assertFalse(self.destination.exists())

    def test_permitted_missing_direct_generated_and_similar_names_stay_unresolved(self):
        self.names=[evidence.PROJECT+'src/missing.ts',
            evidence.PROJECT+'src/missing.json.[json].cjs/turbopack:///src/missing.json',
            evidence.PROJECT+'src/.local-error-logs/events.json']
        self.contents=[None,None,None];self.write_map()
        result=self.prepare()
        self.assertEqual(result['sourceStates'],{'missing_source_content':3})
        self.assertFalse(result['releaseCleared'])
        self.assertFalse((self.destination/'origins/src').exists())

    def test_wrong_current_content_or_ambiguous_embedded_origin_cannot_become_a_match(self):
        (self.root/'node_modules/zod/index.js').write_text('changed source')
        with self.assertRaises(ValueError):self.prepare()
        (self.root/'node_modules/zod/index.js').write_text(self.direct)
        p=self.root/'node_modules/next/dist/lib/example.js.map'
        p.write_text(json.dumps({'version':3,'sources':['../../src/lib/example.ts']*2,
            'sourcesContent':[self.embedded]*2,'mappings':''}))
        with self.assertRaises(ValueError):self.prepare()

    def test_known_inventory_identity_cannot_be_substituted_for_another_package_root(self):
        p=self.root/'node_modules/zod/package.json'
        p.write_text(json.dumps({'name':'next','version':'1.0','license':'MIT'}))
        with self.assertRaisesRegex(ValueError,'package differs'):self.prepare()
        self.assertFalse(self.destination.exists())

    def test_scoped_package_name_matches_its_enclosing_namespace(self):
        package=self.root/'node_modules/@example/owned';package.mkdir(parents=True)
        body='export const scoped = 1;\n';(package/'index.js').write_text(body)
        (package/'package.json').write_text(json.dumps({'name':'@example/owned','version':'1.0','license':'MIT'}))
        (package/'LICENSE').write_text('invented scoped notice\n')
        p=self.root/'docs/OSS_PACKAGE_INVENTORY.json';inventory=json.loads(p.read_bytes())
        inventory['packages'].append({'name':'@example/owned','version':'1.0','declared_license':'MIT'})
        p.write_text(json.dumps(inventory));self.names.append(evidence.PROJECT+'node_modules/@example/owned/index.js')
        self.contents.append(body);self.write_map();result=self.prepare()
        self.assertEqual(result['packages'],3);self.assertEqual(result['noticeFiles'],3)

    def test_duplicate_fields_boolean_version_and_index_maps_are_refused(self):
        for raw in (b'{"version":3,"version":3,"sources":[],"mappings":""}',
                    b'{"version":true,"sources":[],"mappings":""}',
                    b'{"version":3,"sections":[],"sources":[],"mappings":""}'):
            self.map_path.write_bytes(raw)
            with self.assertRaises(ValueError):self.prepare()
            self.assertFalse(self.destination.exists())

    def test_origin_drift_during_copy_preserves_partial_proof_without_manifest(self):
        write=evidence._exclusive
        def changed(path,body):
            write(path,body)
            if path.name=='index.js':(self.root/'node_modules/zod/index.js').write_text('changed during copy')
        with patch.object(evidence,'_exclusive',side_effect=changed),self.assertRaises(ValueError):self.prepare()
        self.assertTrue(self.destination.is_dir());self.assertFalse((self.destination/evidence.MANIFEST).exists())

    def test_self_consistent_counts_or_authority_cannot_override_actual_saved_sources(self):
        self.prepare();p=self.destination/evidence.MANIFEST;original=p.read_bytes()
        for mutate in (lambda d:d.update(releaseCleared=True),lambda d:d['comparison']['sourceStates'].clear(),
                       lambda d:d.update(allModuleOriginsResolved=True)):
            d=json.loads(original);mutate(d);p.write_text(json.dumps(d))
            with self.assertRaises(ValueError):evidence.verify_browser_evidence(self.destination)

    def test_payload_tampering_and_extra_files_are_preserved_and_refused(self):
        self.prepare();p=self.destination/'origins/node_modules/zod/index.js';p.write_text('altered')
        with self.assertRaises(ValueError):evidence.verify_browser_evidence(self.destination)
        self.assertEqual(p.read_text(),'altered')

    def test_unlisted_empty_directory_or_linked_original_source_is_not_accepted(self):
        self.prepare();p=self.destination/'unexpected';p.mkdir(mode=0o700)
        with self.assertRaises(ValueError):evidence.verify_browser_evidence(self.destination)
        self.assertTrue(p.is_dir())

    def test_linked_original_source_refuses_without_reading_the_target(self):
        original=self.root/'node_modules/zod/index.js'
        original.unlink();original.symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):self.prepare()
        self.assertFalse(self.destination.exists())

    def test_ordinary_build_without_explicit_maps_cannot_supply_audit_evidence(self):
        p=self.root/'.next/required-server-files.json'
        p.write_text(json.dumps({'config':{'output':'standalone','env':{}}}))
        with self.assertRaises(ValueError):self.prepare()
        self.assertFalse(self.destination.exists())


if __name__=='__main__':unittest.main()
