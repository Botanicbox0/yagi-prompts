import type { TemplateLook } from '@/lib/template-look/look';
import type { PromptFixture } from './prompt-fixtures';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — LOCAL-ONLY: one template written for the women's style and one for the men's style,
 * so the style question, the list filter and the template page's style fact can be seen and swept against a real
 * server. Every other local template stays `any`. Seeded by `npm run db:local` only — never by the test harness, never
 * to the cloud. NEW templates (invented titles and words), so no existing fixture pinned by a golden test changes; the
 * media are the studio's own landing films (virtual models), the same files the other local samples use.
 */

export const LOOK_FEMALE_SLUG = 'sample-look-female';
export const LOOK_MALE_SLUG = 'sample-look-male';

export const TEMPLATE_LOOK_PROMPT_FIXTURES: PromptFixture[] = [
  {
    id: '9d000000-0000-4000-8000-000000000003',
    slug: LOOK_FEMALE_SLUG,
    priceCents: 400,
    runtimeSeconds: 11,
    engine: 'seedance-2.0',
    aspectDefault: '9:16',
    source: 'yagi',
    status: 'published',
    title: 'Runway walk (sample)',
    titleKo: '런웨이 워크 (예시)',
    text: 'Local sample: a slow runway walk under cool white light, the person in the frame centre the whole time.\n',
    sentinel: 'SENTINEL_LOOK_FEMALE_1',
    textVisibility: 'pro',
    useCase: ['cinematic'],
    featured: false,
    poster: { label: 'look-female-poster', ext: 'jpg', mime: 'image/jpeg', w: 720, h: 1280, file: 'public/reel/landing/v7/film-runway.jpg' },
    video: { label: 'look-female-clip', ext: 'mp4', mime: 'video/mp4', w: 720, h: 1280, duration_s: 11, file: 'public/reel/landing/v7/film-runway.mp4' },
    publishedDaysAgo: 4,
  },
  {
    id: '9d000000-0000-4000-8000-000000000004',
    slug: LOOK_MALE_SLUG,
    priceCents: 400,
    runtimeSeconds: 13,
    engine: 'seedance-2.0',
    aspectDefault: '4:3',
    source: 'yagi',
    status: 'published',
    title: 'Daydream (sample)',
    titleKo: '데이드림 (예시)',
    text: 'Local sample: a quiet daydream in a pale room, a slow drift of the camera around the person.\n',
    sentinel: 'SENTINEL_LOOK_MALE_1',
    textVisibility: 'pro',
    useCase: ['cinematic'],
    featured: false,
    poster: { label: 'look-male-poster', ext: 'jpg', mime: 'image/jpeg', w: 960, h: 720, file: 'public/reel/landing/v7/film-daydream.jpg' },
    video: { label: 'look-male-clip', ext: 'mp4', mime: 'video/mp4', w: 960, h: 720, duration_s: 13, file: 'public/reel/landing/v7/film-daydream.mp4' },
    publishedDaysAgo: 5,
  },
];

/** The style each sample is written for, written to `prompt_items.look` after the seed. */
export const TEMPLATE_LOOK_LABELS: ReadonlyArray<{ slug: string; look: TemplateLook }> = [
  { slug: LOOK_FEMALE_SLUG, look: 'female' },
  { slug: LOOK_MALE_SLUG, look: 'male' },
];
