// Fixed fictional stdin; actual pg/TLS reader and shipped private renderer.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createPostgresOperatorAuditTransport} from '../src/server/postgres-operator-audit-provider.ts';
import {createProposalReader} from '../src/server/operator-proposal-reader.ts';
import {decodeProposalCapture} from '../src/server/proposal-capture.ts';
if(process.argv.length!==2)throw Error('fixed_trial_only');
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>16384)throw Error('fixed_input_limit');}
const input=JSON.parse(raw);assert.ok([JSON.stringify(['configuration','scope']),JSON.stringify(['configuration','expectedKind','scope'])].includes(JSON.stringify(Object.keys(input).sort())));
const expectedKind=input.expectedKind??'ok';assert.ok(['ok','capture_missing','changed'].includes(expectedKind));
const codes=[],transport=createPostgresOperatorAuditTransport(input.configuration);
try{
 const decision=await createProposalReader(transport.readProposal,()=>performance.now(),async code=>{codes.push(code);return 'saved';})(input.scope);
 assert.equal(decision.kind,expectedKind);assert.deepEqual(codes,[]);assert.equal(await transport.shutdown(),true);
 let year=null,sentence=null;
 if(decision.kind==='ok'){
  const payload=decodeProposalCapture(decision.report.capture.proposalJson,decision.report.capture.proposalSha256);
  year=payload.snapshot.claims[0].periodLabel.slice(-4);const expected={2024:['30.1','12.8'],2025:['29.3','11.6']}[year];assert.ok(expected);
  sentence=`For survey year ${year}, the fixed SSB 14059 response for EierStatus=0 reports Boutg4=${expected[0]} percent and Boutg5=${expected[1]} percent. The English band-boundary meaning remains unreviewed.`;
  assert.equal(payload.snapshot.claims[0].assertion,sentence);
 }else assert.ok(!('report' in decision));
 const loaded=new Map();function load(source){
  if(loaded.has(source.href))return loaded.get(source.href);
  const exports={},native=createRequire(source);loaded.set(source.href,exports);
  const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',compiled)(name=>{if(name.startsWith('.')){const candidate=new URL(name.endsWith('.tsx')?name:name+'.tsx',source);if(existsSync(candidate))return load(candidate);}return native(name);},exports);return exports;
 }
 const html=renderToStaticMarkup(createElement(load(new URL('../src/operator-proposal-view.tsx',import.meta.url)).ProposalComparisonView,{decision,selection:input.scope}));
 if(decision.kind==='ok')assert.ok(html.includes(sentence)&&html.includes('automated technical held-decision date')&&html.includes('Unreviewed. No accepted translation receipt is recorded.'));
 else assert.ok(!html.includes('Boutg4=')&&!html.includes('Boutg5=')&&!html.includes('Private review: SSB 14059')&&!html.includes('sourceVersionId'));
 assert.ok(!html.includes('<button')&&!html.includes('<form'));
 console.log(JSON.stringify({decision,diagnostics:codes,drained:true,actualPgRead:true,presentation:{year:year===null?null:Number(year),kind:decision.kind,htmlSha256:createHash('sha256').update(html).digest('hex'),proposedTextVisible:decision.kind==='ok',browserVerified:false},browserVerified:false}));
}finally{await transport.shutdown();}
