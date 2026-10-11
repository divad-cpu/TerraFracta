// Fixed private line protocol for the owned invented PostgreSQL trial. No HTTP.
// Credentials arrive once over stdin and are never printed or written here.
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { Client } from 'pg';
import { createPostgresIssueTransport } from '../src/server/postgres-issue-provider.ts';
import { canonicalPublicIssueRoute, createPublicIssueReader, createDevelopmentPublicIssueHandler, readPublicIssue } from '../src/server/public-issue-reader.ts';
if (process.argv.length !== 2) throw new Error('fixed_trial_only');
const lines = createInterface({input:process.stdin, crlfDelay:Infinity});
let configuration, transport, read;
const route={jurisdictionSlug:'fictional-country',issueSlug:'fictional-share'};
const held={status:503,cacheControl:'no-store'};
let observedPublication;
const diagnosticCodes = [];
let invalidDiagnostic = false;
const record = async code => {
  if (code !== 'public_issue_read' || diagnosticCodes.length >= 16) {
    invalidDiagnostic = true;
    throw new Error('fixed_diagnostic_only');
  }
  diagnosticCodes.push(code);
  return 'saved';
};
// Explicit finite recorder for every supplied provider and handler. The real
// default reader stays unconfigured; this trial never opens the default archive.
function makeReader(candidate) {
  return createPublicIssueReader(candidate, () => performance.now(), record);
}
// Reuse the existing in-process page verification pattern. Only the current
// reader dependency is supplied; actual pages/views/evidence/hooks render.
function load(relative, intercept) {
  const file=new URL(relative,import.meta.url),exports={},native=createRequire(file);
  const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports','process',compiled)(name=>{
    const replacement=intercept(name);if(replacement!==undefined)return replacement;
    if(name.startsWith('.')) {
      const full=new URL(name,file);
      if(full.pathname.endsWith('.tsx')||existsSync(new URL(full.href+'.tsx')))return load(full.pathname.endsWith('.tsx')?full.href:full.href+'.tsx',intercept);
      if(existsSync(new URL(full.href+'.ts')))return native(name+'.ts');
    }
    return native(name);
  },exports,process);
  return exports;
}
async function surfaces(decision,edition) {
  const rows=[];
  for(const view of ['issue','sources','search']) {
    let calls=0;
    const page=load('../app/reader-preview/[country]/[issue]/[view]/page.tsx',name=>name==='next/navigation'?{notFound(){throw new Error('fixed_valid_page_refused');}}:
      name.endsWith('public-issue-reader')?{canonicalPublicIssueRoute,readPublicIssue:async input=>{calls++;return read(input);}}:undefined).default;
    const element=await page({params:Promise.resolve({country:route.jurisdictionSlug,issue:route.issueSlug,view}),searchParams:Promise.resolve({...edition?{edition}:{},...view==='search'?{q:'fictional'}:{}})});
    const html=renderToStaticMarkup(element);assert.equal(calls,1);
    const changed=decision.status===200&&edition!==undefined&&edition!==decision.issue.publicationId;
    if(decision.status===200&&!changed)assert.ok(html.includes(decision.issue.claims[0].assertion));
    else {assert.ok(!/(?:27\.4|28\.1)%/.test(html));assert.ok(!html.includes('example.org/fictional-table'));assert.ok(!html.includes('textarea'));}
    if(changed)assert.ok(html.includes('A newer publication is available'));
    rows.push({view,edition:edition??null,changed,providerReads:calls,bytes:Buffer.byteLength(html),sha256:createHash('sha256').update(html).digest('hex'),html});
  }
  return rows;
}
const summarize=decision=>decision.status===200 ? {status:200,publicationId:decision.issue.publicationId,revision:decision.issue.revision,assertion:decision.issue.claims[0].assertion} : decision;
for await (const line of lines) {
  try {
    const input=JSON.parse(line);
    if (!configuration) {
      assert.equal(input.kind,'configuration');
      configuration=input.configuration;
      process.env.NODE_ENV='development';
      transport=createPostgresIssueTransport(configuration);read=makeReader(transport.readCandidate);
      console.log(JSON.stringify({kind:'ready'}));continue;
    }
    let result;
    switch(input.kind) {
      case 'read': {
        const decision=await read(route);
        const response=await createDevelopmentPublicIssueHandler(read, record)(new Request('http://127.0.0.1:3000/api/dev/public-issue/fictional-country/fictional-share',{headers:{'sec-fetch-site':'same-origin'}}),{params:Promise.resolve({country:'fictional-country',issue:'fictional-share'})},'development');
        const body=await response.json();assert.equal(response.status,decision.status);assert.equal(response.headers.get('cache-control'),'no-store');
        if(decision.status===200)assert.equal(body.issue.publicationId,decision.issue.publicationId);
        const markup=await surfaces(decision,decision.status===200?decision.issue.publicationId:observedPublication);
        const replaced=decision.status===200&&observedPublication&&observedPublication!==decision.issue.publicationId?await surfaces(decision,observedPublication):[];
        if(decision.status===200)observedPublication=decision.issue.publicationId;
        result={decision:summarize(decision),handlerStatus:response.status,defaultHeld:JSON.stringify(await readPublicIssue(route))===JSON.stringify(held),surfaces:markup,replacedEditionSurfaces:replaced};break;
      }
      case 'absent': result={decision:await read({...route,issueSlug:'absent-fixture'})};break;
      case 'preabort': {const c=new AbortController();c.abort();assert.deepEqual(await read(route,c.signal),held);result={held:true};break;}
      case 'permissions': {
        const c=new Client({...configuration,ssl:{rejectUnauthorized:true,ca:configuration.transport.ca},connectionTimeoutMillis:1000,statement_timeout:1000,options:'-c default_transaction_read_only=on'});
        c.on('error',()=>{});let denials=0;
        try {await c.connect();for(const sql of ['select * from terra_private.source_registrations','update terra_private.issue_heads set current_publication_id=null','set role postgres','delete from terra_private.automatic_route_qualifications']) {
          try {await c.query(sql);} catch {denials++;}
        }}finally{await c.end();}
        assert.equal(denials,4);result={denials};break;
      }
      case 'bad-password': {
        const t=createPostgresIssueTransport({...configuration,password:'WRONG_FICTITIOUS_PASSWORD'});
        assert.deepEqual(await makeReader(t.readCandidate)(route),held);assert.equal(await t.shutdown(),true);result={held:true,closed:true};break;
      }
      case 'untrusted-tls': {
        const t=createPostgresIssueTransport({...configuration,transport:{kind:'verified-tls'}});
        assert.deepEqual(await makeReader(t.readCandidate)(route),held);assert.equal(await t.shutdown(),true);result={held:true,closed:true};break;
      }
      case 'overprivileged': {
        const t=createPostgresIssueTransport({...configuration,user:input.user});
        assert.deepEqual(await makeReader(t.readCandidate)(route),held);assert.equal(await t.shutdown(),true);result={held:true,closed:true};break;
      }
      case 'start-two': {
        const controllers=[new AbortController(),new AbortController()];
        globalThis.ownedPair={controllers,pending:controllers.map(c=>read(route,c.signal))};
        result={started:2};break;
      }
      case 'overflow': {assert.deepEqual(await read(route),held);result={held:true};break;}
      case 'finish-two': {
        const pair=globalThis.ownedPair;assert.ok(pair);pair.controllers.forEach(c=>c.abort());
        for(const decision of await Promise.all(pair.pending))assert.deepEqual(decision,held);
        delete globalThis.ownedPair;result={held:2};break;
      }
      case 'start-abort': {
        const c=new AbortController();const pending=read(route,c.signal);
        // The parent separately observes a real server wait before this fixed
        // abort command; the Node operation itself accepts no SQL or timing.
        globalThis.ownedPending={c,pending};result={started:true};break;
      }
      case 'finish-abort': {
        const pending=globalThis.ownedPending;assert.ok(pending);pending.c.abort();assert.deepEqual(await pending.pending,held);delete globalThis.ownedPending;
        result={held:true};break;
      }
      case 'shutdown': result={drained:await transport.shutdown()};break;
      case 'exit': {
        assert.equal(await transport.shutdown(),true);
        await new Promise(resolve => setImmediate(resolve));assert.equal(invalidDiagnostic,false);
        console.log(JSON.stringify({kind:'exit',result:{drained:true,diagnosticCodes:diagnosticCodes.splice(0)}}));process.exit(0);
      }
      default:throw new Error('fixed_trial_only');
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(invalidDiagnostic, false);
    console.log(JSON.stringify({kind:input.kind,result:{...result,diagnosticCodes:diagnosticCodes.splice(0)}}));
  }catch(error){console.log(JSON.stringify({kind:'failure',errorType:error?.constructor?.name??'Error'}));process.exitCode=1;break;}
}
if(transport)await transport.shutdown();
