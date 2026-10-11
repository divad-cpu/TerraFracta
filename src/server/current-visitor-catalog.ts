import { currentCatalogueSelection, currentCatalogueResult, currentVisitorEntry,
  type CurrentVisitorEntry, type CurrentCatalogueResult } from "../current-visitor-catalog.ts";
import { readPublicIssue, type PublicIssueReader } from "./public-issue-reader.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// One fresh existing-reader invocation. Edition and filters never select a
// provider, older candidate, file, role, SQL statement or source.
export async function loadCurrentVisitorCatalogue(input: unknown, reader: PublicIssueReader = readPublicIssue,
  entry: CurrentVisitorEntry = currentVisitorEntry, record: DevelopmentErrorRecorder = recordDevelopmentError, selectorRethrow?: (error: unknown) => void): Promise<CurrentCatalogueResult> {
  const selection = currentCatalogueSelection(input, entry, selectorRethrow);
  if (selection === null) return { kind: "invalid" };
  try {
    const decision = await reader({ jurisdictionSlug: entry.jurisdictionSlug, issueSlug: entry.issueSlug });
    return currentCatalogueResult(decision, selection, entry);
  } catch {
    observeDevelopmentError("public_issue_read", record);
    return { kind: "unavailable", selection };
  }
}
