"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import type { ScopeDraftContext } from "./issue-scope-draft.ts";
import { preparationInputIntent, type PreparationInputIntents } from "./preparation-input-intent.ts";
import { readPreparationPacketFile } from "./preparation-packet-file.ts";
import { downloadPreparationPacketFile } from "./preparation-packet-download.ts";
import { cancelLocalFileRead } from "./local-file-cancellation.ts";
import { withLocalRequestDeadline } from "./local-request-deadline.ts";
import { preparationPacketLabels, preparationPacketTargets, preparationPacketFromParts, preparationPacketJson,
  reopenPreparationPacketJson, inspectPreparationPacket, PREPARATION_PACKET_BYTES, type PreparationPacket, type PreparationPart } from "./preparation-packet.ts";
import { preparationPacketFeedbackFromParts, type PreparationPacketFeedback } from "./preparation-packet.ts";
import { PreparationReadingView } from "./preparation-reading-view.tsx";
type Parts = Record<PreparationPart, string>;
type Editing = { key: string; generation: number; revision: number; parts: Parts; pasted: string;
  preview: PreparationPacket | null; json: string | null; held: boolean };
const names = Object.keys(preparationPacketLabels) as PreparationPart[];
const emptyParts = (): Parts => ({ scope: "", responsibility: "", policyEvents: "", funding: "", indicators: "", delivery: "" });
const statusLabels = { not_supplied: "Not supplied", empty: "Supplied empty entry list", supplied: "Supplied editing material" };
type PacketFileSlot = { released: boolean; waiters: Array<() => void> };
const physicalPacketFileReads = new Map<string, PacketFileSlot>();
function waitForPacketFileSlot(slot: PacketFileSlot): Promise<void> {
  return new Promise(resolve => { if (slot.released) resolve(); else slot.waiters.push(resolve); });
}

// Exact copied text and explicit local files. Physical reads keep ownership
// until settlement; no upload, archive, approval or public conversion exists.
export function PreparationPacketView({ context: input }: { context: ScopeDraftContext }) {
  const checked = checkedResponsibilityContext(input), key = checked?.key ?? null, prefix = useId();
  const latest = useRef({ key, generation: 0 }), visit = useRef<object | null>(null), revision = useRef(0), inputEpoch = useRef(0);
  const intents = useRef<PreparationInputIntents>({ epoch: -1, controls: new Map() });
  const pending = useRef<AbortController | null>(null);
  const [owner, setOwner] = useState<object | null>(null), [editing, setEditing] = useState<Editing | null>(null);
  const [reading, setReading] = useState(false);
  const [fileNotice, setFileNotice] = useState<{ key: string; status: "reading" | "waiting" | "held" | "loaded" | "read" } | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<{ key: string; revision: number; text: string } | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; generation: number; revision: number; value: PreparationPacketFeedback | null } | null>(null);
  const [savedReading, setSavedReading] = useState<{ key: string; generation: number; revision: number; packet: PreparationPacket | null; fileJson?: string } | null>(null);
  if (latest.current.key !== key) { latest.current = { key, generation: latest.current.generation + 1 }; visit.current = null; }
  const generation = latest.current.generation, epoch = inputEpoch.current, frameRevision = revision.current;
  const admitted = key !== null && owner !== null && visit.current === owner && editing?.key === key && editing.generation === generation;
  const state = admitted ? editing : null, shown = state?.revision === revision.current ? state : null;
  const hints = shown?.held && feedback?.key === key && feedback.generation === generation && feedback.revision === revision.current ? feedback.value : null;
  const saved = shown && savedReading?.key === key && savedReading.generation === generation && savedReading.revision === revision.current ? savedReading : null;
  const current = () => admitted && visit.current === owner && latest.current.key === key && latest.current.generation === generation;
  const ownsInput = () => current() && inputEpoch.current === epoch;
  const ownsAction = () => ownsInput() && state?.revision === revision.current;
  useLayoutEffect(() => () => { visit.current = null; cancelLocalFileRead(pending.current); }, []);
  useEffect(() => {
    setFeedback(null);
    setSavedReading(null);
    if (key === null) { visit.current = null; setOwner(null); setEditing(null); return; }
    const token = {}; visit.current = token; setOwner(null); setEditing(null); setReading(false); setDownloadNotice(null);
    const live = () => visit.current === token && latest.current.key === key && latest.current.generation === generation;
    const admit = () => {
      if (!live()) return;
      inputEpoch.current++; setFileNotice(null);
      setEditing({ key, generation, revision: ++revision.current, parts: emptyParts(), pasted: "", preview: null, json: null, held: false }); setOwner(token);
    };
    if (!physicalPacketFileReads.has(key)) admit();
    else {
      setFileNotice({ key, status: "waiting" });
      void (async () => {
        try {
          let slot: PacketFileSlot | undefined;
          while ((slot = physicalPacketFileReads.get(key))) await waitForPacketFileSlot(slot);
        } catch { if (live()) setFileNotice({ key, status: "held" }); return; }
        admit();
      })();
    }
    return () => { if (visit.current === token) { visit.current = null; cancelLocalFileRead(pending.current); } };
  }, [key, generation]);
  if (!checked) return <section><h2>Preparation packet unavailable</h2><p>No captured preparation packet is shown.</p></section>;
  const context = checked.context;
  function replace(parts: Parts, pasted = "", preview: PreparationPacket | null = null, json: string | null = null) {
    if (!ownsAction() || key === null) return;
    inputEpoch.current++; const next = ++revision.current;
    setSavedReading(null);
    cancelLocalFileRead(pending.current);
    setEditing(old => current() && revision.current === next ? { key, generation, revision: next, parts, pasted, preview, json, held: false } : old);
  }
  function clear() {
    // A fresh rendered cancellation may retire an event-property observation
    // before its state merge. Earlier rendered Clear callbacks stay retired.
    if (!ownsInput() || frameRevision !== revision.current || key === null) return;
    inputEpoch.current++; const next = ++revision.current;
    setSavedReading(null); cancelLocalFileRead(pending.current);
    setEditing(old => current() && revision.current === next ? { key, generation, revision: next, parts: emptyParts(),
      pasted: "", preview: null, json: null, held: false } : old);
  }
  function change(name: PreparationPart | "packet", event: ChangeEvent<HTMLTextAreaElement>) {
    const owns = preparationInputIntent(intents, epoch, name, ownsInput); if (!owns) return;
    // Retire action/preview authority before consulting event properties.
    revision.current++; setSavedReading(null); cancelLocalFileRead(pending.current); if (!owns()) return;
    try {
      const target = event.currentTarget; if (!owns()) return;
      const value = target.value; if (!owns()) return;
      if (typeof value !== "string") throw new Error("Preparation text unavailable");
      setEditing(old => owns() && old ? { ...old, revision: revision.current, ...(name === "packet" ? { pasted: value } : { parts: { ...old.parts, [name]: value } }),
        preview: null, json: null, held: false } : old);
    } catch {
      if (!owns()) return;
      setEditing(old => owns() && old ? { ...old, revision: revision.current, preview: null, json: null, held: true } : old);
    }
  }
  function inspect() {
    if (!ownsAction() || !state) return;
    const operation = ++revision.current, owns = () => current() && inputEpoch.current === epoch && revision.current === operation;
    setSavedReading(null);
    cancelLocalFileRead(pending.current);
    if (!owns()) return;
    try {
      const parts = Object.fromEntries(names.map(name => [name, state.parts[name] === "" ? null : state.parts[name]]));
      const preview = preparationPacketFromParts(parts, context), json = preview ? preparationPacketJson(preview, context) : null;
      const correction = json === null ? preparationPacketFeedbackFromParts(parts, context) : null;
      if (!owns() || key === null) return;
      setFeedback({ key, generation, revision: operation, value: correction });
      setEditing(old => owns() && old ? { ...old, revision: operation, preview: json === null ? null : preview, json, held: json === null } : old);
    } catch { setEditing(old => owns() && old ? { ...old, revision: operation, preview: null, json: null, held: true } : old); }
  }
  function reopen() {
    if (!ownsAction() || !state) return;
    const value = reopenPreparationPacketJson(state.pasted, context);
    if (!ownsAction()) return;
    if (value) replace(Object.fromEntries(names.map(name => [name, value.preparations[name] ?? ""])) as Parts,
      state.pasted, value, preparationPacketJson(value, context));
    else { const next = ++revision.current; setSavedReading(null); setEditing(old => ownsInput() && revision.current === next && old ? { ...old, revision: next, preview: null, json: null, held: true } : old); }
  }
  function readSaved() {
    if (!ownsAction() || !state) return;
    const operation = ++revision.current, owns = () => current() && inputEpoch.current === epoch && revision.current === operation;
    setSavedReading(null);
    cancelLocalFileRead(pending.current);
    if (!owns()) return;
    let packet: PreparationPacket | null = null;
    try { packet = reopenPreparationPacketJson(state.pasted, context); } catch { /* Fixed opaque held state below. */ }
    if (!owns() || key === null) return;
    setSavedReading({ key, generation, revision: operation, packet }); setFileNotice(null);
    setEditing(old => owns() && old ? { ...old, revision: operation, preview: null, json: null, held: false } : old);
  }
  function reopenReadFile() {
    if (!ownsAction() || !saved?.packet || saved.fileJson === undefined) return;
    replace(Object.fromEntries(names.map(name => [name, saved.packet!.preparations[name] ?? ""])) as Parts,
      saved.fileJson, saved.packet, saved.fileJson);
  }
  async function readFile(file: File, operation: number, owns: () => boolean, mode: "replace" | "read") {
    if (!owns() || key === null) return;
    if (pending.current !== null || physicalPacketFileReads.has(key)) { setFileNotice({ key, status: "waiting" }); return; }
    // Reserve before observing constructors, timers or File properties. A
    // reentrant admitted instance must see this slot even during setup.
    const slot: PacketFileSlot = { released: false, waiters: [] }; physicalPacketFileReads.set(key, slot);
    let controller: AbortController | null = null;
    try {
      controller = new AbortController();
      if (!owns()) { cancelLocalFileRead(controller); return; }
      pending.current = controller; setReading(true); setFileNotice({ key, status: "reading" });
      const candidate = await withLocalRequestDeadline(controller.signal, 8_000, async signal => {
        const observe = <T,>(get: () => T): T => {
          if (!owns() || signal.aborted) throw new Error("Packet file retired");
          const value = get(); if (!owns() || signal.aborted) throw new Error("Packet file retired"); return value;
        };
        const size = observe(() => file.size);
        if (!Number.isSafeInteger(size) || size < 2 || size > PREPARATION_PACKET_BYTES) throw new Error("Packet file refused");
        const slice = observe(() => file.slice), blob = Reflect.apply(slice, file, [0, PREPARATION_PACKET_BYTES + 1]) as Blob;
        if (!owns() || signal.aborted) throw new Error("Packet file retired");
        const arrayBuffer = observe(() => blob.arrayBuffer);
        // Once invoked, await physical settlement even if the call retires us.
        const bytes = await Reflect.apply(arrayBuffer, blob, []) as ArrayBuffer;
        if (!owns() || signal.aborted) throw new Error("Packet file retired");
        const value = readPreparationPacketFile(bytes, size, context); if (!value) throw new Error("Packet file refused"); return value;
      }, undefined, () => { cancelLocalFileRead(controller); if (owns()) setFileNotice({ key, status: "held" }); });
      if (owns() && revision.current === operation) {
        const json = preparationPacketJson(candidate, context); if (json === null) throw new Error("Packet file refused");
        if (!owns() || revision.current !== operation) return;
        inputEpoch.current++; const next = ++revision.current;
        if (mode === "read") {
          setSavedReading({ key, generation, revision: next, packet: candidate, fileJson: json });
          setEditing(old => current() && revision.current === next && old ? { ...old, revision: next, preview: null, json: null, held: false } : old);
          if (current() && revision.current === next) setFileNotice({ key, status: "read" });
        } else {
          setEditing(old => current() && revision.current === next ? { key, generation, revision: next,
            parts: Object.fromEntries(names.map(name => [name, candidate.preparations[name] ?? ""])) as Parts,
            pasted: json, preview: candidate, json, held: false } : old);
          if (current() && revision.current === next) setFileNotice({ key, status: "loaded" });
        }
      }
    } catch { if (owns()) setFileNotice({ key, status: "held" }); }
    finally {
      if (physicalPacketFileReads.get(key) === slot) physicalPacketFileReads.delete(key);
      slot.released = true; for (const release of slot.waiters.splice(0)) release();
      if (controller !== null && pending.current === controller) { pending.current = null; if (visit.current !== null) setReading(false); }
    }
  }
  function chooseFile(event: ChangeEvent<HTMLInputElement>, mode: "replace" | "read" = "replace") {
    if (!ownsAction() || key === null) return;
    const operation = ++revision.current, owns = () => current() && inputEpoch.current === epoch && revision.current === operation;
    setSavedReading(null);
    cancelLocalFileRead(pending.current);
    setEditing(old => owns() && old ? { ...old, revision: operation, preview: null, json: null, held: false } : old);
    try {
      if (!owns()) return; const target = event.currentTarget; if (!owns()) return;
      const files = target.files; if (!owns()) return;
      const file = files?.[0]; if (!owns()) return;
      target.value = ""; if (!owns()) return;
      if (file) void readFile(file, operation, owns, mode); else setFileNotice(null);
    } catch { if (owns()) setFileNotice({ key, status: "held" }); }
  }
  function download() {
    if (!ownsAction() || shown?.preview === null || !shown?.preview || key === null) return;
    const operation = revision.current, owns = () => ownsAction() && revision.current === operation;
    const result = downloadPreparationPacketFile(shown.preview, context, owns);
    if (!owns()) return;
    setDownloadNotice({ key, revision: operation, text: result === "requested"
      ? "Download requested. Keep the editable local file private. This is not confirmation that a file was saved or a review was completed."
      : "The download request could not be confirmed. The checked preparation preview is preserved; no automatic retry is made." });
  }
  return <details className="issue-scope-preparation"><summary>Keep unsent preparations together</summary>
    <h2>Private preparation packet</h2>
    <p>Paste the exact copied JSON from any of the six worksheets in this captured comparison. This envelope keeps their original formats and bytes together. A missing part stays absent; it is not a zero, an empty finding or a completed review. At least one valid part is required.</p>
    <p>All supplied parts must belong to this exact captured proposal and comparison. Editing copied files is possible; these are unauthenticated private preparations, not approvals, factual findings or public content. Counts below describe editing material only and are not readiness or quality scores.</p>
    <p>Each part keeps its existing 16 KiB limit. The complete encoded packet has a separate 128 KiB UTF-8 limit, including escaping. Individually valid parts may exceed the combined limit. No value is silently truncated or normalized.</p>
    <p>This page keeps the packet in memory. An explicit download can request a private local JSON file. Clearing or closing this view does not erase anything already copied or saved elsewhere.</p>
    {names.map(name => <details key={name}><summary>{preparationPacketLabels[name]} copied preparation</summary>
      <p><a href={`#${preparationPacketTargets[name]}`}>Open {preparationPacketLabels[name].toLowerCase()} worksheet (expand)</a></p>
      <label htmlFor={`${prefix}-part-${name}`}>Exact copied {preparationPacketLabels[name].toLowerCase()} JSON, or blank if absent</label>
      <textarea id={`${prefix}-part-${name}`} rows={6} maxLength={16_384} value={state?.parts[name] ?? ""} disabled={!admitted} onChange={event => change(name, event)}
        aria-invalid={hints?.invalidParts[name] || undefined} aria-describedby={hints?.invalidParts[name] ? `${prefix}-part-${name}-error` : undefined} />
      {hints?.invalidParts[name] && <p id={`${prefix}-part-${name}-error`}>Check this part's exact copied format, current captured binding and individual 16 KiB limit. Recopy it from its worksheet, or leave this optional part absent. Nothing is repaired, moved or rebound automatically.</p>}
    </details>)}
    <button type="button" disabled={!admitted} onClick={inspect}>Inspect combined preparation packet</button>
    <button type="button" disabled={!admitted} onClick={clear}>Clear preparation packet</button>
    {shown?.held && <p role="status">Preparation packet held. Check exact formats, same captured bindings, at least one supplied part, individual copy limits and the complete 128 KiB limit. Previous preview is withheld.</p>}
    {hints?.missing && <p>No preparations supplied. Paste at least one exact copied preparation; the other parts can remain absent. No particular worksheet is required.</p>}
    {hints?.oversized && <p>Each supplied copy passes its existing format and binding checks, but the combined JSON exceeds 128 KiB including escaping. Choose which whole parts to keep or omit manually. Typed copies remain unchanged; nothing is truncated or removed automatically.</p>}
    {hints && names.some(name => hints.invalidParts[name]) && <ul aria-label="Preparation packet corrections">{names.filter(name => hints.invalidParts[name]).map(name =>
      <li key={name}><a href={`#${prefix}-part-${name}`}>Correct {preparationPacketLabels[name].toLowerCase()} copied preparation (expand)</a></li>)}</ul>}
    {shown?.preview && shown.json !== null && <section><h3>Unsent combined preparation</h3>
      <dl>{inspectPreparationPacket(shown.preview, context)!.map(row => <div key={row.part}><dt>{preparationPacketLabels[row.part]}</dt>
        <dd>{statusLabels[row.status]}. {row.status !== "not_supplied" && <>{row.entries} editing entries; {row.suppliedFields} supplied fields; {row.unknownFields} unknown fields.</>}</dd>
      </div>)}</dl>
      <p>No count establishes factual completeness, source rights, independent review, operational acceptance or publication eligibility. Source reference roles and unknowns remain in the original copied preparations.</p>
      <PreparationReadingView packet={shown.preview} context={context} prefix={`${prefix}-reading`} />
      <label htmlFor={`${prefix}-packet-json`}>Exact copied private preparation packet</label>
      <textarea id={`${prefix}-packet-json`} rows={14} readOnly value={shown.json} />
      <button type="button" disabled={!admitted} onClick={download}>Download private preparation packet</button>
    </section>}
    {downloadNotice?.key === key && downloadNotice.revision === revision.current && <p role="status">{downloadNotice.text}</p>}
    <label htmlFor={`${prefix}-packet-paste`}>Paste exact saved preparation packet</label>
    <textarea id={`${prefix}-packet-paste`} rows={8} maxLength={PREPARATION_PACKET_BYTES} value={state?.pasted ?? ""} disabled={!admitted} onChange={event => change("packet", event)} />
    <button type="button" disabled={!admitted} onClick={readSaved}>Read saved preparation packet</button>
    <button type="button" disabled={!admitted} onClick={reopen}>Reopen preparation packet</button>
    <p>Read the pasted saved copy before choosing whether to replace your typed preparations. Reopen replaces all six slots, including absent parts; it does not merge them.</p>
    {saved && (saved.packet ? <section><h3>Saved preparation reading</h3>
      {saved.fileJson === undefined
        ? <p>This read-only saved copy has not replaced your typed parts and cannot be downloaded as their inspected result. Use Reopen preparation packet separately to replace all six typed slots.</p>
        : <p>Reading this saved file has kept your typed parts and pasted text. Choose Reopen read preparation packet to replace all six slots with the copy shown here. No new file read or merge occurs.</p>}
      <table><caption>What Reopen would do to typed copies</caption><thead><tr><th scope="col">Worksheet</th><th scope="col">On explicit Reopen</th></tr></thead>
        <tbody>{names.map(name => {
          const typed = state!.parts[name] === "" ? null : state!.parts[name], incoming = saved.packet!.preparations[name];
          const effect = incoming === null ? typed === null ? "Would keep absent" : "Would remove current typed copy"
            : typed === null ? "Would supply saved copy" : typed === incoming ? "Would keep exact copied text" : "Would replace with different copied text";
          return <tr key={name}><th scope="row">{preparationPacketLabels[name]}</th><td>{effect}</td></tr>;
        })}</tbody></table>
      <p>Exact copied text only, not a comparison of fields, evidence or facts. Current typed text may be unfinished or invalid; it is not parsed, trimmed or repaired for this overview. Reopen replaces whole slots without merging.</p>
      <PreparationReadingView packet={saved.packet} context={context} prefix={`${prefix}-saved-reading`} />
      {saved.fileJson !== undefined && <button type="button" disabled={!admitted} onClick={reopenReadFile}>Reopen read preparation packet</button>}
    </section> : <p role="status">Saved preparation reading held. Check the exact saved format, current captured binding and 128 KiB limit. Typed parts and pasted text are preserved; no partial saved dossier is shown.</p>)}
    <label htmlFor={`${prefix}-packet-file`}>Open exact local preparation packet file</label>
    <input id={`${prefix}-packet-file`} type="file" accept="application/json,.json" disabled={!admitted || reading} onChange={chooseFile} />
    <p>The file is read locally, up to 128 KiB of exact UTF-8. Nothing is uploaded or added to an archive. Filenames are not displayed. Held files preserve the typed preparations.</p>
    <label htmlFor={`${prefix}-packet-read-file`}>Read exact local preparation packet file without replacing typed parts</label>
    <input id={`${prefix}-packet-read-file`} type="file" accept="application/json,.json" disabled={!admitted || reading} onChange={event => chooseFile(event, "read")} />
    <p>This separate read-only choice preserves your typed parts and pasted text. Inspect the saved copy and replacement overview before deciding whether to reopen it. Both file selectors wait for any earlier physical read to settle.</p>
    {reading && <p role="status">A local file read still owns its physical slot. Another file read cannot start until it settles; editing retires its result.</p>}
    {fileNotice?.key === key && (fileNotice.status !== "read" || saved?.fileJson !== undefined) && <p role="status">{fileNotice.status === "waiting"
      ? admitted ? "This file selection did not start because another local packet read owned the slot. Select the file again explicitly after settlement."
        : "A previous local packet read is still settling. Wait for settlement, then select the file again explicitly."
      : fileNotice.status === "held" ? "Local packet file held. Check the exact UTF-8 format, captured binding and 128 KiB limit. Typed preparations are preserved."
      : fileNotice.status === "loaded" ? "Exact local preparation packet checked. The editing material is unauthenticated and unsent."
      : fileNotice.status === "read" ? "Saved local packet checked for private reading. Typed parts and pasted text are preserved; the copy remains unauthenticated and unsent."
      : "Reading a local private preparation packet."}</p>}
  </details>;
}
