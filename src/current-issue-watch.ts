import { captureCurrentIssueIdentity, interpretCurrentIssueStatus, type CurrentIssueIdentity, type CurrentIssueVerdict } from "./current-issue-status.ts";
import { startReaderWatch, type ReaderWatchControls } from "./reader-watch.ts";

export function startCurrentIssueWatch(expected: CurrentIssueIdentity, changed: (value: CurrentIssueVerdict) => void,
  read: (identity: CurrentIssueIdentity, signal: AbortSignal) => Promise<unknown>, controls: ReaderWatchControls) {
  const identity = captureCurrentIssueIdentity(expected);
  return startReaderWatch<CurrentIssueVerdict>(changed, async signal => {
    if (identity === null) return { kind: "unavailable" };
    // A reader gets its own request copy, never the comparison owner's identity.
    return interpretCurrentIssueStatus(await read({ ...identity }, signal), identity);
  },
    controls, () => ({ kind: "unavailable" }));
}
