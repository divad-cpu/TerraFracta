import { illustrativeDateSchema } from "./prototype-contract.ts";
import { captureOwnEnumerableSelectors } from "./own-enumerable-selectors.ts";

// Fixed fictional comparison default, never a system-clock freshness assertion.
export const MILESTONE_EXAMPLE_COMPARISON_DATE = "2027-06-15";
export function plannedMilestoneComparisonDate(input: unknown, rethrow?: (error: unknown) => void): string | null {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.some(key => key !== "comparisonOn")) return null;
    const names = keys as string[];
    const values = captureOwnEnumerableSelectors(input, names, true, error => { throw error; });
    if (!values) return null;
    const after = Reflect.ownKeys(input);
    const enumerable = Object.keys(input);
    if (after.length !== keys.length || after.some(key => !keys.includes(key)) ||
        enumerable.length !== names.length || enumerable.some(key => !names.includes(key))) return null;
    if (keys.length === 0) return MILESTONE_EXAMPLE_COMPARISON_DATE;
    if (values.comparisonOn.length !== 10) return null;
    const checked = illustrativeDateSchema.safeParse({ precision: "day", value: values.comparisonOn });
    return checked.success && checked.data.precision === "day" ? checked.data.value : null;
  } catch (error) { rethrow?.(error); return null; }
}
