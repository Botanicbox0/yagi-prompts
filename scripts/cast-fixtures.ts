import type { PromptFixture } from './prompt-fixtures';
import type { AssetSpec } from './fixtures';

/**
 * docs/CAST-CATEGORIES.md §5 — LOCAL-ONLY sample templates for the pet and couple sections, so the
 * screens can be reviewed against a real server: two per cast and medium. They are seeded by
 * `npm run db:local` only (never by the test harness, never to the cloud), carry placeholder media
 * labelled as such, and are not real templates — the first real ones are the founder's decision.
 *
 * Three carry a recipe so the make card shows its photo fields locally: a pet-only image, a person +
 * pet image, and a couple image. The rest have none, so their page says "준비 중" (a pet or couple
 * template without a matching recipe is never offered for making).
 */

const png = (label: string, w: number, h: number): AssetSpec => ({ label, ext: 'png', mime: 'image/png', w, h });
const mp4 = (label: string, seconds: number): AssetSpec => ({ label, ext: 'mp4', mime: 'video/mp4', w: 1280, h: 720, duration_s: seconds });

const selfie = { kind: 'image', source: 'user', required: true } as const;
const pet = { kind: 'image', source: 'user', required: true, role: 'pet' } as const;
const partner = { kind: 'image', source: 'user', required: true, role: 'partner' } as const;
const still = (inputs: string[], prompt: string) => ({ version: 2, slots: {} as Record<string, unknown>, steps: [{ id: 'still', kind: 'image', engine: 'gpt-image-2', inputs, prompt, params: { aspect: '4:5' } }], output: { from: 'still' } });

export interface CastFixture extends PromptFixture {
  /** A recipe v2 written to `prompt_items.recipe` after the seed. */
  recipe?: Record<string, unknown>;
}

const base = (n: number) => `9c000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

export const CAST_PROMPT_FIXTURES: CastFixture[] = [
  // --- pet · video -----------------------------------------------------------------------
  {
    id: base(1), slug: 'sample-pet-beach-run', cast: 'pet', medium: 'video', runtimeSeconds: 10, aspectDefault: '9:16', engine: 'seedance-2.5',
    source: 'yagi', status: 'published', title: 'Beach run (sample)', titleKo: '바닷가 달리기 (예시)',
    text: 'Local sample: the pet from the photo runs along a pale beach at dawn, low tracking camera.',
    sentinel: 'SENTINEL_CAST_PET_1', textVisibility: 'pro', useCase: ['vlog'], featured: false,
    poster: png('cast-pet-beach-run', 1080, 1920), video: mp4('cast-pet-beach-run-clip', 6), publishedDaysAgo: 1,
  },
  {
    id: base(2), slug: 'sample-pet-walk-together', cast: 'pet', medium: 'video', runtimeSeconds: 10, aspectDefault: '9:16', engine: 'seedance-2.5',
    source: 'yagi', status: 'published', title: 'Walk together (sample)', titleKo: '함께 산책 (예시)',
    text: 'Local sample: the owner walks the pet through an autumn park, slow dolly alongside.',
    sentinel: 'SENTINEL_CAST_PET_2', textVisibility: 'pro', useCase: ['vlog'], featured: false,
    poster: png('cast-pet-walk-together', 1080, 1920), publishedDaysAgo: 3,
  },
  // --- pet · image -----------------------------------------------------------------------
  {
    id: base(3), slug: 'sample-pet-studio-portrait', cast: 'pet', medium: 'image', engine: 'gpt-image-2', aspectDefault: '4:5', priceCents: 200, priceKrw: 2500,
    source: 'yagi', status: 'published', title: 'Studio portrait (sample)', titleKo: '스튜디오 프로필 (예시)',
    text: 'Local sample: a studio portrait of the pet on a powder-blue backdrop.',
    sentinel: 'SENTINEL_CAST_PET_3', textVisibility: 'pro', useCase: ['cinematic'], featured: false,
    poster: png('cast-pet-studio-portrait', 1080, 1350), publishedDaysAgo: 2,
    recipe: { ...still(['pet'], 'A studio portrait of {{pet}} on a powder-blue backdrop, soft window light.'), slots: { pet } },
  },
  {
    id: base(4), slug: 'sample-pet-sofa-together', cast: 'pet', medium: 'image', engine: 'gpt-image-2', aspectDefault: '4:5', priceCents: 200, priceKrw: 2500,
    source: 'yagi', status: 'published', title: 'Sofa together (sample)', titleKo: '소파에서 함께 (예시)',
    text: 'Local sample: the owner and the pet on a white sofa, morning light.',
    sentinel: 'SENTINEL_CAST_PET_4', textVisibility: 'pro', useCase: ['ugc'], featured: false,
    poster: png('cast-pet-sofa-together', 1080, 1350), publishedDaysAgo: 4,
    recipe: { ...still(['selfie', 'pet'], '{{selfie}} sits on a white sofa with {{pet}} in morning light.'), slots: { selfie, pet } },
  },
  // --- couple · video (off unless TWINGS_COUPLE_TEMPLATES=on) ----------------------------
  {
    id: base(5), slug: 'sample-couple-rooftop', cast: 'couple', medium: 'video', runtimeSeconds: 10, aspectDefault: '9:16', engine: 'seedance-2.5',
    source: 'yagi', status: 'published', title: 'Rooftop at dusk (sample)', titleKo: '해 질 녘 옥상 (예시)',
    text: 'Local sample: two people on a rooftop at dusk, slow orbit.',
    sentinel: 'SENTINEL_CAST_COUPLE_1', textVisibility: 'pro', useCase: ['cinematic'], featured: false,
    poster: png('cast-couple-rooftop', 1080, 1920), video: mp4('cast-couple-rooftop-clip', 6), publishedDaysAgo: 1,
  },
  {
    id: base(6), slug: 'sample-couple-subway', cast: 'couple', medium: 'video', runtimeSeconds: 10, aspectDefault: '9:16', engine: 'seedance-2.5',
    source: 'yagi', status: 'published', title: 'Last train (sample)', titleKo: '막차 (예시)',
    text: 'Local sample: two people on an empty late-night train, handheld.',
    sentinel: 'SENTINEL_CAST_COUPLE_2', textVisibility: 'pro', useCase: ['short-film'], featured: false,
    poster: png('cast-couple-subway', 1080, 1920), publishedDaysAgo: 5,
  },
  // --- couple · image --------------------------------------------------------------------
  {
    id: base(7), slug: 'sample-couple-umbrella', cast: 'couple', medium: 'image', engine: 'gpt-image-2', aspectDefault: '4:5', priceCents: 200, priceKrw: 2500,
    source: 'yagi', status: 'published', title: 'One umbrella (sample)', titleKo: '우산 하나 (예시)',
    text: 'Local sample: two people share one umbrella on a rainy street.',
    sentinel: 'SENTINEL_CAST_COUPLE_3', textVisibility: 'pro', useCase: ['cinematic'], featured: false,
    poster: png('cast-couple-umbrella', 1080, 1350), publishedDaysAgo: 2,
    recipe: { ...still(['selfie', 'partner'], '{{selfie}} and {{partner}} share one umbrella on a rainy street.'), slots: { selfie, partner } },
  },
  {
    id: base(8), slug: 'sample-couple-photo-booth', cast: 'couple', medium: 'image', engine: 'gpt-image-2', aspectDefault: '4:5', priceCents: 200, priceKrw: 2500,
    source: 'yagi', status: 'published', title: 'Photo booth (sample)', titleKo: '포토부스 (예시)',
    text: 'Local sample: two people in a photo booth strip, four frames.',
    sentinel: 'SENTINEL_CAST_COUPLE_4', textVisibility: 'pro', useCase: ['ugc'], featured: false,
    poster: png('cast-couple-photo-booth', 1080, 1350), publishedDaysAgo: 6,
  },
];

export const CAST_SENTINELS = CAST_PROMPT_FIXTURES.map((fixture) => ({ slug: fixture.slug, token: fixture.sentinel, cast: fixture.cast! }));
