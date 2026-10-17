"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ConnectedStatusIdentity, ConnectedStatusVerdict } from "../../src/connected-reader-status";
import { startConnectedReaderWatch } from "../../src/connected-reader-watch";
import { readStatusResponse } from "../../src/status-response.ts";

const physicalRead: { current: Promise<void> | null } = { current: null };

export function CurrentConnectedEdition({ expected, children }: { expected: ConnectedStatusIdentity; children: ReactNode }) {
  const [status, setStatus] = useState<ConnectedStatusVerdict>({ kind: "current" });
  const stopWatch = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => { stopWatch.current?.(); }, [expected.generation, expected.executionId, expected.observedAt, expected.state, expected.publicationId]);
  useEffect(() => {
    let active = true;
    const changed = (value: ConnectedStatusVerdict) => { if (active) setStatus(value); };
    const watch = startConnectedReaderWatch(expected, changed, async (identity, signal) => {
        const response = await fetch("/api/dev/connected-reader", {
          headers: { "x-terrafracta-edition": String(identity.generation) },
          cache: "no-store", credentials: "omit", signal,
        });
        return readStatusResponse(response, signal);
      }, { visible: () => document.visibilityState !== "hidden", interval: setInterval, clearInterval,
        timeout: setTimeout, clearTimeout, physical: physicalRead });
    const visible = () => { if (active) void watch.check(); };
    const retire = () => {
      active = false;
      try { watch.stop(); } catch { /* Visibility still has its own retirement. */ }
      try { document.removeEventListener("visibilitychange", visible); } catch { /* Retained events are inactive. */ }
    };
    stopWatch.current = retire;
    try { document.addEventListener("visibilitychange", visible); }
    catch { retire(); setStatus({ kind: "unavailable" }); }
    return () => {
      retire();
      if (stopWatch.current === retire) stopWatch.current = null;
    };
  }, [expected.generation, expected.executionId, expected.observedAt, expected.state, expected.publicationId]);

  if (status.kind === "current") return children;
  return <section className="content-page connected-preview" role="status" aria-live="polite">
    <p className="eyebrow">Local development / Connected update</p>
    <h1>{status.kind === "changed" ? "This update has changed" : "Update temporarily unavailable"}</h1>
    <p>{status.kind === "changed" ? "The earlier claim and source are now withheld. Open the latest edition to see the current update." : "The current edition could not be confirmed. The earlier claim and source are withheld until you reload."}</p>
    <a href="/connected-preview/overview">Open latest edition</a>
  </section>;
}
