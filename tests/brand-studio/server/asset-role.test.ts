import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completeStudioAsset, reserveStudioAsset, updateStudioAsset } from '@/lib/brand-studio/assets';
import { recogniseAssetRole } from '@/lib/brand-studio/asset-role';
import type { AssetRoleFacts } from '@/lib/brand-studio/asset-role';
import { fakeClipBytes } from '@/lib/brand-studio/provider/fake';
import { loadStudioState } from '@/lib/brand-studio/service';
import type { StudioAssetRole } from '@/lib/brand-studio/contracts';
import { pngBytes, requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/** docs/BRAND-STUDIO-V3.md §4.1 — the upload's role, recognised once after the answer, never over the customer's. */
const sure: AssetRoleFacts = { role: 'product', alternative: 'none', kind: 'photo', people: 'none', framing: 'no_person', light: 'even', text: 'none', surface: false };
const doubtful: AssetRoleFacts = { ...sure, role: 'person', alternative: 'product', people: 'one_face_visible', framing: 'half_body' };

function geminiAnswer(body: unknown, calls: { n: number }, status = 200): typeof fetch {
  return (async () => {
    calls.n += 1;
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(body) }] } }] }), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

let f: StudioFixture;
let tasks: Array<() => Promise<void>>;
let calls: { n: number };
beforeEach(async () => {
  f = await studioFixture();
  tasks = [];
  calls = { n: 0 };
});
afterEach(async () => {
  await f.db.close();
});

function depsWith(fetchImpl: typeof fetch, env: Record<string, string> = { GEMINI_API_KEY: 'test-key' }) {
  return studioDeps(f.sql, { intelDeps: { fetch: fetchImpl, env }, later: (task) => tasks.push(task) });
}
const owner = () => viewerOf(f.ids.owner);

async function upload(deps: ReturnType<typeof studioDeps>, bytes: Uint8Array, mime: string, role?: StudioAssetRole) {
  const reserved = await reserveStudioAsset(deps, owner(), { organizationId: f.orgId, requestId: requestId(), name: 'pic', mime, sizeBytes: bytes.byteLength, ...(role ? { role } : {}) });
  if (!reserved.ok) throw new Error(reserved.code);
  const key = (await f.sql.query<{ storage_key: string }>('select storage_key from brand_studio_assets where id = $1', [reserved.id])).rows[0]!.storage_key;
  await deps.staging.putStaging(key, bytes, mime);
  return completeStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: reserved.id });
}
async function roleRow(id: string) {
  return (await f.sql.query<{ role: string | null; role_source: string | null }>('select role, role_source from brand_studio_assets where id = $1', [id])).rows[0]!;
}
const runLater = async () => {
  for (const task of tasks.splice(0)) await task();
};

describe('the upload role check', () => {
  it('answers the upload first, then saves a sure role as recognised automatically', async () => {
    const deps = depsWith(geminiAnswer(sure, calls));
    const saved = await upload(deps, await pngBytes(120, 90), 'image/png');
    expect(saved).toMatchObject({ ok: true, roleCheck: true, asset: { role: null } });
    if (!saved.ok) throw new Error();
    expect(saved.asset.roleSource).toBeUndefined();
    expect(calls.n).toBe(0); // nothing was asked before the answer
    await runLater();
    expect(calls.n).toBe(1);
    expect(await roleRow(saved.asset.id)).toEqual({ role: 'product', role_source: 'auto' });
    const state = await loadStudioState(deps, owner(), f.orgId);
    expect(state.ok && state.assets[0]).toMatchObject({ role: 'product', roleSource: 'auto' });
    // Once is once: a second check of the same picture asks nothing.
    expect(await recogniseAssetRole(deps, saved.asset.id)).toBe('skipped');
    expect(calls.n).toBe(1);
  });

  it('leaves a doubtful picture empty and never asks about it again', async () => {
    const deps = depsWith(geminiAnswer(doubtful, calls));
    const saved = await upload(deps, await pngBytes(64, 64), 'image/png');
    if (!saved.ok) throw new Error();
    await runLater();
    expect(await roleRow(saved.asset.id)).toEqual({ role: null, role_source: 'auto' });
    const again = await upload(deps, await pngBytes(64, 64), 'image/png'); // the same bytes fold into the same entry
    expect(again.ok && again.asset.id).toBe(saved.asset.id);
    expect(again.ok && again.roleCheck).toBeUndefined();
  });

  it('keeps a role the uploader chose, marked as theirs, and does not ask', async () => {
    const deps = depsWith(geminiAnswer(sure, calls));
    const saved = await upload(deps, await pngBytes(30, 30), 'image/png', 'logo');
    expect(saved).toMatchObject({ ok: true, asset: { role: 'logo', roleSource: 'user' } });
    expect(saved.ok && saved.roleCheck).toBeUndefined();
    expect(tasks).toHaveLength(0);
    if (!saved.ok) throw new Error();
    expect(await roleRow(saved.asset.id)).toEqual({ role: 'logo', role_source: 'user' });
  });

  it('never writes over a role the customer set (or cleared) while the check was running', async () => {
    const deps = depsWith(geminiAnswer(sure, calls));
    const first = await upload(deps, await pngBytes(40, 40), 'image/png');
    const second = await upload(deps, await pngBytes(41, 40), 'image/png');
    if (!first.ok || !second.ok) throw new Error();
    await updateStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: first.asset.id, role: 'style' });
    await updateStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: second.asset.id, role: null });
    await runLater();
    expect(await roleRow(first.asset.id)).toEqual({ role: 'style', role_source: 'user' });
    expect(await roleRow(second.asset.id)).toEqual({ role: null, role_source: 'user' });
  });

  it('keeps a recognised role recognised when only the name changes, and makes a change the customer’s', async () => {
    const logs: string[] = [];
    const deps = studioDeps(f.sql, { intelDeps: { fetch: geminiAnswer(sure, calls), env: { GEMINI_API_KEY: 'k' } }, later: (task) => tasks.push(task), log: (event) => logs.push(event) });
    const saved = await upload(deps, await pngBytes(50, 40), 'image/png');
    if (!saved.ok) throw new Error();
    await runLater();
    await updateStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: saved.asset.id, name: 'Bottle' });
    expect(await roleRow(saved.asset.id)).toEqual({ role: 'product', role_source: 'auto' });
    const changed = await updateStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: saved.asset.id, role: 'place' });
    expect(changed).toMatchObject({ ok: true, asset: { role: 'place', roleSource: 'user' } });
    expect(logs).toContain('asset_role_corrected');
  });

  it('leaves the role empty when the call fails or times out, and the upload still succeeds', async () => {
    const failures = [
      geminiAnswer(sure, calls, 503),
      (() => Promise.reject(new Error('offline'))) as typeof fetch,
      geminiAnswer({ role: 'product' }, calls),
    ];
    for (const [i, failing] of failures.entries()) {
      tasks = [];
      const deps = depsWith(failing);
      const saved = await upload(deps, await pngBytes(60 + i, 33), 'image/png');
      expect(saved).toMatchObject({ ok: true, roleCheck: true });
      if (!saved.ok) throw new Error();
      await runLater();
      expect(await roleRow(saved.asset.id)).toEqual({ role: null, role_source: null });
    }
  });

  describe('one more try when the first read gives no answer', () => {
    /** Answers in order; `null` = an HTTP 503, `'blocked'` = a blocked prompt. */
    function sequence(answers: Array<unknown | null | 'blocked'>): typeof fetch {
      return (async () => {
        const answer = answers[Math.min(calls.n, answers.length - 1)];
        calls.n += 1;
        if (answer === null) return new Response('{}', { status: 503 });
        if (answer === 'blocked') return new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 });
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { status: 200 });
      }) as typeof fetch;
    }
    async function check(fetchImpl: typeof fetch) {
      const logs: Array<{ event: string; detail?: Record<string, unknown> }> = [];
      const deps = studioDeps(f.sql, { intelDeps: { fetch: fetchImpl, env: { GEMINI_API_KEY: 'k' } }, later: (task) => tasks.push(task), log: (event, detail) => logs.push({ event, detail }) });
      const saved = await upload(deps, await pngBytes(110, 30 + calls.n), 'image/png');
      if (!saved.ok) throw new Error();
      await runLater();
      return { row: await roleRow(saved.asset.id), logs: logs.filter((l) => l.event.startsWith('asset_role')) };
    }

    it('saves the role when the second try answers', async () => {
      const { row, logs } = await check(sequence([null, sure]));
      expect(calls.n).toBe(2);
      expect(row).toEqual({ role: 'product', role_source: 'auto' });
      expect(logs.map((l) => l.event)).toEqual(['asset_role']);
    });

    it('writes nothing after two failed tries, and logs one line with the tries', async () => {
      const { row, logs } = await check(sequence([null, { role: 'bottle' }]));
      expect(calls.n).toBe(2);
      expect(row).toEqual({ role: null, role_source: null });
      expect(logs).toEqual([{ event: 'asset_role_failed', detail: { reason: 'no_answer', tries: 2 } }]);
    });

    it('asks once when the first try answers', async () => {
      const { row } = await check(sequence([sure, sure]));
      expect(calls.n).toBe(1);
      expect(row).toEqual({ role: 'product', role_source: 'auto' });
    });

    it('does not ask again after a blocked answer', async () => {
      const { row, logs } = await check(sequence(['blocked', sure]));
      expect(calls.n).toBe(1);
      expect(row).toEqual({ role: null, role_source: null });
      expect(logs).toEqual([{ event: 'asset_role_failed', detail: { reason: 'blocked', tries: 1 } }]);
    });
  });

  it('does not read a transient source ("빈 곳 채우기"), and reads the next ordinary upload', async () => {
    const deps = depsWith(geminiAnswer(sure, calls));
    const bytes = await pngBytes(90, 30);
    const reserved = await reserveStudioAsset(deps, owner(), { organizationId: f.orgId, requestId: requestId(), name: 'fill.png', mime: 'image/png', sizeBytes: bytes.byteLength });
    if (!reserved.ok) throw new Error(reserved.code);
    const key = (await f.sql.query<{ storage_key: string }>('select storage_key from brand_studio_assets where id = $1', [reserved.id])).rows[0]!.storage_key;
    await deps.staging.putStaging(key, bytes, 'image/png');
    const fill = await completeStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: reserved.id, transient: true });
    expect(fill).toMatchObject({ ok: true, asset: { role: null } });
    expect(fill.ok && fill.roleCheck).toBeUndefined();
    expect(tasks).toHaveLength(0);
    expect(await roleRow(reserved.id)).toEqual({ role: null, role_source: null });
    const ordinary = await upload(deps, await pngBytes(91, 30), 'image/png');
    expect(ordinary.ok && ordinary.roleCheck).toBe(true);
  });

  it('does nothing with the kill switch, without a key, for video, or without a scheduler', async () => {
    const off = depsWith(geminiAnswer(sure, calls), { GEMINI_API_KEY: 'k', BRAND_STUDIO_ASSET_AUTO_ROLE: 'off' });
    const a = await upload(off, await pngBytes(70, 20), 'image/png');
    expect(a.ok && a.roleCheck).toBeUndefined();
    const noKey = depsWith(geminiAnswer(sure, calls), {});
    const b = await upload(noKey, await pngBytes(71, 20), 'image/png');
    expect(b.ok && b.roleCheck).toBeUndefined();
    const film = await upload(depsWith(geminiAnswer(sure, calls)), fakeClipBytes(), 'video/mp4');
    expect(film.ok && film.roleCheck).toBeUndefined();
    const plain = studioDeps(f.sql, { intelDeps: { fetch: geminiAnswer(sure, calls), env: { GEMINI_API_KEY: 'k' } } });
    const c = await upload(plain, await pngBytes(72, 20), 'image/png');
    expect(c.ok && c.roleCheck).toBeUndefined();
    expect(tasks).toHaveLength(0);
    expect(calls.n).toBe(0);
  });
});
