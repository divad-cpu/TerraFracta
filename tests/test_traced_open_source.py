from hashlib import sha256
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import audit_traced_open_source as traced
from scripts.audit_traced_open_source import audit_traces


class TracedOpenSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        (self.root/'.next').mkdir();(self.root/'docs').mkdir()
        self.package=self.root/'node_modules/example';self.package.mkdir(parents=True)
        (self.package/'package.json').write_text(json.dumps({'name':'example','version':'1.0','license':'MIT'}))
        (self.package/'LICENSE').write_text('permission\n')
        (self.package/'index.js').write_text('throw new Error("must never execute");')
        (self.root/'pnpm-lock.yaml').write_text('pinned')
        self.saved={'pnpm_lock_sha256':sha256(b'pinned').hexdigest(),'packages':[{
            'name':'example','version':'1.0','declared_license':'MIT','top_level_notice_files':[
                {'file':'LICENSE','bytes':11,'sha256':sha256(b'permission\n').hexdigest()}]}]}
        (self.root/'docs/OSS_PACKAGE_INVENTORY.json').write_text(json.dumps(self.saved))
        self.write_trace(['../node_modules/example/index.js'])

    def write_trace(self,files):
        (self.root/'.next/test.nft.json').write_text(json.dumps({'version':1,'files':files}))

    def test_exact_notice_mapping_never_executes_or_clears_distribution(self):
        result=audit_traces(self.root)
        self.assertEqual(result['packages'][0]['topLevelNoticeFiles'],self.saved['packages'][0]['top_level_notice_files'])
        self.assertFalse(result['releaseCleared']);self.assertFalse(result['dependenciesExecuted'])
        self.assertNotIn(str(self.root),json.dumps(result))

    def test_private_and_escaping_references_refuse_without_reading_bodies(self):
        for name in ['../.env.local','../../outside','/etc/passwd']:
            with self.subTest(name=name):
                self.write_trace([name])
                with self.assertRaises(ValueError):audit_traces(self.root)

    def test_diagnostic_archive_reference_refuses_before_path_resolution(self):
        secret=self.root/'.local-error-log/events.json'
        secret.parent.mkdir();secret.write_bytes(b'invented-private-diagnostic')
        self.write_trace(['../.local-error-log/events.json'])
        original=Path.resolve
        def resolve(path,*args,**kwargs):
            if '.local-error-log' in path.parts:
                raise AssertionError('Private diagnostic reference resolved')
            return original(path,*args,**kwargs)
        with patch.object(Path,'resolve',resolve),self.assertRaisesRegex(ValueError,'private reference'):
            audit_traces(self.root)
        self.assertEqual(secret.read_bytes(),b'invented-private-diagnostic')

    def test_diagnostic_manifest_directory_refuses_before_body_read(self):
        secret=self.root/'.next/.local-error-log/secret.nft.json'
        secret.parent.mkdir();secret.write_text('{"version":1,"files":[]}')
        original=traced._json
        def read(path):
            if path==secret:raise AssertionError('Private diagnostic manifest opened')
            return original(path)
        with patch.object(traced,'_json',side_effect=read),self.assertRaisesRegex(ValueError,'Private material'):
            audit_traces(self.root)

    def test_private_manifest_directory_or_filename_refuses_before_manifest_body_read(self):
        folder=self.root/'.next/.local-connected-reader';folder.mkdir()
        secret=folder/'secret.nft.json';secret.write_text('{"version":1,"files":[]}')
        original=traced._json
        def read(path):
            if path==secret:raise AssertionError('Private manifest opened')
            return original(path)
        with patch.object(traced,'_json',side_effect=read),self.assertRaises(ValueError):audit_traces(self.root)
        secret.unlink();folder.rmdir();secret=self.root/'.next/.env.private.nft.json';secret.write_text('{"version":1,"files":[]}')
        with patch.object(traced,'_json',side_effect=read),self.assertRaises(ValueError):audit_traces(self.root)

    def test_auxiliary_notice_in_private_directory_is_never_opened(self):
        package=self.root/'node_modules/next';component=package/'dist/compiled/example'
        component.mkdir(parents=True)
        (package/'package.json').write_text(json.dumps({'name':'next','version':'1.0','license':'MIT'}))
        (component/'index.js').write_text('never execute')
        secret=component/'.local-connected-reader/NOTICE';secret.parent.mkdir();secret.write_text('private-canary')
        self.saved['packages'].append({'name':'next','version':'1.0','declared_license':'MIT','top_level_notice_files':[]})
        (self.root/'docs/OSS_PACKAGE_INVENTORY.json').write_text(json.dumps(self.saved))
        self.write_trace(['../node_modules/next/dist/compiled/example/index.js'])
        original=traced._evidence
        def read(path,base):
            if path==secret:raise AssertionError('Private auxiliary notice opened')
            return original(path,base)
        with patch.object(traced,'_evidence',side_effect=read),self.assertRaises(ValueError):audit_traces(self.root)
        self.assertEqual(secret.read_text(),'private-canary')

    def test_package_symlink_escape_refuses(self):
        (self.package/'leak').symlink_to('/etc/passwd')
        self.write_trace(['../node_modules/example/leak'])
        with self.assertRaises(ValueError):audit_traces(self.root)

    def test_changed_notice_or_lock_cannot_reuse_saved_evidence(self):
        (self.package/'LICENSE').write_text('different')
        with self.assertRaises(ValueError):audit_traces(self.root)
        (self.package/'LICENSE').write_text('permission\n');(self.root/'pnpm-lock.yaml').write_text('changed')
        with self.assertRaises(ValueError):audit_traces(self.root)

    def test_duplicate_references_and_duplicate_metadata_fields_refuse(self):
        self.write_trace(['../node_modules/example/index.js']*2)
        with self.assertRaises(ValueError):audit_traces(self.root)
        (self.root/'.next/test.nft.json').write_text('{"version":1,"version":1,"files":[]}')
        with self.assertRaises(ValueError):audit_traces(self.root)
        (self.root/'.next/test.nft.json').write_text('{"version":true,"files":[]}')
        with self.assertRaises(ValueError):audit_traces(self.root)

    def test_directory_reference_is_observed_without_claiming_full_contents(self):
        self.write_trace(['../node_modules/example'])
        result=audit_traces(self.root)
        self.assertEqual(result['packages'][0]['directoryReferences'],1)
        self.assertFalse(result['directoryContentsExpanded']);self.assertFalse(result['browserBundlesAudited'])

    def test_compiled_notices_and_native_hashes_remain_uncleared_candidates(self):
        package=self.root/'node_modules/next';component=package/'dist/compiled/example'
        component.mkdir(parents=True)
        (package/'package.json').write_text(json.dumps({'name':'next','version':'1.0','license':'MIT'}))
        (component/'index.js').write_text('throw new Error("must never execute");')
        (component/'LICENSE').write_text('bundled terms')
        (package/'native.so.1').write_bytes(b'invented native bytes')
        self.saved['packages'].append({'name':'next','version':'1.0','declared_license':'MIT','top_level_notice_files':[]})
        (self.root/'docs/OSS_PACKAGE_INVENTORY.json').write_text(json.dumps(self.saved))
        self.write_trace(['../node_modules/next/dist/compiled/example/index.js','../node_modules/next/native.so.1'])
        result=audit_traces(self.root);row=result['packages'][0]
        self.assertEqual(row['nativeFiles'][0]['sha256'],sha256(b'invented native bytes').hexdigest())
        self.assertEqual(row['compiledComponentCandidates'][0]['candidateNoticeFiles'][0]['sha256'],sha256(b'bundled terms').hexdigest())
        self.assertFalse(row['nativeFiles'][0]['bundledLibraryObligationsReviewed'])
        self.assertFalse(row['compiledComponentCandidates'][0]['obligationsReviewed'])
        (component/'hidden-link').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):audit_traces(self.root)

    def test_root_development_cache_and_copied_traces_do_not_mix_with_canonical_production(self):
        for name in ('dev','cache','standalone'):
            directory=self.root/'.next'/name;directory.mkdir()
            (directory/'stale.nft.json').write_text('invalid development output')
        self.assertEqual(len(audit_traces(self.root)['traces']),1)
        route=self.root/'.next/server/app/api/dev/check.nft.json';route.parent.mkdir(parents=True)
        route.write_text(json.dumps({'version':1,'files':[os.path.relpath(self.package/'index.js',route.parent)]}))
        self.assertEqual(len(audit_traces(self.root)['traces']),2)
        (self.root/'.next/test.nft.json').unlink();route.unlink()
        with self.assertRaises(ValueError):audit_traces(self.root)


if __name__=='__main__':unittest.main()
