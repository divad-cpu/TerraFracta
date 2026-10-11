// Actual isolated SQL reports through the shipped inactive reader and presenter.
import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import ts from 'typescript';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {createProposalReader} from '../src/server/operator-proposal-reader.ts';
const input=JSON.parse(readFileSync(0,'utf8')),loaded=new Map();
function load(source){if(loaded.has(source.href))return loaded.get(source.href);const exports={},native=createRequire(source);loaded.set(source.href,exports);
 const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',compiled)(name=>{if(name.startsWith('.')){const candidate=new URL(name.endsWith('.tsx')?name:name+'.tsx',source);if(existsSync(candidate))return load(candidate);}return native(name);},exports);return exports;}
const View=load(new URL('../src/operator-proposal-view.tsx',import.meta.url)).ProposalComparisonView,checked=[];
for(const row of input.outputs){let logged=0;const raw=new TextEncoder().encode(JSON.stringify(row.report));
 const read=createProposalReader(async()=>raw,()=>0,async code=>{assert.equal(code,'operator_audit_read');logged++;return 'saved';});
 const decision=await read(row.scope);assert.equal(decision.kind,row.expectedKind??row.report.status,row.name);
 assert.equal(logged,row.expectedKind==='unavailable'?1:0,row.name);
 const html=renderToStaticMarkup(createElement(View,{decision,selection:row.scope}));
 assert.ok(!html.includes('<button')&&!html.includes('<form'),row.name);assert.ok(!html.includes('PRIVATE_UNKNOWN_REASON_CANARY'),row.name);
 if(decision.kind==='ok'){assert.ok(html.includes('The invented share was 8.2%.'),row.name);assert.ok(html.includes('Proposed content — unverified'),row.name);
  assert.ok(html.includes(decision.report.base===null?'witnessed issue head had no publication':'The invented share was 7.5%.'),row.name);
 }else assert.ok(!html.includes('The invented share'),row.name);
 checked.push({name:row.name,kind:decision.kind,htmlSha256:createHash('sha256').update(html).digest('hex')});}
console.log(JSON.stringify({methods:checked.length,checked,httpVerified:false,browserVerified:false}));
