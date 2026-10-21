/**
 * Touch-tier arming for catalog card previews.
 *
 * The pointer tier disarms on `pointerleave`, so a 40-card wall never has more than one clip
 * decoding. The touch tier had no matching release: it armed on the first intersection and
 * disconnected, so every card the reader scrolled past kept a live `<video>` for the rest of the
 * session. iPhone Safari caps how many media elements may hold a decoder at once, which turned a
 * long rail into a race the later cards lose — the clip stays on its poster and never starts
 * (founder report 2026-10-21, "아래 템플릿 카드 영상이 모바일에서 안 보인다"; intermittent, because
 * whether a card wins the cap depends on how far the reader scrolled first).
 *
 * Arming and release use different ratios so a card resting on the boundary does not mount and
 * unmount on every scroll frame.
 */

/** Scrolled to deliberately — the touch equivalent of a hover. */
export const CARD_ARM_RATIO = 0.6;
/** Mostly gone: give the decoder back before the next card needs one. */
export const CARD_RELEASE_RATIO = 0.25;

export function observeCardArming(root: Element, setArmed: (armed: boolean) => void) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= CARD_ARM_RATIO) setArmed(true);
        else if (entry.intersectionRatio < CARD_RELEASE_RATIO) setArmed(false);
      }
    },
    { threshold: [CARD_RELEASE_RATIO, CARD_ARM_RATIO] },
  );
  observer.observe(root);
  return () => observer.disconnect();
}
