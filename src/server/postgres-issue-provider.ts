import { Buffer } from "node:buffer";
import { canonicalPublicIssueRoute, PUBLIC_CANDIDATE_BYTES, type CurrentIssueCandidateReader } from "./public-issue-reader.ts";
import { createPostgresReadOwner, type PostgresReadClientFactory } from "./postgres-read-owner.ts";

// Existing public names remain compatible. The public principal and SQL are
// unchanged; the audit transport has a separate, broad trusted reviewer role.
export type { PostgresReadConfiguration as PostgresIssueConfiguration, PostgresReadClient as IssueReadClient,
  PostgresReadClientFactory as IssueReadClientFactory } from "./postgres-read-owner.ts";
const unavailable = () => new Error("read_unavailable");

// One statement: authenticate the narrow principal, then read one consistent
// current JSONB candidate. Rejection is separate from an admitted SQL NULL.
export const POSTGRES_CURRENT_ISSUE_SQL = `WITH principal AS MATERIALIZED (
  SELECT session_user = current_user
    AND system_user = 'scram-sha-256:' || session_user
    AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb
    AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
    AND current_setting('transaction_read_only') = 'on'
    AND NOT has_schema_privilege(current_user, 'terra_private', 'CREATE')
    AND has_function_privilege(current_user, 'terra_private.read_issue_candidate(text,text)', 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'terra_private' AND c.relkind IN ('r','p','v','m','f')
      AND (has_table_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'terra_private'
      AND p.oid <> 'terra_private.read_issue_candidate(text,text)'::regprocedure
      AND has_function_privilege(current_user, p.oid, 'EXECUTE')
    ) AS admitted
  FROM pg_roles r WHERE r.rolname = current_user
)
SELECT admitted, CASE WHEN admitted
  THEN terra_private.read_issue_candidate($1::text, $2::text)::text
  ELSE NULL END AS candidate FROM principal`;

function candidateBytes(input: unknown): Uint8Array {
  if (input === null || typeof input !== "object") throw unavailable();
  const result = input as { command?: unknown; rowCount?: unknown; fields?: unknown; rows?: unknown };
  if (result.command !== "SELECT" || result.rowCount !== 1 || !Array.isArray(result.fields) ||
      result.fields.length !== 2 || result.fields[0]?.name !== "admitted" || result.fields[0]?.dataTypeID !== 16 ||
      result.fields[1]?.name !== "candidate" || result.fields[1]?.dataTypeID !== 25 ||
      !Array.isArray(result.rows) || result.rows.length !== 1 || !Array.isArray(result.rows[0]) ||
      result.rows[0].length !== 2 || result.rows[0][0] !== true) throw unavailable();
  const value: unknown = result.rows[0][1];
  if (value !== null && typeof value !== "string") throw unavailable();
  const text = value === null ? "null" : value as string;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes < 4 || bytes > PUBLIC_CANDIDATE_BYTES) throw unavailable();
  return new TextEncoder().encode(text);
}

export type PostgresIssueTransport = Readonly<{
  readCandidate: CurrentIssueCandidateReader;
  shutdown: () => Promise<boolean>;
}>;

export function createPostgresIssueTransport(input: unknown, factory?: PostgresReadClientFactory, now = () => performance.now()): PostgresIssueTransport {
  const owner = createPostgresReadOwner(input, "terrafracta.current-reader", false, factory, now);
  const readCandidate: CurrentIssueCandidateReader = async (inputRoute, signal) => {
    const route = canonicalPublicIssueRoute(inputRoute);
    if (route === null) throw unavailable();
    return owner.run(signal, async (client, assertActive) => {
      const result = await client.query({ text: POSTGRES_CURRENT_ISSUE_SQL, values: [route.jurisdictionSlug, route.issueSlug], rowMode: "array" });
      assertActive();
      return candidateBytes(result);
    });
  };
  return Object.freeze({ readCandidate, shutdown: owner.shutdown });
}
