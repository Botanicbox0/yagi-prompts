import { describe, expect, it } from 'vitest';
import { SHORTCUT_ACTIONS, SHORTCUT_GROUPS, SHORTCUT_SETS } from '@/lib/brand-studio/editor-v2/shortcuts';
import { studioEditorEn, studioEditorKo } from '@/messages/studio-editor';
import { studioEditorChatEn, studioEditorChatKo } from '@/messages/studio-editor-chat';

/** The editing studio copy names no vendor, tool, engine or reference product, and quotes no money. */
function leaves(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

const VENDORS = [
  'gemini',
  'hydrogen',
  'argon',
  'whisper',
  'ffmpeg',
  'webcodecs',
  'opencut',
  'openchatcut',
  'morphic',
  '모픽',
  'sunra',
  'elevenlabs',
  'seedance',
  'seedream',
  'slack',
  '슬랙',
  'supabase',
];

const REFERENCE_PRODUCTS = [
  /capcut/i,
  /캡컷/,
  /premiere/i,
  /프리미어/,
  /davinci/i,
  /다빈치/,
  /final\s*cut/i,
  /파이널\s*컷/,
  /descript/i,
  /\bcanva\b/i,
  /캔바/,
  /imovie/i,
  /\bvrew\b/i,
  /브루/,
  /adobe/i,
  /어도비/,
  /\brunway\b/i,
  /frame\.io/i,
];

describe('studio editor copy hygiene', () => {
  for (const [locale, copy] of [
    ['ko', studioEditorKo],
    ['en', studioEditorEn],
  ] as const) {
    const all = leaves(copy);

    it(`${locale} has copy to check`, () => {
      expect(all.length).toBeGreaterThan(50);
    });

    it(`${locale} names no vendor, tool or engine`, () => {
      const hits = all.filter(([, text]) => VENDORS.some((v) => text.toLowerCase().includes(v)));
      expect(hits).toEqual([]);
    });

    it(`${locale} quotes no money`, () => {
      const hits = all.filter(([, text]) => /\d[\d,.]*\s*원/.test(text) || text.includes('$') || /₩|krw|usd/i.test(text));
      expect(hits).toEqual([]);
    });

    it(`${locale} names no reference product`, () => {
      const hits = all.filter(([, text]) => REFERENCE_PRODUCTS.some((p) => p.test(text)));
      expect(hits).toEqual([]);
    });
  }

  describe('shortcut and timeline copy (2026-11-20)', () => {
    /** The reference editors the shortcut sets are modelled on must never be named on screen. */
    const EDITOR_NAMES = [/capcut/i, /캡컷/, /premiere/i, /프리미어/, /davinci/i, /다빈치/, /final\s*cut/i, /파이널\s*컷/, /vrew/i, /브루/];

    for (const [locale, copy, chatCopy] of [
      ['ko', studioEditorKo, studioEditorChatKo],
      ['en', studioEditorEn, studioEditorChatEn],
    ] as const) {
      it(`${locale} names a set for every shortcut set and a label for every action and group`, () => {
        expect(Object.keys(copy.shortcuts.sets).sort()).toEqual([...SHORTCUT_SETS].sort());
        // `focusChat` label lives in the switch-gated `messages/studio-editor-chat.ts` dictionary (BLOCKER #1 + W5).
        const actionKeys = [
          ...Object.keys(copy.shortcuts.actions),
          ...(chatCopy.shortcutFocusChat.trim() ? ['focusChat'] : []),
        ];
        expect(actionKeys.sort()).toEqual([...SHORTCUT_ACTIONS].sort());
        expect(Object.keys(copy.shortcuts.groups).sort()).toEqual(SHORTCUT_GROUPS.map((group) => group.id).sort());
      });

      it(`${locale} shortcut set names and all shortcut and timeline strings name no editing program`, () => {
        const strings = [
          ...leaves(copy.shortcuts, 'shortcuts'),
          ...leaves(copy.timeline, 'timeline'),
          ...leaves(chatCopy, 'studioEditorChat'),
          ...SHORTCUT_SETS.map((id) => [`shortcuts.sets.${id}`, copy.shortcuts.sets[id]] as [string, string]),
        ];
        expect(strings.length).toBeGreaterThan(40);
        const hits = strings.filter(([, text]) => EDITOR_NAMES.some((p) => p.test(text)));
        expect(hits).toEqual([]);
      });
    }

    it('the set ids themselves name no editing program', () => {
      for (const id of SHORTCUT_SETS) expect(EDITOR_NAMES.some((p) => p.test(id)), id).toBe(false);
    });
  });

  it('ko and en have the same keys', () => {
    expect(leaves(studioEditorKo).map(([k]) => k)).toEqual(leaves(studioEditorEn).map(([k]) => k));
  });
});
