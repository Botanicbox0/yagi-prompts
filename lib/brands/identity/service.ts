import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  BrandFeatureDenied,
  assertBrandFeature,
  isMissingTable,
  loadFeaturePolicy
} from '../entitlements';
import type { BrandFailureCode, BrandOutcome, BrandRole } from '../workspace/types';
import {
  BRAND_IDENTITY_STATUSES,
  BrandIdentitySchema,
  BrandLookInputSchema,
  BrandMemoryInputSchema,
  markConfirmedBrandIdentity,
  twingsDefaultIdentity,
  type BrandIdentity,
  type BrandIdentityStatus,
  type BrandLookInput,
  type BrandLookSource,
  type BrandMemoryKind,
  type ConfirmedBrandIdentity
} from './schema';

export {
  BRAND_IDENTITY_STATUSES,
  BRAND_LOOK_SOURCES,
  BRAND_MEMORY_KINDS,
  BrandIdentitySchema,
  BrandLookInputSchema,
  BrandMemoryInputSchema,
  LOGO_PLACEMENTS,
  REFERENCE_ROLES,
  markConfirmedBrandIdentity,
  twingsDefaultIdentity,
  type BrandIdentity,
  type BrandIdentityStatus,
  type BrandLookInput,
  type BrandLookSource,
  type BrandMemoryKind,
  type ConfirmedBrandIdentity
} from './schema';

export interface BrandIdentityRecord {
  organizationId: string;
  version: string;
  status: BrandIdentityStatus;
  identity: BrandIdentity;
  /** Optimistic concurrency token (starts at 1 when a row exists). */
  revision: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface BrandMemoryRecord {
  id: string;
  organizationId: string;
  kind: BrandMemoryKind;
  payload: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

export interface BrandLookRecord {
  id: string;
  organizationId: string;
  title: string;
  lutKey: string | null;
  measurements: Record<string, unknown>;
  intensity: number;
  skinProtect: boolean;
  source: BrandLookSource;
  createdBy: string | null;
  createdAt: string;
}

export interface BrandIdentityWorkspace {
  identity: BrandIdentityRecord | null;
  looks: BrandLookRecord[];
  memory: BrandMemoryRecord[];
}

const uuid = z.string().uuid();

const stamp = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? '');

function splitLines(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|,/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return fallback;
}

function splitLinesOnly(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return fallback;
}

/**
 * Accepts either a full `identity` object, a JSON string `identityJson`, or structured form fields
 * from `/brand/identity`, merging against `fallback` (defaults to `twingsDefaultIdentity()`).
 */
export function coerceIdentityPayload(
  body: Record<string, unknown>,
  fallback: BrandIdentity = twingsDefaultIdentity()
): unknown {
  if (body.identity && typeof body.identity === 'object') {
    return body.identity;
  }
  if (typeof body.identityJson === 'string' && body.identityJson.trim().length > 0) {
    try {
      return JSON.parse(body.identityJson);
    } catch {
      return null;
    }
  }
  const str = (key: string, def: string) =>
    typeof body[key] === 'string' && String(body[key]).trim().length > 0
      ? String(body[key]).trim()
      : def;
  const num = (key: string, def: number) =>
    body[key] !== undefined && body[key] !== '' ? Number(body[key]) : def;
  const bool = (key: string, def: boolean) => {
    if (body[key] === undefined) return def;
    if (typeof body[key] === 'boolean') return body[key];
    return body[key] === 'true' || body[key] === '1' || body[key] === 'on';
  };

  let references: unknown = fallback.references;
  if (typeof body.referencesJson === 'string' && body.referencesJson.trim().length > 0) {
    try {
      references = JSON.parse(body.referencesJson);
    } catch {
      references = null;
    }
  }

  return {
    colour: {
      paper: str('colourPaper', fallback.colour.paper),
      canvas: str('colourCanvas', fallback.colour.canvas),
      sky: str('colourSky', fallback.colour.sky),
      ink: str('colourInk', fallback.colour.ink),
      body: str('colourBody', fallback.colour.body),
      muted: str('colourMuted', fallback.colour.muted),
      line: str('colourLine', fallback.colour.line),
      lineStrong: str('colourLineStrong', fallback.colour.lineStrong),
      accent: str('colourAccent', fallback.colour.accent)
    },
    type: {
      sans: str('typeSans', fallback.type.sans),
      mono: str('typeMono', fallback.type.mono),
      display: {
        weight: num('displayWeight', fallback.type.display.weight),
        tracking: str('displayTracking', fallback.type.display.tracking),
        leading: num('displayLeading', fallback.type.display.leading)
      },
      heading: {
        weight: num('headingWeight', fallback.type.heading.weight),
        tracking: str('headingTracking', fallback.type.heading.tracking),
        leading: num('headingLeading', fallback.type.heading.leading)
      },
      body: {
        weight: num('bodyWeight', fallback.type.body.weight),
        tracking: str('bodyTracking', fallback.type.body.tracking),
        leading: num('bodyLeading', fallback.type.body.leading)
      }
    },
    world: {
      ownedHue: [
        num('ownedHueMin', fallback.world.ownedHue[0]),
        num('ownedHueMax', fallback.world.ownedHue[1])
      ],
      warmPerScreen: num('warmPerScreen', fallback.world.warmPerScreen),
      skinProtected: true as const
    },
    modelRoles: fallback.modelRoles,
    rules: {
      logo: {
        minSizePx: num('logoMinSizePx', fallback.rules.logo.minSizePx),
        clearSpace: str('logoClearSpace', fallback.rules.logo.clearSpace),
        placement: splitLines(body.logoPlacement, fallback.rules.logo.placement)
      },
      forbiddenTerms: splitLines(
        body.forbiddenTerms,
        fallback.rules.forbiddenTerms
      ),
      paletteOnly: bool('paletteOnly', fallback.rules.paletteOnly),
      consentedFacesOnly: true as const,
      competitorExclusions: splitLines(
        body.competitorExclusions,
        fallback.rules.competitorExclusions
      ),
      never: splitLinesOnly(body.neverRules, fallback.rules.never)
    },
    references,
    productChecklist: splitLinesOnly(
      body.productChecklist,
      fallback.productChecklist
    ),
    voice: {
      tone: str('voiceTone', fallback.voice.tone),
      forbiddenWords: splitLines(
        body.voiceForbiddenWords,
        fallback.voice.forbiddenWords
      )
    }
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

class Denied extends Error {
  constructor(readonly code: BrandFailureCode) {
    super(code);
  }
}

async function authorizeBrandActor(
  sql: SqlRunner,
  userId: string,
  organizationId: string,
  allowedRoles: readonly BrandRole[]
): Promise<'admin' | BrandRole> {
  const profile = (
    await sql.query<{ is_admin: boolean }>(
      'select is_admin from profiles where id = $1 for share',
      [userId]
    )
  ).rows[0];
  if (!profile) throw new Denied('sign_in_required');

  const org = (
    await sql.query<{ id: string }>(
      'select id from brand_organizations where id = $1 for update',
      [organizationId]
    )
  ).rows[0];

  if (profile.is_admin === true) {
    if (!org) throw new Denied('not_found');
    return 'admin';
  }

  const membership = (
    await sql.query<{ role: BrandRole }>(
      "select role from brand_memberships where organization_id = $1 and user_id = $2 and status = 'active' for share",
      [organizationId, userId]
    )
  ).rows[0];

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new Denied('forbidden');
  }
  if (!org) throw new Denied('not_found');
  return membership.role;
}

/**
 * Load the organization's stored identity record (draft or confirmed). Returns null when no row
 * exists or before migration 0075 is applied.
 */
export async function loadBrandIdentity(
  sql: SqlRunner,
  organizationId: string
): Promise<BrandIdentityRecord | null> {
  if (!uuid.safeParse(organizationId).success) return null;
  let row:
    | {
        organization_id: string;
        version: string;
        identity: unknown;
        status: string;
        revision: number;
        updated_by: string | null;
        updated_at: unknown;
      }
    | undefined;
  try {
    row = (
      await sql.query<{
        organization_id: string;
        version: string;
        identity: unknown;
        status: string;
        revision: number;
        updated_by: string | null;
        updated_at: unknown;
      }>(
        `select organization_id, version, identity, status, revision, updated_by, updated_at
           from brand_identities
          where organization_id = $1`,
        [organizationId]
      )
    ).rows[0];
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (!row) return null;
  const parsed = BrandIdentitySchema.safeParse(parseJsonObject(row.identity));
  if (!parsed.success) return null;
  const status: BrandIdentityStatus =
    row.status === 'confirmed' ? 'confirmed' : 'draft';
  return {
    organizationId: String(row.organization_id),
    version: String(row.version ?? '2026-11-03'),
    status,
    identity: parsed.data,
    revision: Number(row.revision),
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAt: stamp(row.updated_at)
  };
}

/**
 * Engines (S3/S4/S5) read the brand identity ONLY through this gate.
 * Returns null when:
 *   - `brand_learning` is denied for the organization by `brand_feature_policies`,
 *   - no identity row exists, or
 *   - the stored row is still `'draft'`.
 */
export async function confirmedIdentityFor(
  sql: SqlRunner,
  organizationId: string
): Promise<ConfirmedBrandIdentity | null> {
  if (!uuid.safeParse(organizationId).success) return null;
  const policy = await loadFeaturePolicy(sql, organizationId);
  if (
    policy.denied.includes('brand_learning') ||
    policy.denied.includes('generative_media')
  ) {
    return null;
  }
  const record = await loadBrandIdentity(sql, organizationId);
  if (!record || record.status !== 'confirmed') return null;
  return markConfirmedBrandIdentity(record.identity);
}

const SaveBrandIdentityInputSchema = z.object({
  organizationId: uuid,
  identity: BrandIdentitySchema,
  expectedRevision: z.number().int().min(0),
  version: z.string().trim().min(1).max(40).default('2026-11-03'),
  status: z.enum(BRAND_IDENTITY_STATUSES).default('draft')
});

/**
 * Save a brand identity (owner or admin only). Defaults `status` to `'draft'` so edits require
 * explicit confirmation before engines read them.
 */
export async function saveBrandIdentity(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown
): Promise<
  BrandOutcome<{
    id: string;
    revision: number;
    status: BrandIdentityStatus;
    identity: BrandIdentity;
  }>
> {
  if (!uuid.safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const userId = viewer.userId!;
  const parsed = SaveBrandIdentityInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      code: 'invalid',
      field: (issue?.path ?? []).map(String).join('.') || 'identity'
    };
  }
  const v = parsed.data;
  try {
    return await deps.sql.transaction(async (sql) => {
      await authorizeBrandActor(sql, userId, v.organizationId, ['owner']);
      await assertBrandFeature(sql, v.organizationId, 'brand_learning');
      await assertBrandFeature(sql, v.organizationId, 'generative_media');

      const existing = (
        await sql.query<{ revision: number }>(
          'select revision from brand_identities where organization_id = $1 for update',
          [v.organizationId]
        )
      ).rows[0];
      const currentRevision = existing ? Number(existing.revision) : 0;
      if (currentRevision !== v.expectedRevision) {
        return { ok: false as const, code: 'conflict' as const };
      }
      const nextRevision = currentRevision + 1;
      const jsonPayload = JSON.stringify(v.identity);
      await sql.query(
        `insert into brand_identities (organization_id, version, identity, status, revision, updated_by, updated_at)
           values ($1, $2, $3::jsonb, $4, $5, $6, now())
         on conflict (organization_id) do update
           set version = excluded.version,
               identity = excluded.identity,
               status = excluded.status,
               revision = excluded.revision,
               updated_by = excluded.updated_by,
               updated_at = now()`,
        [
          v.organizationId,
          v.version,
          jsonPayload,
          v.status,
          nextRevision,
          viewer.userId
        ]
      );
      await sql.query(
        `insert into brand_identity_events (organization_id, status, revision, identity, actor_id)
           values ($1, $2, $3, $4::jsonb, $5)`,
        [v.organizationId, v.status, nextRevision, jsonPayload, viewer.userId]
      );
      return {
        ok: true as const,
        id: v.organizationId,
        revision: nextRevision,
        status: v.status,
        identity: v.identity
      };
    });
  } catch (error) {
    if (error instanceof Denied) return { ok: false, code: error.code };
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }
}

const ConfirmBrandIdentityInputSchema = z.object({
  organizationId: uuid,
  expectedRevision: z.number().int().min(1)
});

/**
 * Promote an organization's existing identity row to `'confirmed'` (owner or admin only).
 */
export async function confirmBrandIdentity(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown
): Promise<
  BrandOutcome<{
    id: string;
    revision: number;
    status: 'confirmed';
    identity: ConfirmedBrandIdentity;
  }>
> {
  if (!uuid.safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const userId = viewer.userId!;
  const parsed = ConfirmBrandIdentityInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.')
    };
  }
  const v = parsed.data;
  try {
    return await deps.sql.transaction(async (sql) => {
      await authorizeBrandActor(sql, userId, v.organizationId, ['owner']);
      await assertBrandFeature(sql, v.organizationId, 'brand_learning');
      await assertBrandFeature(sql, v.organizationId, 'generative_media');

      const existing = (
        await sql.query<{ identity: unknown; revision: number }>(
          'select identity, revision from brand_identities where organization_id = $1 for update',
          [v.organizationId]
        )
      ).rows[0];
      if (!existing) return { ok: false as const, code: 'not_found' as const };
      const currentRevision = Number(existing.revision);
      if (currentRevision !== v.expectedRevision) {
        return { ok: false as const, code: 'conflict' as const };
      }
      const checked = BrandIdentitySchema.safeParse(
        parseJsonObject(existing.identity)
      );
      if (!checked.success) {
        return { ok: false as const, code: 'invalid' as const, field: 'identity' };
      }
      const nextRevision = currentRevision + 1;
      const jsonPayload = JSON.stringify(checked.data);
      await sql.query(
        `update brand_identities
            set status = 'confirmed',
                revision = $2,
                updated_by = $3,
                updated_at = now()
          where organization_id = $1`,
        [v.organizationId, nextRevision, viewer.userId]
      );
      await sql.query(
        `insert into brand_identity_events (organization_id, status, revision, identity, actor_id)
           values ($1, 'confirmed', $2, $3::jsonb, $4)`,
        [v.organizationId, nextRevision, jsonPayload, viewer.userId]
      );
      return {
        ok: true as const,
        id: v.organizationId,
        revision: nextRevision,
        status: 'confirmed' as const,
        identity: markConfirmedBrandIdentity(checked.data)
      };
    });
  } catch (error) {
    if (error instanceof Denied) return { ok: false, code: error.code };
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }
}

const DraftDefaultsInputSchema = z.object({
  organizationId: uuid,
  expectedRevision: z.number().int().min(0).default(0)
});

/**
 * Seed a `'draft'` identity from `twingsDefaultIdentity()` (owner or admin only).
 */
export async function draftFromTwingsDefaults(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown
): Promise<
  BrandOutcome<{
    id: string;
    revision: number;
    status: BrandIdentityStatus;
    identity: BrandIdentity;
  }>
> {
  const parsed = DraftDefaultsInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.')
    };
  }
  return saveBrandIdentity(deps, viewer, {
    organizationId: parsed.data.organizationId,
    expectedRevision: parsed.data.expectedRevision,
    identity: twingsDefaultIdentity(),
    status: 'draft'
  });
}

const RecordMemoryInputSchema = z.object({
  organizationId: uuid,
  kind: BrandMemoryInputSchema.shape.kind,
  payload: BrandMemoryInputSchema.shape.payload
});

/**
 * Append a memory event (owner, editor, or admin).
 */
export async function recordMemory(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown
): Promise<BrandOutcome<{ id: string; event: BrandMemoryRecord }>> {
  if (!uuid.safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const userId = viewer.userId!;
  const parsed = RecordMemoryInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.')
    };
  }
  const v = parsed.data;
  try {
    return await deps.sql.transaction(async (sql) => {
      await authorizeBrandActor(sql, userId, v.organizationId, [
        'owner',
        'editor'
      ]);
      await assertBrandFeature(sql, v.organizationId, 'brand_learning');
      await assertBrandFeature(sql, v.organizationId, 'generative_media');

      const row = (
        await sql.query<{
          id: string;
          organization_id: string;
          kind: BrandMemoryKind;
          payload: unknown;
          created_by: string | null;
          created_at: unknown;
        }>(
          `insert into brand_memory_events (organization_id, kind, payload, created_by)
             values ($1, $2, $3::jsonb, $4)
             returning id, organization_id, kind, payload, created_by, created_at`,
          [v.organizationId, v.kind, JSON.stringify(v.payload), viewer.userId]
        )
      ).rows[0]!;

      const event: BrandMemoryRecord = {
        id: String(row.id),
        organizationId: String(row.organization_id),
        kind: row.kind,
        payload: parseJsonObject(row.payload),
        createdBy: row.created_by ? String(row.created_by) : null,
        createdAt: stamp(row.created_at)
      };
      return { ok: true as const, id: event.id, event };
    });
  } catch (error) {
    if (error instanceof Denied) return { ok: false, code: error.code };
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }
}

export async function listMemory(
  sql: SqlRunner,
  organizationId: string,
  limit = 50
): Promise<BrandMemoryRecord[]> {
  if (!uuid.safeParse(organizationId).success) return [];
  const clampedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  let rows: Array<{
    id: string;
    organization_id: string;
    kind: BrandMemoryKind;
    payload: unknown;
    created_by: string | null;
    created_at: unknown;
  }>;
  try {
    rows = (
      await sql.query<{
        id: string;
        organization_id: string;
        kind: BrandMemoryKind;
        payload: unknown;
        created_by: string | null;
        created_at: unknown;
      }>(
        `select id, organization_id, kind, payload, created_by, created_at
           from brand_memory_events
          where organization_id = $1
          order by created_at desc, id desc
          limit $2`,
        [organizationId, clampedLimit]
      )
    ).rows;
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return rows.map((row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    kind: row.kind,
    payload: parseJsonObject(row.payload),
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: stamp(row.created_at)
  }));
}

const SaveLookInputSchema = BrandLookInputSchema.extend({
  organizationId: uuid
});

/**
 * Save a deterministic brand colour-grade look (owner, editor, or admin).
 */
export async function saveLook(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown
): Promise<BrandOutcome<{ id: string; look: BrandLookRecord }>> {
  if (!uuid.safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const userId = viewer.userId!;
  const parsed = SaveLookInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.')
    };
  }
  const v = parsed.data;
  try {
    return await deps.sql.transaction(async (sql) => {
      await authorizeBrandActor(sql, userId, v.organizationId, [
        'owner',
        'editor'
      ]);
      await assertBrandFeature(sql, v.organizationId, 'brand_learning');
      await assertBrandFeature(sql, v.organizationId, 'generative_media');
      await assertBrandFeature(sql, v.organizationId, 'color_grading');

      const row = (
        await sql.query<{
          id: string;
          organization_id: string;
          title: string;
          lut_key: string | null;
          measurements: unknown;
          intensity: unknown;
          skin_protect: boolean;
          source: BrandLookSource;
          created_by: string | null;
          created_at: unknown;
        }>(
          `insert into brand_looks (
             organization_id, title, lut_key, measurements, intensity, skin_protect, source, created_by
           ) values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
           returning id, organization_id, title, lut_key, measurements, intensity, skin_protect, source, created_by, created_at`,
          [
            v.organizationId,
            v.title,
            v.lutKey,
            JSON.stringify(v.measurements),
            v.intensity,
            v.skinProtect,
            v.source,
            viewer.userId
          ]
        )
      ).rows[0]!;

      const look: BrandLookRecord = {
        id: String(row.id),
        organizationId: String(row.organization_id),
        title: String(row.title),
        lutKey: row.lut_key ? String(row.lut_key) : null,
        measurements: parseJsonObject(row.measurements),
        intensity: Number(row.intensity),
        skinProtect: Boolean(row.skin_protect),
        source: row.source,
        createdBy: row.created_by ? String(row.created_by) : null,
        createdAt: stamp(row.created_at)
      };
      return { ok: true as const, id: look.id, look };
    });
  } catch (error) {
    if (error instanceof Denied) return { ok: false, code: error.code };
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }
}

export async function listLooks(
  sql: SqlRunner,
  organizationId: string
): Promise<BrandLookRecord[]> {
  if (!uuid.safeParse(organizationId).success) return [];
  let rows: Array<{
    id: string;
    organization_id: string;
    title: string;
    lut_key: string | null;
    measurements: unknown;
    intensity: unknown;
    skin_protect: boolean;
    source: BrandLookSource;
    created_by: string | null;
    created_at: unknown;
  }>;
  try {
    rows = (
      await sql.query<{
        id: string;
        organization_id: string;
        title: string;
        lut_key: string | null;
        measurements: unknown;
        intensity: unknown;
        skin_protect: boolean;
        source: BrandLookSource;
        created_by: string | null;
        created_at: unknown;
      }>(
        `select id, organization_id, title, lut_key, measurements, intensity, skin_protect, source, created_by, created_at
           from brand_looks
          where organization_id = $1
          order by created_at desc, id desc`,
        [organizationId]
      )
    ).rows;
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return rows.map((row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    title: String(row.title),
    lutKey: row.lut_key ? String(row.lut_key) : null,
    measurements: parseJsonObject(row.measurements),
    intensity: Number(row.intensity),
    skinProtect: Boolean(row.skin_protect),
    source: row.source,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: stamp(row.created_at)
  }));
}

export async function loadBrandIdentityWorkspace(
  sql: SqlRunner,
  organizationId: string
): Promise<BrandIdentityWorkspace> {
  const [identity, looks, memory] = await Promise.all([
    loadBrandIdentity(sql, organizationId),
    listLooks(sql, organizationId),
    listMemory(sql, organizationId, 50)
  ]);
  return { identity, looks, memory };
}
