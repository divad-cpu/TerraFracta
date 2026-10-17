export type PreparationInputIntents = { epoch: number; controls: Map<string, object> };

// One token per live control, scoped to an owned input epoch. Retire before
// consulting event getters; independent controls can still merge in a batch.
export function preparationInputIntent(ref: { current: PreparationInputIntents }, epoch: number,
  control: string, current: () => boolean): (() => boolean) | null {
  if (!current()) return null;
  if (ref.current.epoch !== epoch) ref.current = { epoch, controls: new Map() };
  const state = ref.current, token = {};
  state.controls.set(control, token);
  return () => current() && ref.current === state && state.controls.get(control) === token;
}
