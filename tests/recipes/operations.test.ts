import { describe, expect, it } from 'vitest';
import { ADMIN_OPERATIONS } from '@/lib/admin/operations';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import type { AdminContext } from '@/lib/admin/context';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';

/** `platform.review` is a registered admin operation (AGENTS.md §4): guarded, strictly parsed. */
describe('platform.review operation', () => {
  const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [k, v] of Object.entries(fields)) data.set(k, v); return data; };
  const ctx = (viewer = ADMIN_VIEWER) => ({ sql: null, storage: null, viewer }) as unknown as AdminContext;

  it('is in the registry next to platform.manage', () => {
    expect(Object.keys(ADMIN_OPERATIONS)).toEqual(expect.arrayContaining(['platform.manage', 'platform.review']));
  });

  it('refuses a non-admin before parsing, and parses only render + id + reason', async () => {
    expect(await dispatchAdmin('platform.review', form({ action: 'render', id: '11111111-1111-4111-8111-111111111111', reason: 'Face check' }), ctx(viewerOf('free')))).toMatchObject({ ok: false, code: 'forbidden' });
    const op = ADMIN_OPERATIONS['platform.review'];
    expect(op.parse(form({ action: 'render', id: '11111111-1111-4111-8111-111111111111', reason: 'Face check' }))).toMatchObject({ ok: true });
    expect(op.parse(form({ action: 'render', id: 'nope', reason: 'Face check' }))).toMatchObject({ ok: false });
    expect(op.parse(form({ action: 'render', id: '11111111-1111-4111-8111-111111111111', reason: 'Face check', priceKrw: '100' }))).toMatchObject({ ok: false });
  });

  it('reads an empty optional price as absent on platform.manage', () => {
    const op = ADMIN_OPERATIONS['platform.manage'];
    expect(op.parse(form({ action: 'format', id: '11111111-1111-4111-8111-111111111111', accept: 'false', note: 'Fix the face step', priceKrw: '', reason: 'Review' }))).toMatchObject({ ok: true, value: { accept: false } });
    expect(op.parse(form({ action: 'format', id: '11111111-1111-4111-8111-111111111111', accept: 'true', priceKrw: '4900', reason: 'Review' }))).toMatchObject({ ok: true, value: { priceKrw: 4900 } });
  });
});
