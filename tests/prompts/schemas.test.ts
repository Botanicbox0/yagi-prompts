import { describe, expect, it } from 'vitest';
import {
  ApprovalSchema,
  AuthoringSchema,
  DEFAULT_PROMPT_MODEL,
  EditSchema,
  PROMPT_MODEL_LABEL,
  PROMPT_TEXT_MAX,
  PromptMediaSchema,
  RejectionSchema,
  SubmissionSchema,
  USE_CASES,
  USE_CASE_MAX,
  effectiveTextVisibility,
  isUseCase,
  mediaEntries,
  normalizeHandle,
  parsePromptMedia,
  slugify,
} from '@/lib/prompts/schemas';

/**
 * PLAN §13.1 — the boundary contracts.
 *
 * These are the rules an anonymous person's POST body meets first, so each one is tested as a
 * REFUSAL rather than as a happy path: a cap that is only exercised from below is a cap nobody has
 * proved exists.
 */

const ok = {
  title: 'Neon alley dolly',
  promptText: 'Slow dolly-in down a rain-slick alley at night, anamorphic flares.',
  useCase: ['cinematic'],
  handle: 'hana',
  consent: true as const,
};

const asset = (sha = 'a'.repeat(64)) => ({
  staging_key: 'content/prompt/x/y.png',
  sha256: sha,
  mime: 'image/png',
});

/** The two admin payloads, at module scope: the caps below must hold on every path, not just one. */
const authoring = {
  slug: 'neon-alley-dolly',
  title: 'Neon alley dolly',
  titleKo: '네온 골목 달리',
  promptText: ok.promptText,
  useCase: ['cinematic'],
  textVisibility: 'pro',
  featured: true,
  model: DEFAULT_PROMPT_MODEL,
};

const edit = {
  id: '9a000000-0000-4000-8000-000000000001',
  slug: 'x-y-z',
  title: 'Title',
  titleKo: null,
  promptText: ok.promptText,
  useCase: ['cinematic'],
  handle: null,
  textVisibility: 'public',
  featured: false,
};

describe('submission schema (§13.1)', () => {
  it('accepts a complete submission', () => {
    const parsed = SubmissionSchema.safeParse(ok);
    expect(parsed.success).toBe(true);
  });

  it('refuses prompt text over the cap', () => {
    const parsed = SubmissionSchema.safeParse({ ...ok, promptText: 'x'.repeat(PROMPT_TEXT_MAX + 1) });
    expect(parsed.success).toBe(false);
  });

  it('accepts prompt text at exactly the cap', () => {
    expect(SubmissionSchema.safeParse({ ...ok, promptText: 'x'.repeat(PROMPT_TEXT_MAX) }).success).toBe(
      true,
    );
  });

  /**
   * The cap has to fit the artefact it caps (founder report, 2026-08-15). A real shot-by-shot video
   * brief — the founder's 1994 ENG segment is 4,853 characters of timed direction — was REFUSED by
   * every prompt form at the old 2,000. Every schema that takes prompt text is asserted here
   * TOGETHER, because the failure was that admin authoring inherited a limit written for community
   * moderation, and nothing said the two were the same decision.
   */
  it('takes a full shot-by-shot brief on every path that accepts prompt text', () => {
    // 15,540 was the founder's SECOND brief the same day (a timecoded 30s reel). The cap has to
    // clear the real artefact, not the one we pictured when we wrote the number.
    expect(PROMPT_TEXT_MAX).toBeGreaterThanOrEqual(16000);
    const brief = 'A. '.repeat(5200); // 15,600 chars — bigger than the real one.
    expect(brief.length).toBeGreaterThan(15540);

    expect(SubmissionSchema.safeParse({ ...ok, promptText: brief }).success, 'submission').toBe(true);
    expect(
      AuthoringSchema.safeParse({ ...authoring, promptText: brief }).success,
      'admin authoring',
    ).toBe(true);
    expect(EditSchema.safeParse({ ...edit, promptText: brief }).success, 'admin edit').toBe(true);
  });

  /** "Invalid input" tells the founder nothing. Every refusal names the limit it broke. */
  it('names the limit in the message, on every path', () => {
    const over = 'x'.repeat(PROMPT_TEXT_MAX + 1);
    const message = (result: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
      result.success ? '' : (result.error?.issues[0]?.message ?? '');

    for (const [label, result] of [
      ['submission', SubmissionSchema.safeParse({ ...ok, promptText: over })],
      ['authoring', AuthoringSchema.safeParse({ ...authoring, promptText: over })],
      ['edit', EditSchema.safeParse({ ...edit, promptText: over })],
    ] as const) {
      expect(result.success, label).toBe(false);
      // Grouped for a human ("12,000"), which is who reads the banner.
      expect(message(result), label).toContain(PROMPT_TEXT_MAX.toLocaleString('en-US'));
      expect(message(result), label).not.toBe('Invalid input');
    }
  });

  /** An unchecked box posts NOTHING, so "absent" has to fail exactly the way "false" does. */
  it('refuses a missing consent as hard as a false one', () => {
    expect(SubmissionSchema.safeParse({ ...ok, consent: undefined }).success).toBe(false);
    expect(SubmissionSchema.safeParse({ ...ok, consent: false }).success).toBe(false);
  });

  it('refuses an empty use-case list and a list over the cap', () => {
    expect(SubmissionSchema.safeParse({ ...ok, useCase: [] }).success).toBe(false);
    expect(
      SubmissionSchema.safeParse({ ...ok, useCase: USE_CASES.slice(0, USE_CASE_MAX + 1) }).success,
    ).toBe(false);
  });

  it('refuses a use case outside the fixed vocabulary', () => {
    expect(SubmissionSchema.safeParse({ ...ok, useCase: ['deepfake'] }).success).toBe(false);
  });

  it('de-duplicates a checkbox posted twice', () => {
    const parsed = SubmissionSchema.parse({ ...ok, useCase: ['cinematic', 'cinematic'] });
    expect(parsed.useCase).toEqual(['cinematic']);
  });
});

describe('vocabulary + defaults (§13.3)', () => {
  it('locks the eight use cases and the single launch model', () => {
    expect(USE_CASES).toHaveLength(8);
    expect(new Set(USE_CASES).size).toBe(8);
    expect(DEFAULT_PROMPT_MODEL).toBe('seedance-2.5');
    expect(PROMPT_MODEL_LABEL).toBe('SEEDANCE 2.5');
    expect(isUseCase('cinematic')).toBe(true);
    expect(isUseCase('nope')).toBe(false);
  });

  /** §13.3-1: community text can never be anything but public, whatever the form asked for. */
  it('forces community text visibility to public and leaves YAGI alone', () => {
    expect(effectiveTextVisibility('community', 'pro')).toBe('public');
    expect(effectiveTextVisibility('community', 'hidden')).toBe('public');
    expect(effectiveTextVisibility('yagi', 'pro')).toBe('pro');
    expect(effectiveTextVisibility('yagi', 'public')).toBe('public');
  });
});

describe('slug + handle normalisation', () => {
  it('slugifies a latin title and falls back for one that transliterates to nothing', () => {
    expect(slugify('Neon Alley Dolly!', 'fallback-1')).toBe('neon-alley-dolly');
    expect(slugify('네온 골목', 'prompt-abc12345')).toBe('prompt-abc12345');
    expect(slugify('--', 'prompt-abc12345')).toBe('prompt-abc12345');
  });

  it('never leaves a trailing hyphen after truncation', () => {
    const slug = slugify(`${'a'.repeat(59)} tail`, 'fallback-1');
    expect(slug.endsWith('-')).toBe(false);
  });

  it('normalises handles and treats an empty one as absent', () => {
    expect(normalizeHandle('@Hana ')).toBe('hana');
    expect(normalizeHandle('  ')).toBeNull();
    expect(normalizeHandle(null)).toBeNull();
  });
});

describe('media schema (§13.1)', () => {
  it('treats a null jsonb as "no media" rather than a parse failure', () => {
    expect(parsePromptMedia(null)).toEqual({});
    expect(parsePromptMedia(undefined)).toEqual({});
    expect(parsePromptMedia({ garbage: true })).toEqual({});
  });

  it('accepts poster-only, video-only and both', () => {
    expect(PromptMediaSchema.safeParse({ poster: asset() }).success).toBe(true);
    expect(PromptMediaSchema.safeParse({ video: asset() }).success).toBe(true);
    expect(PromptMediaSchema.safeParse({ poster: asset(), video: asset('b'.repeat(64)) }).success).toBe(
      true,
    );
  });

  it('refuses an AssetRef with no real hash', () => {
    expect(PromptMediaSchema.safeParse({ poster: { ...asset(), sha256: 'nope' } }).success).toBe(false);
  });

  it('enumerates poster before video, so the poster is always staged first', () => {
    const entries = mediaEntries({ video: asset('b'.repeat(64)), poster: asset() });
    expect(entries.map(([kind]) => kind)).toEqual(['poster', 'video']);
  });
});

describe('admin payloads (§13.1/F)', () => {
  it('requires a Korean title on a YAGI item (§13.3-4 bilingual publish gate)', () => {
    expect(AuthoringSchema.safeParse(authoring).success).toBe(true);
    expect(AuthoringSchema.safeParse({ ...authoring, titleKo: '' }).success).toBe(false);
  });

  it('refuses a slug that is not lowercase-hyphenated', () => {
    for (const slug of ['Neon Alley', 'neon_alley', 'ne', '-neon']) {
      expect(AuthoringSchema.safeParse({ ...authoring, slug }).success, slug).toBe(false);
    }
  });

  it('requires a reason to reject, and a real uuid to act on anything', () => {
    expect(RejectionSchema.safeParse({ id: crypto.randomUUID(), reason: 'Too generic.' }).success).toBe(
      true,
    );
    expect(RejectionSchema.safeParse({ id: crypto.randomUUID(), reason: '' }).success).toBe(false);
    expect(RejectionSchema.safeParse({ id: 'not-a-uuid', reason: 'Too generic.' }).success).toBe(false);
  });

  it('lets approval edit slug/handle/use-case/featured and nothing else', () => {
    const parsed = ApprovalSchema.parse({
      id: crypto.randomUUID(),
      slug: 'skate-park-golden-hour',
      handle: '@hana',
      useCase: ['ugc'],
      featured: false,
    });
    expect(Object.keys(parsed).sort()).toEqual(['featured', 'handle', 'id', 'slug', 'useCase']);
  });

  it('allows an edit to blank the Korean title but never the English one', () => {
    const base = { ...edit, id: crypto.randomUUID() };
    expect(EditSchema.safeParse(base).success).toBe(true);
    expect(EditSchema.safeParse({ ...base, title: '' }).success).toBe(false);
  });
});
