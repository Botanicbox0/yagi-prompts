type Connection = EventTarget & { saveData?: boolean; effectiveType?: string };

/** A visible preview plays by default; a visitor's pause always wins over scroll and tab events. */
export function observePreviewPlayback(video: HTMLVideoElement, root: Element) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  let visible = false;
  let userPaused = false;
  let userRequested = false;
  let disposed = false;

  const shouldPlay = () => !disposed && visible && !document.hidden && !userPaused && (
    userRequested || (!motion.matches && !connection?.saveData &&
      connection?.effectiveType !== 'slow-2g' && connection?.effectiveType !== '2g')
  );
  const play = () => {
    void video.play().then(() => {
      // A play request can finish after the visitor has scrolled away or paused it.
      if (!shouldPlay()) video.pause();
    }).catch(() => undefined);
  };
  const synchronize = () => {
    if (shouldPlay()) play();
    else video.pause();
  };
  const updatePreferences = () => {
    userRequested = false;
    synchronize();
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.35);
    synchronize();
  }, { threshold: [0, 0.35] });
  observer.observe(root);
  document.addEventListener('visibilitychange', synchronize);
  motion.addEventListener('change', updatePreferences);
  connection?.addEventListener('change', updatePreferences);

  return {
    toggle() {
      userPaused = !video.paused;
      userRequested = video.paused;
      synchronize();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', synchronize);
      motion.removeEventListener('change', updatePreferences);
      connection?.removeEventListener('change', updatePreferences);
      video.pause();
    },
  };
}
