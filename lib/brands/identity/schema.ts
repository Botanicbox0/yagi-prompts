import { z } from 'zod';
import { COLOUR, IMAGERY, MODEL_ROLES, TYPE, WORLD, contrast } from '@/lib/design/identity';

const HexColourSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB hex colour')
  .transform((hex) => hex.toLowerCase() as `#${string}`);

export const BrandColourSchema = z
  .object({
    paper: HexColourSchema,
    canvas: HexColourSchema,
    sky: HexColourSchema,
    ink: HexColourSchema,
    body: HexColourSchema,
    muted: HexColourSchema,
    line: HexColourSchema,
    lineStrong: HexColourSchema,
    accent: HexColourSchema
  })
  .superRefine((colour, ctx) => {
    const accentOnWhite = contrast('#ffffff', colour.accent);
    if (accentOnWhite < 4.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accent'],
        message: `Accent contrast against #ffffff must be at least 4.5:1 (got ${accentOnWhite.toFixed(2)}:1)`
      });
    }
    const inkOnCanvas = contrast(colour.ink, colour.canvas);
    if (inkOnCanvas < 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ink'],
        message: `Ink contrast against canvas must be at least 7:1 (got ${inkOnCanvas.toFixed(2)}:1)`
      });
    }
    const bodyOnPaper = contrast(colour.body, colour.paper);
    if (bodyOnPaper < 4.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body'],
        message: `Body contrast against paper must be at least 4.5:1 (got ${bodyOnPaper.toFixed(2)}:1)`
      });
    }
  });

const TypeScaleStepSchema = z.object({
  weight: z.number().int().min(300).max(900),
  tracking: z.string().trim().min(1).max(32),
  leading: z.number().min(0.85).max(2.4)
});

export const BrandTypeSchema = z.object({
  sans: z.string().trim().min(1).max(240),
  mono: z.string().trim().min(1).max(240),
  display: TypeScaleStepSchema,
  heading: TypeScaleStepSchema,
  body: TypeScaleStepSchema
});

export const BrandWorldSchema = z.object({
  ownedHue: z
    .tuple([z.number().min(0).max(360), z.number().min(0).max(360)])
    .refine(([lo, hi]) => lo <= hi, 'ownedHue min must not exceed max'),
  warmPerScreen: z.number().int().min(0).max(5),
  skinProtected: z.literal(true)
});

export const BrandModelRolesSchema = z.object({
  editorial: z.string().trim().min(1).max(80),
  referenceExact: z.string().trim().min(1).max(80),
  faceAndEdit: z.string().trim().min(1).max(80),
  film: z.string().trim().min(1).max(80),
  swap: z.string().trim().min(1).max(80)
});

export const LOGO_PLACEMENTS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'center'
] as const;
export type LogoPlacement = (typeof LOGO_PLACEMENTS)[number];

export const BrandLogoRuleSchema = z.object({
  minSizePx: z.number().int().min(12).max(400),
  clearSpace: z.string().trim().min(1).max(80),
  placement: z.array(z.enum(LOGO_PLACEMENTS)).min(1).max(5)
});

export const BrandRulesSchema = z.object({
  logo: BrandLogoRuleSchema,
  forbiddenTerms: z.array(z.string().trim().min(1).max(120)).max(50),
  paletteOnly: z.boolean(),
  consentedFacesOnly: z.literal(true),
  competitorExclusions: z.array(z.string().trim().min(1).max(120)).max(50),
  never: z.array(z.string().trim().min(1).max(200)).max(3)
});

export const REFERENCE_ROLES = ['subject', 'place', 'pose', 'style', 'palette'] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];

export const BrandReferenceRuleSchema = z.object({
  role: z.enum(REFERENCE_ROLES),
  lend: z.string().trim().min(1).max(300),
  not: z.string().trim().min(1).max(300)
});

export const BrandVoiceSchema = z.object({
  tone: z.string().trim().min(1).max(400),
  forbiddenWords: z.array(z.string().trim().min(1).max(80)).max(50)
});

export const BrandIdentitySchema = z.object({
  colour: BrandColourSchema,
  type: BrandTypeSchema,
  world: BrandWorldSchema,
  modelRoles: BrandModelRolesSchema,
  rules: BrandRulesSchema,
  references: z.array(BrandReferenceRuleSchema).max(14),
  productChecklist: z.array(z.string().trim().min(1).max(300)).max(20),
  voice: BrandVoiceSchema
});

export type BrandIdentity = z.infer<typeof BrandIdentitySchema>;

export const BRAND_IDENTITY_STATUSES = ['draft', 'confirmed'] as const;
export type BrandIdentityStatus = (typeof BRAND_IDENTITY_STATUSES)[number];

declare const confirmedBrandIdentityBrand: unique symbol;
export type ConfirmedBrandIdentity = BrandIdentity & {
  readonly [confirmedBrandIdentityBrand]: 'confirmed';
};

export function markConfirmedBrandIdentity(identity: BrandIdentity): ConfirmedBrandIdentity {
  return identity as ConfirmedBrandIdentity;
}

export const BRAND_MEMORY_KINDS = [
  'approved_cut',
  'fix',
  'banned_phrase',
  'saved_look',
  'note'
] as const;
export type BrandMemoryKind = (typeof BRAND_MEMORY_KINDS)[number];

export const BrandMemoryInputSchema = z.object({
  kind: z.enum(BRAND_MEMORY_KINDS),
  payload: z.record(z.string(), z.unknown()).default({})
});

export const BRAND_LOOK_SOURCES = ['preset', 'reference_match'] as const;
export type BrandLookSource = (typeof BRAND_LOOK_SOURCES)[number];

export const BrandLookInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  lutKey: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  measurements: z.record(z.string(), z.unknown()).default({}),
  intensity: z.number().min(0).max(1).default(1),
  skinProtect: z.boolean().default(true),
  source: z.enum(BRAND_LOOK_SOURCES).default('preset')
});

export type BrandLookInput = z.infer<typeof BrandLookInputSchema>;

export function twingsDefaultIdentity(): BrandIdentity {
  return BrandIdentitySchema.parse({
    colour: {
      paper: COLOUR.paper,
      canvas: COLOUR.canvas,
      sky: COLOUR.sky,
      ink: COLOUR.ink,
      body: COLOUR.body,
      muted: COLOUR.muted,
      line: COLOUR.line,
      lineStrong: COLOUR.lineStrong,
      accent: WORLD.french
    },
    type: {
      sans: TYPE.sans,
      mono: TYPE.mono,
      display: {
        weight: TYPE.display.weight,
        tracking: TYPE.display.tracking,
        leading: TYPE.display.leading
      },
      heading: {
        weight: TYPE.heading.weight,
        tracking: TYPE.heading.tracking,
        leading: TYPE.heading.leading
      },
      body: {
        weight: TYPE.body.weight,
        tracking: TYPE.body.tracking,
        leading: TYPE.body.leading
      }
    },
    world: {
      ownedHue: [IMAGERY.ownedHue[0], IMAGERY.ownedHue[1]],
      warmPerScreen: IMAGERY.warmPerScreen,
      skinProtected: true
    },
    modelRoles: {
      editorial: MODEL_ROLES.editorial,
      referenceExact: MODEL_ROLES.referenceExact,
      faceAndEdit: MODEL_ROLES.faceAndEdit,
      film: MODEL_ROLES.film,
      swap: MODEL_ROLES.swap
    },
    rules: {
      logo: {
        minSizePx: 24,
        clearSpace: '1x cap-height',
        placement: ['top-left', 'bottom-right']
      },
      forbiddenTerms: ['무료 크레딧', '무제한 생성', 'AI 생성 표시'],
      paletteOnly: true,
      consentedFacesOnly: true,
      competitorExclusions: [],
      never: [
        '화면 배경이나 강조 버튼에 빨강·형광·네온 그라디언트를 쓰지 않는다',
        '동의·검수되지 않은 인물 사진을 참조에 넣지 않는다',
        '제품 로고 비율·철자·용기 형태를 변형하지 않는다'
      ]
    },
    references: [
      {
        role: 'subject',
        lend: '제품 실루엣, 용기 비율, 라벨 위치, 재질 광택',
        not: '촬영 배경의 임의 소품이나 타 브랜드 표식'
      },
      {
        role: 'place',
        lend: '화이트 페이퍼 스튜디오, 쿨 데이라이트 창가, 정돈된 건축 표면',
        not: '사이버펑크 네온, 과장된 오렌지/틸 룩'
      },
      {
        role: 'style',
        lend: '35mm/50mm 자연광 에디토리얼, 얕은 필름 그레인, 피부 톤 보호',
        not: '플라스틱 피부 보정, 과채도 HDR'
      }
    ],
    productChecklist: [
      '로고 철자와 자간이 원본 에셋과 정확히 일치하는가',
      '제품 용기 비율과 뚜껑·라벨 경계가 왜곡되지 않았는가',
      '브랜드 대표 색이 조명 때문에 다른 색으로 틀어지지 않았는가',
      '인물이 포함된 경우 피부 톤이 룩 보정에서 보호되었는가'
    ],
    voice: {
      tone: '명확하고 단정한 에디토리얼 톤. 과장 형용사 대신 숫자와 사실로 말한다.',
      forbiddenWords: ['혁신적인', '압도적인', '완벽한 AI', '마법 같은']
    }
  });
}

export const ONBOARDING_VIBES = [
  'minimal_editorial',
  'warm_film',
  'crisp_commercial',
  'high_contrast_street',
  'natural_daylight'
] as const;

export type OnboardingVibe = (typeof ONBOARDING_VIBES)[number];

