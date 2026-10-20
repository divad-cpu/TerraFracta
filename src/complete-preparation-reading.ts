import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { reopenEvaluationPreparationBundleJson } from "./evaluation-preparation-bundle.ts";
import { evaluationPreparationReading } from "./evaluation-preparation-reading.ts";
import { reopenPlannedMilestoneDraftJson, plannedMilestoneDraftFieldLabels, type PlannedMilestoneDraftField } from "./planned-milestone-draft.ts";
import { preparedEventDateLabel } from "./policy-event-draft.ts";
import { scopeReferenceKey } from "./issue-scope-draft.ts";
import { recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";
import { statementLabels, evidenceLabels } from "./issue-display-labels.ts";

// Ephemeral reading only: two unchanged exact copies, never another carrier,
// export format, accepted review, cross-measure match or publication candidate.
export function completePreparationReading(bundleJson: unknown, milestoneJson: unknown, contextInput: unknown) {
  try {
    const checked = checkedResponsibilityContext(contextInput);
    if (!checked || typeof bundleJson !== "string" || typeof milestoneJson !== "string" ||
        (bundleJson === "" && milestoneJson === "")) return null;
    const context = checked.context;
    const bundle = bundleJson === "" ? null : reopenEvaluationPreparationBundleJson(bundleJson, context);
    if (bundleJson !== "" && (bundle === null || evaluationPreparationReading(bundle, context) === null)) return null;
    const draft = milestoneJson === "" ? null : reopenPlannedMilestoneDraftJson(milestoneJson, context);
    if (milestoneJson !== "" && draft === null) return null;
    const claims = new Map(context.claims.map((claim, index) => [claim.id, { ...claim, number: index + 1 }]));
    const selected = new Map<string, Array<{ entryNumber: number; field: PlannedMilestoneDraftField; label: string }>>();
    const entries = draft?.entries.map((entry, index) => {
      const claim = claims.get(entry.claimId); if (!claim) throw Error();
      return { statement: { number: claim.number, label: statementLabels[claim.type], period: claim.periodLabel,
        href: `#proposal-proposed-claim-${claim.id}` },
        fields: (Object.keys(plannedMilestoneDraftFieldLabels) as PlannedMilestoneDraftField[]).map(key => {
          const value = entry.fields[key];
          if (value === null) return { key, label: plannedMilestoneDraftFieldLabels[key], value: null, precision: null, references: [] };
          const references = value.references.map(ref => {
            const identity = scopeReferenceKey(ref.claimId, ref.referenceNumber), uses = selected.get(identity) ?? [];
            uses.push({ entryNumber: index + 1, field: key, label: plannedMilestoneDraftFieldLabels[key] });
            selected.set(identity, uses); return identity;
          });
          return { key, label: plannedMilestoneDraftFieldLabels[key],
            value: "date" in value ? preparedEventDateLabel(value.date) : value.wording,
            precision: "date" in value ? value.date.precision : null, references };
        }) };
    }) ?? [];
    const references = context.claims.flatMap((claim, index) => claim.evidence.flatMap((source, referenceIndex) => {
      const key = scopeReferenceKey(claim.id, referenceIndex + 1), selections = selected.get(key);
      return selections ? [{ key, statementNumber: index + 1, referenceNumber: referenceIndex + 1, title: source.title,
        locator: source.locator, originalRelation: evidenceLabels[source.relation],
        originalHref: `#${recordedProposalReferenceAnchor("proposed", claim.id, referenceIndex)}`, selections }] : [];
    }));
    if (references.length !== selected.size) return null;
    return { context, bundle, milestones: { status: draft === null ? "not_supplied" as const : entries.length === 0 ? "empty" as const : "supplied" as const,
      entries, references } };
  } catch { return null; }
}
