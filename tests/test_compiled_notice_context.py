from hashlib import sha256
import json
from unittest import TestCase
from unittest.mock import patch
from scripts import compiled_notice_context as context
from scripts import prepare_local_web_candidate as candidate
from tests import test_artifact_notice_coverage as support

class CompiledNoticeContextTests(TestCase):
    def setUp(self):
        self.helper=support.ArtifactNoticeCoverageTests();self.helper.setUp();self.addCleanup(self.helper.doCleanups)
        self.root=self.helper.root;self.packet=self.helper.destination
        self.original,self.shipped=self.helper.add_package('next',compiled='primitives')
        (self.original/'dist/compiled/primitives/LICENSE').unlink()
        self.folder=self.original/'dist/compiled/primitives'
    def prepare(self):return candidate.prepare_candidate(self.root,self.packet)
    def test_exact_sidecar_context_is_partial_and_leaves_original_packet_and_gap_unchanged(self):
        text=b'Invented partial third-party notice; not whole bundle clearance.\n'
        (self.folder/'index.js.LEGAL.txt').write_bytes(text)
        for p in (self.folder,self.shipped/'dist/compiled/primitives'):(p/'empty.js').write_text('throw Error("NEVER_EXECUTE")')
        (self.folder/'empty.js.LEGAL.txt').write_bytes(b'')
        before=self.prepare();result=context.read_compiled_notice_context(self.root,self.packet)
        self.assertEqual(candidate.verify_candidate(self.packet)['buildId'],before['buildId'])
        self.assertEqual(result['originalCompiledNoticeGaps'],['node_modules/next/dist/compiled/primitives'])
        rows={r['shippedCodePath'].split('/')[-1]:r for r in result['contexts']}
        self.assertEqual(rows['index.js']['sidecarSha256'],sha256(text).hexdigest());self.assertEqual(rows['index.js']['noticeText'],text.decode())
        self.assertEqual(rows['empty.js']['status'],'observed_empty')
        for field in ('packetChanged','upstreamFetched','dependenciesExecuted','releaseCleared','obligationsReviewed','hostAccepted'):self.assertIs(result[field],False)
        self.assertTrue(all(r['wholeCompiledScopeReviewed'] is False for r in rows.values()))
    def test_absent_and_unshipped_orphan_sidecars_do_not_supply_terms(self):
        (self.folder/'orphan.js.LEGAL.txt').write_bytes(b'PRIVATE_ORPHAN_CANARY')
        self.prepare();r=context.read_compiled_notice_context(self.root,self.packet)
        self.assertEqual(r['contexts'],[]);self.assertEqual(len(r['originalCompiledNoticeGaps']),1)
    def test_mismatching_source_code_or_package_identity_refuses(self):
        sidecar=self.folder/'index.js.LEGAL.txt';sidecar.write_text('Invented notice');self.prepare()
        code=self.folder/'index.js';raw=code.read_bytes();code.write_text('PRIVATE_CHANGED')
        with self.assertRaises(ValueError):context.read_compiled_notice_context(self.root,self.packet)
        code.write_bytes(raw)
        meta=self.original/'package.json';meta.write_text(json.dumps({'name':'next','version':'different','license':'MIT'}))
        with self.assertRaises(ValueError):context.read_compiled_notice_context(self.root,self.packet)
    def test_invalid_utf8_oversize_links_and_packet_mutation_refuse(self):
        sidecar=self.folder/'index.js.LEGAL.txt';sidecar.write_bytes(b'Invented notice');self.prepare()
        for data in (b'\xff',b'x'*(context.MAX_TEXT_BYTES+1)):
            sidecar.write_bytes(data)
            with self.assertRaises(ValueError):context.read_compiled_notice_context(self.root,self.packet)
        sidecar.unlink();sidecar.symlink_to(self.folder/'index.js')
        with self.assertRaises(ValueError):context.read_compiled_notice_context(self.root,self.packet)
        sidecar.unlink();sidecar.write_text('Invented notice')
        (self.packet/'node_modules/next/dist/compiled/primitives/index.js').write_text('PRIVATE_PACKET_CHANGED')
        with self.assertRaises(ValueError):context.read_compiled_notice_context(self.root,self.packet)
    def test_changed_sidecar_during_read_refuses_instead_of_reporting_unbound_text(self):
        sidecar=self.folder/'index.js.LEGAL.txt';sidecar.write_text('Invented notice');self.prepare();body=context._body;done=False
        def read(path):
            nonlocal done
            raw=body(path)
            if path==sidecar and not done:done=True;sidecar.write_text('Changed invented notice')
            return raw
        with patch.object(context,'_body',side_effect=read):
            with self.assertRaises(ValueError):context.read_compiled_notice_context(self.root,self.packet)
