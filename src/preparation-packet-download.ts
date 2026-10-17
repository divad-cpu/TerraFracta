import { preparationPacketJson } from "./preparation-packet.ts";
export type PreparationDownloadResult = "requested" | "held" | "retired" | "failed";

// Native local download only. A returned request is not a saved-file receipt.
// No filename, exception, copied text or context goes to a reporting/IO port.
export function downloadPreparationPacketFile(input: unknown, context: unknown, current: () => boolean): PreparationDownloadResult {
  let link: HTMLAnchorElement | null = null, remove: (() => void) | null = null;
  let url: string | null = null, urls: typeof URL | null = null, revoke: typeof URL.revokeObjectURL | null = null;
  const observe = <T>(get: () => T): T => {
    if (!current()) throw new Error("Preparation download retired");
    const value = get(); if (!current()) throw new Error("Preparation download retired"); return value;
  };
  try {
    if (!current()) return "retired";
    const json = preparationPacketJson(input, context);
    if (!current()) return "retired"; if (json === null) return "held";
    const doc = observe(() => document), create = observe(() => doc.createElement);
    // Keep allocated handles before testing retirement so finally can clean up.
    link = Reflect.apply(create, doc, ["a"]) as HTMLAnchorElement;
    if (!current()) return "retired";
    remove = observe(() => link!.remove);
    const BlobType = observe(() => Blob), blob = new BlobType([json], { type: "application/json" });
    if (!current()) return "retired";
    urls = observe(() => URL); revoke = observe(() => urls!.revokeObjectURL);
    const createUrl = observe(() => urls!.createObjectURL);
    url = Reflect.apply(createUrl, urls, [blob]);
    if (!current()) return "retired";
    if (typeof url !== "string") return "failed";
    link.href = url;
    if (!current()) return "retired";
    link.download = "terrafracta-private-preparation-packet.json";
    if (!current()) return "retired";
    const body = observe(() => doc.body), append = observe(() => body.append);
    Reflect.apply(append, body, [link]);
    if (!current()) return "retired";
    const click = observe(() => link!.click);
    Reflect.apply(click, link, []);
    return current() ? "requested" : "retired";
  } catch { return current() ? "failed" : "retired"; }
  finally {
    try {
      // If retirement happened during allocation, the link still belongs to
      // this operation. Cleanup may obtain remove even after retirement.
      if (link !== null) Reflect.apply(remove ?? link.remove, link, []);
    } catch { /* Preserve original result; URL cleanup remains independent. */ }
    try { if (url !== null && urls !== null && revoke !== null) Reflect.apply(revoke, urls, [url]); }
    catch { /* No retry, recursive diagnostics or inferred saved-file outcome. */ }
  }
}
