import type { heldReasonCodes } from "./operator-held-decisions.ts";

// Definitions of disclosed historical codes, not findings about a current source.
// In particular, a fixed check can fail because a passing result was not recorded.
const explanations = Object.freeze({
  source_version_not_current: "Version-currentness was not established for this decision. This does not establish the source's present version or health.",
  evidence_locator_unverified: "The referenced source location was not verified for the decision. The code does not reconstruct a missing excerpt.",
  identity_unresolved: "The identity check was not established as passing. The code alone does not identify an incorrect institution, country or source.",
  fields_dates_units_unverified: "The required field, date and unit checks were not established as passing. The code does not identify which value is wrong.",
  semantics_unqualified: "The interpretation of the source fields was not qualified for the recorded decision. The code does not supply a reviewed interpretation.",
  material_conflict: "The no-material-conflict check was not established as passing. The code alone does not identify a contradiction or prove that relevant conflict-search coverage was complete.",
  snapshot_inconsistent: "Consistency of the proposed public snapshot was not established. The code alone does not specify an inconsistency.",
  predecessor_changed: "The expected predecessor was not established as current for the decision. The code alone does not identify a replacement version.",
  sensitive_data_present: "The no-sensitive-data check was not established as passing. The code alone does not establish that sensitive data was found.",
  decision_identity_missing: "A required candidate or policy identity was missing or invalid for the decision. The code does not reveal the missing or invalid value.",
  mode_unsupported: "The recorded decision mode was outside the supported modes. This page does not choose or activate a mode.",
  policy_not_active: "The decision did not use an active policy. This is not a statement about current policy settings.",
  source_not_approved: "Source approval was not available for the decision. Source availability is not reuse or publication permission.",
  source_fetch_disabled: "Fetch permission was not enabled for the decision. This page does not fetch or enable the source.",
  qualification_not_active: "An active qualification with a valid identity was not available for the decision.",
  qualification_policy_mismatch: "The qualification and decision policy identities did not match.",
  change_class_not_automatable: "The change class was outside the classes allowed for automatic processing. The code does not authorize manual publication.",
  change_class_mismatch: "The proposed change class did not match the qualification's recorded class.",
  parser_version_mismatch: "The parser identifier did not match the qualification's specified parser.",
  parser_version_invalid: "The parser identifier did not satisfy the required identity format. This is not a parser-quality score.",
  public_use_not_allowed: "Public reuse was not allowed by the qualification for the decision. Availability or a citation does not clear reuse rights.",
  public_citation_invalid: "The qualification did not have an accepted public source address. This does not certify link uptime or prove that source content is absent.",
  qualification_expired_or_invalid: "The qualification window or decision time was invalid or expired. The code alone does not distinguish these causes.",
  qualification_samples_invalid: "The qualification's reviewed sample count or unresolved-error state did not meet the required conditions. The code alone does not identify a failed sample.",
  semantic_contract_mismatch: "The observed semantic-contract digest did not match a valid accepted qualification digest. This is a mapping check, not factual proof.",
  evidence_receipt_invalid: "Required evidence-receipt identity, source address, content digest, location or retrieval metadata was invalid. The code does not reconstruct the receipt.",
  decision_time_invalid: "The decision and retrieval time checks failed, including missing UTC times or retrieval after evaluation. The code alone does not identify the cause.",
  source_endpoint_mismatch: "The receipt's source address did not match the qualification's source endpoint. A shared publisher or domain does not establish equivalence.",
  source_identity_mismatch: "The candidate, qualification and receipt did not establish the same source identity. This is not a judgement of source credibility.",
  shadow_mode: "The recorded code indicates shadow processing. It is not a publication receipt or a current activation permission.",
  qualified_checks_passed: "The code records passed qualification checks. It is not a publication receipt or a current approval. A held record remains held.",
} satisfies Record<(typeof heldReasonCodes)[number], string>);

export function recordedHoldReasonExplanation(code: unknown): string | null {
  return typeof code === "string" && Object.hasOwn(explanations, code)
    ? explanations[code as keyof typeof explanations] : null;
}

export const recordedHoldExplanationNotice = "These explanations describe recorded codes, not current findings. A failed or unrecorded check does not by itself prove a conflict, outdated evidence or sensitive data. Definitions do not explain undisclosed reasons or reconstruct missing evidence. A held decision remains held.";
