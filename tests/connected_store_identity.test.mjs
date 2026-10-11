import assert from "node:assert/strict";
import test from "node:test";
import { constants } from "node:fs";
import { readFileSync } from "node:fs";
import * as files from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";
import { ConnectedFictionalStore } from "../src/server/connected-fictional-store.ts";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";

const scratch = async () => {
  const parent = await files.mkdtemp('/tmp/terrafracta-connected-identity-');
  const directory = join(parent, "archive"), store = new ConnectedFictionalStore(directory);
  const snapshot = await store.append(connectedInput(), null); return { parent, directory, store, snapshot };
};
function faultStore(collaborators) {
  const file = new URL("../src/server/connected-fictional-store.ts", import.meta.url), native = createRequire(file), exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", code)(name => name === "node:fs/promises" ? { ...files, ...collaborators } : native(name), exports);
  return exports.ConnectedFictionalStore;
}
test("a hard-linked latest invented edition is withheld and both original names remain intact", async () => {
  const { parent, directory, store } = await scratch(), path = join(directory, 'edition-001.json'), before = await files.readFile(path);
  await files.link(path, join(parent, 'preserved-alias.json'));
  assert.deepEqual(await store.current(), { kind: "unavailable" });
  assert.deepEqual(await files.readFile(path), before); assert.deepEqual(await files.readFile(join(parent, 'preserved-alias.json')), before);
});
test("a newest head arriving during a read withholds the earlier snapshot without falling back", async () => {
  const { directory, snapshot } = await scratch(); let changed = false;
  const FaultStore = faultStore({ async open(path, ...args) {
    const handle = await files.open(path, ...args);
    if (path !== join(directory, 'edition-001.json')) return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === 'read') return async (...options) => { const value = await target.read(...options);
        if (!changed) { changed = true; await files.writeFile(join(directory, 'edition-002.json'), JSON.stringify({ ...connectedInput('28.1'), generation: 2 }) + '\n', { mode: 0o600 }); }
        return value;
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } });
  assert.deepEqual(await new FaultStore(directory).current(), { kind: "unavailable" }); assert.equal(changed, true);
  assert.equal(JSON.parse(await files.readFile(join(directory, 'edition-001.json'), 'utf8')).executionId, snapshot.executionId);
  assert.equal((await new ConnectedFictionalStore(directory).current()).snapshot.generation, 2);
});
test("a record changed after its bytes were read cannot remain a confirmed edition", async () => {
  const { directory, snapshot } = await scratch(); let changed = false;
  const FaultStore = faultStore({ async open(path, ...args) {
    const handle = await files.open(path, ...args);
    if (path !== join(directory, 'edition-001.json')) return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === 'read') return async (...options) => { const value = await target.read(...options);
        if (!changed) { changed = true; await files.writeFile(path, JSON.stringify({ ...snapshot, observedAt: '2026-10-01T12:01:00Z' }) + '\n'); }
        return value;
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } });
  assert.deepEqual(await new FaultStore(directory).current(), { kind: "unavailable" }); assert.equal(changed, true);
  assert.equal(JSON.parse(await files.readFile(join(directory, 'edition-001.json'), 'utf8')).observedAt, '2026-10-01T12:01:00Z');
});
test("a named record replaced after reading is withheld and its original bytes remain preserved", async () => {
  const { parent, directory, snapshot } = await scratch(); let changed = false;
  const preserved = join(parent, 'preserved-original.json');
  const FaultStore = faultStore({ async open(path, ...args) {
    const handle = await files.open(path, ...args);
    if (path !== join(directory, 'edition-001.json')) return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === 'read') return async (...options) => { const value = await target.read(...options);
        if (!changed) { changed = true; await files.rename(path, preserved); await files.writeFile(path, JSON.stringify(snapshot) + '\n', { mode: 0o600 }); }
        return value;
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } });
  assert.deepEqual(await new FaultStore(directory).current(), { kind: "unavailable" });
  assert.equal(JSON.parse(await files.readFile(preserved, 'utf8')).executionId, snapshot.executionId);
});
test("a substituted archive directory is withheld even when the same named file bytes are valid", async () => {
  const { parent, directory, snapshot } = await scratch(); let changed = false;
  const preserved = join(parent, 'preserved-archive');
  const FaultStore = faultStore({ async open(path, ...args) {
    const handle = await files.open(path, ...args);
    if (path !== join(directory, 'edition-001.json')) return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === 'read') return async (...options) => { const value = await target.read(...options);
        if (!changed) { changed = true; await files.rename(directory, preserved); await files.mkdir(directory, { mode: 0o700 }); await files.writeFile(path, JSON.stringify(snapshot) + '\n', { mode: 0o600 }); }
        return value;
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } });
  assert.deepEqual(await new FaultStore(directory).current(), { kind: "unavailable" });
  assert.equal(JSON.parse(await files.readFile(join(preserved, 'edition-001.json'), 'utf8')).executionId, snapshot.executionId);
});
test("an actual owned FIFO latest entry refuses promptly without waiting for a writer", async () => {
  const { directory } = await scratch();
  await promisify(execFile)('/usr/bin/mkfifo', ['-m', '600', join(directory, 'edition-002.json')]);
  // Only this test's own child, directory and pipe. A bounded child timeout
  // contains a future blocking-open regression; no server or transport starts.
  const module = new URL('../src/server/connected-fictional-store.ts', import.meta.url).href;
  const program = `import { ConnectedFictionalStore } from ${JSON.stringify(module)}; process.stdout.write(JSON.stringify(await new ConnectedFictionalStore(process.argv[1]).current()));`;
  const result = await promisify(execFile)(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program, directory], { timeout: 1500 });
  assert.deepEqual(JSON.parse(result.stdout), { kind: 'unavailable' });
  assert.equal((await files.lstat(join(directory, 'edition-002.json'))).isFIFO(), true);
});
test("a record changed while closing its read handle is withheld at the final archive fence", async () => {
  const { directory, snapshot } = await scratch(); let changed = false;
  const path = join(directory, 'edition-001.json');
  const FaultStore = faultStore({ async open(candidate, ...args) {
    const handle = await files.open(candidate, ...args);
    if (candidate !== path) return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === 'close') return async () => {
        await target.close();
        if (!changed) { changed = true; await files.writeFile(path, JSON.stringify({ ...snapshot, observedAt: '2026-10-01T12:02:00Z' }) + '\n'); }
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } });
  assert.deepEqual(await new FaultStore(directory).current(), { kind: 'unavailable' });
  assert.equal(changed, true);
  assert.equal(JSON.parse(await files.readFile(path, 'utf8')).observedAt, '2026-10-01T12:02:00Z');
});
