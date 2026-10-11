// Preserve one request's native elapsed clock history across existing fences.
// Invalid or backward observations cannot renew its original read interval.
export function createElapsedReadClock(now: () => number, began: number): () => number {
  let previous = began;
  let refused = !Number.isFinite(began);
  return () => {
    const tick = now();
    if (refused || !Number.isFinite(tick) || tick < previous) {
      refused = true;
      return Infinity;
    }
    previous = tick;
    return tick - began;
  };
}
