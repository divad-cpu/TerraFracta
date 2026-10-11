import { z } from "zod";
import { publicIssueProjectionSchema } from "./public-issue-projection.ts";
import { searchText } from "./search-text.ts";
import { compareRecordedInstants } from "./recorded-instant-order.ts";

export const CONNECTED_READER_CAPACITY = 128;
export const CONNECTED_READER_BYTES = 64 * 1024;
const identity = {
  schemaVersion: z.literal(1),
  evidenceKind: z.literal("connected_fictional_reader"),
  executionId: z.uuid({ version: "v4" }),
  observedAt: z.iso.datetime({ offset: true }),
  actualSourceRequests: z.literal(0), modelCalls: z.literal(0),
  livePublicationEnabled: z.literal(false),
};
const active = z.strictObject({ ...identity, state: z.literal("active"), issue: publicIssueProjectionSchema });
const suppressed = z.strictObject({ ...identity, state: z.literal("suppressed"), issue: z.null(), reason: z.literal("fictional_source_rights_withdrawn") });
const body = z.discriminatedUnion("state", [active, suppressed]);
const snapshot = z.discriminatedUnion("state", [
  active.extend({ generation: z.number().int().min(1).max(CONNECTED_READER_CAPACITY) }),
  suppressed.extend({ generation: z.number().int().min(1).max(CONNECTED_READER_CAPACITY) }),
]);

function checkFictionalIssue(input: z.infer<typeof body> | z.infer<typeof snapshot>) {
  if (input.state !== "active") return;
  const issue = input.issue;
  if (issue.jurisdictionSlug !== "fictional-country" || issue.issueSlug !== "fictional-share" ||
      issue.title !== "Fictional share observation" || issue.claims.length !== 1 ||
      issue.summary !== "A page draft calculated from invented source bytes. No fact about a real country is stated.") {
    throw new Error("Connected development reader accepts only the invented source route");
  }
  const claim = issue.claims[0];
  if (claim.type !== "condition" || claim.periodLabel !== "2025" ||
      !/^In 2025, the fictional share was (?:27\.4|28\.1)%\.$/.test(claim.assertion) ||
      claim.evidence.length !== 1) throw new Error("Connected development reader rejects unrecognized wording");
  const source = claim.evidence[0];
  if (source.publisher !== "Fictional statistics office" || source.title !== "Fictional housing table" ||
      source.url !== "https://example.org/fictional-table" || source.relation !== "supports" ||
      source.sourcePublishedOn !== null || source.locator !== "series=fictional-share;geography=fictional-country;period=2025") {
    throw new Error("Connected development reader rejects a real or substituted source");
  }
  const observed = new Date(input.observedAt).toISOString();
  const retrieved = new Date(source.retrievedAt).toISOString();
  if (compareRecordedInstants(source.retrievedAt, input.observedAt) > 0 || issue.lastEvidenceReviewOn < retrieved.slice(0, 10) ||
      issue.lastEvidenceReviewOn > observed.slice(0, 10)) {
    throw new Error("Connected display timing differs from its captured evidence");
  }
}

export function parseConnectedReaderInput(input: unknown) {
  const parsed = body.parse(input);
  checkFictionalIssue(parsed);
  return parsed;
}
export function parseConnectedReaderSnapshot(input: unknown) {
  const parsed = snapshot.parse(input);
  checkFictionalIssue(parsed);
  return parsed;
}
export type ConnectedReaderSnapshot = ReturnType<typeof parseConnectedReaderSnapshot>;
export type ConnectedReaderInput = ReturnType<typeof parseConnectedReaderInput>;
export type ConnectedReaderOutcome =
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "changed"; currentGeneration: number }
  | { kind: "snapshot"; snapshot: ConnectedReaderSnapshot };

export function connectedEdition(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > CONNECTED_READER_CAPACITY) {
    throw new Error("Invalid connected edition");
  }
  return Number(value);
}

// Every surface is derived from the same already checked projection. Query
// text filters public wording; it never selects a file, source or SQL command.
export function connectedSearch(snapshot: ConnectedReaderSnapshot, query: unknown) {
  const search = searchText(query);
  if (search.kind === "invalid") return { ...search, matches: false };
  const cleaned = search.query;
  if (snapshot.state !== "active") return { kind: "valid" as const, matches: false, query: cleaned };
  const issue = snapshot.issue;
  const words = cleaned.toLocaleLowerCase("en").split(/\s+/).filter(Boolean);
  const text = [issue.title, issue.summary, ...issue.claims.flatMap((claim) =>
    [claim.assertion, claim.periodLabel, ...claim.evidence.map((source) => source.title)])].join(" ").toLocaleLowerCase("en");
  return { kind: "valid" as const, matches: words.every((word) => text.includes(word)), query: cleaned };
}
