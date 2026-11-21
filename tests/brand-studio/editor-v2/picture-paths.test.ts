import { describe, expect, it } from 'vitest';
import { MAX_LIVE_SESSIONS, PicturePaths, type DecoderSession, type FrameAsk, type PathDeps } from '@/lib/brand-studio/editor-v2/picture-paths';

/**
 * Spec G, B10 (a) and B2: the path for each film frame, with the picture getters given. A decoder error in
 * the middle of a source hands the rest of it to seeking and every film frame is written exactly once; a
 * session is closed after its source's last frame; at most four decoders are open at once.
 */
class FakeSession implements DecoderSession<string> {
  live = false;
  closed = false;
  suspended = 0;
  opened = 0;
  constructor(
    readonly name: string,
    private readonly failAt: number | null = null,
  ) {}
  async picture(frame: number) {
    if (this.closed) throw new Error('closed');
    if (frame === this.failAt) throw new Error('decoder error');
    if (!this.live) {
      this.live = true;
      this.opened += 1;
    }
    return { picture: `${this.name}:decoder:${frame}`, past: false };
  }
  suspend() {
    this.live = false;
    this.suspended += 1;
  }
  close() {
    this.live = false;
    this.closed = true;
  }
  stats() {
    return { bytesRead: 10, fileBytes: 100, requests: 1, reopened: Math.max(0, this.opened - 1), reclaimed: 0 };
  }
}

function film(sources: string[], each: number): FrameAsk[] {
  return sources.flatMap((srcUrl, cut) => Array.from({ length: each }, (_, k) => ({ frame: cut * each + k, srcUrl, sourceFrame: k })));
}

function harness(plan: FrameAsk[], sessions: Record<string, FakeSession | { reason: string }>) {
  const released: string[] = [];
  const deps: PathDeps<string> = {
    decoder: (srcUrl) => sessions[srcUrl]!,
    seek: async (entry) => ({ picture: `${entry.srcUrl}:seek:${entry.frame}`, past: false }),
    releaseSeek: (srcUrl) => released.push(srcUrl),
    cancelled: () => false,
  };
  return { paths: new PicturePaths(plan, deps), released };
}

/** The export loop: each film frame asked once, written, then marked done. */
async function exportAll(plan: FrameAsk[], paths: PicturePaths<string>) {
  const written: string[] = [];
  for (const entry of plan) {
    written.push((await paths.picture(entry, entry.srcUrl)).picture);
    paths.done(entry.frame);
  }
  return written;
}

describe('a decoder error in the middle of a source', () => {
  it('the rest of that source is seeked; every film frame is written exactly once, in order; other sources stay on the decoder', async () => {
    const plan = film(['a', 'b'], 6);
    const a = new FakeSession('a', 3);
    const b = new FakeSession('b');
    const { paths } = harness(plan, { a, b });
    const written = await exportAll(plan, paths);
    expect(written).toEqual(['a:decoder:0', 'a:decoder:1', 'a:decoder:2', 'a:seek:3', 'a:seek:4', 'a:seek:5', 'b:decoder:6', 'b:decoder:7', 'b:decoder:8', 'b:decoder:9', 'b:decoder:10', 'b:decoder:11']);
    const records = paths.paths();
    expect(records[0]).toMatchObject({ srcUrl: 'a', decoded: 3, seeked: 3, path: 'seek', reason: 'error: decoder error' });
    expect(records[1]).toMatchObject({ srcUrl: 'b', decoded: 6, seeked: 0, path: 'decoder', reason: null });
    expect(a.closed).toBe(true);
  });

  it('a source that cannot be decoded is seeked from its first frame, with its reason', async () => {
    const plan = film(['a'], 3);
    const { paths } = harness(plan, { a: { reason: 'colour' } });
    expect(await exportAll(plan, paths)).toEqual(['a:seek:0', 'a:seek:1', 'a:seek:2']);
    expect(paths.paths()[0]).toMatchObject({ path: 'seek', reason: 'colour', seeked: 3, decoded: 0 });
  });
});

describe('B2: sessions are let go when their source is done, and no more than four are open', () => {
  it('closed after the source’s last film frame, not at the end of the export', async () => {
    const plan = film(['a', 'b'], 3);
    const a = new FakeSession('a');
    const b = new FakeSession('b');
    const { paths } = harness(plan, { a, b });
    for (const entry of plan.slice(0, 3)) {
      await paths.picture(entry, entry.srcUrl);
      paths.done(entry.frame);
    }
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(false);
    // Its numbers were kept before it closed.
    expect(paths.paths()[0]).toMatchObject({ bytesRead: 10, fileBytes: 100, requests: 1 });
  });

  it('a cut that comes back to a source keeps its session until the source’s very last frame', async () => {
    const plan: FrameAsk[] = [
      { frame: 0, srcUrl: 'a', sourceFrame: 0 },
      { frame: 1, srcUrl: 'b', sourceFrame: 0 },
      { frame: 2, srcUrl: 'a', sourceFrame: 1 },
    ];
    const a = new FakeSession('a');
    const { paths } = harness(plan, { a, b: new FakeSession('b') });
    await paths.picture(plan[0]!, 'a');
    paths.done(0);
    expect(a.closed).toBe(false);
    await paths.picture(plan[1]!, 'b');
    paths.done(1);
    await paths.picture(plan[2]!, 'a');
    paths.done(2);
    expect(a.closed).toBe(true);
  });

  it(`five sources taking turns: never more than ${MAX_LIVE_SESSIONS} decoders open; the one used longest ago is let go and made again`, async () => {
    const names = ['a', 'b', 'c', 'd', 'e'];
    const plan: FrameAsk[] = [];
    for (let round = 0; round < 3; round += 1) for (const name of names) plan.push({ frame: plan.length, srcUrl: name, sourceFrame: round });
    const sessions = Object.fromEntries(names.map((name) => [name, new FakeSession(name)]));
    const { paths } = harness(plan, sessions);
    let most = 0;
    for (const entry of plan) {
      await paths.picture(entry, entry.srcUrl);
      most = Math.max(most, paths.liveSessions());
      paths.done(entry.frame);
    }
    expect(most).toBe(MAX_LIVE_SESSIONS);
    expect(sessions.a!.suspended).toBeGreaterThanOrEqual(1);
    expect(sessions.a!.opened).toBeGreaterThanOrEqual(2);
    expect(paths.paths()[0]!.reopened).toBeGreaterThanOrEqual(1);
    expect(Object.values(sessions).every((session) => session.closed)).toBe(true);
  });

  it('a seeked source is released after its last frame too', async () => {
    const plan = film(['a', 'b'], 2);
    const { paths, released } = harness(plan, { a: { reason: 'forced' }, b: new FakeSession('b') });
    await exportAll(plan, paths);
    expect(released).toEqual(['a']);
  });

  it('closeAll lets go of everything (cancel, restart)', async () => {
    const plan = film(['a', 'b'], 3);
    const a = new FakeSession('a');
    const { paths, released } = harness(plan, { a, b: { reason: 'forced' } });
    await paths.picture(plan[0]!, 'a');
    await paths.picture(plan[3]!, 'b');
    paths.closeAll();
    expect(a.closed).toBe(true);
    expect(released).toEqual(['b']);
  });
});

describe('the export uses these paths', () => {
  it('every picture through PicturePaths; each frame marked done after its encode; everything let go when the pass ends', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const film = readFileSync(join(process.cwd(), 'components/brand-studio/editor-v2/export-film.ts'), 'utf8');
    const pass = film.slice(film.indexOf('async function videoPass('));
    expect(pass).toMatch(/new PicturePaths<Picture, PlannedFrame>\(plan,/);
    expect(pass.indexOf('paths.done(entry.frame)')).toBeGreaterThan(pass.indexOf('made.encode(frame'));
    expect(pass).toMatch(/\} finally \{[\s\S]*paths\.closeAll\(\);/);
  });
});
