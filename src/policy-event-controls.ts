// Shared synchronous ownership checks around each native observation.
function ownedControlRead(current: () => boolean) {
  return <T>(get: () => T): T => {
    if (!current()) throw new Error("Event controls retired");
    const value = get(); if (!current()) throw new Error("Event controls retired"); return value;
  };
}

// A whole bounded native selection. No iterator, filename, text, normalization,
// source eligibility or partial over-limit selection is accepted here.
export function preparationReferenceValues(control: HTMLSelectElement, current: () => boolean): string[] {
  const read = ownedControlRead(current);
  const options = read(() => control.selectedOptions), count = read(() => options.length);
  if (!Number.isSafeInteger(count) || count < 0 || count > 12) throw new Error("Event reference selection exceeds its bound");
  const values: string[] = [];
  for (let option = 0; option < count; option++) {
    const item = read(() => options.item);
    const selected = read(() => Reflect.apply(item, options, [option])); if (!selected) throw new Error("Event choice unavailable");
    const value = read(() => selected.value); if (typeof value !== "string") throw new Error("Event choice unavailable");
    values.push(value);
  }
  return values;
}

// Bounded synchronous DOM-control read for the form-free private worksheet.
// No FormData submission, DOM creation, hidden form or network operation.
export function policyEventControlEntries(root: HTMLFieldSetElement, current: () => boolean): Array<[string, string]> {
  const read = ownedControlRead(current);
  const controls = read(() => root.elements), length = read(() => controls.length);
  if (!Number.isSafeInteger(length) || length < 0 || length > 128) throw new Error("Event controls exceed their bound");
  const entries: Array<[string, string]> = [];
  for (let index = 0; index < length; index++) {
    const item = read(() => controls.item);
    const control = read(() => Reflect.apply(item, controls, [index])); if (!control) throw new Error("Event control missing");
    const attribute = read(() => control.getAttribute);
    const name = read(() => Reflect.apply(attribute, control, ["name"])); if (name === null || name === "") continue;
    if (typeof name !== "string") throw new Error("Event control name unavailable");
    const tag = read(() => control.tagName);
    if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") throw new Error("Unknown event control");
    if (tag === "INPUT" && read(() => (control as HTMLInputElement).type) !== "text") throw new Error("Unknown event input type");
    if (tag === "SELECT" && read(() => (control as HTMLSelectElement).multiple)) {
      for (const value of preparationReferenceValues(control as HTMLSelectElement, current)) entries.push([name, value]);
    } else {
      const value = read(() => (control as HTMLInputElement).value);
      if (typeof value !== "string") throw new Error("Event value unavailable"); entries.push([name, value]);
    }
  }
  return entries;
}
