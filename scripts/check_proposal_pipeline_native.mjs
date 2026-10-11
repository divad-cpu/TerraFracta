// Fixed synthetic producer boundary; never imported by the application.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {prepareProposalCaptureCommand,recoverProposalCaptureCommand,verifyProposalCaptureReceipt,PROPOSAL_CAPTURE_SQL} from '../src/server/proposal-capture-command.ts';
import {createProposalReader} from '../src/server/operator-proposal-reader.ts';

const input=JSON.parse(readFileSync(0,'utf8'));
if(input.mode==='prepare'||input.mode==='verify'){
 const command=prepareProposalCaptureCommand(input.selection,input.payload);
 if(input.mode==='prepare')console.log(JSON.stringify({sql:PROPOSAL_CAPTURE_SQL,values:command.values,proposalSha256:command.proposalSha256}));
 else console.log(JSON.stringify(verifyProposalCaptureReceipt(new TextEncoder().encode(JSON.stringify(input.receipt)),command)));
}else if(input.mode==='recover'||input.mode==='recover_verify'){
 const command=recoverProposalCaptureCommand(input.selection,input.report);
 if(input.mode==='recover')console.log(JSON.stringify({...command,sql:PROPOSAL_CAPTURE_SQL}));
 else console.log(JSON.stringify(verifyProposalCaptureReceipt(new TextEncoder().encode(JSON.stringify(input.receipt)),command)));
}else if(input.mode==='read'){
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
 let logged=0;
 const decision=await createProposalReader(async()=>new TextEncoder().encode(JSON.stringify(input.report)),()=>0,async()=>{logged++;return 'saved';})(input.scope);
 assert.equal(decision.kind,input.expectedKind);assert.equal(logged,0);
 const html=renderToStaticMarkup(createElement(View,{decision,selection:input.scope}));
 assert.ok(!html.includes('<button')&&!html.includes('<form'));
 if(decision.kind==='ok'){
  assert.equal(decision.report.capture.basePublicationId,null);
  assert.ok(html.includes('In 2025, the fictional share was 27.4%.'));
  assert.ok(html.includes('Proposed content — unverified'));
  assert.ok(html.includes('witnessed issue head had no publication'));
 }else assert.ok(!html.includes('In 2025, the fictional share'));
 console.log(JSON.stringify({kind:decision.kind,htmlSha256:createHash('sha256').update(html).digest('hex'),browserVerified:false}));
}else throw Error('Fixed synthetic producer mode unavailable');
