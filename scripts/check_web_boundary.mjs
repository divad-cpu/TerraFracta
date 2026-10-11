import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const bindHost = "127.0.0.1";
const probe = createServer();
probe.listen(0, bindHost);
await once(probe, "listening");
const address = probe.address();
if (!address || typeof address === "string") throw new Error("Unable to choose local test port");
const port = address.port;
await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", bindHost, "--port", String(port)], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => { serverOutput = (serverOutput + chunk.toString()).slice(-4000); });
}

const base = `http://${bindHost}:${port}`;
const deadline = Date.now() + 15_000;

async function request(path, options) {
  return fetch(`${base}${path}`, { ...options, redirect: "manual", signal: AbortSignal.timeout(3_000) });
}

try {
  while (true) {
    if (server.exitCode !== null) throw new Error(`Local server exited early: ${serverOutput}`);
    try {
      const response = await request("/");
      if (response.ok) break;
    } catch {
      // The loopback listener may not be ready yet.
    }
    if (Date.now() >= deadline) throw new Error(`Local server did not start: ${serverOutput}`);
    await delay(150);
  }

  const home = await request("/");
  const homeHtml = await home.text();
  assert.equal(home.status, 200);
  assert.match(homeHtml, /Local demonstration\./);
  assert.match(homeHtml, /<title>TerraFracta — Local prototype<\/title>/);
  assert.match(homeHtml, /name="robots"[^>]*noindex/i);
  assert.doesNotMatch(homeHtml, /href="\/editorial-preview"/);

  for (const [path, expectedTitle] of [
    ["/countries", "Sample country directory"],
    ["/countries/norway", "Norway sample overview"],
    ["/methodology", "Methodology and limits"],
    ["/sources", "Source standards"],
  ]) {
    const page = await request(path);
    assert.equal(page.status, 200, path);
    assert.ok((await page.text()).includes(`<title>${expectedTitle} | TerraFracta</title>`), path);
  }

  const issue = await request("/countries/norway/issues/housing-costs");
  const issueHtml = await issue.text();
  assert.equal(issue.status, 200);
  assert.match(issueHtml, /Entire dossier is illustrative/);
  assert.match(issueHtml, /No public conclusion is available/);
  assert.match(issueHtml, /<title>Illustrative housing costs dossier \| TerraFracta<\/title>/);

  const correction = await request("/corrections");
  const correctionHtml = await correction.text();
  assert.equal(correction.status, 200);
  assert.match(correctionHtml, /Nothing is sent or saved/);
  assert.match(correctionHtml, /<title>Correction draft preview \| TerraFracta<\/title>/);

  assert.equal((await request("/editorial-preview")).status, 404);
  assert.equal((await request("/editorial-preview/audit")).status, 404);
  assert.equal((await request("/evidence-preview")).status, 404);
  assert.equal((await request("/update-preview")).status, 404);
  const updateAttempt = await request("/api/dev/update-rehearsal", {
    method: "POST", headers: { "content-type": "application/json", origin: base },
    body: '{"trigger":"manual"}',
  });
  assert.equal(updateAttempt.status, 404);
  assert.equal(updateAttempt.headers.get("cache-control"), "no-store");
  assert.deepEqual(await updateAttempt.json(), { error: "not_found" });
  const historyAttempt = await request("/api/dev/update-rehearsal/history");
  assert.equal(historyAttempt.status, 404);
  assert.equal(historyAttempt.headers.get("cache-control"), "no-store");
  assert.deepEqual(await historyAttempt.json(), { error: "not_found" });
  assert.equal((await request("/api/corrections")).status, 404);
  const attemptedSubmit = await request("/corrections", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "Synthetic test only",
  });
  assert.ok(attemptedSubmit.status >= 400, `Unexpected correction POST response ${attemptedSubmit.status}`);

  process.stdout.write("Production-mode local web boundary checks passed (page titles, preview refusal and correction POST refusal).\n");
} finally {
  server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), delay(3000)]);
  if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
}
