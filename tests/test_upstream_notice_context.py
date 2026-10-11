"""Exact private artifact/upstream context, never executing package text."""
from hashlib import sha256
import json
import unittest
from unittest.mock import patch
from tests import test_artifact_notice_coverage as support
from scripts import artifact_notice_coverage as coverage
from scripts import prepare_local_web_candidate as candidate
from scripts.prepare_server_notice_bundle import _exclusive

class UpstreamNoticeContextTests(unittest.TestCase):
    def setUp(self):
        helper=support.ArtifactNoticeCoverageTests();helper.setUp();self.addCleanup(helper.doCleanups)
        self.packet=helper.destination;self.upstream=helper.destination.parent/'upstream';self.upstream.mkdir(mode=0o700)
        sources=[];packages=[]
        for repo,(name,version,license_name,notice,saved,definition,stored) in coverage.UPSTREAM_CONTEXTS.items():
            original,shipped=helper.add_package(name,notice=False)
            metadata=json.dumps({'name':name,'version':version,'license':license_name}).encode()
            for package in (original,shipped):(package/'package.json').write_bytes(metadata)
            commit='a'*40;tag='v'+version;body=b'invented upstream review notice; never release\n'
            _exclusive(self.upstream/saved,body);_exclusive(self.upstream/stored,metadata)
            ref={'ref':'refs/tags/'+tag,'object':{'type':'commit','sha':commit}}
            raw=json.dumps(ref).encode();_exclusive(self.upstream/(saved+'.tag.json'),raw)
            sources.append({'repository':repo,'tag':tag,'commit':commit,'sourceFile':notice,
                'sourceUrl':'https://raw.githubusercontent.com/'+repo+'/'+commit+'/'+notice,'savedFile':saved,
                'bytes':len(body),'sha256':sha256(body).hexdigest(),'metadata':[{'url':'https://api.github.com/repos/'+repo+'/git/ref/tags/'+tag,
                    'bytes':len(raw),'sha256':sha256(raw).hexdigest()}],'scopeBindingReviewed':False,'releaseCleared':False})
            packages.append({'name':name,'version':version,'sourceUrl':'https://raw.githubusercontent.com/'+repo+'/'+commit+'/'+definition,
                'sourceFile':definition,'savedFile':stored,'bytes':len(metadata),'sha256':sha256(metadata).hexdigest(),
                'repository':repo,'commit':commit,'noticeSavedFile':saved,'upstreamCodeExecuted':False})
        self.sources=sources;self.packages=packages
        self.retrieval={'observedAt':'2026-10-06T07:34:00+00:00','kind':'upstream_notice_candidates','sources':sources,
            'privatePacketOnly':True,'dependenciesChanged':False}
        self.context={'schemaVersion':1,'packages':packages,'scopeBindingReviewed':False,'releaseCleared':False}
        _exclusive(self.upstream/'RETRIEVAL.json',json.dumps(self.retrieval).encode())
        _exclusive(self.upstream/'PACKAGE_CONTEXT.json',json.dumps(self.context).encode())
        candidate.prepare_candidate(helper.root,self.packet)
    def read(self):return coverage.read_upstream_notice_context(self.packet,self.upstream)
    def save(self,name,value):(self.upstream/name).write_text(json.dumps(value))
    def test_actual_packet_scopes_match_only_fixed_upstream_context_and_remain_held(self):
        before=candidate.verify_candidate(self.packet)
        with patch('urllib.request.urlopen',side_effect=AssertionError('Network attempted')):result=self.read()
        self.assertEqual(candidate.verify_candidate(self.packet),before)
        self.assertEqual({(r['package'],r['version']) for r in result['contexts']},{('@next/env','16.3.6'),('@img/sharp-libvips-linux-x64','1.3.3')})
        self.assertEqual(len(result['originalPackageRootGaps']),2)
        for key in ('packetChanged','upstreamFetched','codeExecuted','releaseCleared','obligationsReviewed','hostAccepted','compiledScopeCleared'):
            self.assertIs(result[key],False)
        for row in result['contexts']:
            self.assertIs(row['wholeCompiledScopeReviewed'],False);self.assertIs(row['nativeBinaryIdentityAuthenticated'],False)
    def test_annotated_tag_resolves_exact_commit_without_promoting_signature_or_binary_scope(self):
        source=self.sources[1];commit=source['commit'];tag_sha='b'*40
        raw=json.dumps({'ref':'refs/tags/'+source['tag'],'object':{'type':'tag','sha':tag_sha}}).encode()
        (self.upstream/(source['savedFile']+'.tag.json')).write_bytes(raw)
        source['metadata'][0].update(bytes=len(raw),sha256=sha256(raw).hexdigest())
        annotated=json.dumps({'tag':source['tag'],'sha':tag_sha,'object':{'type':'commit','sha':commit}}).encode()
        _exclusive(self.upstream/(source['savedFile']+'.annotated-tag.json'),annotated)
        source['metadata'].append({'url':'https://api.github.com/repos/'+source['repository']+'/git/tags/'+tag_sha,
            'bytes':len(annotated),'sha256':sha256(annotated).hexdigest()})
        self.save('RETRIEVAL.json',self.retrieval);self.assertEqual(self.read()['contexts'][1]['commit'],commit)
    def test_changed_notice_metadata_digest_and_duplicate_receipts_refuse(self):
        path=self.upstream/self.sources[0]['savedFile'];original=path.read_bytes();path.write_bytes(b'changed')
        with self.assertRaises(ValueError):self.read()
        path.write_bytes(original)
        raw=(self.upstream/'RETRIEVAL.json').read_bytes()
        (self.upstream/'RETRIEVAL.json').write_bytes(b'{"kind":"alias",'+raw[1:])
        with self.assertRaises(ValueError):self.read()
        (self.upstream/'RETRIEVAL.json').write_bytes(raw)
        self.sources[0]['bytes']=True;self.save('RETRIEVAL.json',self.retrieval)
        with self.assertRaises(ValueError):self.read()
    def test_foreign_urls_paths_versions_and_scope_claims_cannot_select_more_material(self):
        original=json.dumps(self.retrieval)
        for key,value in [('sourceUrl','https://example.invalid/PRIVATE'),('savedFile','../private'),('commit','f'*40),
            ('tag','v99.0'),('releaseCleared',True),('scopeBindingReviewed',True)]:
            changed=json.loads(original);changed['sources'][0][key]=value;self.save('RETRIEVAL.json',changed)
            with self.subTest(key=key),self.assertRaises(ValueError):self.read()
        self.save('RETRIEVAL.json',json.loads(original));self.context['schemaVersion']=True;self.save('PACKAGE_CONTEXT.json',self.context)
        with self.assertRaises(ValueError):self.read()
    def test_symlinked_oversize_and_corrupt_runtime_packet_refuse_without_overwriting_evidence(self):
        path=self.upstream/self.sources[0]['savedFile'];original=path.read_bytes();other=self.upstream/'other';_exclusive(other,original)
        path.unlink();path.symlink_to(other)
        with self.assertRaises(ValueError):self.read()
        path.unlink();_exclusive(path,b'x'*16385)
        with self.assertRaises(ValueError):self.read()
        path.write_bytes(original)
        payload=self.packet/'server.js';raw=payload.read_bytes();payload.write_bytes(raw+b' ')
        # The existing packet inventory binds payload hashes, without execution.
        with self.assertRaises(ValueError):self.read()
        self.assertEqual(payload.read_bytes(),raw+b' ')

if __name__=='__main__':unittest.main()
