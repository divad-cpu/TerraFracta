// Fixed private protocol for a fresh owned invented PostgreSQL TLS trial.
// Credentials arrive once over stdin; never emit exception text or configuration.
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { Client } from "pg";
import { createPostgresOperatorAuditTransport } from "../src/server/postgres-operator-audit-provider.ts";
import { canonicalOperatorAuditScope, createOperatorAuditReader, readOperatorAudit } from "../src/server/operator-audit-reader.ts";
import { canonicalOperatorAuditChoice, canonicalOperatorAuditRunCursor, createOperatorAuditChoicesReader, readOperatorAuditChoices } from "../src/server/operator-audit-choices-reader.ts";
import { canonicalHeldDecisionScope, createHeldDecisionsReader, readHeldDecisions } from "../src/server/operator-held-decisions-reader.ts";
import { heldCheckNames } from "../src/operator-held-decisions.ts";
import { canonicalProposalScope, createProposalReader, readCapturedProposal } from "../src/server/operator-proposal-reader.ts";

if (process.argv.length !== 2) throw new Error("fixed_trial_only");
const RUN = "41000000-0000-4000-8000-000000000001";
const ISSUE = "42000000-0000-4000-8000-000000000001";
const ABSENT = "49000000-0000-4000-8000-000000000001";
const scope = (runId = RUN, issueId = ISSUE, cursor = null) => ({ runId, issueId, cursor });
const held = { kind: "unavailable" };
const hash = value => createHash("sha256").update(value).digest("hex");
const attribute = (text, name) => text.match(new RegExp("(?:^|\\s)" + name + '="([^"]*)"'))?.[1];
const pageSource = new URL("../app/editorial-preview/audit/page.tsx", import.meta.url);
const choicesPageSource = new URL("../app/editorial-preview/audit/select/page.tsx", import.meta.url);
const heldPageSource = new URL("../app/editorial-preview/held/page.tsx", import.meta.url);
const proposalPageSource = new URL("../app/editorial-preview/held/proposal/page.tsx", import.meta.url);
const proposalScope = { runId:"87000000-0000-4000-8000-000000000001", decisionId:"87000000-0000-4000-8000-000000000002" };
let readProposal;
let configuration, transport, read, readChoices, readHeld, cursor, runCursor, firstRunIds, olderRunLink, heldCursor, firstHeldIds, olderHeldLink, pending, pair;
const heldScope = (runId = RUN, cursor = null) => ({ runId, cursor });
const events = [];
const record = async code => { assert.equal(code, "operator_audit_read"); events.push(code); return "saved"; };
const makeReader = candidate => createOperatorAuditReader(candidate, () => performance.now(), record);
const makeChoicesReader = candidate => createOperatorAuditChoicesReader(candidate, () => performance.now(), record);
const makeHeldReader = candidate => createHeldDecisionsReader(candidate, () => performance.now(), record);
const settle = () => new Promise(resolve => setImmediate(resolve));

// Reuse the existing in-process page/TSX seam, with actual PageIntro and native
// React. Only the page's Next refusal and reader dependencies are supplied.
function load(source, pageReader, modules = new Map()) {
  if (modules.has(source.href)) return modules.get(source.href);
  const exports = {}, native = createRequire(source);
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  modules.set(source.href, exports);
  new Function("require", "exports", "process", compiled)(name => {
    if ([pageSource.href, choicesPageSource.href, heldPageSource.href, proposalPageSource.href].includes(source.href) && name === "next/navigation")
      return { notFound() { throw new Error("fixed_valid_page_refused"); } };
    if (source.href === pageSource.href && name.endsWith("operator-audit-reader.ts"))
      return { canonicalOperatorAuditScope, readOperatorAudit: pageReader };
    if (source.href === choicesPageSource.href && name.endsWith("operator-audit-choices-reader.ts"))
      return { canonicalOperatorAuditChoice, canonicalOperatorAuditRunCursor, readOperatorAuditChoices: pageReader };
    if (source.href === heldPageSource.href && name.endsWith("operator-held-decisions-reader.ts"))
      return { canonicalHeldDecisionScope, readHeldDecisions: pageReader };
    if (source.href === proposalPageSource.href && name.endsWith("operator-proposal-reader.ts"))
      return { canonicalProposalScope, readCapturedProposal:pageReader };
    if (name.startsWith(".")) {
      const candidate = new URL(name.endsWith(".tsx") ? name : name + ".tsx", source);
      if (existsSync(candidate)) return load(candidate, pageReader, modules);
    }
    return native(name);
  }, exports, { env: { NODE_ENV: "development" } });
  return exports;
}
const { OperatorAuditView } = load(new URL("../src/operator-audit-view.tsx", import.meta.url));
const titles = { unavailable: "Recorded audit unavailable", not_found: "No matching recorded audit",
  changed: "Publication ledger changed", unconfigured: "Recorded audit connection unavailable" };
function markup(decision, request) {
  const html = renderToStaticMarkup(createElement(OperatorAuditView, { decision, selection: request }));
  assert.ok(html.includes("<h1>Recorded source and publication audit</h1>"));
  assert.ok(!html.includes("PRIVATE_"));
  if (decision.kind === "ok") {
    assert.ok(html.includes("Recorded audit snapshot"));
    for (const row of decision.report.history.publications) assert.ok(html.includes(row.publicationId));
    assert.ok(html.includes("These issue revisions are not attributed to the selected run."));
  } else {
    assert.ok(html.includes(titles[decision.kind]));
    assert.ok(!html.includes("Stored publication history"));
    assert.ok(!html.includes("Query observed at (UTC)"));
  }
  return { bytes: Buffer.byteLength(html), sha256: hash(html), html };
}
async function surfaces(decision, request) {
  const view = markup(decision, request);
  let calls = 0;
  // The real byte reader has already produced this decision. The actual page
  // consumes that exact decision via its ordinary reader seam, without a second
  // query or an assertion that runtime credentials have been installed.
  const page = load(pageSource, async selected => {
    calls++; assert.deepEqual(selected, request); return decision;
  }).default;
  const query = { runId: request.runId, issueId: request.issueId };
  if (request.cursor !== null) {
    query.latestRevision = String(request.cursor.latestRevision);
    query.beforeRevision = String(request.cursor.beforeRevision);
    if (request.cursor.headPublicationId !== null) query.headPublicationId = request.cursor.headPublicationId;
  }
  const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve(query) }));
  assert.equal(calls, 1);
  assert.equal(html, view.html);
  return { view, page: { bytes: Buffer.byteLength(html), sha256: hash(html), readerCalls: calls },
    actualPageReaderSeam: true, installedRuntimeIdentity: false };
}
async function selectedRead(request, expected = "ok") {
  const start = events.length, decision = await read(request);
  await settle(); assert.equal(decision.kind, expected);
  const recorded = events.slice(start);
  assert.deepEqual(recorded, expected === "unavailable" ? ["operator_audit_read"] : []);
  if (decision.kind === "ok") {
    assert.deepEqual(decision.report.requested, request);
    assert.ok(Buffer.byteLength(JSON.stringify(decision.report)) <= 65536);
    assert.ok(!JSON.stringify(decision).includes("PRIVATE_"));
  }
  return { decision, diagnosticCodes: recorded, surfaces: await surfaces(decision, request) };
}
async function choicesSurfaces(decision, runId, requestedCursor = null) {
  const { OperatorAuditChoicesView } = load(new URL("../src/operator-audit-choices-view.tsx", import.meta.url));
  const html = renderToStaticMarkup(createElement(OperatorAuditChoicesView, { decision, selection: runId, cursor: requestedCursor }));
  assert.ok(html.includes("<h1>Choose a recorded run and issue</h1>"));
  assert.ok(!html.includes("PRIVATE_"));
  if (decision.kind === "ok") {
    for (const run of decision.report.runs) assert.ok(html.includes(run.runId));
    for (const issue of decision.report.issues) assert.ok(html.includes(issue.issueId));
  } else {
    assert.ok(!html.includes(ISSUE)); assert.ok(!html.includes("52000000-0000-4000-8000-000000000001"));
    assert.ok(!html.includes('action="/editorial-preview/audit"'));
  }
  let calls = 0;
  const page = load(choicesPageSource, async (selected, _signal, selectedCursor) => {
    calls++; assert.equal(selected, runId); assert.deepEqual(selectedCursor, requestedCursor); return decision;
  }).default;
  const query = runId === null ? {} : { runId };
  if (requestedCursor !== null) {
    query.beforeCreatedAt = requestedCursor.createdAt; query.beforeRunId = requestedCursor.runId;
  }
  const pageHtml = renderToStaticMarkup(await page({ searchParams: Promise.resolve(query) }));
  assert.equal(calls, 1); assert.equal(pageHtml, html);
  return { view: { html, bytes: Buffer.byteLength(html), sha256: hash(html) },
    page: { bytes: Buffer.byteLength(pageHtml), sha256: hash(pageHtml), readerCalls: calls },
    actualPageReaderSeam: true, installedRuntimeIdentity: false };
}
async function selectedChoices(runId = null, expected = "ok", requestedCursor = null) {
  const start = events.length, decision = await readChoices(runId, undefined, requestedCursor);
  await settle(); assert.equal(decision.kind, expected);
  assert.deepEqual(events.slice(start), expected === "unavailable" ? ["operator_audit_read"] : []);
  if (decision.kind === "ok") {
    assert.equal(decision.report.schemaVersion, 2); assert.equal(decision.report.status, "ok");
    assert.equal(decision.report.requestedRunId, runId);
    assert.deepEqual(decision.report.requestedCursor, requestedCursor);
    assert.ok(Buffer.byteLength(JSON.stringify(decision.report)) <= 65536);
    assert.ok(!JSON.stringify(decision).includes("PRIVATE_"));
  }
  return { decision, diagnosticCodes: events.slice(start), surfaces: await choicesSurfaces(decision, runId, requestedCursor) };
}
function choicesLink(html, label) {
  const link = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].find(match => match[2] === label);
  assert.ok(link, "Actual run navigation link absent");
  const href = attribute(link[1], "href").replaceAll("&amp;", "&");
  const url = new URL(href, "https://terrafracta.invalid");
  assert.equal(url.pathname, "/editorial-preview/audit/select");
  assert.equal(url.origin, "https://terrafracta.invalid");
  const fields = [...url.searchParams.keys()];
  assert.ok(fields.every(field => ["runId","beforeCreatedAt","beforeRunId"].includes(field)));
  assert.equal(new Set(fields).size, fields.length);
  const runId = canonicalOperatorAuditChoice(url.searchParams.get("runId"));
  const requestedCursor = canonicalOperatorAuditRunCursor(url.searchParams.has("beforeCreatedAt") || url.searchParams.has("beforeRunId") ?
    { createdAt: url.searchParams.get("beforeCreatedAt"), runId: url.searchParams.get("beforeRunId") } : null);
  assert.notEqual(runId, undefined); assert.notEqual(requestedCursor, undefined);
  return { runId, requestedCursor, href };
}
function heldLink(html, label) {
  const link = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].find(match => match[2] === label);
  assert.ok(link, "Actual held navigation link absent");
  const href = attribute(link[1], "href").replaceAll("&amp;", "&");
  const url = new URL(href, "https://terrafracta.invalid");
  assert.equal(url.origin, "https://terrafracta.invalid"); assert.equal(url.pathname, "/editorial-preview/held");
  const keys = [...url.searchParams.keys()];
  assert.ok(keys.every(key => ["runId","beforeDecidedAt","beforeDecisionId"].includes(key)));
  assert.equal(new Set(keys).size, keys.length);
  const scope = canonicalHeldDecisionScope({ runId: url.searchParams.get("runId"),
    cursor: keys.length === 1 ? null : { decidedAt: url.searchParams.get("beforeDecidedAt"), decisionId: url.searchParams.get("beforeDecisionId") } });
  assert.ok(scope); return { scope, href };
}
async function heldSurfaces(decision, requested) {
  const { HeldDecisionsView } = load(new URL("../src/operator-held-decisions-view.tsx", import.meta.url));
  const html = renderToStaticMarkup(createElement(HeldDecisionsView, { decision, selection: requested }));
  assert.ok(html.includes("<h1>Held decisions</h1>")); assert.ok(!html.includes("PRIVATE_"));
  assert.ok(!html.includes("https://"));
  if (decision.kind === "ok") {
    assert.ok(html.includes("Proposal details are read separately"));
    assert.ok(html.includes("A missing conflict dossier does not mean there is no conflict"));
    const back = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].find(match => match[2] === "Back to this recorded run");
    assert.ok(back, "Actual return-to-recorded-run link absent");
    const backUrl = new URL(attribute(back[1], "href").replaceAll("&amp;", "&"), "https://terrafracta.invalid");
    assert.equal(backUrl.origin, "https://terrafracta.invalid");
    assert.equal(backUrl.pathname, "/editorial-preview/audit/select");
    assert.deepEqual([...backUrl.searchParams.entries()], [["runId",requested.runId]]);
    for (const row of decision.report.decisions) {
      assert.ok(html.includes(row.decisionId));
    }
    const proposalHrefs = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
      .filter(match => match[2] === "Inspect captured proposal")
      .map(match => attribute(match[1], "href"));
    assert.deepEqual(proposalHrefs, decision.report.decisions.map(row =>
      `/editorial-preview/held/proposal?runId=${requested.runId}&amp;decisionId=${row.decisionId}`));
    const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)];
    assert.equal(forms.length, 2);
    for (const [, attributes] of forms) {
      assert.equal(attribute(attributes, "method"), "get");
      assert.equal(attribute(attributes, "action"), "/editorial-preview/held");
    }
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    assert.deepEqual(buttons.map(match => match[2]), ["Search held references", "Apply reason filter"]);
    for (const [, attributes] of buttons) assert.equal(attribute(attributes, "type"), "submit");
    for (const [, attributes] of html.matchAll(/<input\b([^>]*)>/g)) {
      assert.ok(["hidden", "search"].includes(attribute(attributes, "type")));
    }
    assert.ok(!/method="post"|formaction=|formmethod=/i.test(html));
  } else {
    assert.ok(!html.includes("Recorded holds"));
    assert.ok(!html.includes("66000000-0000-4000-8000-000000000019"));
  }
  let calls = 0;
  const page = load(heldPageSource, async selected => {
    calls++; assert.deepEqual(selected, requested); return decision;
  }).default;
  const query = { runId: requested.runId };
  if (requested.cursor !== null) {
    query.beforeDecidedAt = requested.cursor.decidedAt; query.beforeDecisionId = requested.cursor.decisionId;
  }
  const pageHtml = renderToStaticMarkup(await page({ searchParams: Promise.resolve(query) }));
  assert.equal(calls, 1); assert.equal(pageHtml, html);
  return { view: { html, bytes: Buffer.byteLength(html), sha256: hash(html) },
    page: { bytes: Buffer.byteLength(pageHtml), sha256: hash(pageHtml), readerCalls: calls },
    actualPageReaderSeam: true, installedRuntimeIdentity: false };
}
async function selectedHeld(requested = heldScope(), expected = "ok") {
  const start = events.length, decision = await readHeld(requested);
  await settle(); assert.equal(decision.kind, expected);
  assert.deepEqual(events.slice(start), expected === "unavailable" ? ["operator_audit_read"] : []);
  if (decision.kind === "ok") {
    assert.deepEqual(decision.report.requested, requested);
    assert.ok(Buffer.byteLength(JSON.stringify(decision.report)) <= 65536);
    assert.ok(!JSON.stringify(decision).includes("PRIVATE_"));
    assert.ok(!JSON.stringify(decision).includes("https://"));
    assert.ok(!JSON.stringify(decision).includes("9999999999999999999999999999999999999999999999999999999999999999"));
    for (const row of decision.report.decisions) assert.deepEqual(Object.keys(row.checks).sort(), [...heldCheckNames].sort());
  }
  return { decision, diagnosticCodes: events.slice(start), surfaces: await heldSurfaces(decision, requested) };
}
function rawClient(config = configuration) {
  return new Client({ host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password,
    ssl: { rejectUnauthorized: true, ca: config.transport.ca }, sslnegotiation: "postgres",
    enableChannelBinding: true, connectionTimeoutMillis: 1000, statement_timeout: 1000,
    options: "-c default_transaction_read_only=on", application_name: "terrafracta.audit-trial-probe" });
}
async function authenticationProbe(expectedScram, config = configuration) {
  const client = rawClient(config); client.on("error", () => {});
  try {
    await client.connect();
    const row = (await client.query("select session_user=current_user as ordinary, " +
      "system_user='scram-sha-256:'||session_user as scram, system_user is null as unknown, " +
      "current_setting('transaction_read_only')='on' as readonly, " +
      "(select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls, " +
      "r.rolcanlogin as login, r.rolinherit as inherit, r.rolcreatedb as createdb, r.rolsuper as super, " +
      "r.rolcreaterole as createrole, r.rolreplication as replication, r.rolbypassrls as bypassrls, " +
      "pg_has_role(session_user,'terra_reviewer','SET') as may_set, " +
      "pg_has_role(session_user,'terra_reviewer','USAGE') as inherited, " +
      "pg_has_role(session_user,'terra_reviewer','SET WITH ADMIN OPTION') as admin " +
      "from pg_roles r where r.rolname=session_user")).rows[0];
    assert.equal(row.ordinary, true); assert.equal(row.readonly, true); assert.equal(row.tls, true);
    assert.equal(expectedScram ? row.scram : row.unknown, true);
    assert.equal(row.login, true);
    return { ordinary: true, readonly: true, verifiedTls: true, scram: expectedScram,
      unknownAuthenticationIdentity: !expectedScram, roleFlags: {
        inherit: row.inherit, createdb: row.createdb, super: row.super, createrole: row.createrole,
        replication: row.replication, bypassrls: row.bypassrls, maySet: row.may_set,
        inheritedReviewer: row.inherited, reviewerAdmin: row.admin,
      } };
  } finally { await client.end(); }
}
async function permissions() {
  const client = rawClient(); client.on("error", () => {});
  let directDenied = false, writeDenied = false, count;
  try {
    await client.connect();
    try { await client.query("select count(*) from terra_private.source_registrations"); }
    catch (error) { assert.equal(error.code, "42501"); directDenied = true; }
    await client.query("begin read only"); await client.query("set local role terra_reviewer");
    const flags = (await client.query("select current_user='terra_reviewer' as reviewer, " +
      "pg_has_role(session_user,'terra_reviewer','SET') as may_set, " +
      "pg_has_role(session_user,'terra_reviewer','USAGE') as inherited, " +
      "pg_has_role(session_user,'terra_reviewer','SET WITH ADMIN OPTION') as admin")).rows[0];
    assert.deepEqual(flags, { reviewer: true, may_set: true, inherited: false, admin: false });
    count = Number((await client.query("select count(*) from terra_private.source_registrations")).rows[0].count);
    assert.equal(count, 5);
    try { await client.query("update terra_private.source_registrations set source_key=source_key"); }
    catch (error) { assert.ok(["25006", "42501"].includes(error.code)); writeDenied = true; }
    await client.query("rollback");
  } finally { await client.end(); }
  assert.ok(directDenied && writeDenied);
  return { directDenied, writeDenied, broadReviewerRows: count, credentialFunctionConfined: false };
}
async function faultConfiguration(config, choices = false) {
  const candidate = createPostgresOperatorAuditTransport(config), start = events.length;
  try {
    const decision = choices === "proposal" ? await createProposalReader(candidate.readProposal,()=>performance.now(),record)(proposalScope) :
      choices === "held" ? await makeHeldReader(candidate.readHeld)(heldScope()) :
      choices ? await makeChoicesReader(candidate.readChoices)(RUN) : await makeReader(candidate.readAudit)(scope());
    assert.deepEqual(decision, held);
    await settle(); assert.deepEqual(events.slice(start), ["operator_audit_read"]);
    return { held: true, diagnosticCodes: events.slice(start), drained: await candidate.shutdown() };
  } finally { assert.equal(await candidate.shutdown(), true); }
}
async function selectedProposal(expected, requested=proposalScope){
 const start=events.length,decision=await readProposal(requested);await settle();
 assert.equal(decision.kind,expected);
 assert.deepEqual(events.slice(start),expected==='unavailable'?['operator_audit_read']:[]);
 const {ProposalComparisonView}=load(new URL('../src/operator-proposal-view.tsx',import.meta.url));
 const html=renderToStaticMarkup(createElement(ProposalComparisonView,{decision,selection:requested}));
 assert.ok(!html.includes('<form')&&!html.includes('PRIVATE_'));
 if(expected==='ok'){
  assert.ok(html.includes('Captured content cannot be edited here'));
  assert.ok(html.includes('Nothing is submitted, saved to the archive or published'));
  const buttons=[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(buttons.map(match=>match[2]),['Clear reference finder','Show all reference choices',
   'Reopen scope preparation','Review scope draft','Clear scope draft','Show all responsibility reference choices','Add responsibility entry',
   'Review responsibility draft','Clear responsibility draft','Reopen responsibility preparation',
   'Show all indicator reference choices','Add indicator entry','Inspect unsent indicator draft','Clear indicator draft','Reopen indicator preparation',
   'Inspect combined preparation packet','Clear preparation packet','Read saved preparation packet','Reopen preparation packet']);
  for(const [,attributes] of buttons){
   assert.match(attributes,/(?:^|\s)type="button"(?=\s|$)/);
   assert.match(attributes,/(?:^|\s)disabled=""(?=\s|$)/);
  }
  // The preceding reference finder is read-only; unsent preparation remains
  // unadmitted in server markup, independently of those local lookup controls.
  const preparationStart=html.indexOf('<details class="issue-scope-preparation"');
  assert.ok(preparationStart>=0);
  const fields=[...html.slice(preparationStart).matchAll(/<(?:input|select|textarea)\b([^>]*)>/g)];
  assert.ok(fields.length>0);
  for(const [,attributes] of fields)assert.match(attributes,/(?:^|\s)disabled=""(?=\s|\/|$)/);
  for(const [,attributes] of html.matchAll(/<input\b([^>]*)>/g))
   assert.match(attributes,/(?:^|\s)type="(?:search|file)"(?=\s|\/|$)/);
  assert.ok(!/type="submit"|method="post"|formaction=|formmethod=/i.test(html));
  assert.equal(decision.report.capture.basePublicationId,null);
  assert.ok(html.includes('The invented share was 8.2%.'));
  assert.ok(html.includes('witnessed issue head had no publication'));
 }else assert.ok(!html.includes('The invented share')&&!html.includes('<button'));
 let calls=0;
 const page=load(proposalPageSource,async selected=>{calls++;assert.deepEqual(selected,requested);return decision;}).default;
 const pageHtml=renderToStaticMarkup(await page({searchParams:Promise.resolve(requested)}));
 assert.equal(calls,1);assert.equal(pageHtml,html);
 return {decision,diagnosticCodes:events.slice(start),htmlSha256:hash(html),actualPageReaderSeam:true,browserVerified:false};
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  try {
    assert.ok(Buffer.byteLength(line) < 100000);
    const input = JSON.parse(line);
    if (configuration === undefined) {
      assert.equal(input.kind, "configuration"); configuration = input.configuration;
      transport = createPostgresOperatorAuditTransport(configuration);
      assert.ok(Object.isFrozen(transport)); read = makeReader(transport.readAudit);
      readChoices = makeChoicesReader(transport.readChoices);
      readHeld = makeHeldReader(transport.readHeld);
      readProposal = createProposalReader(transport.readProposal,()=>performance.now(),record);
      console.log(JSON.stringify({ kind: "ready" })); continue;
    }
    let result;
    switch (input.kind) {
      case 'proposal-missing':result=await selectedProposal('capture_missing');break;
      case 'proposal':result=await selectedProposal('ok');break;
      case 'proposal-changed':result=await selectedProposal('changed');break;
      case 'proposal-unavailable':result=await selectedProposal('unavailable');break;
      case 'proposal-absent':result=await selectedProposal('not_found',{...proposalScope,decisionId:ABSENT});break;
      case 'proposal-bad-password':result=await faultConfiguration({...configuration,password:configuration.password+'wrong'},'proposal');break;
      case 'proposal-untrusted-ca':result=await faultConfiguration({...configuration,transport:{kind:'verified-tls'}},'proposal');break;
      case 'proposal-variant':result=await faultConfiguration({...configuration,user:input.user},'proposal');break;
      case 'proposal-default':assert.deepEqual(await readCapturedProposal(proposalScope),{kind:'unconfigured'});result={defaultUnconfigured:true};break;
      case 'proposal-preabort':{
       const controller=new AbortController(),start=events.length;controller.abort();
       assert.deepEqual(await readProposal(proposalScope,controller.signal),held);await settle();assert.equal(events.length,start);
       result={held:true,diagnosticCodes:[]};break;
      }
      case "read": {
        result = await selectedRead(scope());
        cursor = result.decision.report.history.nextCursor;
        assert.deepEqual(result.decision.report.history.publications.map(row => row.revision),
          Array.from({ length: 20 }, (_, index) => 25 - index)); break;
      }
      case "second": {
        assert.ok(cursor);
        result = await selectedRead(scope(RUN, ISSUE, cursor));
        assert.deepEqual(result.decision.report.history.publications.map(row => row.revision), [5,4,3,2,1]);
        assert.equal(result.decision.report.history.publications[2].isHead, true);
        assert.equal(result.decision.report.history.nextCursor, null); break;
      }
      case "absent-run": result = await selectedRead(scope(ABSENT), "not_found"); break;
      case "absent-issue": result = await selectedRead(scope(RUN, ABSENT), "not_found"); break;
      case "cross-scope": result = await selectedRead(scope(RUN, "42000000-0000-4000-8000-000000000003"), "not_found"); break;
      case "unknown": {
        result = await selectedRead(scope("41000000-0000-4000-8000-000000000002"));
        assert.equal(result.decision.report.expectedSourcesKnown, false);
        assert.equal(result.decision.report.sources.length, 1); break;
      }
      case "empty": {
        result = await selectedRead(scope("41000000-0000-4000-8000-000000000003", "42000000-0000-4000-8000-000000000002"));
        assert.equal(result.decision.report.expectedSourcesKnown, false);
        assert.deepEqual(result.decision.report.sources, []);
        assert.equal(result.decision.report.history.latestRevision, 0); break;
      }
      case "changed": result = await selectedRead(scope(RUN, ISSUE, cursor), "changed"); break;
      case "held": result = await selectedRead(scope(), "unavailable"); break;
      case "choices": {
        result = await selectedChoices();
        const report = result.decision.report;
        assert.equal(report.runs.length, 20); assert.equal(report.moreRuns, true);
        assert.deepEqual(report.runs.slice(0, 2).map(run => run.runId),
          ["51000000-0000-4000-8000-000000000016","51000000-0000-4000-8000-000000000015"]);
        assert.equal(report.runs[0].createdAt, report.runs[1].createdAt);
        assert.equal(report.selectedRun, null); assert.deepEqual(report.issues, []);
        assert.equal(report.moreIssues, false);
        runCursor = report.nextCursor; firstRunIds = report.runs.map(run => run.runId);
        assert.deepEqual(runCursor, { createdAt: "2026-10-04T06:00:03.000001Z",
          runId: "51000000-0000-4000-8000-000000000003" });
        assert.deepEqual({ createdAt: report.runs.at(-1).createdAt, runId: report.runs.at(-1).runId }, runCursor);
        assert.deepEqual(choicesLink(result.surfaces.view.html, "Older recorded runs").requestedCursor, runCursor); break;
      }
      case "choices-selected": {
        result = await selectedChoices(RUN);
        const report = result.decision.report;
        assert.equal(report.selectedRun.runId, RUN);
        assert.ok(!report.runs.some(run => run.runId === RUN));
        olderRunLink = choicesLink(result.surfaces.view.html, "Older recorded runs");
        assert.equal(olderRunLink.runId, RUN); assert.deepEqual(olderRunLink.requestedCursor, runCursor);
        assert.equal(report.issues.length, 50); assert.equal(report.moreIssues, true);
        assert.deepEqual(report.issues.slice(0, 2).map(issue => issue.issueKey), ["audit-empty","audit-history"]);
        const form = [...result.surfaces.view.html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)]
          .find(match => attribute(match[1], "action") === "/editorial-preview/audit");
        assert.ok(form, "Actual selected choices audit form absent");
        assert.equal(attribute(form[1], "method"), "get");
        const runInput = [...form[2].matchAll(/<input\b([^>]*)>/g)]
          .find(match => attribute(match[1], "name") === "runId");
        assert.ok(runInput); assert.equal(attribute(runInput[1], "type"), "hidden");
        const selectedRun = attribute(runInput[1], "value");
        const issueSelect = [...form[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)]
          .find(match => attribute(match[1], "name") === "issueId")?.[2];
        assert.equal(selectedRun, RUN); assert.ok(issueSelect);
        const selectedIssue = report.issues.find(issue => issue.issueKey === "audit-history");
        assert.ok(issueSelect.includes('value="' + selectedIssue.issueId + '"'));
        const audit = await selectedRead(scope(selectedRun, selectedIssue.issueId));
        assert.equal(audit.decision.report.history.latestRevision, 25);
        result.actualFormToAudit = { selectedRun, selectedIssue: selectedIssue.issueId,
          decision: audit.decision, surfaces: audit.surfaces, browserInteractionVerified: false }; break;
      }
      case "choices-next": {
        assert.ok(olderRunLink && runCursor && firstRunIds);
        result = await selectedChoices(olderRunLink.runId, "ok", olderRunLink.requestedCursor);
        const report = result.decision.report;
        assert.equal(report.runs.length, 6); assert.equal(report.moreRuns, false); assert.equal(report.nextCursor, null);
        assert.equal(report.runs[0].runId, "51000000-0000-4000-8000-000000000002");
        assert.equal(report.runs[0].createdAt, runCursor.createdAt);
        const allRunIds = [...firstRunIds, ...report.runs.map(run => run.runId)];
        assert.equal(allRunIds.length, 26); assert.equal(new Set(allRunIds).size, 26);
        assert.ok(Array.isArray(input.expectedRunIds) && input.expectedRunIds.length === 26);
        assert.ok(input.expectedRunIds.every(id => canonicalOperatorAuditChoice(id) === id));
        assert.deepEqual(allRunIds, input.expectedRunIds);
        const newest = choicesLink(result.surfaces.view.html, "Newest recorded runs");
        assert.equal(newest.runId, RUN); assert.equal(newest.requestedCursor, null);
        const reset = await selectedChoices(newest.runId, "ok", newest.requestedCursor);
        assert.deepEqual(reset.decision.report.runs.map(run => run.runId), firstRunIds);
        const form = [...result.surfaces.view.html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)]
          .find(match => attribute(match[1], "action") === "/editorial-preview/audit");
        assert.ok(form); assert.equal(attribute(form[1], "method"), "get");
        const runInput = [...form[2].matchAll(/<input\b([^>]*)>/g)]
          .find(match => attribute(match[1], "name") === "runId");
        const issue = report.issues.find(value => value.issueKey === "audit-history");
        assert.equal(attribute(runInput[1], "value"), RUN);
        assert.ok(form[2].includes('value="' + issue.issueId + '"'));
        const audit = await selectedRead(scope(attribute(runInput[1], "value"), issue.issueId));
        assert.equal(audit.decision.report.history.latestRevision, 25);
        result.navigation = { allRunIds, uniqueRunCount: new Set(allRunIds).size,
          olderLink: olderRunLink.href, newestLink: newest.href, newestReset: reset,
          actualOlderFormToAudit: audit, browserInteractionVerified: false }; break;
      }
      case "choices-selected-newer": {
        result = await selectedChoices("51000000-0000-4000-8000-000000000016", "ok", runCursor);
        const report = result.decision.report;
        assert.ok(!report.runs.some(run => run.runId === report.selectedRun.runId));
        assert.ok(report.selectedRun.createdAt > runCursor.createdAt);
        assert.equal(report.issues.length, 50); assert.equal(report.moreIssues, true); break;
      }
      case "choices-changed": result = await selectedChoices(RUN, "changed", runCursor); break;
      case "choices-restored": result = await selectedChoices(RUN, "ok", runCursor); break;
      case "choices-unknown-cursor": result = await selectedChoices(RUN, "changed", { ...runCursor, runId: ABSENT }); break;
      case "choices-future-cursor": result = await selectedChoices(RUN, "changed", {
        createdAt: "9999-01-01T00:00:00.000001Z", runId: runCursor.runId }); break;
      case "choices-anchor-held": result = await selectedChoices(RUN, "unavailable", runCursor); break;
      case "choices-future-anchor-held": result = await selectedChoices(RUN, "unavailable", {
        createdAt: "9999-01-01T00:00:00.000001Z", runId: runCursor.runId }); break;
      case "choices-absent": {
        result = await selectedChoices(ABSENT);
        assert.equal(result.decision.report.selectedRun, null); assert.deepEqual(result.decision.report.issues, []);
        assert.equal(result.decision.report.moreIssues, false); break;
      }
      case "choices-empty-jurisdiction": {
        result = await selectedChoices("51000000-0000-4000-8000-000000000030");
        assert.equal(result.decision.report.selectedRun.jurisdictionId, "choice-empty-country");
        assert.deepEqual(result.decision.report.issues, []); assert.equal(result.decision.report.moreIssues, false); break;
      }
      case "choices-empty": {
        result = await selectedChoices();
        assert.deepEqual(result.decision.report.runs, []); assert.equal(result.decision.report.moreRuns, false); break;
      }
      case "choices-held": result = await selectedChoices(RUN, "unavailable"); break;
      case "choices-default": {
        assert.deepEqual(await readOperatorAuditChoices(), { kind: "unconfigured" });
        result = { defaultUnconfigured: true, surfaces: await choicesSurfaces({ kind: "unconfigured" }, null) }; break;
      }
      case "choices-preabort": {
        const controller = new AbortController(), start = events.length; controller.abort();
        assert.deepEqual(await readChoices(null, controller.signal), held);
        await settle(); assert.equal(events.length, start); result = { held: true, diagnosticCodes: [] }; break;
      }
      case "start-choices-abort": {
        assert.equal(pending, undefined);
        const controller = new AbortController();
        pending = { controller, start: events.length, promise: readChoices(RUN, controller.signal) };
        result = { started: true }; break;
      }
      case "start-mixed": {
        assert.equal(pair, undefined);
        const controllers = [new AbortController(), new AbortController()];
        pair = { controllers, start: events.length, promises: [
          read(scope(), controllers[0].signal), readChoices(RUN, controllers[1].signal),
        ] };
        result = { started: 2, methods: ["readAudit","readChoices"] }; break;
      }
      case "choices-overflow": {
        const start = events.length; assert.deepEqual(await readChoices(RUN), held); await settle();
        assert.deepEqual(events.slice(start), ["operator_audit_read"]);
        result = { held: true, diagnosticCodes: ["operator_audit_read"] }; break;
      }
      case "held-first": {
        const choice = await selectedChoices(RUN);
        const link = heldLink(choice.surfaces.view.html, "Inspect held decisions for this run");
        assert.deepEqual(link.scope, heldScope()); result = await selectedHeld(link.scope);
        const report = result.decision.report;
        assert.equal(report.decisions.length, 20); assert.equal(report.more, true);
        assert.deepEqual(report.decisions.slice(0,2).map(row => row.decisionId),
          ["66000000-0000-4000-8000-000000000019","66000000-0000-4000-8000-000000000018"]);
        assert.equal(report.decisions[0].decidedAt, report.decisions[1].decidedAt);
        for (const row of report.decisions) {
          assert.deepEqual(row.reasonCodes, ["material_conflict","material_conflict"]);
          assert.equal(row.undisclosedReasonCount, 1); assert.equal(row.undisclosedCheckCount, 2);
          assert.equal(row.checks.source_version_current, true); assert.equal(row.checks.evidence_locator_verified, false);
          assert.equal(row.checks.identity_resolved, null);
        }
        heldCursor = report.nextCursor; firstHeldIds = report.decisions.map(row => row.decisionId);
        assert.deepEqual(heldCursor, { decidedAt:"2026-09-28T06:03:06.000001Z",
          decisionId:"66000000-0000-4000-8000-000000000006" });
        olderHeldLink = heldLink(result.surfaces.view.html, "Older held decisions");
        assert.deepEqual(olderHeldLink.scope, heldScope(RUN, heldCursor));
        result.actualChoiceToHeld = { href:link.href, requested:link.scope, browserInteractionVerified:false }; break;
      }
      case "held-next": {
        assert.ok(olderHeldLink && firstHeldIds && heldCursor);
        result = await selectedHeld(olderHeldLink.scope);
        const report = result.decision.report;
        assert.equal(report.decisions.length,5); assert.equal(report.more,false); assert.equal(report.nextCursor,null);
        assert.equal(report.decisions[0].decisionId,"66000000-0000-4000-8000-000000000005");
        assert.equal(report.decisions[0].decidedAt, heldCursor.decidedAt);
        const allIds=[...firstHeldIds,...report.decisions.map(row=>row.decisionId)];
        assert.equal(allIds.length,25); assert.equal(new Set(allIds).size,25); assert.deepEqual(allIds,input.expectedDecisionIds);
        const reset=heldLink(result.surfaces.view.html,"Start a fresh held-decision read");
        assert.deepEqual(reset.scope,heldScope()); const fresh=await selectedHeld(reset.scope);
        assert.deepEqual(fresh.decision.report.decisions.map(row=>row.decisionId),firstHeldIds);
        result.navigation={allIds,uniqueDecisionCount:25,olderLink:olderHeldLink.href,newestReset:fresh,browserInteractionVerified:false};break;
      }
      case "held-other-run": {
        result=await selectedHeld(heldScope("41000000-0000-4000-8000-000000000002"));
        assert.deepEqual(result.decision.report.decisions.map(row=>row.decisionId),["66000000-0000-4000-8000-000000000030"]);break;
      }
      case "held-absent": result=await selectedHeld(heldScope(ABSENT),"not_found");break;
      case "held-empty": {
        result=await selectedHeld(heldScope("41000000-0000-4000-8000-000000000003"));
        assert.deepEqual(result.decision.report.decisions,[]);assert.equal(result.decision.report.more,false);break;
      }
      case "held-changed": result=await selectedHeld(heldScope(RUN,heldCursor),"changed");break;
      case "held-unknown-cursor": result=await selectedHeld(heldScope(RUN,{...heldCursor,decisionId:ABSENT}),"changed");break;
      case "held-future-cursor": result=await selectedHeld(heldScope(RUN,{decidedAt:"9999-01-01T00:00:00.000001Z",decisionId:heldCursor.decisionId}),"changed");break;
      case "held-restored": result=await selectedHeld(heldScope(RUN,heldCursor));break;
      case "held-technical": result=await selectedHeld(heldScope(),"unavailable");break;
      case "held-anchor-technical": result=await selectedHeld(heldScope(RUN,heldCursor),"unavailable");break;
      case "held-default": {
        assert.deepEqual(await readHeldDecisions(heldScope()),{kind:"unconfigured"});
        result={defaultUnconfigured:true,surfaces:await heldSurfaces({kind:"unconfigured"},heldScope())};break;
      }
      case "held-preabort": {
        const controller=new AbortController(),start=events.length;controller.abort();
        assert.deepEqual(await readHeld(heldScope(),controller.signal),held);await settle();assert.equal(events.length,start);
        result={held:true,diagnosticCodes:[]};break;
      }
      case "start-held-abort": {
        assert.equal(pending,undefined);const controller=new AbortController();
        pending={controller,start:events.length,promise:readHeld(heldScope(),controller.signal)};result={started:true};break;
      }
      case "start-held-mixed": {
        assert.equal(pair,undefined);const controllers=[new AbortController(),new AbortController()];
        pair={controllers,start:events.length,promises:[read(scope(),controllers[0].signal),readHeld(heldScope(),controllers[1].signal)]};
        result={started:2,methods:["readAudit","readHeld"]};break;
      }
      case "held-overflow": {
        const start=events.length;assert.deepEqual(await readChoices(RUN),held);await settle();
        assert.deepEqual(events.slice(start),["operator_audit_read"]);result={held:true,diagnosticCodes:["operator_audit_read"],attemptedMethod:"readChoices"};break;
      }
      case "held-bad-password": result=await faultConfiguration({...configuration,password:"WRONG_INVENTED_PASSWORD"},"held");break;
      case "held-untrusted-ca": result=await faultConfiguration({...configuration,transport:{kind:"verified-tls"}},"held");break;
      case "authentication": result = await authenticationProbe(true); break;
      case "trust-authentication": result = await authenticationProbe(false); break;
      case "permissions": result = await permissions(); break;
      case "default": {
        assert.deepEqual(await readOperatorAudit(scope()), { kind: "unconfigured" });
        result = { defaultUnconfigured: true, surfaces: await surfaces({ kind: "unconfigured" }, scope()) }; break;
      }
      case "bad-password": result = await faultConfiguration({ ...configuration, password: "WRONG_INVENTED_PASSWORD" }); break;
      case "untrusted-ca": result = await faultConfiguration({ ...configuration, transport: { kind: "verified-tls" } }); break;
      case "variant": {
        assert.match(input.user, /^terra_audit_(noset|inherit|admin|elevated)_[0-9]{14}_[0-9a-f]{6}$/);
        const config = { ...configuration, user: input.user };
        // Prove the variant authenticated successfully before treating the
        // adapter's held result as role admission denial.
        const authentication = await authenticationProbe(true, config), flags = authentication.roleFlags;
        const kind = input.user.split("_")[2];
        assert.equal(flags.inherit, kind === "inherit");
        assert.equal(flags.inheritedReviewer, kind === "inherit");
        assert.equal(flags.maySet, kind !== "noset");
        assert.equal(flags.reviewerAdmin, kind === "admin");
        assert.equal(flags.createdb, kind === "elevated");
        for (const key of ["super","createrole","replication","bypassrls"]) assert.equal(flags[key], false);
        result = { ...await faultConfiguration(config), successfulVariantAuthentication: authentication,
          choicesRefusal: await faultConfiguration(config, true), heldRefusal:await faultConfiguration(config,"held") }; break;
      }
      case "loopback-refused": {
        assert.throws(() => createPostgresOperatorAuditTransport({ ...configuration, transport: { kind: "loopback-development" } }));
        result = { refusedBeforeConnection: true }; break;
      }
      case "preabort": {
        const controller = new AbortController(), start = events.length; controller.abort();
        assert.deepEqual(await read(scope(), controller.signal), held);
        await settle(); assert.equal(events.length, start); result = { held: true, diagnosticCodes: [] }; break;
      }
      case "start-abort":
      case "start-backend":
      case "start-shutdown": {
        assert.equal(pending, undefined);
        const controller = new AbortController();
        pending = { controller, start: events.length, promise: read(scope(), controller.signal) };
        result = { started: true }; break;
      }
      case "finish-abort": {
        assert.ok(pending); pending.controller.abort();
        assert.deepEqual(await pending.promise, held); await settle();
        assert.equal(events.length, pending.start); pending = undefined;
        result = { held: true, diagnosticCodes: [] }; break;
      }
      case "finish-backend": {
        assert.ok(pending); assert.deepEqual(await pending.promise, held); await settle();
        assert.deepEqual(events.slice(pending.start), ["operator_audit_read"]); pending = undefined;
        result = { held: true, diagnosticCodes: ["operator_audit_read"] }; break;
      }
      case "start-two": {
        assert.equal(pair, undefined); const controllers = [new AbortController(), new AbortController()];
        pair = { controllers, start: events.length, promises: controllers.map(controller => read(scope(), controller.signal)) };
        result = { started: 2 }; break;
      }
      case "overflow": {
        const start = events.length; assert.deepEqual(await read(scope()), held); await settle();
        assert.deepEqual(events.slice(start), ["operator_audit_read"]);
        result = { held: true, diagnosticCodes: ["operator_audit_read"] }; break;
      }
      case "finish-two": {
        assert.ok(pair); const start = events.length; pair.controllers.forEach(controller => controller.abort());
        for (const decision of await Promise.all(pair.promises)) assert.deepEqual(decision, held);
        await settle(); assert.equal(events.length, start); pair = undefined;
        result = { held: 2, cancellationDiagnosticCodes: [] }; break;
      }
      case "finish-shutdown": {
        assert.ok(pending);
        const drained = await transport.shutdown(); assert.deepEqual(await pending.promise, held);
        await settle(); assert.deepEqual(events.slice(pending.start), ["operator_audit_read"]); pending = undefined;
        result = { held: true, drained, permanentlyUnavailable: (await read(scope())).kind === "unavailable" }; break;
      }
      case "exit": {
        assert.equal(pending, undefined); assert.equal(pair, undefined); assert.equal(await transport.shutdown(), true);
        console.log(JSON.stringify({ kind: "exit", result: { drained: true, diagnosticEvents: events.length } }));
        process.exit(0);
      }
      default: throw new Error("fixed_trial_only");
    }
    console.log(JSON.stringify({ kind: input.kind, result }));
  } catch (error) {
    console.log(JSON.stringify({ kind: "failure", errorType: error?.constructor?.name ?? "Error" }));
    process.exitCode = 1; break;
  }
}
if (transport) await transport.shutdown();
