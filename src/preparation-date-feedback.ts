import { illustrativeDateSchema } from "./prototype-contract.ts";
import { scopeReferenceKey } from "./issue-scope-draft.ts";
import { collectedPreparationControls } from "./preparation-control-values.ts";

export const preparationDatePrefixes = { eventDate: "event", reportedDate: "reported" } as const;
export type PreparationDateField = keyof typeof preparationDatePrefixes;
export type PreparationDateFeedback = Record<string, Record<PreparationDateField, { precision: boolean; value: boolean; references: boolean }>>;

// Fixed correction hints for already collected private native controls only.
// No candidate acceptance, date repair, source meaning, text or exception output.
export function preparationDateFeedback(input: unknown, rowIds: number[], contextInput: unknown,
  mode: "policy_event" | "delivery"): PreparationDateFeedback | null {
  try {
    const collected = collectedPreparationControls(input, rowIds, contextInput, mode); if (!collected) return null;
    const { rows, values, context } = collected;
    const known = new Set(context.claims.flatMap(claim => claim.evidence.map((_ref, index) => scopeReferenceKey(claim.id, index + 1))));
    const result: PreparationDateFeedback = {};
    for (const id of rows) {
      const row = {} as PreparationDateFeedback[string];
      for (const field of Object.keys(preparationDatePrefixes) as PreparationDateField[]) {
        const prefix = preparationDatePrefixes[field], precisionValues = values.get(`${id}.${prefix}Precision`), dateValues = values.get(`${id}.${prefix}Value`);
        if (precisionValues?.length !== 1 || dateValues?.length !== 1) return null;
        const precision = precisionValues[0], value = dateValues[0], references = values.get(`${id}.${field}References`) ?? [];
        const hint = { precision: false, value: false, references: false };
        if (precision === "") {
          hint.precision = value !== "" || references.length > 0;
          hint.value = value === "" && references.length > 0;
        } else if (!["day", "month", "year", "period"].includes(precision)) hint.precision = true;
        else hint.value = !illustrativeDateSchema.safeParse(precision === "period" ? { precision, label: value } : { precision, value }).success;
        hint.references = (precision !== "" && references.length === 0) || references.length > 12 || new Set(references).size !== references.length || references.some(key => !known.has(key));
        row[field] = hint;
      }
      result[String(id)] = row;
    }
    return result;
  } catch { return null; }
}
