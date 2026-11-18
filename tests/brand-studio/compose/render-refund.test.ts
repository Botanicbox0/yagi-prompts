/**
 * `render.refund` only frees credits for the caller's own MP4 export reservation (`params.source =
 * 'compose'`) and only within `COMPOSE_RENDER_REFUND_WINDOW_MS` of the reservation. Music, SFX and
 * upscale rows share the ledger model and status but refund themselves server-side, so the client
 * operation must never touch them.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSE_FINAL_RENDER_MODEL,
  COMPOSE_RENDER_REFUND_WINDOW_MS,
  composeFinalRenderKrw,
} from '@/lib/brand-studio/compose/credits';
import { runComposeOperation } from '@/lib/brand-studio/compose/service';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

// Mid-month so every clock step below stays inside one allowance month.
const BASE = new Date('2026-11-15T03:00:00.000Z');

interface JobSnapshot {
  status: string;
  usage_krw: number | null;
  error_code: string | null;
  finished_at: string | null;
  params: unknown;
}

describe('render.refund is limited to recent MP4 export reservations', () => {
  let f: StudioFixture;
  let clock: Date;
  let deps: ReturnType<typeof studioDeps>;

  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    f = await studioFixture();
    clock = BASE;
    deps = studioDeps(f.sql, { now: () => clock });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f.db.close();
  });

  const at = (offsetMs: number) => new Date(BASE.getTime() + offsetMs);

  async function reserve(userId: string, durationSec = 10): Promise<string> {
    const result = await runComposeOperation(deps, viewerOf(userId), 'render.reserve', {
      organizationId: f.orgId,
      requestId: `cmp_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      durationSec,
    });
    if (!result.ok || !('jobId' in result)) throw new Error(`reserve failed: ${JSON.stringify(result)}`);
    return result.jobId;
  }

  async function refund(userId: string, jobId: string) {
    const result = await runComposeOperation(deps, viewerOf(userId), 'render.refund', {
      organizationId: f.orgId,
      jobId,
    });
    if (!result.ok || !('refunded' in result)) throw new Error(`refund failed: ${JSON.stringify(result)}`);
    return result;
  }

  async function snapshot(jobId: string): Promise<JobSnapshot> {
    const row = (
      await f.sql.query<{
        status: string;
        usage_krw: number | null;
        error_code: string | null;
        finished_at: Date | string | null;
        params: unknown;
      }>('select status, usage_krw, error_code, finished_at, params from brand_studio_jobs where id = $1', [jobId])
    ).rows[0]!;
    return {
      status: row.status,
      usage_krw: row.usage_krw == null ? null : Number(row.usage_krw),
      error_code: row.error_code,
      finished_at: row.finished_at == null ? null : new Date(row.finished_at).toISOString(),
      params: typeof row.params === 'string' ? JSON.parse(row.params) : row.params,
    };
  }

  /** Inserts a paid ledger row exactly the way the music / SFX / upscale services do. */
  async function insertLedgerRow(userId: string, prompt: string, params: Record<string, unknown>, krw = 200): Promise<string> {
    const ts = clock.toISOString();
    return (
      await f.sql.query<{ id: string }>(
        `insert into brand_studio_jobs (
           organization_id, created_by, request_id, kind, status, lane, model,
           prompt, enhance, refs, params, estimate_krw, usage_krw, created_at, started_at, finished_at
         ) values (
           $1, $2, $3, 'video_final', 'succeeded', null, $4,
           $5, false, '[]'::jsonb, $6::jsonb, $7, $7, $8, $8, $8
         ) returning id`,
        [f.orgId, userId, `req_${randomUUID().slice(0, 12)}`, COMPOSE_FINAL_RENDER_MODEL, prompt, JSON.stringify(params), krw, ts],
      )
    ).rows[0]!.id;
  }

  it('exports the refund window as 30 minutes', () => {
    expect(COMPOSE_RENDER_REFUND_WINDOW_MS).toBe(30 * 60 * 1000);
  });

  it('refunds the caller’s own export reservation inside the window and restores the allowance', async () => {
    const krw = composeFinalRenderKrw(10);
    const jobId = await reserve(f.ids.owner, 10);
    expect((await snapshot(jobId)).params).toMatchObject({ source: 'compose' });

    clock = at(COMPOSE_RENDER_REFUND_WINDOW_MS - 1_000);
    const first = await refund(f.ids.owner, jobId);
    expect(first.refunded).toBe(true);
    expect(first.allowance.usedKrw).toBe(0);
    expect(await snapshot(jobId)).toMatchObject({ status: 'failed', usage_krw: null, error_code: 'failed' });

    // Idempotent: a second call finds nothing to refund and charges nothing back.
    const second = await refund(f.ids.owner, jobId);
    expect(second.refunded).toBe(false);
    expect(second.allowance.usedKrw).toBe(0);
    expect(krw).toBeGreaterThan(0);
  });

  it('does not refund an export reservation older than the window', async () => {
    const krw = composeFinalRenderKrw(10);
    const jobId = await reserve(f.ids.owner, 10);
    const before = await snapshot(jobId);

    clock = at(COMPOSE_RENDER_REFUND_WINDOW_MS + 1_000);
    const result = await refund(f.ids.owner, jobId);
    expect(result.refunded).toBe(false);
    expect(result.allowance.usedKrw).toBe(krw);
    expect(await snapshot(jobId)).toEqual(before);
    expect(before).toMatchObject({ status: 'succeeded', usage_krw: krw });
  });

  it('never refunds music, SFX or upscale rows that share the ledger model and status', async () => {
    const assetId = randomUUID();
    const musicId = await insertLedgerRow(f.ids.owner, 'BGM 120 BPM (C major)', {
      source: 'music',
      postProdStatus: 'succeeded',
      providerId: 'fake',
      providerTaskId: 'task_music',
      bpm: 120,
      keySignature: 'C major',
      durationSec: 30,
      revealSec: 8,
      preDropHushMs: 0,
      dropSync: null,
      abcScore: null,
      stylePrompt: 'french house',
      hasReferenceAudio: false,
      nonCommercialOnly: false,
      commercialAllowed: true,
      licenseSource: 'commercial_api',
      licenseGate: { commercialAllowed: true },
      synthesizedPreview: false,
      assetId,
      audioUrl: '/api/brand-studio/media/st/music.mp3',
      dataUrl: null,
    });
    const sfxId = await insertLedgerRow(f.ids.owner, 'SFX: glass clink', {
      source: 'sfx',
      postProdStatus: 'succeeded',
      providerMode: 'fake',
      providerTaskId: null,
      text: 'glass clink',
      durationSec: 2,
      promptInfluence: 0.3,
      commercialAllowed: true,
      assetId,
      audioUrl: '/api/brand-studio/media/st/sfx.mp3',
      dataUrl: null,
    });
    const upscaleId = await insertLedgerRow(f.ids.owner, 'HD 1080p upscale', {
      source: 'upscale',
      postProdStatus: 'succeeded',
      providerId: 'fake',
      providerTaskId: 'task_upscale',
      kind: 'video',
      resolution: 1080,
      durationSec: 6,
      requiresSplit: false,
      segments: [],
      assetId,
      outputUrl: '/api/brand-studio/media/st/upscaled.mp4',
      width: 1920,
      height: 1080,
    });

    for (const jobId of [musicId, sfxId, upscaleId]) {
      const before = await snapshot(jobId);
      const result = await refund(f.ids.owner, jobId);
      expect(result.refunded).toBe(false);
      expect(result.allowance.usedKrw).toBe(600);
      expect(await snapshot(jobId)).toEqual(before);
      expect(before).toMatchObject({ status: 'succeeded', usage_krw: 200 });
    }
  });

  it('does not let one member refund another member’s export reservation', async () => {
    const krw = composeFinalRenderKrw(5);
    const editorJobId = await reserve(f.ids.editor, 5);
    const before = await snapshot(editorJobId);

    const byOwner = await refund(f.ids.owner, editorJobId);
    expect(byOwner.refunded).toBe(false);
    expect(byOwner.allowance.usedKrw).toBe(krw);
    expect(await snapshot(editorJobId)).toEqual(before);

    const byEditor = await refund(f.ids.editor, editorJobId);
    expect(byEditor.refunded).toBe(true);
    expect(byEditor.allowance.usedKrw).toBe(0);
  });
});
