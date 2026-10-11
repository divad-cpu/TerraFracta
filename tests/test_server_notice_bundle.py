"""Exact notice bytes, preserved failures and bounded read-only packet checks."""
from hashlib import sha256
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import prepare_server_notice_bundle as bundle
from tests import test_traced_open_source as support


class ServerNoticeBundleTests(unittest.TestCase):
    def setUp(self):
        helper=support.TracedOpenSourceTests();helper.setUp();self.addCleanup(helper.doCleanups)
        self.root,self.package,self.saved=helper.root,helper.package,helper.saved
        self.write_trace=helper.write_trace
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.destination=Path(self.temp.name)/'packet'

    def prepare(self):return bundle.prepare_notice_bundle(self.root,self.destination)

    def test_every_private_directory_is_created_with_ordinary_caller_umask(self):
        previous=os.umask(0o022)
        try:
            self.prepare()
            self.assertTrue(bundle.verify_notice_bundle(self.destination)['exactPacketBytesMatched'])
            for path in self.destination.rglob('*'):
                if path.is_dir():self.assertEqual(path.stat().st_mode&0o777,0o700)
        finally:os.umask(previous)

    def test_exact_notice_copy_and_read_only_verify_without_source_or_execution(self):
        original=(self.package/'LICENSE').read_bytes();manifest=self.prepare()
        self.assertEqual(manifest['noticeFilesCopied'],1);self.assertEqual(manifest['payloadBytes'],len(original))
        self.assertEqual((self.destination/manifest['files'][0]['path']).read_bytes(),original)
        self.assertEqual((self.package/'LICENSE').read_bytes(),original)
        before={p.relative_to(self.destination).as_posix():p.read_bytes() for p in self.destination.rglob('*') if p.is_file()}
        with patch.object(bundle,'audit_traces',side_effect=AssertionError('Original installation opened')):
            report=bundle.verify_notice_bundle(self.destination)
        self.assertTrue(report['exactPacketBytesMatched']);self.assertFalse(report['releaseCleared'])
        self.assertFalse(report['originalInstallationOpened']);self.assertFalse(report['dependenciesExecuted'])
        self.assertEqual(before,{p.relative_to(self.destination).as_posix():p.read_bytes() for p in self.destination.rglob('*') if p.is_file()})
        self.assertNotIn(str(self.root),json.dumps(manifest));self.assertNotIn(str(self.destination),json.dumps(manifest))
        self.assertFalse(any(p.suffix in ('.js','.node','.so') for p in self.destination.rglob('*')))
        for p in self.destination.rglob('*'):self.assertEqual(p.stat().st_mode&0o777,0o700 if p.is_dir() else 0o600)

    def test_compiled_notice_and_native_readme_copy_keep_binary_uncleared(self):
        package=self.root/'node_modules/next';component=package/'dist/compiled/example'
        component.mkdir(parents=True)
        (package/'package.json').write_text(json.dumps({'name':'next','version':'1.0','license':'MIT'}))
        (component/'index.js').write_text('throw new Error("must never execute");')
        (component/'LICENSE').write_text('bundled terms')
        (package/'README.md').write_text('Native obligations require review')
        (package/'native.so.1').write_bytes(b'invented binary')
        self.saved['packages'].append({'name':'next','version':'1.0','declared_license':'MIT','top_level_notice_files':[]})
        (self.root/'docs/OSS_PACKAGE_INVENTORY.json').write_text(json.dumps(self.saved))
        self.write_trace(['../node_modules/next/dist/compiled/example/index.js','../node_modules/next/native.so.1'])
        manifest=self.prepare();self.assertEqual(manifest['noticeFilesCopied'],1);self.assertEqual(manifest['nativeReadmeFilesCopied'],1)
        self.assertEqual({row['kind'] for row in manifest['files']},{'compiled_notice','native_readme'})
        self.assertFalse(manifest['nativeObligationsReviewed']);self.assertFalse(manifest['releaseCleared'])
        self.assertEqual(bundle.verify_notice_bundle(self.destination)['regularFilesChecked'],2)

    def test_existing_destination_and_symlink_are_not_overwritten(self):
        self.destination.mkdir(mode=0o700);kept=self.destination/'kept';kept.write_bytes(b'preserved')
        with self.assertRaises(ValueError):self.prepare()
        self.assertEqual(kept.read_bytes(),b'preserved')
        other=Path(self.temp.name)/'link';other.symlink_to(self.destination,target_is_directory=True)
        with self.assertRaises(ValueError):bundle.prepare_notice_bundle(self.root,other)
        self.assertEqual(kept.read_bytes(),b'preserved')

    def test_changed_source_mid_copy_preserves_partial_packet_and_refuses_completion(self):
        original=bundle._exclusive
        def write(path,body):
            original(path,body)
            if path.name=='LICENSE':(self.package/'LICENSE').write_text('changed after copy')
        with patch.object(bundle,'_exclusive',side_effect=write),self.assertRaisesRegex(ValueError,'^Server notice candidate preservation refused; keep partial evidence$'):
            self.prepare()
        self.assertEqual((self.destination/'files/001/LICENSE').read_bytes(),b'permission\n')
        self.assertFalse((self.destination/'BUNDLE_MANIFEST.json').exists())
        with self.assertRaises(ValueError):bundle.verify_notice_bundle(self.destination)

    def test_bounds_refuse_without_normalizing_the_partial_packet(self):
        with patch.object(bundle,'MAX_TOTAL',5),self.assertRaises(ValueError):self.prepare()
        self.assertTrue(self.destination.is_dir());self.assertFalse((self.destination/'BUNDLE_MANIFEST.json').exists())

    def test_changed_copy_or_trace_hash_cannot_verify(self):
        manifest=self.prepare();path=self.destination/manifest['files'][0]['path'];original=path.read_bytes()
        path.write_bytes(b'altered')
        with self.assertRaises(ValueError):bundle.verify_notice_bundle(self.destination)
        path.write_bytes(original)
        trace=self.destination/'TRACE_EVIDENCE.json';trace.write_bytes(trace.read_bytes()+b' ')
        with self.assertRaises(ValueError):bundle.verify_notice_bundle(self.destination)

    def test_self_consistent_private_notice_path_is_refused_before_payload_read(self):
        manifest=self.prepare();old=self.destination/manifest['files'][0]['path']
        relative='files/001/.env.private/LICENSE';secret=self.destination/relative;secret.parent.mkdir(mode=0o700)
        old.rename(secret)
        trace_path=self.destination/'TRACE_EVIDENCE.json';trace=json.loads(trace_path.read_bytes())
        trace['packages'][0]['topLevelNoticeFiles'][0]['file']='.env.private/LICENSE'
        trace_bytes=(json.dumps(trace,sort_keys=True,indent=2)+'\n').encode();trace_path.write_bytes(trace_bytes)
        manifest['traceEvidenceSha256']=sha256(trace_bytes).hexdigest()
        manifest['files'][0].update(path=relative,upstreamFile='.env.private/LICENSE')
        manifest['packages'][0]['copiedPaths']=[relative]
        (self.destination/'BUNDLE_MANIFEST.json').write_text(json.dumps(manifest))
        original=bundle.private_read
        def read(path,**kwargs):
            if path==secret:raise AssertionError('Private notice body opened')
            return original(path,**kwargs)
        with patch.object(bundle,'private_read',side_effect=read),self.assertRaises(ValueError):
            bundle.verify_notice_bundle(self.destination)
        self.assertEqual(secret.read_bytes(),b'permission\n')

    def test_extra_files_links_modes_and_hardlinks_are_preserved_but_refused(self):
        manifest=self.prepare();path=self.destination/manifest['files'][0]['path']
        extra=self.destination/'.env.private';extra.write_bytes(b'private-canary')
        with self.assertRaises(ValueError) as error:bundle.verify_notice_bundle(self.destination)
        self.assertNotIn('private-canary',str(error.exception));self.assertEqual(extra.read_bytes(),b'private-canary');extra.unlink()
        path.chmod(0o644)
        with self.assertRaises(ValueError):bundle.verify_notice_bundle(self.destination)
        path.chmod(0o600);hard=Path(self.temp.name)/'hard';os.link(path,hard)
        with self.assertRaises(ValueError):bundle.verify_notice_bundle(self.destination)
        hard.unlink();linked=self.destination/'linked';linked.symlink_to(self.package,target_is_directory=True)
        with self.assertRaises(ValueError):bundle.verify_notice_bundle(self.destination)

    def test_manifest_cannot_raise_rights_claims_coerce_counts_or_select_outside_paths(self):
        self.prepare();path=self.destination/'BUNDLE_MANIFEST.json';original=path.read_bytes()
        for change in (lambda v:v.update(releaseCleared=True),lambda v:v.update(regularFilesCopied=True),
                lambda v:v.update(nativeObligationsReviewed=True),lambda v:v.update(privatePath='canary'),
                lambda v:v['files'][0].update(path='../outside')):
            value=json.loads(original);change(value);path.write_text(json.dumps(value))
            with self.assertRaises(ValueError):bundle.verify_notice_bundle(self.destination)
        path.write_bytes(original);self.assertTrue(bundle.verify_notice_bundle(self.destination)['exactPacketBytesMatched'])

    def test_duplicate_fields_refuse_even_when_other_bytes_match(self):
        self.prepare();path=self.destination/'BUNDLE_MANIFEST.json';raw=path.read_bytes()
        path.write_bytes(raw.replace(b'"schemaVersion": 1',b'"schemaVersion": 1, "schemaVersion": 1'))
        with self.assertRaises(ValueError):bundle.verify_notice_bundle(self.destination)


if __name__=='__main__':unittest.main()
