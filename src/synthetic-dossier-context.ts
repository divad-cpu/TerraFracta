import type { DossierContextV2 } from "./dossier-context-v2.ts";

// Fictional display/test values only. Calling this function creates no real
// claim, review, source decision or permission to publish the returned words.
export function inventedDossierContext(claimId: string): DossierContextV2 {
  const ref = (referenceNumber: number, relation: "supports" | "contradicts" | "context" = "supports") => ({ claimId, referenceNumber, relation });
  return {
    scope: {
      population: { wording: "An entirely fictional group of households in an invented local exercise.", references: [ref(1)] },
      period: { wording: "Example year 2030 — year precision only, not a specific day.", references: [ref(2)] },
      selectionRationale: { wording: "Selected only to exercise the local v2 contract. This is not a real issue-selection decision.", references: [ref(1, "context"), ref(3)] },
    },
    responsibilities: [
      { claimId, fields: {
        institution: { wording: "Invented municipal implementation unit", references: [ref(1)] }, governmentLevel: null,
        role: { wording: "Fictional delivery role; no implementation in a real place is claimed.", references: [ref(3)] },
        period: { wording: "Example year 2030", references: [ref(1)] },
      } },
      { claimId, fields: { institution: null, governmentLevel: null,
        role: { wording: "A separate fictional introduction role, not attributed to a current government.", references: [ref(2)] }, period: null } },
    ],
  };
}
