import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeMock = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), loadPromptBySlug: vi.fn() }));

vi.mock('@/lib/auth/viewer', () => ({ getViewer: routeMock.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: routeMock.sql }));
vi.mock('@/lib/prompts/repo', async (original) => ({
  ...(await original<typeof import('@/lib/prompts/repo')>()),
  loadPromptBySlug: routeMock.loadPromptBySlug,
}));

import { POST } from '@/app/api/template-director/route';
import { toPromptCard } from '@/lib/prompts/catalog';
import type { PromptRow } from '@/lib/prompts/repo';
import {
  CUSTOM_DIRECTOR_REF_SLOTS,
  DIRECTOR_EDITABLE_SLOTS,
  GEMINI_DIRECTOR_DEFAULT_MODEL,
  NO_LOCKS,
  TEMPLATE_LOCK_NAMED,
  createFlashTemplateDirector,
  editableSlotsFor,
  emptyPersonalSheetState,
  locksFromPublic,
  lockTextHit,
  lockVerdict,
  parseTemplateLocks,
  publicLocks,
  renderLockBlock,
  runHeuristicDirectorTurn,
  toClientDirectorTurnResponse,
  type PersonalSheetState,
} from '@/lib/template-director';

/**
 * docs/PERSONAL-STUDIO.md §3.3 (C2) — template locks reach the route, the catalogue card and the browser, and only
 * as the public projection: WHICH parts are fixed, never the block or a line's tail (template prompt text can be
 * hidden from customers).
 */

/** Tails a template author wrote: private prompt text that must never leave the server. */
const PRODUCT_NOTE = 'the amber serum bottle with the gold dropper PRIVATE-PRODUCT-TAIL';
const HAIR_NOTE = 'a bright pink chin-length bob PRIVATE-HAIR-TAIL';
const LOCKED_BLOCK = renderLockBlock([
  { kind: 'product', note: PRODUCT_NOTE },
  { kind: 'slot', slot: 'hair', note: HAIR_NOTE },
  { kind: 'shots', from: 2, to: 3 },
  { kind: 'logo' },
]);
const SOUND_BLOCK = renderLockBlock([{ kind: 'sound' }, { kind: 'slot', slot: 'outfit' }]);
const PROP_BLOCK = renderLockBlock([{ kind: 'slot', slot: 'prop' }]);
const MALFORMED_BLOCK = 'Template locks:\n- Keep exactly as in the template: the moon — PRIVATE-MALFORMED-TAIL';

const BODY = `Reference authority:
- @Image 1 supplies ONLY the protagonist's facial identity.

Timeline:
[Shot 1 - Counter, 0.0-3.0s]:
- @Image 1 picks up the serum bottle.
[Shot 2 - Close-up, 3.0-6.0s]:
- The bottle turns slowly in hand.

[Exclusions]
No watermarks.`;
const withBlock = (block: string) => `${BODY}\n\n${block}`;

/** Every string that belongs to a lock block and may not appear in anything the browser or the catalogue sees. */
const PRIVATE_NEEDLES = [
  'Template locks',
  'Keep exactly as in the template',
  'PRIVATE-PRODUCT-TAIL',
  'PRIVATE-HAIR-TAIL',
  'PRIVATE-MALFORMED-TAIL',
  'amber serum bottle',
  'pink chin-length bob',
  // The default tails are template text too.
  'its shape, colour, label and logo placement',
  'its wording, colour and placement',
  'action, framing, timing and what is shown',
  'voice, music and effects as written',
];

function expectNoPrivateText(value: unknown): void {
  const serialised = JSON.stringify(value);
  for (const needle of PRIVATE_NEEDLES) expect(serialised.includes(needle), needle).toBe(false);
}

function promptRow(promptText: string): PromptRow {
  return {
    audience: 'public',
    id: 'tpl-locks',
    slug: 'serum-counter',
    source: 'yagi',
    authorId: null,
    authorHandle: null,
    status: 'published',
    models: ['seedance-2.5'],
    title: 'Serum Counter',
    titleKo: '세럼 카운터',
    promptText,
    processMd: 'A serum on a counter',
    processMdKo: '카운터 위의 세럼',
    sourceUrl: null,
    textVisibility: 'hidden',
    media: null,
    useCase: [],
    featured: false,
    medium: 'video',
    cast: 'solo',
    priceCents: 0,
    priceKrw: 0,
    price1080Cents: 0,
    price1080Krw: 0,
    runtimeSeconds: 10,
    engine: null,
    aspectDefault: '9:16',
    rejectReason: null,
    announcedAt: null,
    createdAt: null,
    publishedAt: null,
  };
}

// --- 1. The projection ----------------------------------------------------------------------------------------------

describe('publicLocks — the only lock shape that leaves the server', () => {
  it('is null without locks', () => {
    expect(publicLocks(NO_LOCKS)).toBeNull();
    expect(publicLocks(parseTemplateLocks(BODY))).toBeNull();
  });

  it('names which parts are fixed and drops `block` and `notes`', () => {
    const locks = parseTemplateLocks(withBlock(LOCKED_BLOCK));
    expect(locks.notes.length).toBeGreaterThan(0);
    const projected = publicLocks(locks);
    expect(projected).toEqual({
      named: ['product', 'logo'],
      slots: ['hair', 'prop'],
      shots: [{ from: 2, to: 3 }],
      refs: ['look_ref', 'prop_ref', 'scene_ref'],
      all: false,
    });
    expect(Object.keys(projected!).sort()).toEqual(['all', 'named', 'refs', 'shots', 'slots']);
    expectNoPrivateText(projected);
  });

  it('a malformed block projects as "everything is fixed"', () => {
    const projected = publicLocks(parseTemplateLocks(withBlock(MALFORMED_BLOCK)));
    expect(projected).toEqual({
      named: [...TEMPLATE_LOCK_NAMED],
      slots: [...DIRECTOR_EDITABLE_SLOTS],
      shots: [],
      refs: [...CUSTOM_DIRECTOR_REF_SLOTS],
      all: true,
    });
    expectNoPrivateText(projected);
  });

  it('locksFromPublic gives the browser the same verdicts the server reaches, and NO_LOCKS for null', () => {
    expect(locksFromPublic(null)).toBe(NO_LOCKS);
    for (const block of [LOCKED_BLOCK, SOUND_BLOCK, PROP_BLOCK, MALFORMED_BLOCK]) {
      const server = parseTemplateLocks(withBlock(block));
      const browser = locksFromPublic(publicLocks(server));
      expect(browser.block).toBe('');
      expect(browser.notes).toEqual([]);
      for (const slot of DIRECTOR_EDITABLE_SLOTS) {
        for (const text of ['핑크 단발', '제품을 바꿔 줘', 'swap the logo', '노래를 바꿔', '빨간 드레스']) {
          for (const shots of [undefined, { from: 1, to: 1 }, { from: 3, to: 4 }]) {
            const line = { slot, text, ...(shots ? { shots } : {}) };
            expect(lockVerdict(line, browser)).toBe(lockVerdict(line, server));
          }
          expect(lockTextHit(text, browser)).toBe(lockTextHit(text, server));
        }
      }
    }
  });
});

// --- 2. The catalogue card ------------------------------------------------------------------------------------------

describe('the catalogue card carries the public projection only for a template with locks', () => {
  it('a template with a block gets `locks`, and nothing of the block', () => {
    const card = toPromptCard(promptRow(withBlock(LOCKED_BLOCK)), { publicUrl: () => null });
    expect(card.locks).toEqual(publicLocks(parseTemplateLocks(withBlock(LOCKED_BLOCK))));
    expectNoPrivateText(card);
    const malformed = toPromptCard(promptRow(withBlock(MALFORMED_BLOCK)), { publicUrl: () => null });
    expect(malformed.locks?.all).toBe(true);
    expectNoPrivateText(malformed);
  });

  it('a template without one has no `locks` key, and its card differs from a locked one only by that key', () => {
    const plain = toPromptCard(promptRow(BODY), { publicUrl: () => null });
    expect(Object.hasOwn(plain, 'locks')).toBe(false);
    expect(JSON.stringify(plain)).not.toContain('"locks"');
    const { locks, ...rest } = toPromptCard(promptRow(withBlock(LOCKED_BLOCK)), { publicUrl: () => null });
    expect(locks).toBeTruthy();
    expect(rest).toEqual(plain);
    expect(JSON.stringify(rest)).toBe(JSON.stringify(plain));
  });
});

// --- 3. The route ---------------------------------------------------------------------------------------------------

const ENV_KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'TWINGS_PERSONAL_EDIT_SHEET'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function template(promptText: string | undefined) {
  return {
    id: 'tpl-locks',
    slug: 'serum-counter',
    status: 'published',
    audience: 'public',
    medium: 'video',
    title: 'Serum Counter',
    titleKo: '세럼 카운터',
    processMd: 'A serum on a counter',
    processMdKo: '카운터 위의 세럼',
    ...(promptText === undefined ? {} : { promptText }),
  };
}

function post(fields: Record<string, string | File>): Promise<Response> {
  const form = new FormData();
  form.set('template', 'serum-counter');
  form.set('locale', 'ko');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return POST(new Request('https://twings.app/api/template-director', { method: 'POST', body: form }));
}

const sheetField = (state: PersonalSheetState) => JSON.stringify(state);
const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'look.jpg', { type: 'image/jpeg' });

function geminiJson(payload: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stage1Payload(fetchMock: { mock: { calls: unknown[][] } }, call = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]![1] as RequestInit;
  const body = JSON.parse(String(init.body)) as { contents: Array<{ parts: Array<{ text?: string }> }> };
  return JSON.parse(body.contents[0]!.parts[0]!.text!) as Record<string, unknown>;
}

describe('POST /api/template-director with template locks', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    routeMock.viewer.mockResolvedValue({ userId: 'u-locks', isAdmin: true, tier: 'free', locale: 'ko' });
    routeMock.sql.mockResolvedValue({ query: vi.fn() });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sheet turn: answers with the public `locks`, drops the locked request and reports `lockedHit`', async () => {
    process.env.TWINGS_PERSONAL_EDIT_SHEET = 'on';
    routeMock.loadPromptBySlug.mockResolvedValue(template(withBlock(LOCKED_BLOCK)));
    const res = await post({ message: '핑크 단발로 바꿔 줘', sheet: sheetField(emptyPersonalSheetState()) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown> & { turn: Record<string, unknown> };
    expect(body.locks).toEqual(publicLocks(parseTemplateLocks(withBlock(LOCKED_BLOCK))));
    expect(body.turn.lockedHit).toBe(true);
    expect((body.turn.sheet as { change: unknown[] }).change).toEqual([]);
    expectNoPrivateText(body);
  });

  it('sheet turn (model): Stage 1 sees the reduced `editableSlots`, and a locked line in the sent sheet comes back without it', async () => {
    process.env.TWINGS_PERSONAL_EDIT_SHEET = 'on';
    process.env.GEMINI_API_KEY = 'fake-gemini-key';
    routeMock.loadPromptBySlug.mockResolvedValue(template(withBlock(LOCKED_BLOCK)));
    const fetchMock = vi.fn(async () =>
      geminiJson({
        approved: true,
        refusal: 'none',
        replyKo: '담았어요.',
        guardrailAdjustmentKo: null,
        set: [{ text: '블랙 실크 원피스', slot: 'outfit' }],
        remove: [],
        revert: [],
        keep: [],
        exclude: [],
        question: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const sent: PersonalSheetState = {
      ...emptyPersonalSheetState(),
      sheet: { change: [{ text: '핑크 단발', slot: 'hair' }], keep: [], exclude: [] },
    };
    const res = await post({ message: '원피스로 바꿔 줘', sheet: sheetField(sent) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown> & { turn: Record<string, unknown> };
    const locks = parseTemplateLocks(withBlock(LOCKED_BLOCK));
    expect(stage1Payload(fetchMock).editableSlots).toEqual(editableSlotsFor(locks));
    expect(stage1Payload(fetchMock).editableSlots).not.toContain('hair');
    expect((body.turn.sheet as { change: unknown[] }).change).toEqual([{ text: '블랙 실크 원피스', slot: 'outfit' }]);
    // The locked line was only in the (untrusted) sheet the screen sent, not asked for in this turn: no hit (C1 rule).
    expect(body.turn).not.toHaveProperty('lockedHit');
    expect(body.locks).toEqual(publicLocks(locks));
    expectNoPrivateText(body);
    // Stage 1 never sees a tail either (only the default part names, as C1 sends them).
    expectNoPrivateText(stage1Payload(fetchMock));
  });

  it('a photo for a closed reference slot is refused with 400 before any model call', async () => {
    process.env.GEMINI_API_KEY = 'fake-gemini-key';
    const fetchMock = vi.fn(async () => geminiJson({}));
    vi.stubGlobal('fetch', fetchMock);
    routeMock.loadPromptBySlug.mockResolvedValue(template(withBlock(LOCKED_BLOCK)));
    for (const field of ['slot_prop_ref', 'slot_look_ref', 'slot_scene_ref']) {
      const res = await post({ message: '이 사진으로', [field]: photo() });
      expect(res.status, field).toBe(400);
      expect(await res.json()).toEqual({ ok: false, code: 'locked_slot_photo' });
    }
    expect(fetchMock).not.toHaveBeenCalled();

    // An open reference slot still goes through (the prop slot alone closes only its photo).
    routeMock.loadPromptBySlug.mockResolvedValue(template(withBlock(PROP_BLOCK)));
    delete process.env.GEMINI_API_KEY;
    expect((await post({ message: '이 옷으로', slot_look_ref: photo() })).status).toBe(200);
    expect((await post({ message: '이 소품으로', slot_prop_ref: photo() })).status).toBe(400);
  });

  it('chips turn (flag off, model): the locked chip is removed and the hit reported', async () => {
    process.env.GEMINI_API_KEY = 'fake-gemini-key';
    routeMock.loadPromptBySlug.mockResolvedValue(template(withBlock(PROP_BLOCK)));
    const fetchMock = vi.fn(async () =>
      geminiJson({
        approved: true,
        refusal: 'none',
        replyKo: '바꿨어요.',
        guardrailAdjustmentKo: null,
        readyToRender: true,
        summaryChips: [
          { slot: 'prop', labelKo: '소품', summaryKo: '가죽 가방' },
          { slot: 'outfit', labelKo: '의상', summaryKo: '블랙 자켓' },
        ],
        structuredIntent: {
          hairOverrideEn: null,
          makeupOverrideEn: null,
          outfitOverrideEn: 'a black jacket',
          propOverrideEn: 'a leather bag',
          shotEdits: [],
          strictExclusionsEn: [],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await post({ message: '가방이랑 자켓으로' });
    const body = (await res.json()) as Record<string, unknown> & { turn: Record<string, unknown> };
    expect(stage1Payload(fetchMock).editableSlots).toEqual(editableSlotsFor(parseTemplateLocks(withBlock(PROP_BLOCK))));
    expect(body.turn.approved).toBe(true);
    expect(body.turn.summaryChips).toEqual([{ slot: 'outfit', labelKo: '의상', summaryKo: '블랙 자켓' }]);
    expect(body.turn.lockedHit).toBe(true);
    expect(body.turn).not.toHaveProperty('structuredIntent');
    expect(body.locks).toEqual(publicLocks(parseTemplateLocks(withBlock(PROP_BLOCK))));
  });

  it('chips turn (flag off, no key): nothing left after the lock = the refusal', async () => {
    routeMock.loadPromptBySlug.mockResolvedValue(template(withBlock(PROP_BLOCK)));
    const res = await post({ message: '가방 들고 있게 해 줘' });
    const body = (await res.json()) as Record<string, unknown> & { turn: Record<string, unknown> };
    expect(body.model).toBe('heuristic');
    expect(body.turn).toMatchObject({ approved: false, refusal: 'unsupported', readyToRender: false, summaryChips: [], lockedHit: true });

    // With the flag on but no `sheet` field it is the same chips turn.
    process.env.TWINGS_PERSONAL_EDIT_SHEET = 'on';
    const again = (await (await post({ message: '가방 들고 있게 해 줘' })).json()) as { turn: Record<string, unknown> };
    expect(again.turn).toMatchObject({ approved: false, lockedHit: true });
  });

  it('a sound lock leaves the turn and every audio field alone (no extra refusal for BGM in the route)', async () => {
    routeMock.loadPromptBySlug.mockResolvedValue(template(withBlock(SOUND_BLOCK)));
    const res = await post({ message: '단발로 해 줘', audioMode: 'bgm', bgmMood: 'trendy_beat' });
    const body = (await res.json()) as Record<string, unknown> & { turn: Record<string, unknown> };
    expect(body.turn.approved).toBe(true);
    expect(body.locks).toMatchObject({ named: ['sound'], slots: ['outfit'], all: false });
  });

  it('without locks the answer is exactly the pre-C2 answer and carries no `locks` key (heuristic, flag off and on)', async () => {
    for (const promptText of [BODY, undefined]) {
      routeMock.loadPromptBySlug.mockResolvedValue(template(promptText));
      for (const flag of [undefined, 'on'] as const) {
        if (flag) process.env.TWINGS_PERSONAL_EDIT_SHEET = flag;
        else delete process.env.TWINGS_PERSONAL_EDIT_SHEET;
        const fields: Record<string, string> = { message: '가방 들고 핑크 단발로', audioMode: 'bgm', bgmMood: 'calm_mood' };
        if (flag) fields.sheet = sheetField(emptyPersonalSheetState());
        const body = (await (await post(fields)).json()) as Record<string, unknown>;
        const expected = {
          ok: true,
          model: 'heuristic',
          turn: toClientDirectorTurnResponse(
            runHeuristicDirectorTurn({
              templateId: 'tpl-locks',
              templateSummaryKo: '세럼 카운터 — 카운터 위의 세럼',
              editableSlots: DIRECTOR_EDITABLE_SLOTS,
              userMessage: '가방 들고 핑크 단발로',
              references: [],
              ...(flag ? { sheetState: emptyPersonalSheetState(), locale: 'ko' as const } : {}),
              audioMode: 'bgm',
              bgmMood: 'calm_mood',
            }),
          ),
        };
        expect(JSON.stringify(body)).toBe(JSON.stringify(expected));
        expect(Object.hasOwn(body, 'locks')).toBe(false);
        expect((body.turn as Record<string, unknown>).lockedHit).toBeUndefined();
      }
    }
  });

  it('without locks the Stage-1 request body is exactly the one the pre-C2 input produces (chips and sheet)', async () => {
    process.env.GEMINI_API_KEY = 'fake-gemini-key';
    routeMock.loadPromptBySlug.mockResolvedValue(template(BODY));
    const chipsReply = {
      approved: true,
      refusal: 'none',
      replyKo: '바꿨어요.',
      guardrailAdjustmentKo: null,
      readyToRender: true,
      summaryChips: [{ slot: 'prop', labelKo: '소품', summaryKo: '가죽 가방' }],
      structuredIntent: { hairOverrideEn: null, makeupOverrideEn: null, outfitOverrideEn: null, propOverrideEn: 'a leather bag', shotEdits: [], strictExclusionsEn: [] },
    };
    const sheetReply = { approved: true, refusal: 'none', replyKo: '담았어요.', guardrailAdjustmentKo: null, set: [{ text: '가죽 가방', slot: 'prop' }], remove: [], revert: [], keep: [], exclude: [], question: null };
    for (const flag of [undefined, 'on'] as const) {
      if (flag) process.env.TWINGS_PERSONAL_EDIT_SHEET = flag;
      const reply = flag ? sheetReply : chipsReply;
      const viaRoute = vi.fn(async () => geminiJson(reply));
      vi.stubGlobal('fetch', viaRoute);
      const fields: Record<string, string | File> = { message: '가방 들고', slot_look_ref: photo() };
      if (flag) fields.sheet = sheetField(emptyPersonalSheetState());
      const body = (await (await post(fields)).json()) as Record<string, unknown>;

      const direct = vi.fn(async () => geminiJson(reply));
      const director = createFlashTemplateDirector(
        { apiKey: 'fake-gemini-key', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: GEMINI_DIRECTOR_DEFAULT_MODEL },
        { fetch: direct as unknown as typeof fetch },
      );
      const result = await director.runChatTurn({
        templateId: 'tpl-locks',
        templateSummaryKo: '세럼 카운터 — 카운터 위의 세럼',
        editableSlots: DIRECTOR_EDITABLE_SLOTS,
        userMessage: '가방 들고',
        references: [{ slotName: 'look_ref', role: 'look', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mime: 'image/jpeg' }],
        ...(flag ? { sheetState: emptyPersonalSheetState(), locale: 'ko' as const } : {}),
      });
      const sentByRoute = (viaRoute.mock.calls[0] as unknown[])[1] as RequestInit;
      const sentDirect = (direct.mock.calls[0] as unknown[])[1] as RequestInit;
      expect(String(sentByRoute.body)).toBe(String(sentDirect.body));
      expect(JSON.stringify(body)).toBe(JSON.stringify({ ok: true, model: director.model, turn: toClientDirectorTurnResponse(result) }));
      expect(Object.hasOwn(body, 'locks')).toBe(false);
    }
  });
});
