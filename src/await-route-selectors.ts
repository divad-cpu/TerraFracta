// Await a framework selector port once. A failed read becomes invalid input;
// route-specific admission decides its existing refusal or recovery response.
export async function awaitRouteSelectors(input: unknown, rethrow?: (error: unknown) => void): Promise<Readonly<{ value: unknown }>> {
  // The box prevents async return from assimilating the admitted object again,
  // including a hidden or changing then getter on that object's own boundary.
  const settled = Object.create(null) as { value: unknown };
  try { settled.value = await input; }
  catch (error) {
    // Trusted framework wiring classifies its own control-flow errors before
    // ordinary selector failures become invalid input. No source error port.
    rethrow?.(error);
    settled.value = null;
  }
  return Object.freeze(settled);
}
