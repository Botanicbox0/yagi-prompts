import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_ARM_RATIO, CARD_RELEASE_RATIO, observeCardArming } from '@/lib/media/card-arming';

/**
 * iPhone Safari caps concurrent media decoders, so a rail that arms every card it passes and never
 * releases one starves the cards further down. These assert the release half of the contract.
 */

let emit: (ratio: number) => void;
let disconnect: ReturnType<typeof vi.fn>;
let thresholds: number[] | undefined;

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
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const setArmed = vi.fn();
  const stop = observeCardArming({} as Element, setArmed);
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
