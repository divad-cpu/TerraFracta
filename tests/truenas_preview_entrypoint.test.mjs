import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

// Generate the exact project entrypoint; virtual process/fs/server below avoid
// a real server, image, NAS, credentials or payload execution.
const generated = spawnSync('/usr/bin/python3.12', ['-B', '-E', '-s', '-c',
  "from scripts.prepare_truenas_web_draft import entrypoint; import sys; sys.stdout.buffer.write(entrypoint('invented-build'))"],
  { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
assert.equal(generated.status, 0, generated.stderr);

function exercise(overrides = {}) {
  const reads = [], changes = [], calls = [], errors = [];
  const processFacade = {argv:['node','entrypoint.cjs'], version:'v24.18.0', platform:'linux', arch:'x64',
    env:{NODE_OPTIONS:'invented-private', HOSTNAME:'untrusted', PORT:'9', PRIVATE_CANARY:'hidden'},
    chdir(value) { changes.push(value); }, ...overrides};
  const context = {__dirname:'/fixed-preview', process:processFacade,
    console:{error(value) { errors.push(value); }}, require(name) {
      if (name === 'node:path') return path;
      if (name === 'node:fs') return {readFileSync(file, encoding) {
        reads.push([file, encoding]);
        if (overrides.readError) throw new Error('invented-private-path-error');
        return overrides.buildId ?? 'invented-build\n';
      }};
      calls.push(name);
      if (overrides.serverError) throw new Error('invented-private-server-error');
      return {};
    }};
  vm.runInNewContext(generated.stdout, context, {timeout:1000});
  return {processFacade, reads, changes, calls, errors};
}

test('exact entrypoint clears selectors and selects only fixed production payload', () => {
  const seen = exercise();
  assert.deepEqual(seen.processFacade.env, {NODE_ENV:'production', HOSTNAME:'0.0.0.0', PORT:'3210', NEXT_TELEMETRY_DISABLED:'1'});
  assert.deepEqual(seen.reads, [['/fixed-preview/payload/.next/BUILD_ID','utf8']]);
  assert.deepEqual(seen.changes, ['/fixed-preview/payload']);
  assert.deepEqual(seen.calls, ['/fixed-preview/payload/server.js']);
  assert.deepEqual(seen.errors, []);
});

test('unsupported version OS architecture and extra arguments refuse before file/server access', () => {
  for (const changed of [{version:'v24.21.0'}, {platform:'freebsd'}, {arch:'arm64'}, {argv:['node','entrypoint.cjs','selector']}]) {
    const seen = exercise(changed);
    assert.equal(seen.processFacade.exitCode, 1);
    assert.deepEqual(seen.reads, []);
    assert.deepEqual(seen.changes, []);
    assert.deepEqual(seen.calls, []);
    assert.deepEqual(seen.errors, ['Private preview unavailable']);
  }
});

test('wrong or unavailable build never imports an earlier or alternative payload', () => {
  for (const changed of [{buildId:'different-build'}, {buildId:''}, {readError:true}]) {
    const seen = exercise(changed);
    assert.equal(seen.processFacade.exitCode, 1);
    assert.deepEqual(seen.changes, []);
    assert.deepEqual(seen.calls, []);
    assert.deepEqual(seen.errors, ['Private preview unavailable']);
    assert.ok(!JSON.stringify(seen.errors).includes('invented-private'));
  }
});

test('payload startup error yields one generic nonzero outcome with no diagnostic leak', () => {
  const seen = exercise({serverError:true});
  assert.equal(seen.processFacade.exitCode, 1);
  assert.equal(seen.calls.length, 1);
  assert.deepEqual(seen.errors, ['Private preview unavailable']);
});
