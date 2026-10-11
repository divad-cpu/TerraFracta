import { Buffer } from "node:buffer";
import { createPostgresReadOwner, type PostgresReadClient, type PostgresReadClientFactory } from "./postgres-read-owner.ts";
import { prepareWorkProposalCapture, recoverWorkProposalCapture, verifyWorkProposalCaptureReceipt,
  type PreparedWorkProposalCapture } from "./proposal-work-command.ts";
import type { ProposalCaptureReceipt } from "./proposal-capture-command.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// Fixed trusted invoker, not a function-confined database account. Accepted
// privileges/RLS/runtime and source-specific inputs remain installation gates.
export const POSTGRES_WORK_PROPOSAL_SQL = `WITH principal AS MATERIALIZED (
 SELECT session_user = $9::text AND current_user = session_user
 AND system_user = 'scram-sha-256:' || session_user
 AND r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreatedb
 AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
 AND current_setting('transaction_read_only') = 'off'
 AND current_setting('transaction_isolation') = 'read committed'
 AND NOT has_schema_privilege(session_user,'terra_private','CREATE')
 AND has_function_privilege(session_user,'terra_private.capture_held_proposal_for_work(uuid,text,uuid,uuid,uuid,uuid,uuid,text)','EXECUTE')
 AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='terra_private' AND nspowner=r.oid)
 AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='terra_private' AND c.relowner=r.oid)
 AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='terra_private' AND p.proowner=r.oid) AS admitted
 FROM pg_roles r WHERE r.rolname=session_user
)
SELECT admitted, CASE WHEN admitted THEN terra_private.capture_held_proposal_for_work(
 $1::uuid,$2::text,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::text)::text
 ELSE NULL END AS capture FROM principal`;

export type WorkProposalCaptureOutcome = Readonly<
  { kind: "confirmed"; receipt: Readonly<ProposalCaptureReceipt> } |
  { kind: "not_dispatched" } | { kind: "outcome_unknown" }
>;
const notDispatched = Object.freeze({ kind: "not_dispatched" as const });
const unknown = Object.freeze({ kind: "outcome_unknown" as const });
const unavailable = () => Error("proposal_capture_unavailable");
function idle(client: PostgresReadClient): void {
  const current = client as PostgresReadClient & { getTransactionStatus?: () => unknown };
  if (typeof current.getTransactionStatus !== "function" || current.getTransactionStatus() !== "I") throw unavailable();
}
function settingAck(input: unknown): void {
  if (input === null || typeof input !== "object") throw unavailable();
  const r = input as { command?: unknown; rowCount?: unknown; fields?: unknown; rows?: unknown };
  if (r.command !== "SET" || r.rowCount !== null || !Array.isArray(r.fields) || r.fields.length ||
      !Array.isArray(r.rows) || r.rows.length) throw unavailable();
}
function captureBytes(input: unknown): Uint8Array | null {
  if (input === null || typeof input !== "object") throw unavailable();
  const r = input as { command?: unknown; rowCount?: unknown; fields?: unknown; rows?: unknown };
  if (r.command !== "SELECT" || r.rowCount !== 1 || !Array.isArray(r.fields) || r.fields.length !== 2 ||
      r.fields[0]?.name !== "admitted" || r.fields[0]?.dataTypeID !== 16 ||
      r.fields[1]?.name !== "capture" || r.fields[1]?.dataTypeID !== 25 ||
      !Array.isArray(r.rows) || r.rows.length !== 1 || !Array.isArray(r.rows[0]) || r.rows[0].length !== 2) throw unavailable();
  if (r.rows[0][0] === false && r.rows[0][1] === null) return null;
  if (r.rows[0][0] !== true || typeof r.rows[0][1] !== "string" ||
      Buffer.byteLength(r.rows[0][1],"utf8") < 2 || Buffer.byteLength(r.rows[0][1],"utf8") > 2048) throw unavailable();
  return new TextEncoder().encode(r.rows[0][1]);
}
// Caller supplies trusted server configuration only. No ambient default,
// browser endpoint, accepted account, automatic retry or source fetch is added.
export function createPostgresWorkProposalTransport(input: unknown, factory?: PostgresReadClientFactory,
  now = () => performance.now(), record: DevelopmentErrorRecorder = recordDevelopmentError) {
  const owner = createPostgresReadOwner(input,"terrafracta.proposal-worker",true,factory,now);
  let stopped = false;
  async function execute(prepare: () => PreparedWorkProposalCapture, signal: AbortSignal): Promise<WorkProposalCaptureOutcome> {
    if (signal.aborted || stopped) return notDispatched;
    let command: PreparedWorkProposalCapture;
    try { command = prepare(); } catch { return notDispatched; }
    let dispatched = false, expectedRefusal = false;
    try {
      const receipt = await owner.run(signal,async (client,assertActive) => {
        idle(client);
        // Fresh owned session only, no BEGIN or delayed external COMMIT. The
        // shared owner's readonly startup and every reader stay unchanged.
        for (const text of ["SET default_transaction_read_only = off", "SET default_transaction_isolation = 'read committed'"]) {
          assertActive(); settingAck(await client.query({text,values:[],rowMode:"array"}));
          assertActive(); idle(client);
        }
        assertActive(); dispatched = true;
        let result;
        try { result = await client.query({text:POSTGRES_WORK_PROPOSAL_SQL,values:[...command.values,owner.user],rowMode:"array"}); }
        catch (error) {
          // Ordinary dependency/fence/conflict/clock refusals stay silent. Even
          // these errors are not a promise about earlier durable captures.
          const code = error !== null && typeof error === "object" ? (error as {code?:unknown}).code : null;
          expectedRefusal = code === "23514" || code === "23505" || code === "40001";
          throw error;
        }
        assertActive(); idle(client);
        const raw = captureBytes(result);
        if (raw === null) { dispatched = false; throw unavailable(); }
        return Object.freeze(verifyWorkProposalCaptureReceipt(raw,command));
      });
      return Object.freeze({kind:"confirmed",receipt});
    } catch {
      if (!signal.aborted && !stopped && !expectedRefusal) observeDevelopmentError("proposal_capture_write",record);
      return dispatched ? unknown : notDispatched;
    }
  }
  return Object.freeze({
    capture: (work: unknown,selection: unknown,payload: unknown,signal: AbortSignal) =>
      execute(() => prepareWorkProposalCapture(work,selection,payload),signal),
    recover: (work: unknown,selection: unknown,report: unknown,signal: AbortSignal) =>
      execute(() => recoverWorkProposalCapture(work,selection,report),signal),
    shutdown: async () => { stopped = true; return owner.shutdown(); },
  });
}
