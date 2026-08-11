import { z } from 'zod';

/**
 * PLAN §6.1 — block content contracts.
 *
 * These schemas are the SINGLE SOURCE: the M4 admin form fields, the M2 renderer props and the
 * publish-time revalidation all derive from here. Nothing is invented downstream.
 *
 * Interpretation logged for the Director: §6.1's `AssetRef` mirror omits `sha256`, but §6 makes
 * `publish_assets.sha256` NOT NULL and states the hash is "recorded at upload". `sha256` is
 * therefore a required AssetRef field here — without it `prepare_publish` cannot build a manifest.
 */

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

/** Both locales required wherever the field is present (publish gate, §3.9). */
export const LocalizedSchema = z.object({
  en: z.string().min(1),
  ko: z.string().min(1),
});
export type Localized = z.infer<typeof LocalizedSchema>;

export const PUBLISHED_BUCKETS = [
  'public-content',
  'content-published',
  'artifacts-published',
] as const;
export const PublishedBucketSchema = z.enum(PUBLISHED_BUCKETS);
export type PublishedBucket = z.infer<typeof PublishedBucketSchema>;

export const AssetRefSchema = z.object({
  /** content/rev/{revision_id}/{uuid}.{ext} — private staging, never served. */
  staging_key: z.string().min(1),
  /** sha256 of the bytes, recorded at upload; drives the content-addressed published key. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hex chars'),
  /** Stamped by publish_revision: {sha256}.{ext} in the serving bucket. */
  published_key: z.string().min(1).optional(),
  bucket: PublishedBucketSchema.optional(),
  mime: z.string().min(1),
  w: z.number().int().positive().optional(),
  h: z.number().int().positive().optional(),
  duration_s: z.number().positive().optional(),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

export const BLOCK_KINDS = [
  'prompt',
  'params',
  'asset',
  'note',
  'link',
  'workflow_file',
] as const;
export const BlockKindSchema = z.enum(BLOCK_KINDS);
export type BlockKind = z.infer<typeof BlockKindSchema>;

// ---------------------------------------------------------------------------
// per-kind content (§6.1 verbatim)
// ---------------------------------------------------------------------------

/** Prompts are NOT translated — they are model inputs (§3.9). */
export const PromptContentSchema = z.object({
  text: z.string().min(1),
  model: z.string().min(1).optional(),
  negative: z.string().optional(),
});

export const ParamsContentSchema = z.object({
  rows: z.array(z.object({ k: z.string().min(1), v: z.string() })).min(1),
});

export const AssetContentSchema = z.object({
  asset: AssetRefSchema,
  caption: LocalizedSchema.optional(),
});

export const NoteContentSchema = z.object({
  md: LocalizedSchema,
});

export const LinkContentSchema = z.object({
  url: z.string().url(),
  label: LocalizedSchema,
});

export const WorkflowFileContentSchema = z.object({
  asset: AssetRefSchema,
  filename: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  format: z.string().min(1),
});

export type PromptContent = z.infer<typeof PromptContentSchema>;
export type ParamsContent = z.infer<typeof ParamsContentSchema>;
export type AssetContent = z.infer<typeof AssetContentSchema>;
export type NoteContent = z.infer<typeof NoteContentSchema>;
export type LinkContent = z.infer<typeof LinkContentSchema>;
export type WorkflowFileContent = z.infer<typeof WorkflowFileContentSchema>;

export const BLOCK_CONTENT_SCHEMAS = {
  prompt: PromptContentSchema,
  params: ParamsContentSchema,
  asset: AssetContentSchema,
  note: NoteContentSchema,
  link: LinkContentSchema,
  workflow_file: WorkflowFileContentSchema,
} as const;

/** The discriminated union the renderers switch on. */
export const BlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prompt'), content: PromptContentSchema }),
  z.object({ kind: z.literal('params'), content: ParamsContentSchema }),
  z.object({ kind: z.literal('asset'), content: AssetContentSchema }),
  z.object({ kind: z.literal('note'), content: NoteContentSchema }),
  z.object({ kind: z.literal('link'), content: LinkContentSchema }),
  z.object({ kind: z.literal('workflow_file'), content: WorkflowFileContentSchema }),
]);
export type Block = z.infer<typeof BlockSchema>;
export type BlockContent = Block['content'];

/** hero_asset on playbook_revisions is a bare AssetRef (§6.1). */
export const HeroAssetSchema = AssetRefSchema;

// ---------------------------------------------------------------------------
// boundary helpers
// ---------------------------------------------------------------------------

export function parseBlock(kind: BlockKind, content: unknown): Block {
  return BlockSchema.parse({ kind, content });
}

export function safeParseBlock(kind: BlockKind, content: unknown) {
  return BlockSchema.safeParse({ kind, content });
}

/** True when a block kind carries an AssetRef and therefore participates in the manifest. */
export function kindHasAsset(kind: BlockKind): boolean {
  return kind === 'asset' || kind === 'workflow_file';
}
