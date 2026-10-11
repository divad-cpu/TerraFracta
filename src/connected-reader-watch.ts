import { captureConnectedStatusIdentity, interpretConnectedStatus, type ConnectedStatusIdentity, type ConnectedStatusVerdict } from "./connected-reader-status.ts";
import { startReaderWatch, type ReaderWatchControls } from "./reader-watch.ts";

type Transport = (expected: ConnectedStatusIdentity, signal: AbortSignal) => Promise<unknown>;

// Pure lifecycle with injected transport/visibility/timers. It has no source,
// storage, DOM, account or publication authority. Terminal withholding never
// unmasks an old claim based on a later poll; an explicit reload is required.
export function startConnectedReaderWatch(expected: ConnectedStatusIdentity,
  changed: (status: ConnectedStatusVerdict) => void, read: Transport, controls: ReaderWatchControls) {
  const identity = captureConnectedStatusIdentity(expected);
  return startReaderWatch<ConnectedStatusVerdict>(changed, async signal => {
    if (identity === null) return { kind: "unavailable" };
    // The read port owns a request copy, not the watch comparison identity.
    return interpretConnectedStatus(await read({ ...identity }, signal), identity);
  }, controls, () => ({ kind: "unavailable" }));
}
