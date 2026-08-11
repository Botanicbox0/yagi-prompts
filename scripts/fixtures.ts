import type { AssetRef, BlockKind, Localized } from '@/lib/content/schemas';
import { DEFAULT_POLICY, resolveVisibility, type Visibility } from '@/lib/content/visibility';

/**
 * PLAN §8 M0 / §9 — the fixture catalog: polished playbooks with clearly-labelled placeholder media.
 *
 * Core set (`FIXTURE_PLAYBOOKS`, published by `seed()`):
 *   · playbook 1 `character-sheet-generation` — is_showcase, blocks at DEFAULT policy, plus one
 *     `public` asset so the showcase routing branch (public-content) is exercised.
 *   · playbook 2 `talking-character-clip`     — NOT showcase, the full 6 kinds × 4 visibility
 *     levels matrix (24 blocks) with explicit overrides, so every gate and the
 *     "public but not showcase ⇒ content-published" branch are exercised.
 *
 * Edge set (`EDGE_FIXTURE_PLAYBOOKS`, applied by `seedEdgeFixtures()` — M2): the playbook STATES the
 * façade and the media gateway have to refuse, which the core two cannot express because they are
 * both single-revision published playbooks. Kept out of `seed()` deliberately: the M0/M1 acceptance
 * suites assert on the exact shape of the published catalog, and their subject should not drift
 * because a later milestone needed a draft to 404 on.
 *
 * **Sentinels** (M2): every block carries a unique, greppable token embedded in its CONTENT — the
 * gated bytes themselves. `npm run sweep:anon` then asserts a real property rather than a proxy:
 * for an anonymous reader, no token belonging to a block above their tier appears anywhere in the
 * HTML, and the tokens below it do. A leak of any kind — teaser text, a blurred payload, a Flight
 * chunk, a stray serialisation — trips it.
 */

export interface AssetSpec {
  label: string;
  ext: string;
  mime: string;
  w?: number;
  h?: number;
  duration_s?: number;
}

export type AssetFactory = (spec: AssetSpec) => AssetRef;

export interface BlockSpec {
  kind: BlockKind;
  /** undefined ⇒ inherit default_policy(kind) */
  visibility?: Visibility;
  build: (mkAsset: AssetFactory, sentinel: string) => unknown;
}

export interface StepSpec {
  title: Localized;
  body: Localized | null;
  blocks: BlockSpec[];
}

export interface PlaybookSpec {
  id: string;
  slug: string;
  category: 'image' | 'video' | 'character' | 'voice' | 'music' | 'pipeline';
  sort: number;
  revisionId: string;
  isShowcase: boolean;
  title: Localized;
  summary: Localized;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  tools: string[];
  models: string[];
  estTimeMin: number;
  estCostUsd: number;
  hero: AssetSpec;
  steps: StepSpec[];
}

const L = (en: string, ko: string): Localized => ({ en, ko });

// ---------------------------------------------------------------------------
// sentinels — one unique token per block, embedded in that block's gated content
// ---------------------------------------------------------------------------

/** Uppercase + underscores only: greppable in raw HTML, and unharmed by markdown or `toUpperCase`. */
export function sentinelToken(slug: string, stepOrder: number, blockOrder: number): string {
  return `SENTINEL_${slug.replace(/-/g, '_').toUpperCase()}_S${stepOrder}_B${blockOrder}`;
}

export interface FixtureSentinel {
  slug: string;
  token: string;
  kind: BlockKind;
  /** Effective visibility: `coalesce(override, default_policy[kind])` — the same rule the RPC uses. */
  visibility: Visibility;
  stepOrder: number;
  blockOrder: number;
}

export function sentinelsFor(specs: PlaybookSpec[]): FixtureSentinel[] {
  return specs.flatMap((spec) =>
    spec.steps.flatMap((step, stepIndex) =>
      step.blocks.map((block, blockIndex) => ({
        slug: spec.slug,
        token: sentinelToken(spec.slug, stepIndex + 1, blockIndex + 1),
        kind: block.kind,
        visibility: resolveVisibility(block.visibility, block.kind, DEFAULT_POLICY),
        stepOrder: stepIndex + 1,
        blockOrder: blockIndex + 1,
      })),
    ),
  );
}

// ---------------------------------------------------------------------------
// per-kind content builders (shapes are §6.1 verbatim)
// ---------------------------------------------------------------------------

const promptContent = (text: string, model: string) => (_mk: AssetFactory, sentinel: string) => ({
  text: `${text}\n:: ${sentinel}`,
  model,
});

const paramsContent =
  (rows: Array<[string, string]>) => (_mk: AssetFactory, sentinel: string) => ({
    rows: [...rows.map(([k, v]) => ({ k, v })), { k: 'fixture', v: sentinel }],
  });

const noteContent = (md: Localized) => (_mk: AssetFactory, sentinel: string) => ({
  md: { en: `${md.en} (${sentinel})`, ko: `${md.ko} (${sentinel})` },
});

const linkContent =
  (url: string, label: Localized) => (_mk: AssetFactory, sentinel: string) => ({
    url,
    label: { en: `${label.en} · ${sentinel}`, ko: `${label.ko} · ${sentinel}` },
  });

const assetContent =
  (spec: AssetSpec, caption: Localized) => (mkAsset: AssetFactory, sentinel: string) => ({
    asset: mkAsset(spec),
    caption: { en: `${caption.en} · ${sentinel}`, ko: `${caption.ko} · ${sentinel}` },
  });

const workflowContent =
  (spec: AssetSpec, filename: string, format: string) =>
  (mkAsset: AssetFactory, sentinel: string) => ({
    asset: mkAsset(spec),
    filename,
    size_bytes: 4096,
    format: `${format} ${sentinel}`,
  });

// ---------------------------------------------------------------------------
// playbook 1 — showcase, default policy
// ---------------------------------------------------------------------------

const PLAYBOOK_ONE: PlaybookSpec = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'character-sheet-generation',
  category: 'character',
  sort: 100,
  revisionId: '11111111-1111-4111-8111-1111111111a1',
  isShowcase: true,
  title: L('Character sheet generation', '캐릭터 시트 제작'),
  summary: L(
    'Turn one reference face into a consistent multi-pose character sheet.',
    '레퍼런스 얼굴 한 장을 일관된 멀티 포즈 캐릭터 시트로 만듭니다.',
  ),
  difficulty: 'intermediate',
  tools: ['ComfyUI', 'Photoshop'],
  models: ['GPT Image 2', 'InsightFace'],
  estTimeMin: 45,
  estCostUsd: 1.2,
  hero: { label: 'pb1-hero', ext: 'png', mime: 'image/png', w: 1600, h: 900 },
  steps: [
    {
      title: L('Prepare the reference', '레퍼런스 준비'),
      body: L(
        'A single well-lit frontal reference beats ten mediocre ones.',
        '조명이 좋은 정면 레퍼런스 한 장이 애매한 열 장보다 낫습니다.',
      ),
      blocks: [
        {
          kind: 'note',
          build: noteContent(
            L(
              '**Placeholder fixture content.** Crop to the shoulders, 1024px minimum.',
              '**플레이스홀더 픽스처 내용입니다.** 어깨선까지 자르고 최소 1024px로 맞추세요.',
            ),
          ),
        },
        {
          kind: 'link',
          build: linkContent('https://example.com/reference-guide', L('Reference guide', '레퍼런스 가이드')),
        },
        {
          kind: 'asset',
          // Explicit `public` override on a SHOWCASE revision ⇒ routes to public-content.
          visibility: 'public',
          build: assetContent(
            { label: 'pb1-reference', ext: 'png', mime: 'image/png', w: 1024, h: 1024 },
            L('Placeholder reference frame', '플레이스홀더 레퍼런스 프레임'),
          ),
        },
      ],
    },
    {
      title: L('Generate the sheet', '시트 생성'),
      body: null,
      blocks: [
        {
          kind: 'prompt',
          build: promptContent(
            'character sheet, 6 poses, neutral studio background, consistent face, full body',
            'GPT Image 2',
          ),
        },
        {
          kind: 'params',
          build: paramsContent([
            ['size', '1536x1024'],
            ['quality', 'high'],
            ['reference weight', '0.8'],
          ]),
        },
        {
          kind: 'asset',
          build: assetContent(
            { label: 'pb1-output', ext: 'png', mime: 'image/png', w: 1536, h: 1024 },
            L('Placeholder output sheet', '플레이스홀더 결과 시트'),
          ),
        },
        {
          kind: 'workflow_file',
          build: workflowContent(
            { label: 'pb1-graph', ext: 'json', mime: 'application/json' },
            'character-sheet.json',
            'comfyui',
          ),
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// playbook 2 — not showcase, full kind × visibility matrix
// ---------------------------------------------------------------------------

const VISIBILITIES: Visibility[] = ['public', 'free', 'pro', 'hidden'];

const KO_LEVEL: Record<Visibility, string> = {
  public: '공개',
  free: '무료',
  pro: '프로',
  hidden: '비공개',
};

function matrixStep(level: Visibility): StepSpec {
  return {
    title: L(`Visibility level: ${level}`, `공개 등급: ${KO_LEVEL[level]}`),
    body: L(
      `Every block kind at ${level} visibility.`,
      `모든 블록 종류를 ${KO_LEVEL[level]} 등급으로 배치했습니다.`,
    ),
    blocks: [
      {
        kind: 'prompt',
        visibility: level,
        build: promptContent(`talking character clip, ${level} tier fixture prompt`, 'Kling 3.0'),
      },
      {
        kind: 'params',
        visibility: level,
        build: paramsContent([
          ['tier', level],
          ['fps', '24'],
        ]),
      },
      {
        kind: 'asset',
        visibility: level,
        build: assetContent(
          { label: `pb2-${level}-frame`, ext: 'png', mime: 'image/png', w: 1280, h: 720 },
          L(`Placeholder ${level} frame`, `플레이스홀더 ${KO_LEVEL[level]} 프레임`),
        ),
      },
      {
        kind: 'note',
        visibility: level,
        build: noteContent(
          L(`Fixture note at ${level} visibility.`, `${KO_LEVEL[level]} 등급 픽스처 노트입니다.`),
        ),
      },
      {
        kind: 'link',
        visibility: level,
        build: linkContent(
          `https://example.com/${level}`,
          L(`${level} reference`, `${KO_LEVEL[level]} 레퍼런스`),
        ),
      },
      {
        kind: 'workflow_file',
        visibility: level,
        build: workflowContent(
          { label: `pb2-${level}-graph`, ext: 'json', mime: 'application/json' },
          `talking-clip-${level}.json`,
          'comfyui',
        ),
      },
    ],
  };
}

const PLAYBOOK_TWO: PlaybookSpec = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'talking-character-clip',
  category: 'video',
  sort: 90,
  revisionId: '22222222-2222-4222-8222-2222222222a1',
  isShowcase: false,
  title: L('Talking character clip', '말하는 캐릭터 클립'),
  summary: L(
    'Image to voice to lipsync, end to end, with the failure modes called out.',
    '이미지에서 음성, 립싱크까지 한 번에 — 실패 지점까지 함께 정리했습니다.',
  ),
  difficulty: 'advanced',
  tools: ['ComfyUI', 'ffmpeg'],
  models: ['Kling 3.0', 'Qwen3-TTS'],
  estTimeMin: 90,
  estCostUsd: 4.5,
  hero: { label: 'pb2-hero', ext: 'mp4', mime: 'video/mp4', w: 1920, h: 1080, duration_s: 12 },
  steps: VISIBILITIES.map(matrixStep),
};

export const FIXTURE_PLAYBOOKS: PlaybookSpec[] = [PLAYBOOK_ONE, PLAYBOOK_TWO];

// ---------------------------------------------------------------------------
// edge set (M2) — the playbook STATES the read path has to refuse
// ---------------------------------------------------------------------------

/**
 * How `seedEdgeFixtures()` should treat each spec after building the draft:
 *   `draft`       — leave it unpublished. Nothing about it is reachable: 404 for every tier, and
 *                   its block ids are the "draft revision" case the media gateway must refuse.
 *   `archived`    — publish through the real pipeline, then archive the playbook. The published
 *                   pointer SURVIVES archiving (§6), so this is the case where only
 *                   `playbooks.status` stands between an archived playbook and the public read path.
 *   `republished` — publish rev 1, then publish rev 2 with a change note. Rev 1 becomes
 *                   `superseded`: its block ids address real, physically-copied objects that the
 *                   gateway must nonetheless refuse, and rev 2 is the only fixture carrying the
 *                   change note §3.3's header renders.
 */
export type EdgeMode = 'draft' | 'archived' | 'republished';

export interface EdgePlaybookSpec extends PlaybookSpec {
  mode: EdgeMode;
  /** `republished` only. */
  secondRevisionId?: string;
  changeNote?: Localized;
}

const LORA: EdgePlaybookSpec = {
  mode: 'republished',
  id: '33333333-3333-4333-8333-333333333333',
  slug: 'character-lora-training',
  category: 'pipeline',
  sort: 80,
  revisionId: '33333333-3333-4333-8333-3333333333a1',
  secondRevisionId: '33333333-3333-4333-8333-3333333333a2',
  isShowcase: false,
  title: L('Character LoRA training', '캐릭터 LoRA 학습'),
  summary: L(
    'A 22-minute LoRA recipe that holds one face across every shot.',
    '한 얼굴을 모든 컷에서 유지하는 22분짜리 LoRA 레시피입니다.',
  ),
  difficulty: 'beginner',
  tools: ['ComfyUI', 'kohya_ss'],
  models: ['Z-Image', 'ArcFace'],
  estTimeMin: 22,
  estCostUsd: 0,
  hero: { label: 'pb3-hero', ext: 'png', mime: 'image/png', w: 1600, h: 900 },
  changeNote: L(
    'Swapped the base model to Z-Image and cut training from 40 to 22 minutes.',
    '베이스 모델을 Z-Image로 교체하고 학습 시간을 40분에서 22분으로 줄였습니다.',
  ),
  steps: [
    {
      title: L('Build the dataset', '데이터셋 구성'),
      body: L('Twenty frames beat two hundred.', '스무 장이 이백 장보다 낫습니다.'),
      blocks: [
        {
          kind: 'note',
          build: noteContent(
            L('**Placeholder fixture content.** 20 frames, varied angles.', '**플레이스홀더 픽스처 내용입니다.** 각도를 바꿔 20장.'),
          ),
        },
        {
          kind: 'params',
          build: paramsContent([
            ['rank', '16'],
            ['steps', '1200'],
          ]),
        },
      ],
    },
    {
      title: L('Train and verify', '학습과 검증'),
      body: null,
      blocks: [
        {
          kind: 'prompt',
          build: promptContent('portrait of the trained character, neutral light', 'Z-Image'),
        },
        {
          kind: 'asset',
          build: assetContent(
            { label: 'pb3-grid', ext: 'png', mime: 'image/png', w: 1024, h: 1024 },
            L('Placeholder verification grid', '플레이스홀더 검증 그리드'),
          ),
        },
      ],
    },
  ],
};

const INSTA_TOON: EdgePlaybookSpec = {
  mode: 'draft',
  id: '44444444-4444-4444-8444-444444444444',
  slug: 'insta-toon-pipeline',
  category: 'image',
  sort: 70,
  revisionId: '44444444-4444-4444-8444-4444444444a1',
  isShowcase: false,
  title: L('Insta-toon pipeline', '인스타툰 파이프라인'),
  summary: L(
    'Four-cut stories from script to published panels.',
    '대본에서 게시까지, 네 컷 이야기를 만드는 흐름입니다.',
  ),
  difficulty: 'intermediate',
  tools: ['ComfyUI'],
  models: ['Nano Banana'],
  estTimeMin: 60,
  estCostUsd: 0.8,
  hero: { label: 'pb4-hero', ext: 'png', mime: 'image/png', w: 1200, h: 1200 },
  steps: [
    {
      title: L('Write the four beats', '네 컷 구성'),
      body: null,
      blocks: [
        {
          kind: 'prompt',
          build: promptContent('four panel comic, consistent character, flat colour', 'Nano Banana'),
        },
        {
          kind: 'asset',
          build: assetContent(
            { label: 'pb4-panel', ext: 'png', mime: 'image/png', w: 1080, h: 1080 },
            L('Placeholder panel', '플레이스홀더 패널'),
          ),
        },
      ],
    },
  ],
};

const VOICE_IDENTITY: EdgePlaybookSpec = {
  mode: 'archived',
  id: '55555555-5555-4555-8555-555555555555',
  slug: 'voice-identity-setup',
  category: 'voice',
  sort: 60,
  revisionId: '55555555-5555-4555-8555-5555555555a1',
  isShowcase: true,
  title: L('Voice identity setup', '보이스 아이덴티티 세팅'),
  summary: L(
    'Retired: the TTS selection this described no longer ships.',
    '보관 처리: 여기서 다룬 TTS 선택지는 더 이상 제공되지 않습니다.',
  ),
  difficulty: 'intermediate',
  tools: ['Audacity'],
  models: ['Qwen3-TTS'],
  estTimeMin: 30,
  estCostUsd: 0,
  hero: { label: 'pb5-hero', ext: 'png', mime: 'image/png', w: 1600, h: 900 },
  steps: [
    {
      title: L('Record the reference', '레퍼런스 녹음'),
      body: null,
      blocks: [
        {
          kind: 'note',
          build: noteContent(
            L('**Placeholder fixture content.** 30 seconds, one room.', '**플레이스홀더 픽스처 내용입니다.** 한 공간에서 30초.'),
          ),
        },
        {
          kind: 'asset',
          // is_showcase + `public` ⇒ this one lands in the PUBLIC bucket and then gets archived,
          // which is the disclosure-doctrine case (§6): still disclosed, no longer served.
          visibility: 'public',
          build: assetContent(
            { label: 'pb5-waveform', ext: 'png', mime: 'image/png', w: 1200, h: 400 },
            L('Placeholder waveform', '플레이스홀더 파형'),
          ),
        },
      ],
    },
  ],
};

export const EDGE_FIXTURE_PLAYBOOKS: EdgePlaybookSpec[] = [LORA, INSTA_TOON, VOICE_IDENTITY];

/** Every sentinel in the whole fixture catalog — what `npm run sweep:anon` asserts against. */
export const FIXTURE_SENTINELS: FixtureSentinel[] = sentinelsFor([
  ...FIXTURE_PLAYBOOKS,
  ...EDGE_FIXTURE_PLAYBOOKS,
]);

// ---------------------------------------------------------------------------
// entitlement fixtures (PLAN §8 M0) — anon is the ABSENCE of a user
// ---------------------------------------------------------------------------

export interface UserFixture {
  id: string;
  email: string;
  displayName: string;
  locale: 'en' | 'ko';
  plan: 'free' | 'pro';
  isAdmin: boolean;
  subscription?: {
    stripeSubscriptionId: string;
    status: string;
  };
}

export const FIXTURE_USERS: Record<'free' | 'pro' | 'admin', UserFixture> = {
  free: {
    id: 'f0000000-0000-4000-8000-000000000001',
    email: 'free@playbook.test',
    displayName: 'Free Fixture',
    locale: 'en',
    plan: 'free',
    isAdmin: false,
  },
  pro: {
    id: 'f0000000-0000-4000-8000-000000000002',
    email: 'pro@playbook.test',
    displayName: 'Pro Fixture',
    locale: 'ko',
    plan: 'pro',
    isAdmin: false,
    subscription: { stripeSubscriptionId: 'sub_fixture_pro', status: 'active' },
  },
  admin: {
    id: 'f0000000-0000-4000-8000-000000000003',
    email: 'admin@yagiworkshop.xyz',
    displayName: 'Admin Fixture',
    locale: 'ko',
    plan: 'free',
    isAdmin: true,
  },
};
