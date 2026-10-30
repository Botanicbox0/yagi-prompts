/**
 * Arming for catalog card previews: which cards hold a live `<video>`.
 *
 * Release: the touch tier used to arm on the first intersection and disconnect, so every card the
 * reader scrolled past kept a live `<video>` for the rest of the session. iPhone Safari caps how
 * many media elements may hold a decoder at once, which turned a long rail into a race the later
 * cards lose — the clip stays on its poster and never starts (founder report 2026-10-21, "아래
 * 템플릿 카드 영상이 모바일에서 안 보인다"; intermittent, because whether a card wins the cap
 * depends on how far the reader scrolled first). So a card gives its decoder back on the way out.
 *
 * Cap: a desktop shows the 4:5 grid four across and two or three rows deep, so "every card on
 * screen" was eight to twelve films decoding at once (docs/qa/catalog-wait/PR.md "남은 위험"). The
 * cards on screen now share one pool, and only the `MAX_PLAYING_CARDS` nearest the viewport's
 * centre are armed; the rest keep their poster until scrolling brings them closer. A card the
 * reader pressed play on (`pinned`) takes a slot first — pressing play is their choice, not motion.
 *
 * Arming and release use different ratios so a card resting on the boundary does not mount and
 * unmount on every scroll frame.
 */

/** Scrolled to deliberately — the touch equivalent of a hover. */
export const CARD_ARM_RATIO = 0.6;
/** Mostly gone: give the decoder back before the next card needs one. */
export const CARD_RELEASE_RATIO = 0.25;
/** At most this many card clips decode at once, however many cards fit on the screen. */
export const MAX_PLAYING_CARDS = 2;

export interface ArmingCandidate {
  /** Distance from the card's centre to the viewport's centre, in px. */
  distance: number;
  pinned: boolean;
}

/** Which candidates get a slot: pinned first, then nearest the centre; ties keep their order. */
export function pickArmed(candidates: readonly ArmingCandidate[], max = MAX_PLAYING_CARDS): Set<number> {
  const order = candidates
    .map((candidate, index) => ({ ...candidate, index }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.distance - b.distance || a.index - b.index);
  return new Set(order.slice(0, Math.max(0, max)).map((candidate) => candidate.index));
}

interface Member {
  root: Element;
  setArmed: (armed: boolean) => void;
  pinned: () => boolean;
  visible: boolean;
  armed: boolean;
}

function distanceToCentre(root: Element): number {
  if (typeof window === 'undefined' || typeof root.getBoundingClientRect !== 'function') return 0;
  const rect = root.getBoundingClientRect();
  return Math.hypot(rect.left + rect.width / 2 - window.innerWidth / 2, rect.top + rect.height / 2 - window.innerHeight / 2);
}

export interface ArmingPool {
  join(member: Omit<Member, 'visible' | 'armed'>): { setVisible(visible: boolean): void; leave(): void };
  /** Re-rank the visible cards (the page calls this on scroll; tests call it directly). */
  rebalance(): void;
}

export function createArmingPool(max = MAX_PLAYING_CARDS): ArmingPool {
  const members = new Set<Member>();
  let frame: number | null = null;

  const rebalance = () => {
    frame = null;
    const visible = [...members].filter((member) => member.visible);
    const keep = pickArmed(visible.map((member) => ({ distance: distanceToCentre(member.root), pinned: member.pinned() })), max);
    const armed = new Set(visible.filter((_, index) => keep.has(index)));
    for (const member of members) {
      const next = armed.has(member);
      if (next === member.armed) continue;
      member.armed = next;
      member.setArmed(next);
    }
  };

  // Scrolling moves the centre without crossing an observer threshold: re-rank once per frame,
  // and only while more cards are on screen than there are slots.
  const onScroll = () => {
    if (frame !== null || typeof window === 'undefined') return;
    let visible = 0;
    for (const member of members) if (member.visible) visible += 1;
    if (visible <= max) return;
    frame = window.requestAnimationFrame(rebalance);
  };
  const listen = (on: boolean) => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    if (on) {
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
    } else {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    }
  };

  return {
    join(input) {
      const member: Member = { ...input, visible: false, armed: false };
      members.add(member);
      if (members.size === 1) listen(true);
      return {
        setVisible(visible) {
          if (visible === member.visible) return;
          member.visible = visible;
          rebalance();
        },
        leave() {
          if (!members.delete(member)) return;
          if (members.size === 0) listen(false);
          if (member.armed) rebalance();
        },
      };
    },
    rebalance,
  };
}

/** The one pool every catalog card on the page shares. */
const pagePool = createArmingPool();

/** Re-rank after something `pinned` reads has changed (the pointer moved onto a card). */
export function rebalanceCardArming() {
  pagePool.rebalance();
}

export function observeCardArming(
  root: Element,
  setArmed: (armed: boolean) => void,
  options: { pinned?: () => boolean; pool?: ArmingPool } = {},
) {
  const seat = (options.pool ?? pagePool).join({ root, setArmed, pinned: options.pinned ?? (() => false) });
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= CARD_ARM_RATIO) seat.setVisible(true);
        else if (entry.intersectionRatio < CARD_RELEASE_RATIO) seat.setVisible(false);
      }
    },
    { threshold: [CARD_RELEASE_RATIO, CARD_ARM_RATIO] },
  );
  observer.observe(root);
  return () => {
    observer.disconnect();
    seat.leave();
  };
}
