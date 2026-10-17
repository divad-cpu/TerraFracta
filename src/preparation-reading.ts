import { checkPreparationPacket, preparationPacketJson, preparationPacketLabels, type PreparationPart } from "./preparation-packet.ts";
import { checkedResponsibilityContext, reopenResponsibilityDraftJson, responsibilityFieldLabels } from "./responsibility-draft.ts";
import { reopenScopeDraftJson, scopeFieldLabels, scopeReferenceKey } from "./issue-scope-draft.ts";
import { reopenPolicyEventDraftJson, policyEventFieldLabels, policyEventKinds, preparedEventDateLabel } from "./policy-event-draft.ts";
import { reopenFundingDraftJson, fundingFieldLabels, fundingChoices, type FundingField } from "./funding-draft.ts";
import { reopenIndicatorDraftJson, indicatorFieldLabels, indicatorMissingReasons } from "./indicator-draft.ts";
import { reopenDeliveryDraftJson, deliveryFieldLabels, deliveryStages } from "./delivery-draft.ts";
import { recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";
import { statementLabels, evidenceLabels } from "./issue-display-labels.ts";
import type { IllustrativeDate } from "./prototype-contract.ts";

type Reference = { claimId: string; referenceNumber: number };
type PreparedField = { references: Reference[] } & ({ wording: string } | { value: string } | { date: IllustrativeDate });
type PreparedEntry = { claimId?: string; fields: Record<string, PreparedField | null> };
export type PreparationReadingReference = {
  key: string; statementNumber: number; referenceNumber: number;
  title: string; locator: string; originalRelation: string; originalHref: string;
  selections: Array<{ part: PreparationPart; entryNumber: number; field: string; label: string }>;
};
export type PreparationReadingEntry = {
  statement: { number: number; label: string; period: string; href: string } | null;
  fields: Array<{ key: string; label: string; value: string | null; references: string[] }>;
};
export type PreparationReading = {
  sections: Array<{ part: PreparationPart; label: string; status: "not_supplied" | "empty" | "supplied"; entries: PreparationReadingEntry[] }>;
  references: PreparationReadingReference[];
};

// These are existing private codecs and labels, not a new publication format.
const definitions = {
  scope: { read: reopenScopeDraftJson, labels: scopeFieldLabels },
  responsibility: { read: reopenResponsibilityDraftJson, labels: responsibilityFieldLabels },
  policyEvents: { read: reopenPolicyEventDraftJson, labels: policyEventFieldLabels },
  funding: { read: reopenFundingDraftJson, labels: fundingFieldLabels },
  indicators: { read: reopenIndicatorDraftJson, labels: indicatorFieldLabels },
  delivery: { read: reopenDeliveryDraftJson, labels: deliveryFieldLabels },
};
const readingOrder: PreparationPart[] = ["scope", "indicators", "responsibility", "policyEvents", "funding", "delivery"];
function fieldText(part: PreparationPart, name: string, field: PreparedField): string {
  if ("wording" in field) return field.wording;
  if ("date" in field) return preparedEventDateLabel(field.date);
  const choices: Record<string, string> | undefined = part === "policyEvents" && name === "kind" ? policyEventKinds
    : part === "delivery" && name === "stage" ? deliveryStages
    : part === "indicators" && name === "missingReason" ? indicatorMissingReasons
    : part === "funding" ? fundingChoices[name as FundingField] : undefined;
  if (!choices) return field.value;
  const label = choices[field.value]; if (typeof label !== "string") throw new Error("Preparation choice unavailable");
  return label;
}

// Pure private reading only. A complete exportable same-capture packet is
// required; no partial preview, data repair, source lookup or inferred relation.
export function preparationPacketReading(input: unknown, contextInput: unknown): PreparationReading | null {
  try {
    const checked = checkedResponsibilityContext(contextInput); if (!checked) return null;
    const context = checked.context, packet = checkPreparationPacket(input, context);
    if (!packet || preparationPacketJson(packet, context) === null) return null;
    const claims = new Map(context.claims.map((claim, index) => [claim.id, { ...claim, number: index + 1 }]));
    const referenceIndex = new Map(context.claims.flatMap((claim, statementIndex) => claim.evidence.map((source, index) => {
      const key = scopeReferenceKey(claim.id, index + 1);
      return [key, { key, statementNumber: statementIndex + 1, referenceNumber: index + 1,
        title: source.title, locator: source.locator, originalRelation: evidenceLabels[source.relation],
        originalHref: `#${recordedProposalReferenceAnchor("proposed", claim.id, index)}` }] as const;
    })));
    const selections = new Map<string, PreparationReadingReference["selections"]>();
    const sections = readingOrder.map(part => {
      const text = packet.preparations[part], label = preparationPacketLabels[part];
      if (text === null) return { part, label, status: "not_supplied" as const, entries: [] };
      const definition = definitions[part], draft = definition.read(text, context);
      if (!draft) throw new Error("Preparation part unavailable");
      const entries: PreparedEntry[] = "entries" in draft ? draft.entries : [{ fields: draft.fields }];
      return { part, label, status: entries.length ? "supplied" as const : "empty" as const,
        entries: entries.map((entry, entryIndex) => {
          const owner = entry.claimId === undefined ? null : claims.get(entry.claimId);
          if (entry.claimId !== undefined && !owner) throw new Error("Preparation statement unavailable");
          return { statement: owner ? { number: owner.number, label: statementLabels[owner.type], period: owner.periodLabel,
            href: `#proposal-proposed-claim-${owner.id}` } : null,
          fields: Object.entries(definition.labels).map(([name, fieldLabel]) => {
            const field = entry.fields[name]; if (field === undefined) throw new Error("Preparation field unavailable");
            if (field === null) return { key: name, label: fieldLabel, value: null, references: [] };
            const references = field.references.map(reference => {
              const key = scopeReferenceKey(reference.claimId, reference.referenceNumber);
              if (!referenceIndex.has(key)) throw new Error("Preparation reference unavailable");
              const selected = selections.get(key) ?? [];
              selected.push({ part, entryNumber: entryIndex + 1, field: name, label: fieldLabel });
              selections.set(key, selected); return key;
            });
            return { key: name, label: fieldLabel, value: fieldText(part, name, field), references };
          }) };
        }) };
    });
    // Share an exact display occurrence only, never a source-identity or
    // independent-confirmation claim. Keep captured statement/reference order.
    return { sections, references: [...referenceIndex.values()].filter(reference => selections.has(reference.key))
      .map(reference => ({ ...reference, selections: selections.get(reference.key)! })) };
  } catch { return null; }
}
