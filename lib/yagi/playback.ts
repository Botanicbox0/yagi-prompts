/** A pause can abort a pending play; only genuine playback refusals need retry feedback. */
export async function playFilm(video: Pick<HTMLMediaElement, 'play'>, onFailure: () => void): Promise<void> {
  try { await video.play(); }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    onFailure();
  }
}
