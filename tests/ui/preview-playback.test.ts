import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observePreviewPlayback } from '@/lib/media/preview-playback';

class Signals {
  listeners = new Map<string, Set<() => void>>();
  addEventListener(name: string, listener: () => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(listener);
  }
  removeEventListener(name: string, listener: () => void) {
    this.listeners.get(name)?.delete(listener);
  }
  emit(name: string) { this.listeners.get(name)?.forEach(listener => listener()); }
}

let motion: Signals & { matches: boolean };
let connection: Signals & { saveData: boolean; effectiveType: string };
let page: Signals & { hidden: boolean };
let intersect: (visible: boolean) => void;
let disconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  motion = Object.assign(new Signals(), { matches: false });
  connection = Object.assign(new Signals(), { saveData: false, effectiveType: '4g' });
  page = Object.assign(new Signals(), { hidden: false });
  disconnect = vi.fn();
  vi.stubGlobal('window', { matchMedia: () => motion });
  vi.stubGlobal('document', page);
  vi.stubGlobal('navigator', { connection });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      intersect = visible => callback([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect = disconnect;
  });
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const video = {
    paused: true,
    play: vi.fn(async () => { video.paused = false; }),
    pause: vi.fn(() => { video.paused = true; }),
  };
  const playback = observePreviewPlayback(video as unknown as HTMLVideoElement, {} as Element);
  return { video, playback };
}

describe('creator preview playback', () => {
  it('plays on visibility without requiring a hover and pauses offscreen', async () => {
    const { video } = setup();
    expect(video.play).not.toHaveBeenCalled();
    intersect(true);
    await Promise.resolve();
    expect(video.paused).toBe(false);
    intersect(false);
    expect(video.paused).toBe(true);
    intersect(true);
    await Promise.resolve();
    expect(video.paused).toBe(false);
  });

  it('pauses in a hidden tab and resumes only when the preview is still visible', () => {
    const { video } = setup();
    intersect(true);
    page.hidden = true;
    page.emit('visibilitychange');
    expect(video.paused).toBe(true);
    intersect(false);
    page.hidden = false;
    page.emit('visibilitychange');
    expect(video.paused).toBe(true);
    intersect(true);
    expect(video.paused).toBe(false);
  });

  it('keeps an explicit pause through scrolling and tab switches until the user plays again', () => {
    const { video, playback } = setup();
    intersect(true);
    playback.toggle();
    expect(video.paused).toBe(true);
    intersect(false);
    intersect(true);
    page.hidden = true;
    page.emit('visibilitychange');
    page.hidden = false;
    page.emit('visibilitychange');
    expect(video.paused).toBe(true);
    playback.toggle();
    expect(video.paused).toBe(false);
  });

  it.each(['motion', 'save-data', 'slow-2g', '2g'])('waits for a play gesture under %s', preference => {
    if (preference === 'motion') motion.matches = true;
    else if (preference === 'save-data') connection.saveData = true;
    else connection.effectiveType = preference;
    const { video, playback } = setup();
    intersect(true);
    expect(video.play).not.toHaveBeenCalled();
    playback.toggle();
    expect(video.paused).toBe(false);
    intersect(false);
    expect(video.paused).toBe(true);
  });

  it('responds when motion and data preferences change during playback', () => {
    const { video } = setup();
    intersect(true);
    motion.matches = true;
    motion.emit('change');
    expect(video.paused).toBe(true);
    motion.matches = false;
    motion.emit('change');
    expect(video.paused).toBe(false);
    connection.saveData = true;
    connection.emit('change');
    expect(video.paused).toBe(true);
  });

  it('handles browser autoplay rejection and allows a later manual retry', async () => {
    const { video, playback } = setup();
    video.play.mockRejectedValueOnce(new Error('autoplay blocked'));
    intersect(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(video.paused).toBe(true);
    playback.toggle();
    expect(video.paused).toBe(false);
  });

  it('disconnects observers and pauses even if a pending play resolves after disposal', async () => {
    const { video, playback } = setup();
    let finish!: () => void;
    video.play.mockImplementationOnce(() => new Promise<void>(resolve => {
      finish = () => { video.paused = false; resolve(); };
    }));
    intersect(true);
    playback.dispose();
    finish();
    await Promise.resolve();
    expect(video.paused).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(page.listeners.get('visibilitychange')?.size).toBe(0);
    expect(motion.listeners.get('change')?.size).toBe(0);
    expect(connection.listeners.get('change')?.size).toBe(0);
  });
});
