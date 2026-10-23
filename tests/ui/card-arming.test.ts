import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_ARM_RATIO, CARD_RELEASE_RATIO, MAX_PLAYING_CARDS, createArmingPool, observeCardArming, pickArmed } from '@/lib/media/card-arming';

/**
 * iPhone Safari caps concurrent media decoders, so a rail that arms every card it passes and never
 * releases one starves the cards further down. These assert the release half of the contract.
 */

let emit: (ratio: number) => void;
let disconnect: ReturnType<typeof vi.fn>;
let thresholds: number[] | undefined;
/** Every observer this test created, in order, so a test can drive more than one card. */
let emitters: Array<(ratio: number) => void> = [];

beforeEach(() => {
  disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        thresholds = options?.threshold as number[] | undefined;
        emit = ratio =>
          callback(
            [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        emitters.push(emit);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  emitters = [];
});

function setup() {
  const setArmed = vi.fn();
  const stop = observeCardArming({} as Element, setArmed, { pool: createArmingPool() });
  return { setArmed, stop };
}

describe('catalog card arming (touch tier)', () => {
  it('arms once the card is deliberately on screen', () => {
    const { setArmed } = setup();
    emit(CARD_ARM_RATIO);
    expect(setArmed).toHaveBeenCalledWith(true);
  });

  it('releases the decoder when the card scrolls away', () => {
    const { setArmed } = setup();
    emit(1);
    setArmed.mockClear();
    emit(0);
    expect(setArmed).toHaveBeenCalledWith(false);
  });

  it('keeps observing after the first arm, so a rail can arm the same card twice', () => {
    const { setArmed } = setup();
    emit(1);
    emit(0);
    emit(1);
    expect(disconnect).not.toHaveBeenCalled();
    expect(setArmed.mock.calls.map(([armed]) => armed)).toEqual([true, false, true]);
  });

  it('holds its state in the hysteresis band rather than thrashing on the boundary', () => {
    const { setArmed } = setup();
    emit(1);
    setArmed.mockClear();
    emit((CARD_ARM_RATIO + CARD_RELEASE_RATIO) / 2);
    expect(setArmed).not.toHaveBeenCalled();
    expect(CARD_RELEASE_RATIO).toBeLessThan(CARD_ARM_RATIO);
    expect(thresholds).toEqual([CARD_RELEASE_RATIO, CARD_ARM_RATIO]);
  });

  it('stops observing when the card unmounts', () => {
    const { stop } = setup();
    stop();
    expect(disconnect).toHaveBeenCalled();
  });
});

/** A card at a given distance below the viewport's centre (the window is stubbed 1280×800). */
function cardAt(offsetY: number): Element {
  return { getBoundingClientRect: () => ({ left: 540, width: 200, top: 400 + offsetY - 125, height: 250 }) } as unknown as Element;
}

describe('the desktop cap (at most four clips on screen at once)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      innerWidth: 1280,
      innerHeight: 800,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: (callback: () => void) => { callback(); return 1; },
      cancelAnimationFrame: vi.fn(),
    });
  });

  it('ranks pinned cards first, then the ones nearest the centre', () => {
    expect([...pickArmed([{ distance: 50, pinned: false }, { distance: 10, pinned: false }, { distance: 900, pinned: true }], 2)].sort()).toEqual([1, 2]);
    expect(pickArmed([], 4).size).toBe(0);
    expect(MAX_PLAYING_CARDS).toBe(4);
  });

  it('plays only the four nearest the centre when six are visible', () => {
    const pool = createArmingPool();
    const offsets = [300, -20, 500, 40, -260, 120];
    const cards = offsets.map((offset) => {
      const setArmed = vi.fn();
      observeCardArming(cardAt(offset), setArmed, { pool });
      return setArmed;
    });
    for (const fire of emitters) fire(1);
    const armed = cards.map((setArmed) => setArmed.mock.calls.at(-1)?.[0] === true);
    expect(armed.filter(Boolean)).toHaveLength(4);
    // −20, 40, 120 and −260 are nearest; 300 and 500 wait on their posters.
    expect(armed).toEqual([false, true, false, true, true, true]);
  });

  it('hands a slot on when a playing card scrolls away, and keeps a card the reader pressed play on', () => {
    const pool = createArmingPool();
    let pinned = false;
    const far = vi.fn();
    const cards = [-20, 40, 120, -200].map((offset) => {
      const setArmed = vi.fn();
      observeCardArming(cardAt(offset), setArmed, { pool });
      return setArmed;
    });
    observeCardArming(cardAt(390), far, { pool, pinned: () => pinned });
    for (const fire of emitters) fire(1);
    expect(far).not.toHaveBeenCalledWith(true);

    emitters[0]!(0); // the nearest card leaves the screen: the waiting one takes its slot
    expect(cards[0]).toHaveBeenLastCalledWith(false);
    expect(far).toHaveBeenLastCalledWith(true);

    emitters[0]!(1); // it comes back nearer than the far card, which the reader has now pressed play on
    pinned = true;
    pool.rebalance();
    expect(far).toHaveBeenLastCalledWith(true);
    expect(cards.map((setArmed) => setArmed.mock.calls.at(-1)?.[0]).filter((armed) => armed === true)).toHaveLength(3);
  });

  it('gives the slot back when a card unmounts', () => {
    const pool = createArmingPool();
    const stops: Array<() => void> = [];
    const cards = [0, 10, 20, 30, 40].map((offset) => {
      const setArmed = vi.fn();
      stops.push(observeCardArming(cardAt(offset), setArmed, { pool }));
      return setArmed;
    });
    for (const fire of emitters) fire(1);
    expect(cards[4]).not.toHaveBeenCalledWith(true);
    stops[0]!();
    expect(cards[4]).toHaveBeenLastCalledWith(true);
  });
});
