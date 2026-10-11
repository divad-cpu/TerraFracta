// Private fictional stdin only. The production reader opens its own pg client.
// No request-supplied SQL or raw errors/credentials are emitted.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createPostgresOperatorAuditTransport} from '../src/server/postgres-operator-audit-provider.ts';
import {createProposalReader} from '../src/server/operator-proposal-reader.ts';
if(process.argv.length!==2)throw Error('fixed_trial_only');
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>16384)throw Error('fixed_input_limit');}
const input=JSON.parse(raw);
assert.deepEqual(Object.keys(input).sort(),['configuration','scope']);
const codes=[];
const transport=createPostgresOperatorAuditTransport(input.configuration);
try{
 const decision=await createProposalReader(transport.readProposal,()=>performance.now(),async code=>{codes.push(code);return 'saved';})(input.scope);
 assert.ok(['ok','changed','unavailable'].includes(decision.kind));
 assert.deepEqual(codes,decision.kind==='unavailable'?['operator_audit_read']:[]);
 assert.equal(await transport.shutdown(),true);
 // Reuse the shipped fixed TSX loader and presenter seam, not a browser claim.
 const loaded=new Map();
 function load(source){
  if(loaded.has(source.href))return loaded.get(source.href);
  const exports={},native=createRequire(source);loaded.set(source.href,exports);
  const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',compiled)(name=>{
   if(name.startsWith('.')){const candidate=new URL(name.endsWith('.tsx')?name:name+'.tsx',source);if(existsSync(candidate))return load(candidate);}
   return native(name);
  },exports);return exports;
 }
 const View=load(new URL('../src/operator-proposal-view.tsx',import.meta.url)).ProposalComparisonView;
 const html=renderToStaticMarkup(createElement(View,{decision,selection:input.scope}));
 assert.ok(!html.includes('<button')&&!html.includes('<form'));
 const visible=html.includes('In 2025, the fictional share was 27.4%.');
 assert.equal(visible,decision.kind==='ok');
 if(decision.kind!=='ok')assert.ok(!('report' in decision));
 console.log(JSON.stringify({decision,diagnostics:codes,drained:true,actualPgRead:true,
  presentation:{kind:decision.kind,htmlSha256:createHash('sha256').update(html).digest('hex'),
   proposedTextVisible:visible,browserVerified:false},browserVerified:false}));
}finally{await transport.shutdown();}
