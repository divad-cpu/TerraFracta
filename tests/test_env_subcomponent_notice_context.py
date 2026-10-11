"""Read authentic-shaped fictional terms as data; no licensing acceptance."""
from copy import deepcopy
from hashlib import sha256
import json
import unittest
from unittest.mock import patch
from tests import test_artifact_notice_coverage as support
from scripts import artifact_notice_coverage as coverage
from scripts import prepare_local_web_candidate as candidate
from scripts.prepare_server_notice_bundle import _exclusive


class EnvSubcomponentNoticeContextTests(unittest.TestCase):
    def setUp(self):
        helper=support.ArtifactNoticeCoverageTests();helper.setUp();self.addCleanup(helper.doCleanups)
        self.root=helper.root;self.packet=helper.destination;self.next=self.packet.parent/'next';self.next.mkdir(mode=0o700)
        self.components=self.packet.parent/'components';self.components.mkdir(mode=0o700)
        sources=[];packages=[]
        for repo,(name,version,license_name,notice,saved,definition,stored) in coverage.UPSTREAM_CONTEXTS.items():
            original,shipped=helper.add_package(name,notice=False)
            definition_value={'name':name,'version':version,'license':license_name}
            if name=='@next/env':
                definition_value['devDependencies']={'dotenv':'16.3.1','dotenv-expand':'10.0.0'}
                for directory in (original,shipped):(directory/'dist').mkdir()
                self.code=shipped/'dist/index.js';self.original_code=original/'dist/index.js'
                self.declaration={'name':'dotenv','version':'16.3.1','license':'BSD-2-Clause'}
                body=self.js(self.declaration)
                self.code.write_bytes(body);self.original_code.write_bytes(body)
            metadata=json.dumps(definition_value).encode()
            for directory in (original,shipped):(directory/'package.json').write_bytes(metadata)
            commit='a'*40;body=b'invented upstream text; not accepted terms\n'
            _exclusive(self.next/saved,body);_exclusive(self.next/stored,metadata)
            raw=json.dumps({'ref':'refs/tags/v'+version,'object':{'type':'commit','sha':commit}}).encode()
            _exclusive(self.next/(saved+'.tag.json'),raw)
            sources.append({'repository':repo,'tag':'v'+version,'commit':commit,'sourceFile':notice,
              'sourceUrl':'https://raw.githubusercontent.com/'+repo+'/'+commit+'/'+notice,'savedFile':saved,
              'bytes':len(body),'sha256':sha256(body).hexdigest(),'metadata':[{'url':'https://api.github.com/repos/'+repo+'/git/ref/tags/v'+version,
              'bytes':len(raw),'sha256':sha256(raw).hexdigest()}],'scopeBindingReviewed':False,'releaseCleared':False})
            packages.append({'name':name,'version':version,'sourceUrl':'https://raw.githubusercontent.com/'+repo+'/'+commit+'/'+definition,
              'sourceFile':definition,'savedFile':stored,'bytes':len(metadata),'sha256':sha256(metadata).hexdigest(),
              'repository':repo,'commit':commit,'noticeSavedFile':saved,'upstreamCodeExecuted':False})
        _exclusive(self.next/'RETRIEVAL.json',json.dumps({'observedAt':'2026-10-07T08:00:00+00:00',
          'kind':'upstream_notice_candidates','sources':sources,'privatePacketOnly':True,'dependenciesChanged':False}).encode())
        _exclusive(self.next/'PACKAGE_CONTEXT.json',json.dumps({'schemaVersion':1,'packages':packages,'scopeBindingReviewed':False,'releaseCleared':False}).encode())
        self.retrieval={'schemaVersion':1,'kind':'exact_env_subcomponent_notice_candidates','packages':[],
          'sources':[],'dependenciesChanged':False,'runtimePacketChanged':False,'archiveFetched':False,
          'scopeBindingReviewed':False,'releaseCleared':False}
        for name,version,repo in coverage.ENV_COMPONENTS:
            commit='b'*40
            metadata={'name':name,'version':version,'license':'BSD-2-Clause','gitHead':commit,
              'repository':{'url':'git+https://github.com/'+repo+'.git'}}
            self.retrieval['packages'].append({'name':name,'version':version,'declaredLicense':'BSD-2-Clause',
              'repository':repo,'commit':commit,'registrySavedFile':name+'-registry.json',
              'packageSavedFile':name+'-package.json','noticeSavedFile':name+'-LICENSE','codeFetched':False,
              'codeExecuted':False,'scopeBindingReviewed':False,'releaseCleared':False})
            for saved,url,body in [(name+'-registry.json','https://registry.npmjs.org/'+name+'/'+version,json.dumps(metadata).encode()),
              (name+'-package.json','https://raw.githubusercontent.com/'+repo+'/'+commit+'/package.json',json.dumps(metadata).encode()),
              (name+'-LICENSE','https://raw.githubusercontent.com/'+repo+'/'+commit+'/LICENSE',b'invented BSD candidate; not accepted license\n')]:
                _exclusive(self.components/saved,body)
                self.retrieval['sources'].append({'savedFile':saved,'url':url,'bytes':len(body),'sha256':sha256(body).hexdigest(),'observedAt':'2026-10-07T08:00:00+00:00'})
        self.save();candidate.prepare_candidate(helper.root,self.packet)
        self.packet_code=self.packet/'node_modules/@next/env/dist/index.js'

    @staticmethod
    def js(value):
        return ('throw new Error("DEPENDENCY_MUST_NOT_EXECUTE");module.exports=JSON.parse(\''+
          json.dumps(value,separators=(',',':'))+'\');').encode()

    def save(self):
        path=self.components/'RETRIEVAL.json'
        if not path.exists():_exclusive(path,json.dumps(self.retrieval).encode())
        else:path.write_bytes(json.dumps(self.retrieval).encode())

    def read(self):return coverage.read_env_subcomponent_notice_context(self.packet,self.next,self.components)

    def rebuild_code(self,body,index):
        # A new invented packet binds each changed code input. Old packets stay
        # intact, so this reaches literal validation rather than hash refusal.
        self.code.write_bytes(body);self.original_code.write_bytes(body)
        self.packet=self.packet.parent/('changed-code-'+str(index))
        candidate.prepare_candidate(self.root,self.packet)
        self.packet_code=self.packet/'node_modules/@next/env/dist/index.js'

    def test_packet_terms_and_build_associations_remain_distinct_and_held(self):
        before=candidate.verify_candidate(self.packet)
        with patch('urllib.request.urlopen',side_effect=AssertionError('Network refused')):
            result=self.read()
        self.assertEqual(candidate.verify_candidate(self.packet),before)
        self.assertEqual([row['association'] for row in result['contexts']],['observed_json_literal_declaration','retained_next_build_input'])
        self.assertEqual([row['embeddedVersionAssociationEstablished'] for row in result['contexts']],[True,False])
        for key in ('packetChanged','upstreamFetched','dependenciesExecuted','compiledScopeCleared','releaseCleared','obligationsReviewed','hostAccepted'):
            self.assertIs(result[key],False)
        for row in result['contexts']:
            self.assertFalse(row['wholeCompiledScopeReviewed']);self.assertFalse(row['upstreamAuthorshipAccepted'])
        self.assertEqual(len(result['originalPackageRootGaps']),2)
        self.assertTrue(result['parserToolExecuted']);self.assertFalse(result['bundledTargetCodeExecuted'])

    def test_changed_notice_is_refused_without_repair_or_packet_change(self):
        path=self.components/'dotenv-LICENSE';path.write_bytes(b'changed notice')
        before=self.packet_code.read_bytes()
        with self.assertRaises(ValueError):self.read()
        self.assertEqual(path.read_bytes(),b'changed notice');self.assertEqual(self.packet_code.read_bytes(),before)

    def test_wrong_version_commit_repository_or_terms_cannot_bind(self):
        original=deepcopy(self.retrieval)
        for key,value in [('version','16.3.2'),('commit','c'*40),('repository','unrelated/author'),('declaredLicense','MIT'),('noticeSavedFile','../private'),('codeExecuted',True)]:
            self.retrieval=deepcopy(original);self.retrieval['packages'][0][key]=value;self.save()
            with self.subTest(key=key),self.assertRaises(ValueError):self.read()

    def test_foreign_urls_duplicate_identity_and_bad_size_are_refused(self):
        original=deepcopy(self.retrieval)
        variants=[]
        for key,value in [('url','https://example.invalid/private'),('bytes',True),('observedAt','2026-10-07T09:00:00+01:00')]:
            value_copy=deepcopy(original);value_copy['sources'][0][key]=value;variants.append(value_copy)
        duplicate=deepcopy(original);duplicate['sources'][1]=deepcopy(duplicate['sources'][0]);variants.append(duplicate)
        duplicate=deepcopy(original);duplicate['packages'][1]=deepcopy(duplicate['packages'][0]);variants.append(duplicate)
        for value in variants:
            self.retrieval=value;self.save()
            with self.subTest(value=value),self.assertRaises(ValueError):self.read()

    def test_closure_flags_or_schema_coercion_cannot_promote_acceptance(self):
        original=deepcopy(self.retrieval)
        for key,value in [('schemaVersion',True),('releaseCleared',True),('archiveFetched',True),('scopeBindingReviewed',True),('dependenciesChanged',True)]:
            self.retrieval=deepcopy(original);self.retrieval[key]=value;self.save()
            with self.subTest(key=key),self.assertRaises(ValueError):self.read()

    def test_duplicate_json_keys_and_oversized_manifest_refuse(self):
        path=self.components/'RETRIEVAL.json';raw=path.read_bytes()
        for body in [b'{"schemaVersion":1,'+raw[1:],b'x'*65537]:
            path.write_bytes(body)
            with self.subTest(size=len(body)),self.assertRaises(ValueError):self.read()

    def test_symlinked_notice_cannot_select_external_text(self):
        path=self.components/'dotenv-LICENSE';other=self.components/'other';other.write_bytes(path.read_bytes())
        path.unlink();path.symlink_to(other)
        with self.assertRaises(ValueError):self.read()

    def test_current_packet_code_corruption_is_not_silently_rebound(self):
        self.packet_code.write_bytes(self.packet_code.read_bytes()+b'changed')
        with self.assertRaises(ValueError):self.read()
        self.assertTrue(self.packet_code.read_bytes().endswith(b'changed'))

    def test_missing_duplicate_dynamic_or_wrong_embedded_identity_is_refused(self):
        bodies=[b'throw new Error("NO_DECLARATION");',self.js(self.declaration)*2,
          b'JSON.parse(loadPrivateContext());',self.js({**self.declaration,'version':'16.3.2'}),
          self.js({**self.declaration,'license':'MIT'}),
          b'module.exports=JSON.parse(\'{"name":"dotenv","name":"dotenv","version":"16.3.1","license":"BSD-2-Clause"}\');']
        for index,body in enumerate(bodies):
            self.rebuild_code(body,index)
            with self.subTest(index=index),self.assertRaises(ValueError):self.read()

    def test_comments_templates_foreign_receiver_and_spaced_duplicate_do_not_bind(self):
        marker=self.js(self.declaration)
        bodies=[b'/*'+marker+b'*/',b'const note=`'+marker+b'`;',
          marker.replace(b'JSON.parse',b'privateObject.JSON.parse'),
          marker+b'module.exports=JSON.parse(\'{"name": "dotenv", "version": "16.3.1", "license": "BSD-2-Clause"}\');']
        for index,body in enumerate(bodies):
            self.rebuild_code(body,index)
            with self.subTest(index=index),self.assertRaises(ValueError):self.read()

    def test_shadowed_or_changed_json_and_tool_failure_are_held(self):
        marker=self.js(self.declaration)
        for index,body in enumerate([b'function read(JSON){'+marker+b'}',b'const JSON=privateParser;'+marker]):
            self.rebuild_code(body,index)
            with self.subTest(index=index),self.assertRaises(ValueError):self.read()
        with patch.object(coverage.subprocess,'run',side_effect=coverage.subprocess.TimeoutExpired('fixed_parser',5)),self.assertRaises(ValueError):self.read()

    def test_named_expression_or_replaced_json_parser_cannot_bind(self):
        marker=self.js(self.declaration)
        bodies=[b'const read=function JSON(){'+marker+b'};',
          b'const read=class JSON{load(){'+marker+b'}};',b'JSON.parse=privateParser;'+marker,
          b'JSON["parse"]=privateParser;'+marker]
        for index,body in enumerate(bodies):
            self.rebuild_code(body,index)
            with self.subTest(index=index),self.assertRaises(ValueError):self.read()


if __name__=='__main__':unittest.main()
