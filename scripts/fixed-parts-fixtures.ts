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
  { index: 2, timeSeconds: 10.25, endSeconds: 11, part: 'prop', labelKo: '은색 붐박스', labelEn: 'Silver boombox' },
];
