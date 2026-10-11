// In-process compiled page check only. No server/listener, HTTP or Browser.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

if (process.argv.length !== 2) throw new Error('Fixed compiled check accepts no arguments');
const root = process.cwd(), require = createRequire(resolve(root, 'package.json'));
const previous = process.env.NODE_ENV;
const rows = [];
try {
  process.env.NODE_ENV = 'production';
  // Installed Next explicitly requires this before importing compiled pages.
  require('next/dist/server/node-environment');
  for (const route of ['editorial-preview', 'editorial-preview/audit', 'editorial-preview/audit/select', 'editorial-preview/held', 'editorial-preview/held/proposal']) {
    const file = resolve(root, '.next/server/app', route, 'page.js');
    const built = require(file), pages = [];
    function visit(tree) {
      if (tree[2]?.page) pages.push(tree[2].page);
      for (const child of Object.values(tree[1] ?? {})) visit(child);
    }
    visit(built.routeModule.userland.loaderTree);
    assert.equal(pages.length, 1);
    const module = await pages[0][0]();
    assert.equal(typeof module.default, 'function');
    let inspected = false;
    const poison = new Proxy({}, { get() { inspected = true; throw new Error('compiled_page_inspected_request'); } });
    await assert.rejects(Promise.resolve().then(() => module.default(poison)), error => error?.digest === 'NEXT_HTTP_ERROR_FALLBACK;404');
    assert.equal(inspected, false);
    rows.push({ route, nextNotFoundDigest: 'NEXT_HTTP_ERROR_FALLBACK;404', beforeParameterInspection: true,
      compiledEntrySha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
  }
  console.log(JSON.stringify({ evidenceKind: 'actual_compiled_operator_page_production_refusal',
    buildId: readFileSync(resolve(root, '.next/BUILD_ID'), 'utf8').trim(), rows,
    serverStarted: false, browserVerified: false, httpVerified: false, liveProviderConnected: false }));
} finally {
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
}
