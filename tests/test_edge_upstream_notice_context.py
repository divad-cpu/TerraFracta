"""Fixed fictional version-tag/terms receipts on actual invented packets.

No code/archive retrieval, installation, target evaluation or legal acceptance.
"""
from copy import deepcopy
from hashlib import sha256
import json
import unittest
from unittest.mock import patch
from urllib.parse import quote

from scripts import compiled_notice_context as context
from scripts import prepare_local_web_candidate as candidate
from scripts.prepare_server_notice_bundle import _exclusive
from tests import test_artifact_notice_coverage as support


class EdgeUpstreamNoticeContextTests(unittest.TestCase):
    def setUp(self):
        helper=support.ArtifactNoticeCoverageTests();helper.setUp();self.addCleanup(helper.doCleanups)
        self.packet=helper.destination;self.upstream=self.packet.parent/'edge-terms'
        self.upstream.mkdir(mode=0o700);self.rows=[];self.sources=[]
        original,shipped=helper.add_package('next',notice=False)
        for folder in (original,shipped):
            (folder/'package.json').write_text(json.dumps({'name':'next','version':'16.3.6','license':'MIT'}))
        self.retrieval={'schemaVersion':1,'kind':'exact_edge_version_tag_notice_candidates',
            'observedAt':'2026-10-07T08:45:00+00:00','packages':self.rows,'sources':self.sources,
            'freshGets':14,'reusedRegistryResponses':1,'dependenciesChanged':False,'runtimePacketChanged':False,
            'archiveFetched':False,'codeFetched':False,'codeExecuted':False,'scopeBindingReviewed':False,'releaseCleared':False}
        for leaf,version in context.EDGE_COMPONENTS:
            name='@edge-runtime/'+leaf;repo='vercel/edge-runtime';commit='a'*40;tag=name+'@'+version;tag_sha='b'*40
            metadata={'name':name,'version':version,'license':'MIT'}
            for parent in (original,shipped):
                folder=parent/'dist/compiled'/name;folder.mkdir(parents=True)
                (folder/'package.json').write_text(json.dumps(metadata))
                (folder/'index.js').write_text('throw Error("DEPENDENCY_MUST_NOT_EXECUTE")')
            row={'schemaVersion':1,'kind':'exact_version_tag_notice_candidate','package':name,'version':version,
                'declaredLicense':'MIT','repository':repo,'tag':tag,'annotatedTag':True,'commit':commit,
                'registryGitHead':None,'packageSourceFile':'packages/'+leaf+'/package.json','noticeSourceFile':'LICENSE.md',
                'sources':[],'freshGets':4 if leaf=='cookies' else 5,'tagPackageContextMatched':True,
                'registryTagPublicationAuthenticityEstablished':False,'shippedCodeBytesCompared':False,
                'archiveFetched':False,'codeFetched':False,'codeExecuted':False,'scopeBindingReviewed':False,'releaseCleared':False}
            registry=dict(metadata,repository={'url':'git+https://github.com/'+repo+'.git','type':'git','directory':'packages/'+leaf})
            reference={'ref':'refs/tags/'+tag,'object':{'type':'tag','sha':tag_sha}}
            annotated={'tag':tag,'sha':tag_sha,'object':{'type':'commit','sha':commit,
                'url':'https://api.github.com/repos/'+repo+'/git/commits/'+commit}}
            receipts=[('registry.json','https://registry.npmjs.org/@edge-runtime%2f'+leaf+'/'+version,registry),
                ('tag-ref.json','https://api.github.com/repos/'+repo+'/git/ref/tags/'+quote(tag,safe=''),reference),
                ('annotated-tag.json','https://api.github.com/repos/'+repo+'/git/tags/'+tag_sha,annotated),
                ('package.json','https://raw.githubusercontent.com/'+repo+'/'+commit+'/packages/'+leaf+'/package.json',metadata),
                ('LICENSE.md','https://raw.githubusercontent.com/'+repo+'/'+commit+'/LICENSE.md',b'Invented MIT candidate; not legal acceptance.\n')]
            for suffix,url,value in receipts:
                saved=leaf+'-'+suffix;raw=value if type(value) is bytes else json.dumps(value).encode()
                _exclusive(self.upstream/saved,raw)
                source={'savedFile':saved,'url':url,'bytes':len(raw),'sha256':sha256(raw).hexdigest(),
                    'observedAt':'2026-10-07T08:40:00+00:00','freshGet':not (leaf=='cookies' and suffix=='registry.json')}
                if not source['freshGet']:source['retainedFrom']='/not-opened/invented-private-receipt'
                row['sources'].append(source);self.sources.append(source)
            self.rows.append(row)
        self.save();candidate.prepare_candidate(helper.root,self.packet)
        self.code=self.packet/'node_modules/next/dist/compiled/@edge-runtime/cookies/index.js'

    def save(self):
        for path,value in [('RETRIEVAL.json',self.retrieval)]+[(row['package'].split('/')[-1]+'-RESULT.json',row) for row in self.rows]:
            destination=self.upstream/path;raw=json.dumps(value).encode()
            if destination.exists():destination.write_bytes(raw)
            else:_exclusive(destination,raw)

    def read(self):return context.read_edge_upstream_notice_context(self.packet,self.upstream)

    def replace_receipt(self,saved,value):
        raw=value if type(value) is bytes else json.dumps(value).encode()
        (self.upstream/saved).write_bytes(raw)
        source=next(row for row in self.sources if row['savedFile']==saved)
        source.update(bytes=len(raw),sha256=sha256(raw).hexdigest());self.save()

    def test_real_packet_metadata_terms_and_tag_context_remain_partial_and_held(self):
        before=candidate.verify_candidate(self.packet)
        with patch('urllib.request.urlopen',side_effect=AssertionError('No network')):
            result=self.read()
        self.assertEqual(candidate.verify_candidate(self.packet),before)
        self.assertEqual([row['version'] for row in result['contexts']],['6.0.0','4.0.0','6.0.0'])
        self.assertEqual([len(row['shippedFileBindings']) for row in result['contexts']],[2,2,2])
        self.assertEqual(len(result['originalCompiledNoticeGaps']),3)
        self.assertEqual(result['originalPackageRootGaps'],['node_modules/next'])
        self.assertEqual(self.code.read_text(),'throw Error("DEPENDENCY_MUST_NOT_EXECUTE")')
        for key in ('packetChanged','upstreamFetched','dependenciesExecuted','registryTagPublicationAuthenticityEstablished',
            'compiledScopeCleared','releaseCleared','obligationsReviewed','hostAccepted'):
            self.assertIs(result[key],False)
        for row in result['contexts']:
            self.assertFalse(row['registryGitHeadAvailable']);self.assertFalse(row['registryTagPublicationAuthenticityEstablished'])
            self.assertFalse(row['wholeCompiledScopeReviewed']);self.assertFalse(row['upstreamAuthorshipAccepted'])

    def test_row_identity_commit_paths_flags_and_duplicate_membership_refuse(self):
        original=deepcopy(self.retrieval)
        for key,value in [('version','6.0.1'),('commit','c'*40),('repository','foreign/repo'),('tag','wrong'),
            ('annotatedTag',False),('declaredLicense','BSD-2-Clause'),('registryGitHead','a'*40),
            ('packageSourceFile','../private'),('noticeSourceFile','other/LICENSE'),('codeExecuted',True),
            ('tagPackageContextMatched',False),('schemaVersion',True),('freshGets',True)]:
            self.retrieval=deepcopy(original);self.rows=self.retrieval['packages'];self.sources=self.retrieval['sources']
            self.rows[0][key]=value;self.save()
            with self.subTest(key=key),self.assertRaises(ValueError):self.read()
        self.retrieval=deepcopy(original);self.rows=self.retrieval['packages'];self.sources=self.retrieval['sources']
        self.retrieval['packages']=[self.rows[0],self.rows[0],self.rows[2]];self.save()
        with self.assertRaises(ValueError):self.read()

    def test_hash_private_mode_link_and_oversized_terms_refuse_without_repair(self):
        target=self.upstream/'cookies-LICENSE.md';original=target.read_bytes()
        for raw in (b'Changed private canary',b'\xff',b'x'*(context.MAX_TEXT_BYTES+1)):
            target.write_bytes(raw)
            with self.assertRaises(ValueError) as error:self.read()
            self.assertNotIn('canary',str(error.exception));self.assertEqual(target.read_bytes(),raw)
        target.write_bytes(original);target.chmod(0o644)
        with self.assertRaises(ValueError):self.read()
        target.chmod(0o600);target.unlink();target.symlink_to(self.upstream/'ponyfill-LICENSE.md')
        with self.assertRaises(ValueError):self.read()

    def test_receipt_size_type_url_date_and_aggregate_refuse(self):
        original=deepcopy(self.retrieval)
        for key,value in [('bytes',True),('url','https://foreign.invalid/LICENSE'),('observedAt','2026-10-07T09:00:00+00:00'),
            ('observedAt','2026-10-07T08:00:00'),('observedAt',4),('freshGet',1),('savedFile','../private')]:
            self.retrieval=deepcopy(original);self.rows=self.retrieval['packages'];self.sources=self.retrieval['sources']
            self.rows[0]['sources'][0][key]=value;self.save()
            with self.subTest(key=key),self.assertRaises(ValueError):self.read()
        for key,value in [('freshGets',True),('reusedRegistryResponses',0),('releaseCleared',True),('codeExecuted',True),('unknown',False)]:
            self.retrieval=deepcopy(original);self.rows=self.retrieval['packages'];self.sources=self.retrieval['sources']
            self.retrieval[key]=value;self.save()
            with self.subTest(key=key),self.assertRaises(ValueError):self.read()

    def test_consistent_receipt_rehash_cannot_bind_wrong_registry_or_package_identity(self):
        for saved in ('cookies-registry.json','cookies-package.json'):
            original=json.loads((self.upstream/saved).read_bytes())
            for key,value in [('name','foreign'),('version','6.0.1'),('license','ISC')]:
                changed=dict(original);changed[key]=value;self.replace_receipt(saved,changed)
                with self.subTest(saved=saved,key=key),self.assertRaises(ValueError):self.read()
            self.replace_receipt(saved,original)
        registry=json.loads((self.upstream/'cookies-registry.json').read_bytes())
        for change in ({'gitHead':'a'*40},{'repository':{'url':'git+https://github.com/foreign/repo.git'}}):
            self.replace_receipt('cookies-registry.json',dict(registry,**change))
            with self.assertRaises(ValueError):self.read()

    def test_consistent_receipt_rehash_cannot_substitute_lightweight_tag_or_foreign_commit(self):
        for saved,changes in [('cookies-tag-ref.json',[
            {'ref':'refs/tags/wrong'},{'object':{'type':'commit','sha':'a'*40}}]),
            ('cookies-annotated-tag.json',[{'tag':'wrong'},{'sha':'c'*40},
            {'object':{'type':'commit','sha':'c'*40,'url':'https://foreign.invalid'}}])]:
            original=json.loads((self.upstream/saved).read_bytes())
            for change in changes:
                self.replace_receipt(saved,dict(original,**change))
                with self.subTest(saved=saved,change=change),self.assertRaises(ValueError):self.read()
            self.replace_receipt(saved,original)

    def test_duplicate_json_empty_terms_and_retrieval_row_drift_refuse(self):
        self.replace_receipt('cookies-package.json',b'{"name":"@edge-runtime/cookies","name":"@edge-runtime/cookies","version":"6.0.0","license":"MIT"}')
        with self.assertRaises(ValueError):self.read()
        self.replace_receipt('cookies-package.json',{'name':'@edge-runtime/cookies','version':'6.0.0','license':'MIT'})
        self.replace_receipt('cookies-LICENSE.md',b' \n')
        with self.assertRaises(ValueError):self.read()
        self.replace_receipt('cookies-LICENSE.md',b'Invented notice\n')
        row=json.loads((self.upstream/'cookies-RESULT.json').read_bytes());row['commit']='c'*40
        (self.upstream/'cookies-RESULT.json').write_text(json.dumps(row))
        with self.assertRaises(ValueError):self.read()

    def test_current_packet_drift_and_mid_read_notice_change_refuse(self):
        original=self.code.read_bytes();self.code.write_bytes(b'PRIVATE_PACKET_CHANGED')
        with self.assertRaises(ValueError):self.read()
        self.code.write_bytes(original);read=context.private_read;target=self.upstream/'cookies-LICENSE.md';done=False
        def changed(path,**kwargs):
            nonlocal done
            raw=read(path,**kwargs)
            if path==target and not done:done=True;target.write_bytes(b'Changed during read')
            return raw
        with patch.object(context,'private_read',side_effect=changed),self.assertRaises(ValueError):self.read()


if __name__=='__main__':unittest.main()
