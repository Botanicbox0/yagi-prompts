import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => null }));
import { billingDb, seedProfile, USER, type BillingHarness } from '@/tests/helpers/billing';
import type { RenderStore } from '@/lib/renders/store';
import type { Viewer } from '@/lib/auth/identity';
import { socialEvidenceKey } from '@/lib/influencers/evidence';
import { verifySocialAccount } from '@/lib/influencers/admin';
import { aiNote, claimSocialJobs, completeSocialJob, lastSocialWorker, leasedEvidence, socialHeartbeat, SOCIAL_LEASE_MS } from '@/lib/influencers/worker';
import { socialWorkerAuthorized } from '@/lib/influencers/worker-http';
import { ollamaBase, pickVisionModel, readFollowerScreenshot } from '@/lib/influencers/local-vision';

/**
 * docs/PLATFORM-2.0.md §17.1 — the local AI's queue: a secret-gated door, one lease per row, a
 * reading that lands in `ai_*` only, three tries, and nothing a model says ever moves `status`.
 */
const SECRET = 's'.repeat(40);
const ID = '57000000-0000-4000-8000-0000000000a1';
const ADMIN = 'a0000000-0000-4000-8000-0000000000ad';
const admin = { tier: 'free', userId: ADMIN, email: null, isAdmin: true, locale: 'ko' } as Viewer;
const MODEL = 'qwen2.5vl:7b';

describe('worker door', () => {
  const req = (auth?: string) => new Request('https://twings.test/api/social-verify-worker/claim', { method: 'POST', headers: auth ? { authorization: auth } : {} });
  it('opens only with the flag on, a 32+ character secret and the exact bearer', () => {
    const on = { TWINGS_INFLUENCERS: 'on', SOCIAL_VERIFY_WORKER_SECRET: SECRET };
    expect(socialWorkerAuthorized(req(`Bearer ${SECRET}`), on)).toBe(true);
    expect(socialWorkerAuthorized(req(`Bearer ${SECRET}`), { ...on, TWINGS_INFLUENCERS: 'off' })).toBe(false);
    expect(socialWorkerAuthorized(req('Bearer short'), { ...on, SOCIAL_VERIFY_WORKER_SECRET: 'short' })).toBe(false);
    expect(socialWorkerAuthorized(req(`Bearer ${SECRET}x`), on)).toBe(false);
    expect(socialWorkerAuthorized(req(), on)).toBe(false);
    expect(socialWorkerAuthorized(req('Bearer '), { TWINGS_INFLUENCERS: 'on' })).toBe(false);
  });
});

describe('the reading queue', () => {
  let h: BillingHarness, objects: Map<string, Uint8Array>, signed: boolean;
  const now = new Date('2026-10-23T09:00:00Z');
  const store = (): RenderStore => ({
    name: 'local', put: async (k, b) => { objects.set(k, b); }, read: async k => objects.get(k)!, url: async k => (signed ? `https://bucket.test/${k}?token=t` : null),
  });
  const ai = async () => (await h.sql.query<Record<string, unknown>>('select status,ai_state,ai_attempts,ai_count,ai_confidence,ai_model,ai_note,follower_count from social_accounts where id=$1', [ID])).rows[0]!;
  const reading = { handle: '@Hana', followers: 4200, confidence: 0.91 };
  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: USER.buyer });
    await seedProfile(h.sql, { id: ADMIN, isAdmin: true });
    objects = new Map([[socialEvidenceKey(ID), new Uint8Array([9, 9, 9])]]);
    signed = false;
    await h.sql.query(
      `insert into social_accounts(id,user_id,platform,handle,profile_url,evidence_key,created_at,updated_at,ai_available_at) values($1,$2,'instagram','hana','https://www.instagram.com/hana/',$3,$4,$4,$4)`,
      [ID, USER.buyer, socialEvidenceKey(ID), now],
    );
  });
  afterEach(async () => h.close());

  it('leases a waiting row once, with a signed URL when the store has one, else the leased-evidence path', async () => {
    const [claim] = await claimSocialJobs(h.sql, store(), 3, now);
    expect(claim).toMatchObject({ id: ID, platform: 'instagram', handle: 'hana', imageUrl: null });
    expect(await claimSocialJobs(h.sql, store(), 3, now)).toEqual([]);
    expect(await leasedEvidence(h.sql, store(), { id: ID, leaseToken: claim!.leaseToken }, now)).toEqual(new Uint8Array([9, 9, 9]));
    expect(await leasedEvidence(h.sql, store(), { id: ID, leaseToken: '00000000-0000-4000-8000-000000000000' }, now)).toBeNull();
    expect(await leasedEvidence(h.sql, store(), { id: ID, leaseToken: claim!.leaseToken }, new Date(now.getTime() + SOCIAL_LEASE_MS + 1))).toBeNull();
    await h.sql.query("update social_accounts set ai_state='queued',ai_lease_token=null where id=$1", [ID]);
    signed = true;
    expect((await claimSocialJobs(h.sql, store(), 1, now))[0]!.imageUrl).toBe(`https://bucket.test/social/${ID}/evidence.jpg?token=t`);
  });

  it('records the reading as a suggestion only, once; a second report, a stale lease or a decided row is ignored', async () => {
    const [claim] = await claimSocialJobs(h.sql, store(), 1, now);
    const complete = (over: Record<string, unknown> = {}, at = now) => completeSocialJob(h.sql, { id: ID, leaseToken: claim!.leaseToken, modelId: MODEL, result: reading, ...over }, at);
    expect(await complete({ modelId: 'bad model!' })).toBe(false); // invalid shape is a failed try
    await h.sql.query("update social_accounts set ai_state='leased',ai_lease_token=$2,ai_lease_until=$3 where id=$1", [ID, claim!.leaseToken, new Date(now.getTime() + SOCIAL_LEASE_MS)]);
    expect(await complete()).toBe(true);
    expect(await ai()).toMatchObject({ status: 'submitted', follower_count: null, ai_state: 'done', ai_count: 4200, ai_model: MODEL, ai_note: 'handle_match' });
    expect(Number((await ai()).ai_confidence)).toBe(0.91);
    expect(await complete({ result: { ...reading, followers: 1 } })).toBe(false);
    expect((await ai()).ai_count).toBe(4200);
    expect(await claimSocialJobs(h.sql, store(), 1, now)).toEqual([]);
    expect(aiNote({ handle: 'hana' }, { ...reading, handle: '@someone.else' })).toBe('handle_mismatch:@someone.else');
    expect(aiNote({ handle: 'hana' }, { ...reading, handle: null })).toBe('handle_unread');
  });

  it('never hears a lease once an administrator decided the row', async () => {
    const [claim] = await claimSocialJobs(h.sql, store(), 1, now);
    expect(await verifySocialAccount(h.sql, admin, { id: ID, followerCount: 3100 }, now)).toMatchObject({ ok: true });
    expect(await completeSocialJob(h.sql, { id: ID, leaseToken: claim!.leaseToken, modelId: MODEL, result: reading }, now)).toBe(false);
    expect(await ai()).toMatchObject({ status: 'verified', follower_count: 3100, ai_count: null });
  });

  it('retries a failed or expired try with back-off, three tries in all, then notes the failure and keeps the row waiting', async () => {
    let at = now;
    const [first] = await claimSocialJobs(h.sql, store(), 1, at);
    expect(await completeSocialJob(h.sql, { id: ID, leaseToken: first!.leaseToken, modelId: MODEL, error: 'model_unavailable' }, at)).toBe(true);
    expect(await ai()).toMatchObject({ ai_state: 'queued', ai_attempts: 1, ai_note: null });
    expect(await claimSocialJobs(h.sql, store(), 1, at)).toEqual([]); // backing off
    at = new Date(at.getTime() + 61_000);
    const [second] = await claimSocialJobs(h.sql, store(), 1, at);
    expect(second).toBeTruthy();
    // The second lease runs out: the next claim counts it as a try.
    at = new Date(at.getTime() + SOCIAL_LEASE_MS + 1);
    expect(await claimSocialJobs(h.sql, store(), 1, at)).toEqual([]);
    expect(await ai()).toMatchObject({ ai_state: 'queued', ai_attempts: 2 });
    at = new Date(at.getTime() + 301_000);
    const [third] = await claimSocialJobs(h.sql, store(), 1, at);
    expect(await completeSocialJob(h.sql, { id: ID, leaseToken: third!.leaseToken, modelId: MODEL, result: { nonsense: true } }, at)).toBe(false);
    expect(await ai()).toMatchObject({ status: 'submitted', ai_state: 'failed', ai_attempts: 3, ai_note: 'failed:invalid_result' });
    expect(await claimSocialJobs(h.sql, store(), 1, new Date(at.getTime() + 86_400_000))).toEqual([]);
  });

  it('keeps a heartbeat per worker and refuses odd ids', async () => {
    expect(await socialHeartbeat(h.sql, { id: 'yagi-server', modelId: MODEL }, now)).toBe(true);
    expect(await socialHeartbeat(h.sql, { id: 'bad id;', modelId: MODEL }, now)).toBe(false);
    expect(await socialHeartbeat(h.sql, { id: 'yagi-server', modelId: MODEL, extra: 1 }, now)).toBe(false);
    expect(await lastSocialWorker(h.sql)).toEqual({ modelId: MODEL, lastSeenAt: now.toISOString() });
  });
});

describe('the workstation adapter', () => {
  it('talks to the gpu-arbiter on loopback only, never the raw Ollama port', () => {
    expect(ollamaBase(undefined).href).toBe('http://127.0.0.1:11434/');
    for (const bad of ['http://127.0.0.1:11444', 'https://ollama.example.com', 'http://10.0.0.5:11434', 'http://user:pw@127.0.0.1:11434']) expect(() => ollamaBase(bad)).toThrow();
  });

  it('prefers an installed qwen vision model, then gemma, and answers null when there is none', async () => {
    const fake = (models: string[], vision: string[]) => vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url).endsWith('/api/tags')) return Response.json({ models: models.map(name => ({ name })) });
      const { model } = JSON.parse(String(init?.body));
      return Response.json({ capabilities: vision.includes(model) ? ['completion', 'vision'] : ['completion'] });
    }) as unknown as typeof fetch;
    const base = ollamaBase(undefined);
    expect(await pickVisionModel(base, undefined, fake(['gemma3:27b', 'qwen3:32b', 'qwen2.5vl:7b'], ['gemma3:27b', 'qwen2.5vl:7b']))).toBe('qwen2.5vl:7b');
    expect(await pickVisionModel(base, undefined, fake(['gemma3:27b', 'qwen3:32b'], ['gemma3:27b']))).toBe('gemma3:27b');
    expect(await pickVisionModel(base, undefined, fake(['qwen3:32b', 'llama3:8b'], []))).toBeNull();
    expect(await pickVisionModel(base, 'gemma3:27b', fake(['gemma3:27b'], []))).toBe('gemma3:27b');
    expect(await pickVisionModel(base, 'missing:1b', fake(['gemma3:27b'], []))).toBeNull();
  });

  it('sends the image with a JSON-only schema and refuses anything but the reading', async () => {
    let sent: Record<string, unknown> = {};
    const answer = (content: string, extra: Record<string, unknown> = {}) => vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ done: true, done_reason: 'stop', message: { content }, ...extra });
    }) as unknown as typeof fetch;
    const base = ollamaBase(undefined);
    expect(await readFollowerScreenshot(new Uint8Array([1, 2]), MODEL, base, answer('```json\n{"handle":"@hana","followers":4200,"confidence":0.9}\n```'))).toEqual({ handle: '@hana', followers: 4200, confidence: 0.9 });
    expect(sent).toMatchObject({ model: MODEL, stream: false, options: { temperature: 0 } });
    expect((sent.messages as Array<{ images: string[] }>)[0]!.images).toEqual(['AQI=']);
    expect(sent.format).toMatchObject({ type: 'object' });
    await expect(readFollowerScreenshot(new Uint8Array([1]), MODEL, base, answer('{"handle":"@hana","followers":"many","confidence":0.9}'))).rejects.toThrow('invalid_result');
    await expect(readFollowerScreenshot(new Uint8Array([1]), MODEL, base, answer('{}', { done_reason: 'length' }))).rejects.toThrow('model_unavailable');
    await expect(readFollowerScreenshot(new Uint8Array([1]), 'bad model!', base, answer('{}'))).rejects.toThrow('configuration');
  });
});
