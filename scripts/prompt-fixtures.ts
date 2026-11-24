import type { Visibility } from '@/lib/content/visibility';
import type { PromptSource, PromptStatus, TemplateCast, TemplateMedium, UseCase } from '@/lib/prompts/schemas';
import type { AssetSpec } from './fixtures';

/**
 * PLAN §13 — the prompts fixture catalog.
 *
 * Built on exactly the same idea as `scripts/fixtures.ts`: every item carries a unique, greppable
 * SENTINEL inside its own prompt text, so `npm run sweep:anon` asserts a real property against a
 * real server rather than a proxy for one —
 *
 *   · a `pro` YAGI prompt's sentinel must appear NOWHERE in the anonymous HTML (gallery, detail,
 *     sitemap, Flight payload, metadata);
 *   · a `public` teaser's and a community item's sentinel MUST appear on its detail page — the
 *     positive control, without which every absence assertion would pass on an empty page;
 *   · `SENTINEL_PENDING` and `SENTINEL_REJECTED` must appear nowhere public at all, and their
 *     slugs must 404 — moderation state is not a preview surface.
 *
 * Media: posters are the same clearly-labelled generated PNGs the playbook fixtures use, and two
 * items carry a generated MP4. That MP4 is a structurally valid ISO-BMFF file (ftyp + moov/mvhd +
 * mdat) with no encoded video track: it is enough to exercise the duration probe over real bytes,
 * the storage copy, and the media route's Content-Type — and a browser that cannot decode it falls
 * back to the poster underneath, which is the same path a slow network takes. It is labelled
 * placeholder in its own bytes, exactly like the PNGs (§9).
 */

export interface PromptFixture {
  id: string;
  slug: string;
  source: PromptSource;
  status: PromptStatus;
  /** Which entitlement fixture owns a community submission (`FIXTURE_USERS` key). */
  authorKey?: 'free' | 'pro';
  handle?: string;
  title: string;
  titleKo: string | null;
  /** The sentinel is appended to this by the seed — one token per item, inside the gated bytes. */
  text: string;
  sentinel: string;
  textVisibility: Visibility;
  useCase: UseCase[];
  featured: boolean;
  poster?: AssetSpec;
  video?: AssetSpec;
  /** The audio result (founder 2026-08-13) — public and downloadable on the detail page. */
  audio?: AssetSpec;
  /** A set template's example frames (2026-10-27) — the template page's set section. */
  gallery?: AssetSpec[];
  rejectReason?: string;
  /** Published items are ordered by this offset (days ago) so NEW badges are deterministic. */
  publishedDaysAgo?: number;
  /** docs/TEMPLATES-IA.md — default video / not for sale; the priced ones exercise the studio. */
  medium?: TemplateMedium;
  /** docs/CAST-CATEGORIES.md — default 'solo'; the cast fixtures live in `scripts/cast-fixtures.ts`. */
  cast?: TemplateCast;
  priceCents?: number;
  /** The fixed won price (0018); the one fixture that sets it proves the override beats the suggestion. */
  priceKrw?: number;
  /** The 1080p price (0039); the one fixture that sets it shows the resolution choice locally. */
  price1080Cents?: number;
  price1080Krw?: number;
  runtimeSeconds?: number;
  engine?: string;
  aspectDefault?: string;
}

const png = (label: string, w: number, h: number): AssetSpec => ({
  label,
  ext: 'png',
  mime: 'image/png',
  w,
  h,
});

const mp4 = (label: string, seconds: number): AssetSpec => ({
  label,
  ext: 'mp4',
  mime: 'video/mp4',
  w: 1280,
  h: 720,
  duration_s: seconds,
});

/** Placeholder audio: labelled bytes under an audio mime — same honesty as the trackless mp4. */
const mp3 = (label: string): AssetSpec => ({
  label,
  ext: 'mp3',
  mime: 'audio/mpeg',
});

// ---------------------------------------------------------------------------
// rail 1 — ORIGINAL PROMPTS BY YAGI (8 items: 6 pro, 2 public teasers)
// ---------------------------------------------------------------------------

const YAGI: PromptFixture[] = [
  {
    id: '9a000000-0000-4000-8000-000000000001',
    slug: 'neon-alley-dolly',
    priceCents: 400,
    // Seedance 2.0 · 15s · 1080p: the cost floor (lib/twings/cost-model.ts) is 11,900원.
    price1080Cents: 900,
    price1080Krw: 11900,
    runtimeSeconds: 15,
    engine: 'seedance-2.0',
    aspectDefault: '16:9',
    source: 'yagi',
    status: 'published',
    title: 'Neon alley dolly',
    titleKo: '네온 골목 달리',
    text: 'Slow dolly-in down a rain-slick Seoul alley at night, neon signage bleeding into the puddles, anamorphic flares, 35mm, shallow depth of field, no camera shake.',
    sentinel: 'SENTINEL_PROMPT_YAGI_1',
    textVisibility: 'pro',
    useCase: ['cinematic'],
    featured: true,
    poster: png('prompt-neon-alley', 1280, 1600),
    video: mp4('prompt-neon-alley-clip', 6),
    publishedDaysAgo: 1,
  },
  {
    id: '9a000000-0000-4000-8000-000000000002',
    slug: 'handheld-market-run',
    priceCents: 700,
    runtimeSeconds: 30,
    source: 'yagi',
    status: 'published',
    title: 'Handheld market run',
    titleKo: '핸드헬드 시장 러닝',
    text: 'Handheld follow shot running through a covered market, vendors blurring past, natural daylight through the roof panels, 24mm, slight rolling shutter, breath in the audio-free frame.',
    sentinel: 'SENTINEL_PROMPT_YAGI_2',
    textVisibility: 'pro',
    useCase: ['vlog', 'ugc'],
    featured: true,
    poster: png('prompt-market-run', 1280, 720),
    video: mp4('prompt-market-run-clip', 8),
    // The audio-carrying fixture: exercises staging→copy→route→download over real bytes.
    audio: mp3('prompt-market-run-ambience'),
    publishedDaysAgo: 2,
  },
  {
    id: '9a000000-0000-4000-8000-000000000003',
    slug: 'product-turntable-studio',
    source: 'yagi',
    status: 'published',
    title: 'Product turntable, studio white',
    titleKo: '제품 턴테이블, 스튜디오 화이트',
    text: 'Locked-off macro of a matte ceramic bottle on a slow turntable, seamless white cyclorama, single large softbox camera-left, crisp specular roll-off, no logo distortion.',
    sentinel: 'SENTINEL_PROMPT_YAGI_3',
    textVisibility: 'pro',
    useCase: ['brand-ad'],
    featured: false,
    poster: png('prompt-turntable', 1080, 1080),
    publishedDaysAgo: 4,
  },
  {
    id: '9a000000-0000-4000-8000-000000000004',
    slug: 'mv-strobe-corridor',
    source: 'yagi',
    status: 'published',
    title: 'MV strobe corridor',
    titleKo: '뮤비 스트로브 복도',
    text: 'Wide lens push through a concrete corridor lit by a single strobing practical, subject walking to camera on the beat, heavy contrast, deep blacks, no motion blur on the face.',
    sentinel: 'SENTINEL_PROMPT_YAGI_4',
    textVisibility: 'pro',
    useCase: ['mv', 'cinematic'],
    featured: false,
    poster: png('prompt-strobe-corridor', 1280, 1600),
    publishedDaysAgo: 6,
  },
  {
    id: '9a000000-0000-4000-8000-000000000005',
    slug: 'kitchen-tutorial-overhead',
    source: 'yagi',
    status: 'published',
    title: 'Kitchen tutorial overhead',
    titleKo: '주방 튜토리얼 오버헤드',
    text: 'Top-down locked frame over a wooden board, two hands working in shot, soft north-window light, no hard shadow across the board, steady 90-degree camera.',
    sentinel: 'SENTINEL_PROMPT_YAGI_5',
    textVisibility: 'pro',
    useCase: ['tutorial'],
    featured: false,
    poster: png('prompt-kitchen-overhead', 1440, 1080),
    publishedDaysAgo: 9,
  },
  {
    id: '9a000000-0000-4000-8000-000000000006',
    slug: 'game-cinematic-flyover',
    // The one short film (≤ 10 s) among the solo videos, so the video list offers three length bands
    // locally (15 s · 30 s · this) and keeps NULL-length cards that show under "all" only.
    runtimeSeconds: 8,
    source: 'yagi',
    status: 'published',
    title: 'Game cinematic flyover',
    titleKo: '게임 시네마틱 플라이오버',
    text: 'Drone-style flyover of a ruined citadel at golden hour, volumetric light through broken arches, wide establishing move ending on the gate, game-cinematic grade.',
    sentinel: 'SENTINEL_PROMPT_YAGI_6',
    textVisibility: 'pro',
    useCase: ['game', 'cinematic'],
    featured: false,
    poster: png('prompt-citadel-flyover', 1600, 900),
    publishedDaysAgo: 12,
  },
  // --- the two deliberate public teasers (§13.3-2) -------------------------
  {
    id: '9a000000-0000-4000-8000-000000000007',
    slug: 'static-portrait-window-light',
    medium: 'image',
    priceCents: 200,
    priceKrw: 2500,
    engine: 'gpt-image-2',
    aspectDefault: '4:5',
    source: 'yagi',
    status: 'published',
    title: 'Static portrait, window light',
    titleKo: '정적 인물, 창문 광',
    text: 'Static medium close-up, subject facing a window, soft directional daylight, no camera move at all, 50mm, natural skin tone, eyes in focus.',
    sentinel: 'SENTINEL_PROMPT_TEASER_1',
    textVisibility: 'public',
    useCase: ['cinematic'],
    featured: false,
    poster: png('prompt-window-portrait', 1080, 1350),
    // The one fixture shaped like a set, so the sweep reads the set section against a real server.
    gallery: [png('prompt-window-portrait-frame-1', 1080, 1350), png('prompt-window-portrait-frame-2', 1080, 1350)],
    publishedDaysAgo: 15,
  },
  {
    id: '9a000000-0000-4000-8000-000000000008',
    slug: 'short-film-establishing-rooftop',
    source: 'yagi',
    status: 'published',
    title: 'Short film establishing rooftop',
    titleKo: '단편 오프닝 옥상',
    text: 'Slow tilt up from a rooftop water tank to the skyline at blue hour, wide, no people, deliberate emptiness, 2.39:1 framing.',
    sentinel: 'SENTINEL_PROMPT_TEASER_2',
    textVisibility: 'public',
    useCase: ['short-film'],
    featured: false,
    poster: png('prompt-rooftop', 1600, 900),
    publishedDaysAgo: 20,
  },
];

// ---------------------------------------------------------------------------
// rail 2 — FROM THE COMMUNITY (3 published + 1 pending + 1 rejected)
// ---------------------------------------------------------------------------

const COMMUNITY: PromptFixture[] = [
  {
    id: '9b000000-0000-4000-8000-000000000001',
    slug: 'skate-park-golden-hour',
    source: 'community',
    status: 'published',
    authorKey: 'free',
    handle: 'hana',
    title: 'Skate park, golden hour',
    titleKo: null,
    text: 'Low-angle tracking shot beside a skater dropping into a bowl, golden hour backlight, dust in the air, 16mm, slight speed ramp on the landing.',
    sentinel: 'SENTINEL_PROMPT_COMMUNITY_1',
    textVisibility: 'public',
    useCase: ['ugc', 'vlog'],
    featured: false,
    poster: png('prompt-skate-park', 1080, 1350),
    publishedDaysAgo: 3,
  },
  {
    id: '9b000000-0000-4000-8000-000000000002',
    slug: 'cafe-window-timelapse',
    source: 'community',
    status: 'published',
    authorKey: 'pro',
    handle: 'jun',
    title: 'Cafe window timelapse',
    titleKo: null,
    text: 'Locked-off timelapse through a rain-streaked cafe window, passers-by smearing into light trails, warm interior against cold exterior, no exposure flicker.',
    sentinel: 'SENTINEL_PROMPT_COMMUNITY_2',
    textVisibility: 'public',
    useCase: ['cinematic'],
    featured: false,
    poster: png('prompt-cafe-window', 1280, 720),
    publishedDaysAgo: 5,
  },
  {
    /** Text-only: no media at all, so the §13.3-4 typographic poster is what the card renders. */
    id: '9b000000-0000-4000-8000-000000000003',
    slug: 'talking-head-brand-read',
    source: 'community',
    status: 'published',
    authorKey: 'free',
    handle: 'minseo',
    title: 'Talking head brand read',
    titleKo: null,
    text: 'Chest-up presenter to camera in a bright office, seamless loop-friendly framing, subtle depth of field, no lip-sync artefacts on plosives, neutral grade.',
    sentinel: 'SENTINEL_PROMPT_COMMUNITY_3',
    textVisibility: 'public',
    useCase: ['brand-ad', 'ugc'],
    featured: false,
    publishedDaysAgo: 8,
  },
  {
    /** Must never appear anywhere public — the moderation queue is not a preview surface. */
    id: '9b000000-0000-4000-8000-000000000004',
    slug: 'pending-underwater-drift',
    source: 'community',
    status: 'pending',
    authorKey: 'free',
    handle: 'hana',
    title: 'Underwater drift',
    titleKo: null,
    text: 'Slow drift past a kelp forest with god rays overhead, neutral buoyancy, no bubbles crossing the lens.',
    sentinel: 'SENTINEL_PENDING',
    textVisibility: 'public',
    useCase: ['cinematic'],
    featured: false,
    poster: png('prompt-pending-underwater', 1080, 1080),
    video: mp4('prompt-pending-underwater-clip', 9),
  },
  {
    id: '9b000000-0000-4000-8000-000000000005',
    slug: 'rejected-stock-lookalike',
    source: 'community',
    status: 'rejected',
    authorKey: 'pro',
    handle: 'jun',
    title: 'Stock lookalike montage',
    titleKo: null,
    text: 'Generic business handshake montage in a glass lobby, four cuts, corporate grade.',
    sentinel: 'SENTINEL_REJECTED',
    textVisibility: 'public',
    useCase: ['brand-ad'],
    featured: false,
    rejectReason: 'It reads as stock footage rather than a prompt worth publishing. Send something only you would shoot.',
  },
];

export const PROMPT_FIXTURES: PromptFixture[] = [...YAGI, ...COMMUNITY];

// ---------------------------------------------------------------------------
// sentinels — the sweep's oracle
// ---------------------------------------------------------------------------

export interface PromptSentinel {
  slug: string;
  token: string;
  status: PromptStatus;
  source: PromptSource;
  visibility: Visibility;
  /** True when an ANONYMOUS reader must be able to see this token on the item's detail page. */
  publicToAnon: boolean;
}

export const PROMPT_SENTINELS: PromptSentinel[] = PROMPT_FIXTURES.map((fixture) => ({
  slug: fixture.slug,
  token: fixture.sentinel,
  status: fixture.status,
  source: fixture.source,
  visibility: fixture.textVisibility,
  publicToAnon: fixture.status === 'published' && fixture.textVisibility === 'public',
}));

/** The two slugs that must 404 for everyone, everywhere (§13.1 moderation). */
export const HIDDEN_PROMPT_SLUGS = PROMPT_FIXTURES.filter(
  (fixture) => fixture.status !== 'published',
).map((fixture) => fixture.slug);
