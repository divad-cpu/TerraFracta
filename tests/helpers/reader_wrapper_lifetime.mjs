// Fixed single-wrapper lifecycle seam, not a general React scheduler or DOM.
// Preserve one stop ref; run its layout setup before the observed passive setup,
// and retire layout before passive cleanup in the older behavioral witnesses.
export function readerWrapperLifetime(receiveEffect) {
  let ref, layout;
  return {
    useRef(initial) { return ref ??= { current: initial }; },
    useLayoutEffect(callback) { layout = callback; },
    useEffect(callback) {
      const setupLayout = layout;
      receiveEffect(() => {
        const cleanupLayout = setupLayout?.(), cleanupPassive = callback();
        return () => { cleanupLayout?.(); cleanupPassive?.(); };
      });
    },
  };
}
