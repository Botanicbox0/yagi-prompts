import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §4 — the team's desk and project list words live in `adminConsole.roomDesk`,
 * never in the blocks brand room pages hand to the browser (`roomsChat`, `roomsReview`, `studioReview`,
 * `roomsShell`), the same rule as the team-note words (`adminConsole.reviewTeam`).
 *
 *  - None of the desk's words appear in those blocks, except plain words the brand screens already show
 *    (a tab, a column) and words of the `admin` sections those blocks already carried before this slice
 *    (left where they are, as asked; frozen below so nothing new is added to them).
 *  - The one string this slice did add to a brand block, the guest label on a share-link guest's line, is
 *    the review stage's existing words, not new ones.
 */
type Tree = { [key: string]: string | Tree };

function leaves(value: unknown, prefix = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[prefix, value]];
  if (value && typeof value === 'object') return Object.entries(value as Tree).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  return [];
}

const BRAND_BLOCKS = ['roomsChat', 'roomsReview', 'studioReview', 'roomsShell'] as const;

/** The `admin` sections of the brand blocks as they were before this slice (main fb936804 / rooms-notices 9c10c8b4). */
const PRE_EXISTING_ADMIN_KEYS = new Set([
  ...['title', 'lede', 'navLink', 'caption', 'columns.organization', 'columns.channel', 'columns.last', 'columns.waiting', 'empty', 'waiting', 'open', 'openBrand', 'brandLabel', 'back', 'workLinks', 'storyboards', 'deliverables', 'teamNote', 'lastFromBrand', 'lastFromTeam'].map((k) => `roomsChat.admin.${k}`),
  ...[
    'title', 'lede', 'navLink', 'flagOff', 'organization', 'project', 'choose', 'file', 'fileHint', 'titleLabel', 'stack', 'stackNew', 'stackVersion', 'upload', 'uploading', 'delivering', 'tooLarge', 'badType',
    'session', 'failed', 'stacksTitle', 'noStacks', 'columns.title', 'columns.version', 'columns.status', 'columns.open', 'columns.source', 'sources.studio', 'sources.delivery', 'sharesTitle', 'noShares',
    'shareColumns.state', 'shareColumns.options', 'shareColumns.views', 'shareColumns.expires', 'shareColumns.by', 'shareColumns.action', 'madeBy.brand', 'madeBy.studio', 'revoke', 'versionsTitle', 'openDesk',
  ].map((k) => `roomsReview.admin.${k}`),
  ...[
    'title', 'lede', 'navLink', 'caption', 'columns.organization', 'columns.title', 'columns.status', 'columns.open', 'columns.activity', 'empty', 'filterAll', 'back', 'brandOf', 'createTitle', 'createHint',
    'organization', 'subjectKind', 'asset', 'output', 'subjectId', 'titleLabel', 'create', 'unavailable',
  ].map((k) => `studioReview.admin.${k}`),
]);

/** Plain words the brand screens already show (a tab, a column), which the desk's tabs and columns share by meaning. */
const SHARED_WORDS = new Set(['시안', 'Drafts', '스토리보드', 'Storyboards', '공유 링크', 'Share links', '대화', 'Conversation', '프로젝트', 'Project', '상태', 'Status', '닫기', 'Close']);

describe('desk and list words', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`stay out of the dictionaries brand room pages serialize (${locale})`, () => {
      const dict = getDictionary(locale) as unknown as Record<string, unknown>;
      const brandLeaves = BRAND_BLOCKS.flatMap((block) => leaves(dict[block], block));

      // No admin words were added to the brand blocks.
      expect(brandLeaves.map(([key]) => key).filter((key) => /^\w+\.admin\./.test(key) && !PRE_EXISTING_ADMIN_KEYS.has(key))).toEqual([]);

      const brand = new Map<string, string[]>();
      for (const [key, value] of brandLeaves) brand.set(value, [...(brand.get(value) ?? []), key]);
      const desk = leaves((dict.adminConsole as Tree).roomDesk, 'adminConsole.roomDesk');
      expect(desk.length).toBeGreaterThan(30);
      const excused = (value: string) => SHARED_WORDS.has(value) || (brand.get(value) ?? []).every((key) => PRE_EXISTING_ADMIN_KEYS.has(key));
      const leaked = desk.filter(([, value]) => brand.has(value) && !excused(value)).map(([key, value]) => `${key} = ${JSON.stringify(value)} (also ${brand.get(value)!.join(', ')})`);
      expect(leaked).toEqual([]);
      // The shared words are really shared (the list stays honest).
      for (const word of SHARED_WORDS) if (desk.some(([, value]) => value === word)) expect(brand.has(word), word).toBe(true);
    });
  }

  it('adds to a brand block only the guest label, reused word for word from the review stage', () => {
    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale);
      expect(dict.roomsChat.author.guest).toBe(dict.studioReview.roles.guest);
    }
  });
});
