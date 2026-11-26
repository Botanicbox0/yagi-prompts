/**
 * The prompt guard's proof table (docs/PROMPT-GUARD.md "The proof harness"): every row of rows.ts, every
 * case, every fake model answer of leaks.ts, in `enforce` and `observe`. (`off` is
 * reference-sites-off.test.ts: the bytes origin/main sent and answered.)
 *
 *   enforce: nothing that leaves carries the canary or an 8-word window of the internal text beyond what the
 *            site's own fallback already showed, and the site answers exactly that fallback;
 *   observe: a leak that reached the customer on origin/main still does, with one log line per refusal; the
 *            canary is stopped all the same;
 *   every mode: the benign answer passes untouched, with no log line.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuardLogLine } from '@/lib/ai-guard';
import { ANSWER_KINDS, canaryOf, emptyNotesFetch, failingSiteFetch, fixedAnswerFetch, leakAnswer, leakingFetch, systemOf, type AnswerKind } from './leaks';
import { isSiteCall, type ReferenceCase } from './reference-cases';
import { ROWS, type GuardRow, type SiteOutcome } from './rows';

const ENV = { GEMINI_API_KEY: 'test-key' } as const;

let logs: GuardLogLine[] = [];
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logs = [];
  warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    const first = String(args[0] ?? '');
    if (first.startsWith('[prompt-guard] ')) logs.push(JSON.parse(first.slice('[prompt-guard] '.length)) as GuardLogLine);
  });
});
afterEach(() => {
  warn.mockRestore();
});

/** Plain word 8-grams, independent of the guard's own reading of text. */
function grams8(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + 8 <= words.length; i += 1) out.add(words.slice(i, i + 8).join(' '));
  return out;
}

/** What origin/main answered for this case and answer (reference-sites-off.test.ts snapshot). */
function offSource(c: ReferenceCase, kind: AnswerKind): string {
  const snap = JSON.parse(readFileSync(new URL(`./__snapshots__/off/${c.id}.json`, import.meta.url), 'utf8')) as Record<string, { result: { source: string } }>;
  return snap[kind]!.result.source;
}

async function run(row: GuardRow, c: ReferenceCase, mode: string, fetchOf: () => { calls: Array<{ body: string }>; fetchImpl: typeof fetch }) {
  const { calls, fetchImpl } = fetchOf();
  const outcome = await row.run(c, { ...ENV, PROMPT_GUARD: mode }, fetchImpl);
  const site = calls.find((call) => isSiteCall(call.body));
  return { outcome, system: site ? systemOf(site.body) : '' };
}

const TABLE = ROWS.flatMap((row) => row.cases.filter((c) => !c.noCall).map((c) => [row.site, c.id, row, c] as const));

describe.each(TABLE)('%s · %s', (_site, _id, row, c) => {
  it('every mode: the benign answer passes untouched, with no log line', async () => {
    const reference = await run(row, c, 'off', () => leakingFetch('benign', c));
    for (const mode of ['observe', 'enforce']) {
      logs = [];
      const guarded = await run(row, c, mode, () => leakingFetch('benign', c));
      expect(guarded.outcome.answer, mode).toEqual(reference.outcome.answer);
      expect(guarded.outcome.source).toBe('model');
      expect(logs, mode).toEqual([]);
    }
  });

  /**
   * The internal text's 8-word windows in what leaves, beyond those the site shows anyway: its own fallback,
   * and its answer to a well-behaved model (the phrases its rules ask the model to write).
   */
  async function leakedWindows(mode: string, outcome: SiteOutcome, system: string): Promise<string[]> {
    const fallback = (await run(row, c, mode, () => failingSiteFetch())).outcome;
    const benign = (await run(row, c, mode, () => leakingFetch('benign', c))).outcome;
    const anyway = grams8([...Object.values(fallback.shown), ...Object.values(benign.shown)].join('\n'));
    const internal = grams8(system);
    return [...grams8(Object.values(outcome.shown).join('\n'))].filter((g) => internal.has(g) && !anyway.has(g));
  }

  it('enforce: no canary and no 8-word window of the internal text leaves; the site answers its own fallback', async () => {
    const fallback = (await run(row, c, 'enforce', () => failingSiteFetch())).outcome;
    const defaultNotes = (await run(row, c, 'enforce', () => emptyNotesFetch(c))).outcome;
    const benign = (await run(row, c, 'enforce', () => leakingFetch('benign', c))).outcome;
    for (const kind of ANSWER_KINDS.filter((k) => k !== 'benign')) {
      logs = [];
      const { outcome, system } = await run(row, c, 'enforce', () => leakingFetch(kind, c));
      const canary = canaryOf(system);
      expect(canary, 'the guarded request carries a canary').not.toBe('pgcnocanarywasinthisrequest');
      expect(Object.values(outcome.shown).join('\n').includes(canary), `${kind}: canary`).toBe(false);
      expect(await leakedWindows('enforce', outcome, system), `${kind}: internal 8-word windows`).toEqual([]);
      if (kind === 'notes8') {
        // Only the note can leak: the prompt goes out as the benign one; a refused note is the site's default note.
        expect((outcome.answer as { prompt: string }).prompt).toBe((benign.answer as { prompt: string }).prompt);
        if (logs.some((l) => l.field === 'notes')) expect((outcome.answer as { notes: string }).notes).toBe((defaultNotes.answer as { notes: string }).notes);
      } else {
        expect(outcome.answer, `${kind}: the site's own fallback`).toEqual(fallback.answer);
      }
      for (const line of logs) expect(row.logSites).toContain(line.site);
    }
  });

  it('observe: an answer goes out exactly as with the guard off, with a log line for a leak; only the canary is stopped', async () => {
    const fallback = (await run(row, c, 'observe', () => failingSiteFetch())).outcome;
    for (const kind of ANSWER_KINDS.filter((k) => k !== 'benign')) {
      logs = [];
      const { outcome, system } = await run(row, c, 'observe', () => leakingFetch(kind, c));
      const answer = leakAnswer(kind, system, c.benign);
      const canary = canaryOf(system);
      // The same answer with the guard off.
      const off = await row.run(c, { ...ENV, PROMPT_GUARD: 'off' }, fixedAnswerFetch(answer).fetchImpl);
      if (JSON.stringify(answer).includes(canary)) {
        // The canary (the `canary` answer, and `full`, which copies the whole system part) never goes out ...
        expect(Object.values(outcome.shown).join('\n').includes(canary), kind).toBe(false);
        expect(outcome.answer, kind).toEqual(fallback.answer);
        // ... and where only the guard stopped it, the log says so.
        if (off.source === 'model') expect(logs, kind).toContainEqual(expect.objectContaining({ mode: 'observe', action: 'fallback', reason: 'canary' }));
        continue;
      }
      // Without the canary, observe changes nothing about the answer.
      expect(outcome.answer, kind).toEqual(off.answer);
      if (offSource(c, kind) === 'model' && outcome.source !== 'model') {
        // Only a site's own check (on a window that differs with the guard's longer system part) may stop it.
        expect(logs.filter((l) => l.action === 'fallback'), kind).toEqual([]);
      }
      if ((await leakedWindows('observe', outcome, system)).length > 0) {
        // Every leak that goes out is in the log.
        expect(logs.length, `${kind}: log lines`).toBeGreaterThan(0);
        for (const line of logs) expect(line).toMatchObject({ mode: 'observe', action: 'observed' });
      }
      for (const line of logs) {
        expect(row.logSites).toContain(line.site);
        // Codes and numbers only: never a word of the answer.
        expect(JSON.stringify(line)).not.toMatch(/[가-힣]|\b(?:bottle|camera|reference|visual|audio)\b/i);
      }
    }
  });
});

describe('the table covers every adopted site and every answer kind', () => {
  it('has one row per adopted site, each with cases, and the six leaks plus the benign control', () => {
    expect(ROWS.map((r) => r.site)).toEqual(['brand-studio.enhancer', 'brand-studio.director']);
    for (const row of ROWS) expect(row.cases.length).toBeGreaterThan(0);
    expect([...ANSWER_KINDS]).toEqual(['benign', 'full', 'window60', 'canary', 'reordered8', 'base64', 'notes8']);
  });
});


describe('a leak in the short note field (an English note passes the sites\' own one-sentence cleaning)', () => {
  const enImage: ReferenceCase = {
    id: 'enhancer-image-en-notes',
    site: 'brand-studio.enhancer',
    input: { kind: 'image', profile: 'seedream', locale: 'en', prompt: 'A perfume bottle on white marble QXPROMPT', references: [], brand: null, video: null },
    benign: 'A frosted perfume bottle stands upright on white marble in soft morning light from the left, a clean product photo for a feed post.',
  };
  const cases = [
    [ROWS[0]!, enImage],
    [ROWS[1]!, ROWS[1]!.cases.find((c) => c.id === 'director-analyzer-live')!],
  ] as const;

  /** A 9-word window of the internal text, as one clean sentence, none of it in `avoid` (what the site shows anyway). */
  function noteLeakFetch(c: ReferenceCase, avoid: string) {
    const avoided = new Set<string>();
    const aw = avoid.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    for (let i = 0; i + 4 <= aw.length; i += 1) avoided.add(aw.slice(i, i + 4).join(' '));
    return () => {
      let system = '';
      const recorded = fixedAnswerFetch({ prompt: c.benign, notes: '' });
      const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body ?? '');
        if (!isSiteCall(body)) return recorded.fetchImpl(url, init);
        system = systemOf(body);
        const w = system.split(/\s+/).filter((x) => /^[A-Za-z]+[,.;:]?$/.test(x)).map((x) => x.replace(/[,.;:]$/, ''));
        let from = Math.floor(w.length / 3);
        const clean = (at: number) => {
          const win = w.slice(at, at + 9).map((x) => x.toLowerCase());
          for (let i = 0; i + 4 <= win.length; i += 1) if (avoided.has(win.slice(i, i + 4).join(' '))) return false;
          return win.length === 9;
        };
        while (from + 9 < w.length && !clean(from)) from += 1;
        const note = `${w.slice(from, from + 9).join(' ')}.`;
        recorded.calls.push({ url: String(url), body });
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ prompt: c.benign, notes: note }) }] } }] }), { status: 200 });
      }) as typeof fetch;
      return { calls: recorded.calls, fetchImpl, system: () => system };
    };
  }

  it.each(cases.map(([row, c]) => [c.id, row, c] as const))('%s: enforce answers the default note, observe lets it through; both log it', async (_id, row, c) => {
    const defaultNotes = (await run(row, c, 'enforce', () => emptyNotesFetch(c))).outcome.answer as { notes: string };
    const benign = (await run(row, c, 'enforce', () => leakingFetch('benign', c))).outcome.answer as { prompt: string };
    const fallback = (await run(row, c, 'enforce', () => failingSiteFetch())).outcome.answer as { prompt: string };
    const avoid = `${fallback.prompt}
${benign.prompt}`;

    logs = [];
    const enforced = (await run(row, c, 'enforce', noteLeakFetch(c, avoid))).outcome.answer as { prompt: string; notes: string };
    expect(enforced.prompt).toBe(benign.prompt);
    expect(enforced.notes).toBe(defaultNotes.notes);
    expect(logs).toEqual([expect.objectContaining({ mode: 'enforce', action: 'fallback', field: 'notes', reason: 'overlap_run' })]);

    logs = [];
    const observed = (await run(row, c, 'observe', noteLeakFetch(c, avoid))).outcome.answer as { prompt: string; notes: string };
    expect(observed.prompt).toBe(benign.prompt);
    expect(observed.notes).not.toBe(defaultNotes.notes);
    expect(logs).toEqual([expect.objectContaining({ mode: 'observe', action: 'observed', field: 'notes' })]);
  });
});
