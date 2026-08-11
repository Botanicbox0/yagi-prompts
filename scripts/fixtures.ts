import type { AssetRef, BlockKind, Localized } from '@/lib/content/schemas';
import type { Visibility } from '@/lib/content/visibility';

/**
 * PLAN §8 M0 / §9 — two polished fixture playbooks with clearly-labelled placeholder media.
 *
 * Coverage the acceptance tests rely on:
 *   · playbook 1 `character-sheet-generation` — is_showcase, blocks at DEFAULT policy, plus one
 *     `public` asset so the showcase routing branch (public-content) is exercised.
 *   · playbook 2 `talking-character-clip`     — NOT showcase, the full 6 kinds × 4 visibility
 *     levels matrix (24 blocks) with explicit overrides, so every gate and the
 *     "public but not showcase ⇒ content-published" branch are exercised.
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
  build: (mkAsset: AssetFactory) => unknown;
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
// per-kind content builders (shapes are §6.1 verbatim)
// ---------------------------------------------------------------------------

const promptContent = (text: string, model: string) => () => ({ text, model });

const paramsContent = (rows: Array<[string, string]>) => () => ({
  rows: rows.map(([k, v]) => ({ k, v })),
});

const noteContent = (md: Localized) => () => ({ md });

const linkContent = (url: string, label: Localized) => () => ({ url, label });

const assetContent =
  (spec: AssetSpec, caption?: Localized) =>
  (mkAsset: AssetFactory) => (caption ? { asset: mkAsset(spec), caption } : { asset: mkAsset(spec) });

const workflowContent =
  (spec: AssetSpec, filename: string, format: string) => (mkAsset: AssetFactory) => ({
    asset: mkAsset(spec),
    filename,
    size_bytes: 4096,
    format,
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
  hero: { label: 'pb1-hero', ext: 'jpg', mime: 'image/jpeg', w: 1600, h: 900 },
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
