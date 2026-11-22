/** Spec I, G4: counts the `abort` listeners a signal holds, for the tests that check reads let go of them. */

/** The `abort` listeners a signal holds now (adds minus removes, by listener). */
export function abortListeners(signal: AbortSignal): () => number {
  const live = new Set<unknown>();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => {
    if (type === 'abort') live.add(listener);
    add(type, listener, options);
  }) as AbortSignal['addEventListener'];
  signal.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: EventListenerOptions | boolean) => {
    if (type === 'abort') live.delete(listener);
    remove(type, listener, options);
  }) as AbortSignal['removeEventListener'];
  return () => live.size;
}
