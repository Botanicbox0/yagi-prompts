import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { BrandOutcome } from './workspace/types';
import {
  BRAND_FEATURES,
  DEFAULT_SANDBOX_DENIED,
  SANDBOXED_CLIENT_ORG_IDS,
  isSandboxedClientOrganization,
  normalizeDenied,
  type BrandFeature,
} from './features';

export {
  BRAND_FEATURES,
  DEFAULT_SANDBOX_DENIED,
  SANDBOXED_CLIENT_ORG_IDS,
  featureDenied,
  isBrandFeature,
  isSandboxedClientOrganization,
  normalizeDenied,
  type BrandFeature,
} from './features';

/**
 * Per-organization feature policy (docs/BRAND-PRODUCT.md §4): the deny-list behind "open to everyone,
 * with named exceptions".
 *
 * Default open: a missing row means nothing is denied. Only the studio writes rows, through the admin
 * registry (`brandEngine.featurePolicy`); nothing on the brand side can change them, and every save
 * appends a `brand_feature_policy_events` row.
 *
 * Where a policy bites (every entry point, never only the menu):
 *   - the sidebar: `sectionVisibility` (workspace/selection.ts) reads the choice's `denied`, which
 *     `loadBrandWorkspaceScope` attaches from this module;
 *   - the studio page: `notFound()` for a denied organization (app/(brand)/brand/studio/page.tsx);
 *   - the reservation that starts a brand render: `reserveProduction` refuses with
 *     `feature_unavailable` (lib/brands/production/service.ts).
 * A new generative, sound or grading entry point must call `assertBrandFeature` (inside its own
 * transaction) or check the choice's `denied` before doing anything. tests/brands/entitlements.test.ts
 * pins each gate.
 *
 * Results already made stay readable: a policy closes doors, it does not take work back.
 */
export interface BrandFeaturePolicy {
  organizationId: string;
  denied: BrandFeature[];
  note: string;
  /** 0 = no row yet. Optimistic-concurrency token for the admin form. */
  revision: number;
  updatedAt: string | null;
}

const uuid = z.string().uuid();

/** node-postgres and PGlite both hand `text[]` back as arrays; a literal is tolerated for safety. */
function deniedOf(value: unknown): BrandFeature[] {
  if (Array.isArray(value)) return normalizeDenied(value);
  if (typeof value === 'string') {
    const inner = value.replace(/^\{/, '').replace(/\}$/, '');
    return normalizeDenied(inner.split(',').map((v) => v.trim().replace(/^"/, '').replace(/"$/, '')));
  }
  return [];
}

/** Code before migration 0074: no table means no exceptions, never a broken workspace. */
export function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42P01';
}

const stamp = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

/**
 * Which of these organizations are the sandboxed client — by id, and by name. Pages already match
 * both (`isSandboxedClientOrganization`); the server-side gates here matched the two known ids only,
 * so an organization created later for the same client under a new id passed every API check.
 * Keys are lower-cased ids.
 */
async function sandboxedAmong(sql: SqlRunner, organizationIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const unknown: string[] = [];
  for (const raw of organizationIds) {
    const id = raw.toLowerCase();
    if (SANDBOXED_CLIENT_ORG_IDS.has(id)) out.add(id);
    else if (uuid.safeParse(raw).success) unknown.push(raw);
  }
  if (unknown.length === 0) return out;
  const { rows } = await sql.query<{ id: string; name: string | null }>('select id, name from brand_organizations where id = any($1::uuid[])', [unknown]);
  for (const row of rows) if (isSandboxedClientOrganization({ id: String(row.id), name: row.name })) out.add(String(row.id).toLowerCase());
  return out;
}

/**
 * Denied features per organization, for the organizations that have an exception only. Outside any
 * transaction on purpose: a missing table is tolerated here, and inside a transaction it could not be.
 */
export async function loadFeaturePolicies(sql: SqlRunner, organizationIds: readonly string[]): Promise<Record<string, BrandFeature[]>> {
  const ids = [...new Set(organizationIds.filter((id) => uuid.safeParse(id).success))];
  if (ids.length === 0) return {};
  const out: Record<string, BrandFeature[]> = {};
  const sandboxed = await sandboxedAmong(sql, ids);
  for (const id of ids) {
    if (sandboxed.has(id.toLowerCase())) {
      out[id] = [...DEFAULT_SANDBOX_DENIED];
    }
  }
  let rows: Array<{ organization_id: string; denied_features: unknown }>;
  try {
    rows = (
      await sql.query<{ organization_id: string; denied_features: unknown }>(
        'select organization_id, denied_features from brand_feature_policies where organization_id = any($1::uuid[])',
        [ids],
      )
    ).rows;
  } catch (error) {
    if (isMissingTable(error)) return out;
    throw error;
  }
  for (const row of rows) {
    const orgId = String(row.organization_id);
    const dbDenied = deniedOf(row.denied_features);
    const merged = sandboxed.has(orgId.toLowerCase())
      ? normalizeDenied([...DEFAULT_SANDBOX_DENIED, ...dbDenied])
      : dbDenied;
    if (merged.length > 0) out[orgId] = merged;
  }
  try {
    const projectOnlyRows = (
      await sql.query<{ organization_id: string }>(
        `select organization_id from brand_plan_assignments
          where organization_id = any($1::uuid[])
            and plan_id = 'project_only'
            and started_on <= (now() at time zone 'Asia/Seoul')::date
            and (ends_on is null or (now() at time zone 'Asia/Seoul')::date < ends_on)`,
        [ids],
      )
    ).rows;
    for (const row of projectOnlyRows) {
      const orgId = String(row.organization_id);
      out[orgId] = normalizeDenied([...(out[orgId] ?? []), 'self_studio']);
    }
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return out;
}

/** The admin form's view of one organization's policy; the empty policy when there is no row. */
export async function loadFeaturePolicy(sql: SqlRunner, organizationId: string): Promise<BrandFeaturePolicy> {
  const isSandboxed = (await sandboxedAmong(sql, [organizationId])).has(organizationId.toLowerCase());
  const empty: BrandFeaturePolicy = {
    organizationId,
    denied: isSandboxed ? [...DEFAULT_SANDBOX_DENIED] : [],
    note: '',
    revision: 0,
    updatedAt: null,
  };
  if (!uuid.safeParse(organizationId).success) return { organizationId, denied: [], note: '', revision: 0, updatedAt: null };
  let row: { denied_features: unknown; note: string; revision: number; updated_at: unknown } | undefined;
  try {
    row = (
      await sql.query<{ denied_features: unknown; note: string; revision: number; updated_at: unknown }>(
        'select denied_features, note, revision, updated_at from brand_feature_policies where organization_id = $1',
        [organizationId],
      )
    ).rows[0];
  } catch (error) {
    if (isMissingTable(error)) return empty;
    throw error;
  }
  if (!row) return empty;
  const dbDenied = deniedOf(row.denied_features);
  return {
    organizationId,
    denied: isSandboxed ? normalizeDenied([...DEFAULT_SANDBOX_DENIED, ...dbDenied]) : dbDenied,
    note: String(row.note ?? ''),
    revision: Number(row.revision),
    updatedAt: stamp(row.updated_at),
  };
}

export class BrandFeatureDenied extends Error {
  readonly code = 'feature_unavailable' as const;
  constructor(readonly feature: BrandFeature) {
    super(`feature_unavailable:${feature}`);
  }
}

/**
 * Throws `BrandFeatureDenied` when the organization's policy closes `feature`. Call it inside the
 * transaction that would start the work, right after the membership check, so the refusal and the
 * work share one view of the row.
 */
export async function assertBrandFeature(sql: SqlRunner, organizationId: string, feature: BrandFeature): Promise<void> {
  if (DEFAULT_SANDBOX_DENIED.includes(feature) && (await sandboxedAmong(sql, [organizationId])).has(organizationId.toLowerCase())) {
    throw new BrandFeatureDenied(feature);
  }
  const row = (
    await sql.query<{ denied_features: unknown }>('select denied_features from brand_feature_policies where organization_id = $1', [organizationId])
  ).rows[0];
  if (row && deniedOf(row.denied_features).includes(feature)) throw new BrandFeatureDenied(feature);
  if (feature === 'self_studio') {
    let projectOnly: { one: number } | undefined;
    try {
      projectOnly = (
        await sql.query<{ one: number }>(
          `select 1 as one from brand_plan_assignments
            where organization_id = $1
              and plan_id = 'project_only'
              and started_on <= (now() at time zone 'Asia/Seoul')::date
              and (ends_on is null or (now() at time zone 'Asia/Seoul')::date < ends_on)
            limit 1`,
          [organizationId],
        )
      ).rows[0];
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
    if (projectOnly) throw new BrandFeatureDenied('self_studio');
  }
}

const PolicyInput = z.object({
  organizationId: uuid,
  denied: z.array(z.enum(BRAND_FEATURES)).max(BRAND_FEATURES.length * 2),
  note: z.string().trim().max(500).default(''),
  expectedRevision: z.number().int().min(0),
});

/**
 * Replace an organization's deny-list (admin only). `expectedRevision` must match the current row
 * (0 when there is none), so two administrators cannot overwrite each other unseen.
 */
export async function setFeaturePolicy(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown,
): Promise<BrandOutcome<{ id: string; revision: number }>> {
  if (!uuid.safeParse(viewer.userId).success) return { ok: false, code: 'sign_in_required' };
  const parsed = PolicyInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  const v = parsed.data;
  const denied = normalizeDenied(v.denied);
  return deps.sql.transaction(async (sql) => {
    const profile = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for share', [viewer.userId])).rows[0];
    if (!profile) return { ok: false as const, code: 'sign_in_required' as const };
    if (profile.is_admin !== true) return { ok: false as const, code: 'forbidden' as const };
    if (!(await sql.query('select id from brand_organizations where id = $1 for update', [v.organizationId])).rows[0])
      return { ok: false as const, code: 'not_found' as const };
    const current = (
      await sql.query<{ revision: number }>('select revision from brand_feature_policies where organization_id = $1 for update', [v.organizationId])
    ).rows[0];
    const revision = current ? Number(current.revision) : 0;
    if (revision !== v.expectedRevision) return { ok: false as const, code: 'conflict' as const };
    const next = revision + 1;
    await sql.query(
      `insert into brand_feature_policies (organization_id, denied_features, note, revision, updated_by, updated_at)
         values ($1, $2::text[], $3, $4, $5, now())
       on conflict (organization_id) do update
         set denied_features = excluded.denied_features, note = excluded.note, revision = excluded.revision,
             updated_by = excluded.updated_by, updated_at = now()`,
      [v.organizationId, denied, v.note, next, viewer.userId],
    );
    await sql.query(
      'insert into brand_feature_policy_events (organization_id, denied_features, note, actor_id) values ($1, $2::text[], $3, $4)',
      [v.organizationId, denied, v.note, viewer.userId],
    );
    return { ok: true as const, id: v.organizationId, revision: next };
  });
}
