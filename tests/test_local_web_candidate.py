"""Exact assembly, missing assets and privacy/link boundaries, without servers."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import prepare_local_web_candidate as candidate
from tests import test_traced_open_source as support


class LocalWebCandidateTests(unittest.TestCase):
    def setUp(self):
        helper=support.TracedOpenSourceTests();helper.setUp();self.addCleanup(helper.doCleanups)
        self.root=helper.root;self.standalone=self.root/'.next/standalone'
        (self.standalone/'.next').mkdir(parents=True)
        (self.standalone/'.next/required-server-files.json').write_text(json.dumps({'config':{'output':'standalone','env':{}}}))
        (self.standalone/'.next/BUILD_ID').write_text('invented-build')
        (self.standalone/'server.js').write_text('throw new Error("must not execute");')
        (self.standalone/'package.json').write_text('{"private":true}')
        package=self.standalone/'node_modules/example';package.mkdir(parents=True)
        (package/'index.js').write_bytes((self.root/'node_modules/example/index.js').read_bytes())
        (package/'package.json').write_bytes((self.root/'node_modules/example/package.json').read_bytes())
        (package.parent/'alias').symlink_to('example',target_is_directory=True)
        (self.root/'.next/static').mkdir();(self.root/'.next/static/browser.js').write_text('invented browser asset')
        (self.root/'public').mkdir();(self.root/'public/icon.svg').write_text('<svg/>')
        (self.root/'scripts').mkdir();(self.root/'scripts/local_web_candidate_launcher.mjs').write_text('invented launcher')
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.destination=Path(self.temp.name)/'packet'

    def prepare(self):return candidate.prepare_candidate(self.root,self.destination)

    def test_complete_exact_packet_verifies_without_original_installation_or_execution(self):
        result=self.prepare();report=candidate.verify_candidate(self.destination)
        self.assertEqual(report['links'],1);self.assertFalse(report['releaseCleared']);self.assertFalse(report['filesExecuted'])
        self.assertEqual((self.destination/'.next/static/browser.js').read_bytes(),b'invented browser asset')
        self.assertEqual((self.destination/'public/icon.svg').read_bytes(),b'<svg/>')
        self.assertEqual(os.readlink(self.destination/'node_modules/alias'),'example')
        self.assertNotIn(str(self.root),json.dumps(result));self.assertNotIn(str(self.destination),json.dumps(result))
        with patch.object(candidate,'prepare_notice_bundle',side_effect=AssertionError('Original build opened')):
            self.assertEqual(candidate.verify_candidate(self.destination),report)

    def test_ordinary_umask_still_produces_private_self_contained_packet(self):
        previous=os.umask(0o022)
        try:
            self.prepare();candidate.verify_candidate(self.destination)
            for path in self.destination.rglob('*'):
                if not path.is_symlink():self.assertEqual(path.stat().st_mode&0o777,0o700 if path.is_dir() else 0o600)
        finally:os.umask(previous)

    def test_linked_metadata_parent_is_refused_before_config_or_build_body_reads(self):
        original=self.standalone/'.next';moved=self.root/'outside-metadata';original.rename(moved)
        original.symlink_to(moved,target_is_directory=True)
        with patch.object(candidate,'_json',side_effect=AssertionError('Linked metadata opened')), self.assertRaises(ValueError):self.prepare()
        self.assertFalse(self.destination.exists())

    def test_existing_packet_is_preserved_and_missing_static_or_embedded_environment_refuses(self):
        self.destination.mkdir(mode=0o700);kept=self.destination/'kept';kept.write_bytes(b'preserved')
        with self.assertRaises(ValueError):self.prepare()
        self.assertEqual(kept.read_bytes(),b'preserved')
        other=Path(self.temp.name)/'missing';(self.root/'.next/static/browser.js').unlink();(self.root/'.next/static').rmdir()
        with self.assertRaisesRegex(ValueError,'static assets'):candidate.prepare_candidate(self.root,other)
        self.assertFalse(other.exists())
        config=self.standalone/'.next/required-server-files.json'
        config.write_text(json.dumps({'config':{'output':'standalone','env':{'PRIVATE_CANARY':'do-not-copy'}}}))
        with self.assertRaises(ValueError) as error:candidate.prepare_candidate(self.root,other)
        self.assertNotIn('do-not-copy',str(error.exception));self.assertFalse(other.exists())

    def test_external_links_and_private_names_refuse_before_opening_their_bodies(self):
        target=self.standalone/'node_modules/leak';target.symlink_to('/etc/passwd')
        with self.assertRaisesRegex(ValueError,'Candidate link'):self.prepare()
        self.assertFalse(self.destination.exists());target.unlink()
        secret=self.standalone/'.env.local';secret.write_bytes(b'private-canary')
        original=candidate._body
        def read(path):
            if path==secret:raise AssertionError('Private body opened')
            return original(path)
        with patch.object(candidate,'_body',side_effect=read),self.assertRaisesRegex(ValueError,'Private material'):self.prepare()
        self.assertFalse(self.destination.exists());self.assertEqual(secret.read_bytes(),b'private-canary')

    def test_changed_source_mid_copy_keeps_partial_evidence_without_a_completed_manifest(self):
        original=candidate._exclusive
        def write(path,body):
            original(path,body)
            if path.name=='server.js':(self.standalone/'server.js').write_bytes(b'changed source')
        with patch.object(candidate,'_exclusive',side_effect=write),self.assertRaises(ValueError):self.prepare()
        self.assertTrue((self.destination/'server.js').exists());self.assertFalse((self.destination/candidate.MANIFEST).exists())
        with self.assertRaises((OSError,ValueError)):candidate.verify_candidate(self.destination)

    def test_diagnostic_archive_in_each_payload_tree_refuses_before_private_body_read_or_copy(self):
        for parent in (self.standalone,self.root/'.next/static',self.root/'public'):
            with self.subTest(tree=parent.relative_to(self.root).as_posix()):
                secret=parent/'.local-error-log/events.json'
                secret.parent.mkdir();secret.write_bytes(b'invented-private-diagnostic')
                original=candidate._body
                def read(path):
                    if path==secret:raise AssertionError('Private diagnostic body opened')
                    return original(path)
                try:
                    with patch.object(candidate,'_body',side_effect=read),self.assertRaisesRegex(ValueError,'Private material'):
                        self.prepare()
                    if parent==self.root/'public':
                        # Ordinary files copied earlier remain as incomplete evidence.
                        self.assertTrue(self.destination.exists())
                        self.assertFalse((self.destination/candidate.MANIFEST).exists())
                    else:self.assertFalse(self.destination.exists())
                    self.assertFalse((self.destination/'public/.local-error-log').exists())
                    self.assertEqual(secret.read_bytes(),b'invented-private-diagnostic')
                finally:
                    secret.unlink();secret.parent.rmdir()

    def test_configuration_change_after_initial_policy_check_cannot_enter_packet(self):
        original=candidate._copy_tree
        def copy(source,destination,**kwargs):
            if source==self.standalone:
                (source/'.next/required-server-files.json').write_text(json.dumps({'config':{'output':'standalone','env':{'PRIVATE_CANARY':'never-copy'}}}))
            return original(source,destination,**kwargs)
        with patch.object(candidate,'_copy_tree',side_effect=copy),self.assertRaisesRegex(ValueError,'after policy checks'):
            self.prepare()
        self.assertFalse(self.destination.exists())

    def test_browser_audit_optin_and_static_map_refuse_before_any_packet_copy(self):
        config=self.standalone/'.next/required-server-files.json'
        for enabled in (True,1,'true'):
            config.write_text(json.dumps({'config':{'output':'standalone','env':{},'productionBrowserSourceMaps':enabled}}))
            with self.assertRaisesRegex(ValueError,'audit maps'):self.prepare()
            self.assertFalse(self.destination.exists())
        config.write_text(json.dumps({'config':{'output':'standalone','env':{},'productionBrowserSourceMaps':False}}))
        (self.root/'.next/static/origin.js.map').write_bytes(b'private original source')
        with self.assertRaisesRegex(ValueError,'audit maps'):self.prepare()
        self.assertFalse(self.destination.exists())

    def test_static_map_inserted_after_policy_check_is_preserved_but_refused(self):
        original=candidate._copy_tree
        def copy(source,destination,**kwargs):
            if source==self.root/'.next/static':(source/'origin.js.map').write_bytes(b'private original source')
            return original(source,destination,**kwargs)
        with patch.object(candidate,'_copy_tree',side_effect=copy),self.assertRaisesRegex(ValueError,'after policy checks'):
            self.prepare()
        self.assertTrue(self.destination.exists());self.assertFalse((self.destination/candidate.MANIFEST).exists())
        self.assertFalse((self.destination/'.next/static').exists())

    def test_standalone_browser_file_and_directory_aliases_refuse_before_copy(self):
        maps=self.standalone/'.next/server/maps';maps.mkdir(parents=True)
        (maps/'private-origin.js.map').write_bytes(b'private original source')
        static=self.standalone/'.next/static';static.mkdir()
        alias=static/'source-alias.js';alias.symlink_to('../server/maps/private-origin.js.map')
        with self.assertRaisesRegex(ValueError,'audit maps'):self.prepare()
        self.assertFalse(self.destination.exists());alias.unlink()
        alias=static/'maps';alias.symlink_to('../server/maps',target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'audit maps'):self.prepare()
        self.assertFalse(self.destination.exists());alias.unlink();static.rmdir()
        static.symlink_to('server/maps',target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'audit maps'):self.prepare()
        self.assertFalse(self.destination.exists())

    def test_self_consistent_static_alias_cannot_hide_source_map_bytes(self):
        self.prepare();directory=self.destination/'.next/server';directory.mkdir(mode=0o700)
        source=directory/'private-origin.js.map';source.write_bytes(b'private original source');source.chmod(0o600)
        (self.destination/'.next/static/source-alias.js').symlink_to('../server/private-origin.js.map')
        path=self.destination/candidate.MANIFEST;manifest=json.loads(path.read_bytes())
        inventory=candidate._inventory(self.destination,private=True)
        inventory['entries']=[r for r in inventory['entries'] if r['path']!=candidate.MANIFEST]
        inventory['bytes']-=len(path.read_bytes());manifest['inventory']=inventory;path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError,'audit maps'):candidate.verify_candidate(self.destination)

    def test_self_consistent_copied_browser_audit_setting_still_refuses(self):
        self.prepare();config=self.destination/'.next/required-server-files.json'
        body=json.dumps({'config':{'output':'standalone','env':{},'productionBrowserSourceMaps':True}}).encode()
        old_size=config.stat().st_size;config.write_bytes(body)
        manifest_path=self.destination/candidate.MANIFEST;manifest=json.loads(manifest_path.read_bytes())
        from hashlib import sha256
        for row in manifest['inventory']['entries']:
            if row['path']=='.next/required-server-files.json':row.update(bytes=len(body),sha256=sha256(body).hexdigest())
        manifest['inventory']['bytes']+=len(body)-old_size;manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError,'audit maps'):candidate.verify_candidate(self.destination)

    def test_self_consistent_receipt_cannot_accept_environment_in_copied_configuration(self):
        self.prepare();config=self.destination/'.next/required-server-files.json'
        body=json.dumps({'config':{'output':'standalone','env':{'PRIVATE_CANARY':'invented-value'}}}).encode();old_size=config.stat().st_size
        config.write_bytes(body);path=self.destination/candidate.MANIFEST;manifest=json.loads(path.read_bytes())
        from hashlib import sha256
        for row in manifest['inventory']['entries']:
            if row['path']=='.next/required-server-files.json':row.update(bytes=len(body),sha256=sha256(body).hexdigest())
        manifest['inventory']['bytes']+=len(body)-old_size;path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError,'Copied standalone configuration'):candidate.verify_candidate(self.destination)

    def test_tampered_files_extra_private_files_and_external_link_are_preserved_but_refused(self):
        self.prepare();server=self.destination/'server.js';original=server.read_bytes()
        server.write_bytes(b'tampered')
        with self.assertRaises(ValueError):candidate.verify_candidate(self.destination)
        server.write_bytes(original);extra=self.destination/'.env.private';extra.write_bytes(b'private-canary')
        with self.assertRaises(ValueError) as error:candidate.verify_candidate(self.destination)
        self.assertNotIn('private-canary',str(error.exception));extra.unlink()
        link=self.destination/'node_modules/alias';link.unlink();link.symlink_to('/etc')
        with self.assertRaises(ValueError):candidate.verify_candidate(self.destination)
        self.assertEqual(os.readlink(link),'/etc')

    def test_limits_wrong_modes_and_hardlinks_refuse(self):
        with patch.object(candidate,'MAX_TOTAL',2),self.assertRaises(ValueError):self.prepare()
        self.assertFalse(self.destination.exists());self.prepare()
        server=self.destination/'server.js';server.chmod(0o644)
        with self.assertRaises(ValueError):candidate.verify_candidate(self.destination)
        server.chmod(0o600);hard=Path(self.temp.name)/'hard';os.link(server,hard)
        with self.assertRaises(ValueError):candidate.verify_candidate(self.destination)

    def test_receipt_cannot_raise_authority_coerce_counts_or_hide_missing_bytes(self):
        self.prepare();path=self.destination/candidate.MANIFEST;original=path.read_bytes()
        for change in (lambda v:v.update(releaseCleared=True),lambda v:v.update(localPort=True),
                lambda v:v['inventory'].update(bytes=True),lambda v:v['inventory']['entries'].pop()):
            value=json.loads(original);change(value);path.write_text(json.dumps(value))
            with self.assertRaises(ValueError):candidate.verify_candidate(self.destination)
        path.write_bytes(original.replace(b'"schemaVersion": 2',b'"schemaVersion": 2, "schemaVersion": 2'))
        with self.assertRaises(ValueError):candidate.verify_candidate(self.destination)


if __name__=='__main__':unittest.main()
