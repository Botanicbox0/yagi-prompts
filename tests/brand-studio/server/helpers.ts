/**
 * Shared fixtures for the brand studio server tests: a PGlite database with one organization and a
 * member of every role, in-memory media and staging, the fake provider and fake intelligence (S2's
 * real modules are not needed to test the state machine). Nothing here touches a network.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { StorageObjectNotFound } from '@/lib/storage';
import { studioEnv } from '@/lib/brand-studio/env';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { createFakeStudioProvider } from '@/lib/brand-studio/provider/fake';
import type { RegionPlan, StudioDeps, StudioIntel, StudioStaging } from '@/lib/brand-studio/types';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';

export const viewerOf = (userId: string, locale: 'ko' | 'en' = 'ko'): Viewer => ({ userId, isAdmin: false, tier: 'free', email: `${userId}@example.test`, locale });

export interface StudioFixture {
  db: PGlite;
  sql: SqlRunner;
  orgId: string;
  ids: { admin: string; owner: string; editor: string; viewer: string; guest: string; outsider: string };
  projectId: string;
}

export async function studioFixture(options: { orgName?: string; orgId?: string; capKrw?: number | null } = {}): Promise<StudioFixture> {
  const db = await freshDb();
  const sql = runner(db);
  const ids = { admin: randomUUID(), owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), guest: randomUUID(), outsider: randomUUID() };
  for (const [role, id] of Object.entries(ids)) await seedProfile(sql, { id, isAdmin: role === 'admin', email: `${role}@example.test` });
  const orgId = options.orgId ?? randomUUID();
  await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [orgId, options.orgName ?? 'Studio fixture brand', ids.owner, randomUUID()]);
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [orgId, ids[role], role]);
  }
  const projectId = randomUUID();
  await sql.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible)
      values ($1, $2, 'Spring launch', 'Launch the spring line', 'creator', $3, $4, true)`,
    [projectId, orgId, ids.owner, randomUUID()],
  );
  // An invited guest who may comment (0034). Rooms keep a guest invited to view only read-only
  // (docs/BRAND-ROOMS-FEEDBACK.md §12); tests that need one set can_comment = false themselves.
  await sql.query('insert into brand_project_members (organization_id, project_id, user_id, can_comment) values ($1, $2, $3, true)', [orgId, projectId, ids.guest]);
  if (options.capKrw !== null) {
    await sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, $2)', [orgId, options.capKrw ?? 1_000_000]);
  }
  return { db, sql, orgId, ids, projectId };
}

export function memoryStaging(): StudioStaging & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    servesSignedUrls: false,
    async putStaging(key, bytes) {
      objects.set(key, new Uint8Array(bytes));
    },
    async read(bucket, key) {
      const hit = objects.get(key);
      if (!hit) throw new StorageObjectNotFound(bucket, key);
      return hit;
    },
    async signedUploadUrl() {
      return null;
    },
  };
}

export interface IntelCalls {
  enhance: number;
  film: number;
  composite: Array<{ original: number; edited: number; plan: RegionPlan }>;
}

/** Deterministic stand-ins for slice S2: the enhancer prefixes, the compositor pastes the edit into the box. */
export function fakeIntel(calls: IntelCalls = { enhance: 0, film: 0, composite: [] }): StudioIntel & { calls: IntelCalls } {
  return {
    calls,
    async enhancePrompt(input) {
      calls.enhance += 1;
      return { prompt: `ENHANCED(${input.profile}): ${input.prompt}`, notes: 'fake', source: 'model' };
    },
    composeFallbackPrompt(input) {
      return { prompt: `FALLBACK: ${input.prompt}`, notes: '', source: 'fallback' };
    },
    async readFilm() {
      calls.film += 1;
      return {
        seconds: 6,
        aspect: '9:16',
        shots: [{ start: 0, end: 6, framing: 'medium', camera: 'locked-off', action: 'a bottle turns' }],
        look: { lighting: 'soft window light', palette: 'blue and white', texture: 'clean' },
        audio: { music: true, speech: false, effects: '' },
        summary: '6초, 컷 하나.',
      };
    },
    planRegion(image, box) {
      const rect = {
        left: Math.floor(box.x * image.width),
        top: Math.floor(box.y * image.height),
        width: Math.max(1, Math.floor(box.w * image.width)),
        height: Math.max(1, Math.floor(box.h * image.height)),
      };
      return { roi: rect, box: rect, aspect: '1:1', work: { width: rect.width, height: rect.height } };
    },
    async cropForEdit(original, plan) {
      const bytes = await sharp(original).extract(plan.roi).png().toBuffer();
      return { bytes: new Uint8Array(bytes), mime: 'image/png' };
    },
    async compositeRegion({ original, edited, plan }) {
      calls.composite.push({ original: original.byteLength, edited: edited.byteLength, plan });
      const patch = await sharp(edited).resize(plan.box.width, plan.box.height, { fit: 'fill' }).png().toBuffer();
      const meta = await sharp(original).metadata();
      const bytes = await sharp(original).composite([{ input: patch, left: plan.box.left, top: plan.box.top }]).png().toBuffer();
      return { bytes: new Uint8Array(bytes), mime: 'image/png', width: meta.width!, height: meta.height! };
    },
  };
}

export function studioDeps(sql: SqlRunner, overrides: Partial<StudioDeps> = {}): StudioDeps & {
  media: ReturnType<typeof createMemoryMediaStore>;
  staging: ReturnType<typeof memoryStaging>;
  provider: ReturnType<typeof createFakeStudioProvider>;
  intel: ReturnType<typeof fakeIntel>;
} {
  const env = studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' });
  return {
    sql,
    env,
    media: createMemoryMediaStore(),
    staging: memoryStaging(),
    provider: createFakeStudioProvider({ pollsBeforeDone: 1 }),
    intel: fakeIntel(),
    intelDeps: { fetch: (() => Promise.reject(new Error('no network in tests'))) as typeof fetch, env: {} },
    log: () => undefined,
    ...overrides,
  } as never;
}

/** A small real PNG (solid colour) for uploads and region edits. */
export async function pngBytes(width = 64, height = 48, colour = { r: 200, g: 40, b: 40 }): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer());
}

/** Put a ready image straight into the library (bypassing upload) and return its id. */
export async function seedImageAsset(deps: StudioDeps, orgId: string, by: string, options: { role?: string; width?: number; height?: number } = {}): Promise<string> {
  const bytes = await pngBytes(options.width ?? 64, options.height ?? 48);
  const { key } = await deps.media.put(bytes, 'image/png');
  const row = (
    await deps.sql.query<{ id: string }>(
      `insert into brand_studio_assets (organization_id, kind, role, name, mime, size_bytes, width, height, storage_key, source, status, created_by, sha256)
        values ($1, 'image', $2, 'seed', 'image/png', $3, $4, $5, $6, 'upload', 'ready', $7, $8) returning id`,
      [orgId, options.role ?? null, bytes.byteLength, options.width ?? 64, options.height ?? 48, key, by, randomUUID().replace(/-/g, '').padEnd(64, '0')],
    )
  ).rows[0]!;
  return row.id;
}

export async function seedVideoAsset(deps: StudioDeps, orgId: string, by: string, seconds = 6): Promise<string> {
  const { key } = await deps.media.put(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]), 'video/mp4');
  return (
    await deps.sql.query<{ id: string }>(
      `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, duration_ms, storage_key, source, status, created_by)
        values ($1, 'video', 'ref film', 'video/mp4', 12, 720, 1280, $2, $3, 'upload', 'ready', $4) returning id`,
      [orgId, seconds * 1000, key, by],
    )
  ).rows[0]!.id;
}

export const requestId = () => `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
