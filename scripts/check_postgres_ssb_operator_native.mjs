// Fixed owned fictional consumer: actual TLS reads and shipped SSR only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createPostgresOperatorAuditTransport} from '../src/server/postgres-operator-audit-provider.ts';
import {createOperatorAuditChoicesReader} from '../src/server/operator-audit-choices-reader.ts';
import {createOperatorAuditReader} from '../src/server/operator-audit-reader.ts';
import {createHeldDecisionsReader} from '../src/server/operator-held-decisions-reader.ts';
import {createProposalReader} from '../src/server/operator-proposal-reader.ts';
if(process.argv.length!==2)throw Error('fixed_trial_only');
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>16384)throw Error('fixed_input_limit');}
const input=JSON.parse(raw);assert.deepEqual(Object.keys(input).sort(),['configuration','mode','scope']);
assert.ok(['choices','audit','held','proposal'].includes(input.mode));
const codes=[],record=async code=>{codes.push(code);return 'saved';};
const transport=createPostgresOperatorAuditTransport(input.configuration);
try{
 const readers={choices:createOperatorAuditChoicesReader(transport.readChoices,()=>performance.now(),record),
  audit:createOperatorAuditReader(transport.readAudit,()=>performance.now(),record),
  held:createHeldDecisionsReader(transport.readHeld,()=>performance.now(),record),
  proposal:createProposalReader(transport.readProposal,()=>performance.now(),record)};
 const decision=await readers[input.mode](input.scope);assert.equal(decision.kind,'ok');assert.deepEqual(codes,[]);
 assert.equal(await transport.shutdown(),true);
 const loaded=new Map();function load(source){
  if(loaded.has(source.href))return loaded.get(source.href);
  const exports={},native=createRequire(source);loaded.set(source.href,exports);
  const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',compiled)(name=>{if(name.startsWith('.')){const candidate=new URL(name.endsWith('.tsx')?name:name+'.tsx',source);if(existsSync(candidate))return load(candidate);}return native(name);},exports);return exports;
 }
 const views={choices:['operator-audit-choices-view.tsx','OperatorAuditChoicesView'],
  audit:['operator-audit-view.tsx','OperatorAuditView'],held:['operator-held-decisions-view.tsx','HeldDecisionsView'],
  proposal:['operator-proposal-view.tsx','ProposalComparisonView']};
 const [file,name]=views[input.mode];const View=load(new URL('../src/'+file,import.meta.url))[name];
 const html=renderToStaticMarkup(createElement(View,{decision,selection:input.scope}));
 console.log(JSON.stringify({decision,html,diagnostics:codes,drained:true,actualPgRead:true,
  presentation:{mode:input.mode,htmlSha256:createHash('sha256').update(html).digest('hex'),browserVerified:false},browserVerified:false,httpVerified:false}));
}finally{await transport.shutdown();}
