import { isIP } from "node:net";
import type { ClientConfig } from "pg";
import { z } from "zod";

// Explicit server configuration, never a URL/query/env-selected connection.
// A caller still needs an independently accepted account/runtime before wiring
// this transport into the existing unconfigured reader.
const name = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const host = z.string().min(1).max(253).refine(value => isIP(value) !== 0 ||
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value));
const configuration = z.strictObject({
  host, port: z.number().int().min(1).max(65535), database: name, user: name,
  password: z.string().min(1).max(1024),
  transport: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("verified-tls"), ca: z.string().min(1).max(524288).optional() }),
    z.strictObject({ kind: z.literal("loopback-development") }),
  ]),
});
export type PostgresReadConfiguration = z.infer<typeof configuration>;

export interface PostgresReadClient {
  connect(): Promise<unknown>;
  query(input: { text: string; values: (string | number | null)[]; rowMode: "array" }): Promise<unknown>;
  end(): Promise<void>;
  on(event: "error", listener: () => void): unknown;
}
// Test/deployment seam only. No request can choose a factory, SQL or identity.
export type PostgresReadClientFactory = (config: Readonly<ClientConfig>) => Promise<PostgresReadClient>;
const unavailable = () => new Error("read_unavailable");
const MAX_CONNECTIONS = 2;
const TOTAL_READ_MS = 2500;
const CLOSE_ACK_MS = 250;

async function defaultClient(config: Readonly<ClientConfig>): Promise<PostgresReadClient> {
  // pg otherwise permits an environment-selected native implementation.
  if (process.env.NODE_PG_FORCE_NATIVE || process.env.PGREPLICATION || process.env.PGBINARY) throw unavailable();
  const { Client } = await import("pg");
  if (process.env.NODE_PG_FORCE_NATIVE || process.env.PGREPLICATION || process.env.PGBINARY) throw unavailable();
  const client = new Client(config);
  const flags = client as unknown as { binary: unknown; replication: unknown };
  if (flags.binary !== false || (flags.replication !== undefined && flags.replication !== false)) throw unavailable();
  return client;
}

type Flight = { abort: () => void };
export type PostgresReadOwner = Readonly<{
  // Only trusted, fixed server callbacks use this seam; requests never supply SQL.
  run: <T>(signal: AbortSignal, execute: (client: PostgresReadClient, assertActive: () => void) => Promise<T>) => Promise<T>;
  user: string;
  shutdown: () => Promise<boolean>;
}>;

export function createPostgresReadOwner(input: unknown, applicationName: "terrafracta.current-reader" | "terrafracta.operator-audit" | "terrafracta.proposal-worker",
  requireTls: boolean, factory: PostgresReadClientFactory = defaultClient, now = () => performance.now()): PostgresReadOwner {
  const parsed = configuration.safeParse(input);
  if (!parsed.success || typeof window !== "undefined") throw unavailable();
  const config = parsed.data;
  const loopback = config.transport.kind === "loopback-development";
  if (loopback && (requireTls || process.env.NODE_ENV !== "development" || !["127.0.0.1", "::1"].includes(config.host))) throw unavailable();
  const usable = () => !loopback || process.env.NODE_ENV === "development";
  const flights = new Set<Flight>();
  const drained = new Set<() => void>();
  let shuttingDown = false;

  const run: PostgresReadOwner["run"] = async (parentSignal, execute) => {
    if (parentSignal.aborted || shuttingDown || !usable() || flights.size >= MAX_CONNECTIONS) throw unavailable();
    let began: number;
    try { began = now(); } catch { throw unavailable(); }
    if (!Number.isFinite(began)) throw unavailable();
    let previousTick = began;
    const controller = new AbortController();
    const flight: Flight = { abort: () => controller.abort() };
    flights.add(flight);
    let client: PostgresReadClient | undefined;
    let closing: Promise<void> | undefined;
    let ended = false, workSettled = false;
    const release = () => {
      if (!ended || !workSettled) return;
      flights.delete(flight);
      if (flights.size === 0) for (const resolve of drained) resolve();
    };
    const close = () => {
      if (client && closing === undefined) {
        closing = Promise.resolve().then(() => client!.end()).then(() => { ended = true; release(); });
        void closing.catch(() => { /* No acknowledgement: retain the owned slot. */ });
      }
      return closing;
    };
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(unavailable()); });
    // Setup can fail before the race exists. Cancellation still has an owner.
    void aborted.catch(() => {});
    const abort = () => { rejectAbort?.(); close(); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let workStarted = false;
    const assertActive = () => {
      const tick = now();
      const elapsed = tick - began;
      if (controller.signal.aborted || parentSignal.aborted || !usable() || shuttingDown ||
          !Number.isFinite(tick) || tick < previousTick ||
          !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TOTAL_READ_MS) throw unavailable();
      previousTick = tick;
    };
    try {
      controller.signal.addEventListener("abort", abort, { once: true });
      parentSignal.addEventListener("abort", flight.abort, { once: true });
      timer = setTimeout(flight.abort, TOTAL_READ_MS);
      workStarted = true;
      const work = (async () => {
        assertActive();
        // The pinned JS driver supports these flags; its public types omit them.
        const options: ClientConfig & { binary: false; replication: false } = {
          host: config.host, port: config.port, database: config.database, user: config.user, password: config.password,
          ssl: loopback ? false : { rejectUnauthorized: true, ...(config.transport.kind === "verified-tls" && config.transport.ca ? { ca: config.transport.ca } : {}) },
          sslnegotiation: "postgres", enableChannelBinding: true,
          connectionTimeoutMillis: 1000, statement_timeout: 2000, query_timeout: 2250, lock_timeout: 500,
          idle_in_transaction_session_timeout: 2000, application_name: applicationName,
          fallback_application_name: applicationName, client_encoding: "UTF8", binary: false,
          replication: false, pipeline: false,
          options: "-c default_transaction_read_only=on -c search_path=pg_catalog,pg_temp -c client_connection_check_interval=100",
        };
        client = await factory(Object.freeze(options));
        client.on("error", flight.abort);
        assertActive();
        await client.connect();
        assertActive();
        return execute(client, assertActive);
      })().then(value => { workSettled = true; release(); return value; }, error => {
        workSettled = true;
        if (!client) ended = true;
        else close();
        release();
        throw error;
      });
      const bytes = await Promise.race([work, aborted]);
      const acknowledgement = close();
      if (!acknowledgement) throw unavailable();
      const acknowledged = await Promise.race([acknowledgement.then(() => true),
        new Promise<false>(resolve => { closeTimer = setTimeout(() => resolve(false), CLOSE_ACK_MS); }), aborted]);
      if (!acknowledged) throw unavailable();
      assertActive();
      return bytes;
    } catch { throw unavailable(); }
    finally {
      // Only an unused slot can retire immediately. Started acquisition/work
      // still needs actual settlement and the same client's close acknowledgement.
      if (!workStarted) { ended = true; workSettled = true; release(); }
      try { if (timer !== undefined) clearTimeout(timer); } catch { /* Retire independently. */ }
      try { if (closeTimer !== undefined) clearTimeout(closeTimer); } catch { /* Retire independently. */ }
      try { parentSignal.removeEventListener("abort", flight.abort); } catch { /* Retire independently. */ }
      try { controller.abort(); } catch { /* Closure still has its own attempt. */ }
      try { controller.signal.removeEventListener("abort", abort); } catch { /* The controller is retired. */ }
      close();
    }
  };

  const shutdown = async () => {
    shuttingDown = true;
    for (const flight of flights) flight.abort();
    if (flights.size === 0) return true;
    let resolveDrained: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<boolean>(resolve => {
        resolveDrained = () => resolve(true);
        drained.add(resolveDrained);
        timer = setTimeout(() => resolve(false), CLOSE_ACK_MS);
      });
    } finally {
      drained.delete(resolveDrained);
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  return Object.freeze({ run, shutdown, user: config.user });
}
