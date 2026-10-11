import { canonicalHeldDecisionScope,type HeldDecisionsProvider } from "./operator-held-decisions-reader.ts";
import { canonicalProposalScope, type ProposalProvider } from "./operator-proposal-reader.ts";
import { Buffer } from "node:buffer";
import { canonicalOperatorAuditScope, OPERATOR_AUDIT_BYTES, type OperatorAuditProvider } from "./operator-audit-reader.ts";
import { canonicalOperatorAuditChoice, canonicalOperatorAuditRunCursor, type OperatorAuditChoicesProvider } from "./operator-audit-choices-reader.ts";
import { createPostgresReadOwner, type PostgresReadClientFactory } from "./postgres-read-owner.ts";

const unavailable = () => new Error("read_unavailable");
// This LOGIN can SET the broad trusted reviewer role. It is not a confined
// public credential or user authorization. Installation and wiring are separate.
export const POSTGRES_OPERATOR_AUDIT_SQL = `WITH principal AS MATERIALIZED (
  SELECT session_user = $6::text
    AND current_user = 'terra_reviewer'
    AND system_user = 'scram-sha-256:' || session_user
    AND r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreatedb
    AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
    AND pg_has_role(session_user, 'terra_reviewer', 'SET')
    AND NOT pg_has_role(session_user, 'terra_reviewer', 'USAGE')
    AND NOT pg_has_role(session_user, 'terra_reviewer', 'SET WITH ADMIN OPTION')
    AND current_setting('transaction_read_only') = 'on' AS admitted
  FROM pg_roles r WHERE r.rolname = session_user
)
SELECT admitted, CASE WHEN admitted
  THEN terra_private.read_operator_audit($1::uuid, $2::uuid, $3::integer, $4::uuid, $5::integer)::text
  ELSE NULL END AS audit FROM principal`;

export const POSTGRES_OPERATOR_AUDIT_CHOICES_SQL = `WITH principal AS MATERIALIZED (
  SELECT session_user = $1::text
    AND current_user = 'terra_reviewer'
    AND system_user = 'scram-sha-256:' || session_user
    AND r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreatedb
    AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
    AND pg_has_role(session_user, 'terra_reviewer', 'SET')
    AND NOT pg_has_role(session_user, 'terra_reviewer', 'USAGE')
    AND NOT pg_has_role(session_user, 'terra_reviewer', 'SET WITH ADMIN OPTION')
    AND current_setting('transaction_read_only') = 'on' AS admitted
  FROM pg_roles r WHERE r.rolname = session_user
)
SELECT admitted, CASE WHEN admitted
  THEN terra_private.read_operator_audit_choices($2::uuid, $3::timestamptz, $4::uuid)::text
  ELSE NULL END AS choices FROM principal`;

export const POSTGRES_OPERATOR_HELD_DECISIONS_SQL = `WITH principal AS MATERIALIZED (
  SELECT session_user = $1::text
    AND current_user = 'terra_reviewer'
    AND system_user = 'scram-sha-256:' || session_user
    AND r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreatedb
    AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
    AND pg_has_role(session_user, 'terra_reviewer', 'SET')
    AND NOT pg_has_role(session_user, 'terra_reviewer', 'USAGE')
    AND NOT pg_has_role(session_user, 'terra_reviewer', 'SET WITH ADMIN OPTION')
    AND current_setting('transaction_read_only') = 'on' AS admitted
  FROM pg_roles r WHERE r.rolname = session_user
)
SELECT admitted, CASE WHEN admitted
  THEN terra_private.read_operator_held_decisions($2::uuid, $3::timestamptz, $4::uuid)::text
  ELSE NULL END AS held FROM principal`;

export const POSTGRES_OPERATOR_PROPOSAL_SQL = `WITH principal AS MATERIALIZED (
  SELECT session_user = $1::text
    AND current_user = 'terra_reviewer'
    AND system_user = 'scram-sha-256:' || session_user
    AND r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreatedb
    AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
    AND pg_has_role(session_user, 'terra_reviewer', 'SET')
    AND NOT pg_has_role(session_user, 'terra_reviewer', 'USAGE')
    AND NOT pg_has_role(session_user, 'terra_reviewer', 'SET WITH ADMIN OPTION')
    AND current_setting('transaction_read_only') = 'on' AS admitted
  FROM pg_roles r WHERE r.rolname = session_user
)
SELECT admitted, CASE WHEN admitted
  THEN terra_private.read_operator_proposal($2::uuid, $3::uuid)::text
  ELSE NULL END AS proposal FROM principal`;

function acknowledge(input: unknown, command: "BEGIN" | "SET" | "ROLLBACK"): void {
  if (input === null || typeof input !== "object") throw unavailable();
  const result = input as { command?: unknown; rowCount?: unknown; fields?: unknown; rows?: unknown };
  if (result.command !== command || result.rowCount !== null || !Array.isArray(result.fields) || result.fields.length !== 0 ||
    !Array.isArray(result.rows) || result.rows.length !== 0) throw unavailable();
}

function auditBytes(input: unknown, column: "audit" | "choices" | "held" | "proposal"): Uint8Array {
  if (input === null || typeof input !== "object") throw unavailable();
  const result = input as { command?: unknown; rowCount?: unknown; fields?: unknown; rows?: unknown };
  if (result.command !== "SELECT" || result.rowCount !== 1 || !Array.isArray(result.fields) || result.fields.length !== 2 ||
    result.fields[0]?.name !== "admitted" || result.fields[0]?.dataTypeID !== 16 ||
    result.fields[1]?.name !== column || result.fields[1]?.dataTypeID !== 25 ||
    !Array.isArray(result.rows) || result.rows.length !== 1 || !Array.isArray(result.rows[0]) ||
    result.rows[0].length !== 2 || result.rows[0][0] !== true || typeof result.rows[0][1] !== "string") throw unavailable();
  const value = result.rows[0][1] as string;
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 2 || bytes > OPERATOR_AUDIT_BYTES) throw unavailable();
  return new TextEncoder().encode(value);
}

export type PostgresOperatorAuditTransport = Readonly<{
  readAudit: OperatorAuditProvider;
  readChoices: OperatorAuditChoicesProvider;
  readHeld: HeldDecisionsProvider;
  readProposal: ProposalProvider;
  shutdown: () => Promise<boolean>;
}>;

export function createPostgresOperatorAuditTransport(input: unknown, factory?: PostgresReadClientFactory,
  now = () => performance.now()): PostgresOperatorAuditTransport {
  const owner = createPostgresReadOwner(input, "terrafracta.operator-audit", true, factory, now);
  // Only these fixed server-authored call sites select the literal SQL/column.
  // A request never supplies a statement or opens another connection budget.
  const transaction = (signal: AbortSignal, text: string, values: (string | number | null)[], column: "audit" | "choices" | "held" | "proposal") => {
    return owner.run(signal, async (client, assertActive) => {
      const command = async (text: string, expected: "BEGIN" | "SET" | "ROLLBACK") => {
        const result = await client.query({ text, values: [], rowMode: "array" });
        assertActive();
        acknowledge(result, expected);
      };
      await command("BEGIN READ ONLY", "BEGIN");
      await command("SET LOCAL ROLE terra_reviewer", "SET");
      const result = await client.query({ text, rowMode: "array", values });
      assertActive();
      const bytes = auditBytes(result, column);
      await command("ROLLBACK", "ROLLBACK");
      return bytes;
    });
  };
  const readAudit: OperatorAuditProvider = async (inputScope, signal) => {
    const scope = canonicalOperatorAuditScope(inputScope);
    if (scope === null) throw unavailable();
    const cursor = scope.cursor;
    return transaction(signal, POSTGRES_OPERATOR_AUDIT_SQL,
      [scope.runId, scope.issueId, cursor?.latestRevision ?? null, cursor?.headPublicationId ?? null,
        cursor?.beforeRevision ?? null, owner.user], "audit");
  };
  const readChoices: OperatorAuditChoicesProvider = async (inputRunId, signal, inputCursor = null) => {
    const runId = canonicalOperatorAuditChoice(inputRunId);
    const cursor = canonicalOperatorAuditRunCursor(inputCursor);
    if (runId === undefined || cursor === undefined) throw unavailable();
    return transaction(signal, POSTGRES_OPERATOR_AUDIT_CHOICES_SQL,
      [owner.user, runId, cursor?.createdAt ?? null, cursor?.runId ?? null], "choices");
  };
  const readHeld: HeldDecisionsProvider = async (inputScope,signal) => {
    const scope=canonicalHeldDecisionScope(inputScope);
    if(scope===null)throw unavailable();
    return transaction(signal,POSTGRES_OPERATOR_HELD_DECISIONS_SQL,
      [owner.user,scope.runId,scope.cursor?.decidedAt??null,scope.cursor?.decisionId??null],"held");
  };
  const readProposal: ProposalProvider = async (inputScope, signal) => {
    const scope = canonicalProposalScope(inputScope);
    if (scope === null) throw unavailable();
    return transaction(signal, POSTGRES_OPERATOR_PROPOSAL_SQL,
      [owner.user, scope.runId, scope.decisionId], "proposal");
  };
  return Object.freeze({ readAudit, readChoices, readHeld, readProposal, shutdown: owner.shutdown });
}
