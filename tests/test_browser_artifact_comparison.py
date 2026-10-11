"""Exact normalization/association boundaries using two fully verified artifacts."""
from pathlib import Path
import json
import unittest
from unittest.mock import patch

from scripts import compare_browser_artifact_origins as comparison
from scripts import prepare_browser_origin_evidence as origin
from tests import test_local_web_candidate as support


class BrowserArtifactComparisonTests(unittest.TestCase):
    def setUp(self):
        helper=support.LocalWebCandidateTests();helper.setUp();self.addCleanup(helper.doCleanups)
        self.helper=helper;self.root=helper.root
        self.audit=Path(helper.temp.name)/'audit';self.report=Path(helper.temp.name)/'comparison'
        self.body=b'throw new Error("never execute");'
        self.source=(self.root/'node_modules/example/index.js').read_text()
        (self.root/'.next/BUILD_ID').write_text('invented-audit')
        (self.root/'.next/required-server-files.json').write_text(json.dumps({'config':{
            'output':'standalone','env':{},'productionBrowserSourceMaps':True}}))

    def prepare_inputs(self,*,ambiguous=False,css=False,runtime_body=None):
        static=self.root/'.next/static';code='audit.css' if css else 'browser.js';map_name='independent.css.map' if css else 'independent.js.map'
        (static/'browser.js').unlink()
        annotation=(b'\n/*# sourceMappingURL='+map_name.encode()+b' */\n') if css \
            else b'\n//# sourceMappingURL='+map_name.encode()+b'\n'
        (static/code).write_bytes(self.body+annotation)
        (static/map_name).write_text(json.dumps({'version':3,'sources':[origin.PROJECT+'node_modules/example/index.js'],
            'sourcesContent':[self.source],'mappings':''}))
        if ambiguous:
            (static/'other.js').write_bytes(self.body+annotation)
        origin.prepare_browser_evidence(self.root,self.audit)
        for path in list(static.iterdir()):path.unlink()
        (static/'browser.js').write_bytes(self.body if runtime_body is None else runtime_body)
        self.helper.prepare();return self.helper.destination

    def test_two_actual_private_fixture_artifacts_bind_unique_normalized_code_and_exact_inputs(self):
        runtime=self.prepare_inputs();result=comparison.prepare_comparison(self.audit,runtime,self.report)
        self.assertEqual(result['counts'],{'unique_normalized_byte_match':1,'held_ambiguous':0,'held_no_match':0})
        self.assertFalse(result['completeRuntimeOrigins']);self.assertFalse(result['filesExecuted'])
        self.assertFalse(result['originalInstallOpened'])
        saved=json.loads((self.report/comparison.MANIFEST).read_bytes())
        match=saved['comparison']['codeComparisons'][0]
        self.assertEqual(match['auditMap'],'independent.js.map')
        self.assertEqual(match['auditSourceReferences'],[{'sourceIndex':0,'state':'direct_source_match'}])
        self.assertEqual(comparison.verify_comparison(self.report,self.audit,runtime),result)

    def test_only_terminal_ascii_whitespace_and_final_map_comment_are_removed(self):
        runtime=self.prepare_inputs(runtime_body=self.body+b' \t\r\n')
        self.assertEqual(comparison.compare_origins(self.audit,runtime)['counts']['unique_normalized_byte_match'],1)
        self.assertEqual(comparison._normalized_audit(b'const x="sourceMappingURL=literal";\n//# sourceMappingURL=x.js.map\n','.js')[0],
            b'const x="sourceMappingURL=literal";')
        with self.assertRaises(ValueError):comparison._normalized_audit(b'//# sourceMappingURL=https://invalid.example/map\n','.js')

    def test_changed_code_is_held_even_when_same_runtime_filename(self):
        runtime=self.prepare_inputs(runtime_body=self.body+b'/* different code */')
        self.assertEqual(comparison.compare_origins(self.audit,runtime)['counts']['held_no_match'],1)

    def test_vertical_tab_and_form_feed_are_never_trimmed_as_allowed_whitespace(self):
        for suffix,comment in (('.js',b'\n//# sourceMappingURL=x.js.map'),
                ('.css',b'\n/*# sourceMappingURL=x.css.map */')):
            for tail in (b'\x0b',b'\x0c'):
                with self.assertRaises(ValueError):comparison._normalized_audit(self.body+comment+tail,suffix)

    def test_identical_multiple_audit_candidates_are_held_without_guessing(self):
        runtime=self.prepare_inputs(ambiguous=True)
        result=comparison.compare_origins(self.audit,runtime)
        self.assertEqual(result['counts']['held_ambiguous'],1)
        self.assertNotIn('auditMap',result['codeComparisons'][0])

    def test_same_body_in_css_does_not_supply_a_javascript_origin(self):
        runtime=self.prepare_inputs(css=True)
        self.assertEqual(comparison.compare_origins(self.audit,runtime)['counts']['held_no_match'],1)

    def test_changed_dependency_binding_cannot_supply_comparison_authority(self):
        runtime=self.prepare_inputs();read=comparison.private_read
        def altered(path,**kwargs):
            raw=read(path,**kwargs)
            if path==runtime/'notice-candidates/TRACE_EVIDENCE.json':
                value=json.loads(raw);value['lockSha256']='0'*64;return json.dumps(value).encode()
            return raw
        with patch.object(comparison,'private_read',side_effect=altered),self.assertRaisesRegex(ValueError,'dependency evidence differs'):
            comparison.prepare_comparison(self.audit,runtime,self.report)
        self.assertFalse(self.report.exists())

    def test_report_counts_authority_and_extra_namespace_do_not_override_recomputed_inputs(self):
        runtime=self.prepare_inputs();comparison.prepare_comparison(self.audit,runtime,self.report)
        path=self.report/comparison.MANIFEST;original=path.read_bytes()
        for mutate in (lambda d:d.update(completeRuntimeOrigins=True),lambda d:d['comparison']['counts'].clear()):
            value=json.loads(original);mutate(value);path.write_text(json.dumps(value))
            with self.assertRaises(ValueError):comparison.verify_comparison(self.report,self.audit,runtime)
        path.write_bytes(original);(self.report/'unexpected').mkdir(mode=0o700)
        with self.assertRaises(ValueError):comparison.verify_comparison(self.report,self.audit,runtime)

    def test_tampered_input_preserved_and_existing_report_never_overwritten(self):
        runtime=self.prepare_inputs();comparison.prepare_comparison(self.audit,runtime,self.report)
        with self.assertRaises(ValueError):comparison.prepare_comparison(self.audit,runtime,self.report)
        changed=runtime/'.next/static/browser.js';changed.write_bytes(b'changed input')
        with self.assertRaises(ValueError):comparison.verify_comparison(self.report,self.audit,runtime)
        self.assertEqual(changed.read_bytes(),b'changed input')


if __name__=='__main__':unittest.main()
