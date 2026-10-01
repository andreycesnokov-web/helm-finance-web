// Guards workspace-scoped fetches against out-of-order responses.
//
// The failure it prevents: the user switches from Business A to Business B while A's request
// is still in flight. A's slower response lands last and paints A's documents under B's name.
// That is a data-isolation bug, not a cosmetic one.
//
// Every load calls start(), which bumps a generation counter and aborts the previous request.
// A response is applied only when its generation is still current.
//
// Kept as a plain module (no JSX) so the logic is unit-testable without a React renderer.

export function createRequestGuard() {
  let generation = 0
  let controller = null

  const newController = () => (typeof AbortController !== 'undefined' ? new AbortController() : null)

  return {
    /**
     * Begin a new load. Aborts whatever was in flight and returns:
     *   { gen, signal, isStale() } — pass `signal` to fetch/apiFetch, and check `isStale()`
     *   before applying any result.
     */
    start() {
      generation += 1
      if (controller) { try { controller.abort() } catch { /* already settled */ } }
      controller = newController()
      const gen = generation
      return {
        gen,
        signal: controller ? controller.signal : undefined,
        isStale: () => gen !== generation,
      }
    },

    /** Invalidate everything in flight (e.g. on unmount or workspace switch). */
    abort() {
      generation += 1
      if (controller) { try { controller.abort() } catch { /* already settled */ } }
      controller = null
    },

    /** True when this generation has been superseded. */
    isStale(gen) { return gen !== generation },

    get generation() { return generation },
  }
}
