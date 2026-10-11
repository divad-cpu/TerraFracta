import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import test from 'node:test';
import ts from 'typescript';

const commands = [
  ['fictional-update-operation', 'runFictionalWorker', 'scripts.update_rehearsal', 65536, 15000],
  ['private-custodian-operation', 'runFixedInventedCustodian', 'scripts.persistent_journaled_custodian_display', 16384, 60000],
  ['private-custodian-operation', 'inspectFixedInventedCustodian', 'scripts.inspect_persistent_journaled_custodian_display', 16384, 5000],
  ['correction-review-operation', 'inspectFixedCorrectionReview', 'scripts.inspect_persistent_correction_review_display', 16384, 5000],
  ['supervised-correction-review-operation', 'inspectFixedSupervisedCorrectionReview', 'scripts.inspect_current_supervised_correction_review', 16384, 5000],
  ['current-copy-scope', 'inspectCurrentCopyScope', 'scripts.inspect_current_copy_scope', 16384, 5000],
  ['current-parent-source', 'inspectCurrentParentSource', 'scripts.inspect_current_parent_source', 16384, 5000],
  ['current-private-preparation', 'inspectCurrentPrivatePreparation', 'scripts.inspect_current_private_preparation', 16384, 10000],
  ['weekly-rehearsal-status', 'inspectWeeklyRehearsal', 'scripts.weekly_rehearsal_status', 16384, 5000],
];

function transport(spec, bytes) {
  const [name, exported, command, cap, timeout] = spec;
  const file = new URL('../src/server/' + name + '.ts', import.meta.url);
  const native = createRequire(file), module = { exports: {} }, calls = [], inputs = [];
  const execFile = () => assert.fail('only the existing promisified command port is permitted');
  execFile[promisify.custom] = (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.stdin = { writableFinished: false, on() { return this; },
      end(input) { inputs.push(input); this.writableFinished = true; } };
    // Match the actual Node decoding option, rather than choosing a parser for
    // the candidate. The corrupt byte passes through the same native contract.
    const stdout = options.encoding === null || options.encoding === 'buffer'
      ? Buffer.from(bytes) : bytes.toString(options.encoding ?? 'utf8');
    const pending = Promise.resolve({ stdout, stderr: Buffer.from('INVENTED_PRIVATE_STDERR') });
    pending.child = child;
    void pending.then(() => child.emit('close', 0, null));
    return pending;
  };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  new Function('require', 'module', 'exports', code)(value => {
    if (value === 'node:child_process') return { execFile };
    if (name === 'weekly-rehearsal-status' && value === './fictional-receipt-store.ts') return {
      readAllFictionalReceipts: async () => ({ stableSnapshot: true, totalReceipts: 0,
        unreadableReceipts: 0, pendingReceipts: 0, entries: [] }),
    };
    return native(value);
  }, module, module.exports);
  return { calls, inputs, command, cap, timeout, name,
    run: () => name === 'fictional-update-operation'
      ? module.exports[exported]('manual', new AbortController().signal, 'standard')
      : module.exports[exported]() };
}

for (const spec of commands) {
  test(`fixed raw worker preserves Unicode and original command bounds: ${spec[1]}`, async () => {
    const payload = { text: 'ø汉😀\uFFFD' };
    const port = transport(spec, Buffer.from(JSON.stringify(payload)));
    const value = await port.run();
    assert.deepEqual(port.name === 'weekly-rehearsal-status' ? value.observation : value, payload);
    assert.equal(port.calls.length, 1);
    const call = port.calls[0];
    assert.equal(call.executable, 'uv');
    assert.deepEqual(call.args, port.name === 'fictional-update-operation'
      ? ['run', '--locked', '--offline', '--no-sync', '--no-python-downloads', '--no-env-file',
        'python', '-B', '-m', port.command, '--trigger', 'manual', '--scenario', 'standard']
      : ['run', '--locked', '--offline', '--no-sync', '--no-env-file', 'python', '-B', '-m', port.command]);
    assert.equal(call.options.cwd, process.cwd());
    assert.equal(call.options.timeout, port.timeout);
    assert.equal(call.options.maxBuffer, port.cap);
    if (port.name !== 'fictional-update-operation') {
      assert.deepEqual(Object.keys(call.options.env).sort(),
        ['HOME', 'NODE_ENV', 'PATH', 'PYTHONDONTWRITEBYTECODE', 'UV_CACHE_DIR', 'UV_NO_ENV_FILE']);
      assert.equal(call.options.env.NODE_ENV, 'development');
      assert.equal(call.options.env.UV_NO_ENV_FILE, '1');
    }
    if (port.name === 'weekly-rehearsal-status') {
      assert.equal(port.inputs.length, 1);
      assert.deepEqual(JSON.parse(port.inputs[0]), { schemaVersion: 1, readComplete: true,
        totalReceipts: 0, unreadableReceipts: 0, pendingReceipts: 0, receipts: [] });
    }
  });
  test(`fixed raw worker refuses invalid UTF-8 without a second dispatch: ${spec[1]}`, async () => {
    const port = transport(spec, Buffer.concat([Buffer.from('{"text":"'), Buffer.from([255]), Buffer.from('"}') ]));
    await assert.rejects(port.run());
    assert.equal(port.calls.length, 1);
  });
}

const fixture = JSON.parse(readFileSync(new URL('../fixtures/fictional_update_report.json', import.meta.url), 'utf8'));
for (const mode of ['invalid-byte', 'valid-replacement-character']) {
  test(`actual native child output is checked before report archival: ${mode}`, async () => {
    const report = structuredClone(fixture);
    report.trigger = 'manual'; report.scheduledDueAt = null; report.requestKey = 'fictional:manual:2026w40';
    report.items[1].itemKey = mode === 'invalid-byte' ? 'INVENTED_UTF8_BYTE' : 'INVENTED_\uFFFD_LABEL';
    const bytes = Buffer.from(JSON.stringify(report));
    if (mode === 'invalid-byte') {
      const at = bytes.indexOf('INVENTED_UTF8_BYTE'); assert.ok(at >= 0); bytes[at] = 255;
    }
    const native = childProcess.execFile, execute = promisify(native), children = [];
    const wrapper = (...args) => native(...args);
    Object.defineProperty(wrapper, promisify.custom, { value: (file, args, options) => {
      assert.equal(file, 'uv'); assert.equal(args[9], 'scripts.update_rehearsal');
      const program = `process.stdout.write(Buffer.from(${JSON.stringify(bytes.toString('base64'))},'base64'));`;
      const pending = execute(process.execPath, ['-e', program], { ...options, cwd: '/tmp' });
      children.push(pending.child); return pending;
    }});
    childProcess.execFile = wrapper; syncBuiltinESMExports();
    try {
      const { handleFictionalUpdateRequest: handle } = await import('../src/server/fictional-update-operation.ts?strict-stdout=' + mode);
      const request = new Request('http://127.0.0.1:3000/api/dev/update-rehearsal', { method: 'POST',
        body: '{"trigger":"manual"}', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' } });
      const archived = [], diagnostics = [];
      const response = await handle(request, 'development', undefined,
        async value => archived.push(value), async code => { diagnostics.push(code); return 'unavailable'; });
      assert.equal(children.length, 1);
      if (mode === 'invalid-byte') {
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'rehearsal_unavailable' });
        assert.equal(archived.length, 0);
        assert.deepEqual(diagnostics, ['update_operation']);
      } else {
        assert.equal(response.status, 200);
        assert.equal(archived.length, 1);
        assert.equal(archived[0].report.items[1].itemKey, report.items[1].itemKey);
        assert.deepEqual(diagnostics, []);
      }
    } finally {
      childProcess.execFile = native; syncBuiltinESMExports();
    }
  });
}
