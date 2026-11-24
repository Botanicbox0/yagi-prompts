import type { VideoKeyframe } from '@/lib/prompts/keyframes';
import { TEMPLATE_KEEP_LINE_PREFIX } from '@/lib/template-director/locks';
import type { PromptFixture } from './prompt-fixtures';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — LOCAL-ONLY: one film template whose prompt declares fixed parts (a valid
 * `Template locks:` block) and whose keyframes carry marks, so the template page's "what this template decides" row
 * can be seen and swept against a real server (`npm run sweep:anon` asserts `data-template-fixed` on it and its
 * absence on templates without a declaration). Seeded by `npm run db:local` only — never by the test harness, never
 * to the cloud. A NEW template, so no existing fixture's prompt (pinned by the lock and parity tests) changes.
 *
 * The example film is the studio's own phone cut of the brand hero (`public/reel/landing/v7/hero-phone.mp4`, virtual
 * models): the row's thumbnails are frames captured from it in the browser, which a placeholder MP4 with no picture
 * could not give.
 */

const KEEP = TEMPLATE_KEEP_LINE_PREFIX;

/** Ends with a newline so the sentinel line the seed appends sits after a blank line, outside the block. */
const TEXT = [
  'Local sample: a cool powder-blue studio, quick cuts between faces, a silver boombox and denim details.',
  '',
  'Template locks:',
  `${KEEP}the wardrobe — rhinestone denim, studded belts and navy tops.`,
  `${KEEP}the prop — a silver boombox.`,
  `${KEEP}the look and light — a cool powder-blue studio world.`,
  '',
].join('\n');

export const FIXED_PARTS_SLUG = 'sample-fixed-parts';

export const FIXED_PARTS_PROMPT_FIXTURES: PromptFixture[] = [
  {
    id: '9d000000-0000-4000-8000-000000000001',
    slug: FIXED_PARTS_SLUG,
    priceCents: 400,
    runtimeSeconds: 12,
    engine: 'seedance-2.0',
    aspectDefault: '9:16',
    source: 'yagi',
    status: 'published',
    title: 'Blue room (sample)',
    titleKo: '블루 룸 (예시)',
    text: TEXT,
    sentinel: 'SENTINEL_FIXED_PARTS_1',
    textVisibility: 'pro',
    useCase: ['cinematic'],
    featured: false,
    poster: { label: 'fixed-parts-poster', ext: 'jpg', mime: 'image/jpeg', w: 720, h: 1280, file: 'public/reel/landing/v7/hero-phone.jpg' },
    video: { label: 'fixed-parts-clip', ext: 'mp4', mime: 'video/mp4', w: 720, h: 1280, duration_s: 12, file: 'public/reel/landing/v7/hero-phone.mp4' },
    publishedDaysAgo: 2,
  },
];

/** The marks written to `prompt_items.keyframes` after the seed (no stored beats: the page keeps its default beats). */
export const FIXED_PARTS_MARKS: VideoKeyframe[] = [
  { index: 0, timeSeconds: 2.5, endSeconds: 3, part: 'outfit', labelKo: '큐빅 장식 데님', labelEn: 'Rhinestone denim' },
  { index: 1, timeSeconds: 8.25, endSeconds: 8.75, part: 'outfit', labelKo: '스터드 벨트', labelEn: 'Studded belt' },
  { index: 2, timeSeconds: 10.5, endSeconds: 11, part: 'prop', labelKo: '은색 붐박스', labelEn: 'Silver boombox' },
];

// --- docs/PERSONAL-STUDIO.md §3.4.9 (S2): a film that styles the hair and the makeup and locks one prop -------------

/**
 * LOCAL-ONLY, like the template above: one film whose prompt declares a `Template styling:` block (the hair and the
 * makeup styled by the template) next to a lock block (the prop), so the template page lists all three with their
 * states, the make card offers the hair and makeup choice, and the video list's "style" group has a card to split on.
 * Invented words; a NEW template, so no pinned prompt changes. The block lines are built from the grammar's own
 * prefixes, so a grammar change breaks the seed loudly instead of seeding a block nobody reads.
 */
const STYLED_TEXT = [
  'Local sample: a quiet white studio, a slow push-in on the person, a silver microphone on a stand.',
  '',
  'Template locks:',
  `${KEEP}the prop — a silver microphone on a stand.`,
  '',
  'Template styling:',
  '- Styled by the template: the hairstyle — a sleek low bun.',
  '- Styled by the template: the makeup — soft rosy cheeks and a glossy lip.',
  '',
].join('\n');

export const STYLED_PARTS_SLUG = 'sample-styled-parts';

export const STYLED_PARTS_PROMPT_FIXTURES: PromptFixture[] = [
  {
    id: '9d000000-0000-4000-8000-000000000002',
    slug: STYLED_PARTS_SLUG,
    priceCents: 400,
    runtimeSeconds: 12,
    engine: 'seedance-2.0',
    aspectDefault: '9:16',
    source: 'yagi',
    status: 'published',
    title: 'White room (sample)',
    titleKo: '화이트 룸 (예시)',
    text: STYLED_TEXT,
    sentinel: 'SENTINEL_STYLED_PARTS_1',
    textVisibility: 'pro',
    useCase: ['cinematic'],
    featured: false,
    poster: { label: 'styled-parts-poster', ext: 'jpg', mime: 'image/jpeg', w: 720, h: 1280, file: 'public/reel/landing/v7/hero-phone.jpg' },
    video: { label: 'styled-parts-clip', ext: 'mp4', mime: 'video/mp4', w: 720, h: 1280, duration_s: 12, file: 'public/reel/landing/v7/hero-phone.mp4' },
    publishedDaysAgo: 3,
  },
];

/** Its marks: a description and a range for each declared part. */
export const STYLED_PARTS_MARKS: VideoKeyframe[] = [
  { index: 0, timeSeconds: 1, endSeconds: 2, part: 'hair', labelKo: '낮게 묶은 머리', labelEn: 'Low bun' },
  { index: 1, timeSeconds: 4, endSeconds: 5, part: 'makeup', labelKo: '은은한 볼과 윤기 있는 입술', labelEn: 'Soft cheeks and lips' },
  { index: 2, timeSeconds: 9.5, endSeconds: 10.5, part: 'prop', labelKo: '은색 스탠드 마이크', labelEn: 'Silver mic stand' },
];
