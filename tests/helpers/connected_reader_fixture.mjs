import { randomUUID } from "node:crypto";

// Invented display fixture only; no database or source authority is asserted.
export function connectedInput(value = "27.4") {
  return {
    schemaVersion: 1, evidenceKind: "connected_fictional_reader",
    executionId: randomUUID(), observedAt: "2026-10-01T12:00:00Z",
    actualSourceRequests: 0, modelCalls: 0, livePublicationEnabled: false, state: "active",
    issue: {
      issueId: "718863b9-75b8-572b-9184-3bc18a13658a", publicationId: randomUUID(), revision: 1,
      jurisdictionSlug: "fictional-country", issueSlug: "fictional-share", title: "Fictional share observation",
      summary: "A page draft calculated from invented source bytes. No fact about a real country is stated.",
      lastEvidenceReviewOn: "2026-10-01", claims: [{
        id: "b1f330c7-1fb0-5d43-ac78-efa58fd46800", type: "condition", assertion: `In 2025, the fictional share was ${value}%.`, periodLabel: "2025",
        evidence: [{ sourceVersionId: "22222222-2222-4222-8222-222222222222", publisher: "Fictional statistics office", title: "Fictional housing table",
          url: "https://example.org/fictional-table", locator: "series=fictional-share;geography=fictional-country;period=2025", relation: "supports",
          sourcePublishedOn: null, retrievedAt: "2026-10-01T11:59:30Z" }],
      }],
    },
  };
}
export function suppressionInput() {
  const { issue: _issue, state: _state, ...identity } = connectedInput();
  return { ...identity, state: "suppressed", issue: null, reason: "fictional_source_rights_withdrawn" };
}
