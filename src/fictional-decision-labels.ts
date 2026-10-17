// Shared wording for already validated fictional decisions; no eligibility rule.
export const fictionalOutcomeLabel: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null) as Record<string, string>, {
  shadow_only: "Passed the rehearsal checks", held: "Held for review", unchanged: "No change",
}));
export const fictionalReasonLabel: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null) as Record<string, string>, {
  shadow_mode: "The checks passed in rehearsal. Nothing was published.",
  material_conflict: "Another finding conflicts with this one and needs review.",
  content_hash_unchanged: "The source content matches the previous check.",
  semantic_contract_mismatch: "The observed data mapping differs from the accepted one.",
  source_reference_invalid: "The source reference could not be checked. Its details are withheld.",
  candidate_binding_invalid: "The proposed finding does not match its source record.",
}));
