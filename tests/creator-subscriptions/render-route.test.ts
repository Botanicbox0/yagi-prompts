import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  viewer: { userId: '11111111-1111-4111-8111-111111111111' as string | null, isAdmin: false, tier: 'free', email: null, locale: 'ko' },
  environment: 'live', editing: true, enqueue: vi.fn(), pass: vi.fn(), after: vi.fn(),
}));
vi.mock('next/server', async importOriginal => ({ ...(await importOriginal<object>()), after: state.after }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => state.viewer }));
vi.mock('@/lib/creator-subscriptions/runtime', () => ({
  getSubscriptionContext: async () => ({ sql: {}, environment: state.environment }),
  premiumEditingOperational: async () => state.editing,
  SUBSCRIPTION_HEADERS: { 'Cache-Control': 'private, no-store' },
}));
vi.mock('@/lib/renders/service', () => ({ createSubscriptionRenderJob: state.enqueue }));
vi.mock('@/lib/renders/runtime', () => ({ runLiveRenderPass: state.pass }));
vi.mock('@/lib/renders/store', () => ({ getRenderStore: async () => ({}) }));
vi.mock('@/lib/billing/toss-runtime', () => ({ isSameOrigin: (r: Request) => r.headers.get('origin') === new URL(r.url).origin }));
import { POST } from '@/app/api/creator-subscriptions/renders/route';

function request(fields: Record<string, string> = {}, origin = 'https://twings.app') {
  const form = new FormData();
  for (const [key, value] of Object.entries({ requestId: '22222222-2222-4222-8222-222222222222', template: 'test-video', locale: 'ko', ownFaceConsent: '1', ...fields })) form.set(key, value);
  form.set('photo', new File([new Uint8Array([255, 216, 255])], 'face.jpg', { type: 'image/jpeg' }));
  return new Request('https://twings.app/api/creator-subscriptions/renders', { method: 'POST', headers: { origin }, body: form });
}
describe('monthly render boundary', () => {
  beforeEach(() => {
    state.viewer.userId = '11111111-1111-4111-8111-111111111111'; state.viewer.isAdmin = false;
    state.environment = 'live'; state.editing = true; vi.clearAllMocks();
    state.enqueue.mockResolvedValue({ ok: true, id: '33333333-3333-4333-8333-333333333333', held: false });
  });
  it('rejects cross-site submission before any subscription or provider action', async () => {
    expect((await POST(request({}, 'https://elsewhere.example'))).status).toBe(403);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it('does not let an ordinary user spend a test entitlement', async () => {
    state.environment = 'test'; expect((await POST(request())).status).toBe(403);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it('rejects client recipe, resolution and storage overrides', async () => {
    for (const key of ['prompt', 'basePrompt', 'resolution', 'aspect', 'inputKey']) {
      expect((await POST(request({ [key]: 'forged' }))).status).toBe(400);
    }
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it('requires own-face consent independently of payment', async () => {
    expect((await POST(request({ ownFaceConsent: '0' }))).status).toBe(400);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it('a missing GPT configuration never sends an adjustment for paid rendering', async () => {
    state.editing = false;
    const response = await POST(request({ editText: '셔츠를 파란색으로 바꿔주세요.' }));
    expect(await response.json()).toEqual({ ok: false, code: 'editing_unavailable' });
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it('forwards only bounded upload data and schedules exactly this paid job', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(state.enqueue).toHaveBeenCalledOnce();
    expect(state.enqueue.mock.calls[0]![2]).toMatchObject({ ownFaceConsent: true, templateSlug: 'test-video', requestId: '22222222-2222-4222-8222-222222222222', references: [] });
    expect(state.after).toHaveBeenCalledOnce();
    await state.after.mock.calls[0]![0]();
    expect(state.pass).toHaveBeenCalledWith({}, { jobId: '33333333-3333-4333-8333-333333333333', limit: 1 });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('bounds the actual body even if Content-Length is omitted', async () => {
    const oversized = new Request('https://twings.app/api/creator-subscriptions/renders', { method: 'POST', headers: { origin: 'https://twings.app', 'content-type': 'multipart/form-data; boundary=x' }, body: new Uint8Array(4_000_001) });
    expect((await POST(oversized)).status).toBe(413);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
});
