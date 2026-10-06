/** A pause can abort a pending play; only genuine playback refusals need retry feedback. */
export async function playFilm(video: Pick<HTMLMediaElement, 'play'>, onFailure: () => void): Promise<void> {
  try { await video.play(); }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    onFailure();
  }
}

/** Preview is opt-in pointer behaviour; it must never override a visitor's pause or motion preference. */
export function mayPreviewFilm(state: { hoverCapable: boolean; reducedMotion: boolean; hidden: boolean; manuallyPaused: boolean; viewerOpen: boolean }): boolean {
  return state.hoverCapable && !state.reducedMotion && !state.hidden && !state.manuallyPaused && !state.viewerOpen;
}
