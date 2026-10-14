import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), create: vi.fn(), output: vi.fn(), after: vi.fn(), pass: vi.fn(), read: vi.fn(), url: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: m.viewer }));
vi.mock('@/lib/auth/verified-email', () => ({ getVerifiedEmail: async () => undefined }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: m.sql }));
vi.mock('@/lib/renders/service', () => ({ createCampaignRenderJob: m.create }));
vi.mock('@/lib/campaigns/production-output', () => ({ loadCampaignOutput: m.output }));
vi.mock('@/lib/renders/runtime', () => ({ runLiveRenderPass: m.pass }));
vi.mock('@/lib/renders/store', () => ({ getRenderStore: async () => ({ read: m.read, url: m.url }) }));
vi.mock('@/lib/storage', () => ({ getStorage: async () => ({}) }));
vi.mock('next/server', async () => ({ ...await vi.importActual('next/server'), after: m.after }));
import { POST } from '@/app/api/campaign-production/route';
import { GET, HEAD } from '@/app/api/campaign-production/[id]/media/route';
beforeEach(() => { vi.clearAllMocks(); m.viewer.mockResolvedValue({ userId: 'selected-creator', isAdmin: false }); m.sql.mockResolvedValue({}); m.output.mockResolvedValue(null); m.url.mockResolvedValue(null); });
function request(extras?: (form: FormData) => void) {
  const form = new FormData(); form.set('applicationId', 'application'); form.set('requestId', 'request'); form.set('locale', 'ko'); form.set('ownFaceConsent', '1'); form.set('photo', new File(['fixture'], 'photo.png', { type: 'image/png' })); extras?.(form);
  return new Request('https://twings.app/api/campaign-production', { method: 'POST', headers: { Origin: 'https://twings.app' }, body: form });
}
it('blocks cross-origin and anonymous creation before processing photo or funding', async () => {
  expect((await POST(new Request('https://twings.app/api/campaign-production', { method: 'POST', headers: { Origin: 'https://evil.test' } }))).status).toBe(403);
  m.viewer.mockResolvedValue({ userId: null }); expect((await POST(request())).status).toBe(401); expect(m.create).not.toHaveBeenCalled();
});
it('rejects injected templates, prompt text, funding proof and duplicate fields', async () => {
  for (const name of ['template', 'prompt', 'contractId', 'paymentOrderId']) expect((await POST(request(f => f.set(name, 'attacker-input')))).status).toBe(400);
  expect((await POST(request(f => f.append('applicationId', 'other')))).status).toBe(400); expect(m.create).not.toHaveBeenCalled();
});
it('bounds actual request bytes and malformed file values', async () => {
  expect((await POST(new Request('https://twings.app/api/campaign-production', { method: 'POST', headers: { Origin: 'https://twings.app' }, body: new Uint8Array(4_000_001) }))).status).toBe(413);
  expect((await POST(request(f => f.set('photo', 'https://evil.test/photo')))).status).toBe(400); expect(m.create).not.toHaveBeenCalled();
});
it('queues only the authorized campaign job, returns no private recipe, and respects identity holds', async () => {
  m.create.mockResolvedValue({ ok: true, id: 'a0000000-0000-4000-8000-000000000001', held: false });
  const response = await POST(request()); expect(response.status).toBe(201); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(m.create.mock.calls[0]![2]).toMatchObject({ applicationId: 'application', requestId: 'request', ownFaceConsent: true, photo: { mime: 'image/png' } });
  await m.after.mock.calls[0]![0](); expect(m.pass).toHaveBeenCalledWith({}, { jobId: 'a0000000-0000-4000-8000-000000000001', limit: 1 });
  expect(await response.json()).toMatchObject({ href: '/renders/a0000000-0000-4000-8000-000000000001' });
  m.after.mockClear(); m.create.mockResolvedValue({ ok: true, id: 'a0000000-0000-4000-8000-000000000001', held: true });
  expect((await (await POST(request())).json()).verifyHref).toContain('/identity'); expect(m.after).not.toHaveBeenCalled();
});
it('does not run a pass on entitlement refusal, and reports capacity/connection accurately', async () => {
  m.create.mockResolvedValue({ ok: false, code: 'generation_used' }); expect((await POST(request())).status).toBe(409);
  m.create.mockResolvedValue({ ok: false, code: 'not_selected' }); expect((await POST(request())).status).toBe(403);
  m.create.mockRejectedValue(Error('database unavailable')); expect((await POST(request())).status).toBe(503); expect(m.after).not.toHaveBeenCalled();
});
it('serves only authorized output, redirects cloud bytes and keeps HEAD/download private', async () => {
  const ctx = { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) }, req = new Request('https://brand.twings.app/api/campaign-production/a0000000-0000-4000-8000-000000000001/media');
  expect((await GET(req, ctx)).status).toBe(404); expect(m.read).not.toHaveBeenCalled();
  m.output.mockResolvedValue({ status: 'succeeded', resultKey: 'output-only', resultMime: 'video/mp4' }); m.url.mockResolvedValue('https://signed.example.test/only-output');
  const cloud = await GET(req, ctx); expect(cloud.status).toBe(302); expect(cloud.headers.get('cache-control')).toBe('private, no-store'); expect(m.read).not.toHaveBeenCalled();
  m.url.mockResolvedValue(null); m.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
  const head = await HEAD(new Request(`${req.url}?download=1`, { method: 'HEAD' }), ctx); expect(head.body).toBeNull(); expect(head.headers.get('content-length')).toBe('3'); expect(head.headers.get('content-disposition')).toContain('attachment');
});
