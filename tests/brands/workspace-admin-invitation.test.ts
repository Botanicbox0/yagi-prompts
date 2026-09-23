import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import * as service from '@/lib/brands/workspace/service';

it('a studio-appointed workspace admin manages only the invited brand, never the TWINGS studio', async () => {
  const db = await freshDb(), sql = runner(db);
  const person = (isAdmin = false): Viewer => ({ userId: randomUUID(), email: `${randomUUID()}@example.test`, isAdmin, tier: isAdmin ? 'admin' : 'free', locale: 'ko' });
  const studio = person(true), client = person(), colleague = person();
  const unwrap = <T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> => {
    if (!value.ok) throw new Error(JSON.stringify(value));
    return value as Extract<T, { ok: true }>;
  };
  try {
    for (const viewer of [studio, client, colleague]) await seedProfile(sql, { id: viewer.userId!, email: viewer.email!, isAdmin: viewer.isAdmin });
    const own = unwrap(await service.createStudioOrganization({ sql }, studio, { name: 'Invited brand', requestId: randomUUID() }));
    const other = unwrap(await service.createStudioOrganization({ sql }, studio, { name: 'Other brand', requestId: randomUUID() }));
    const invitation = unwrap(await service.createStudioInvitation({ sql }, studio, { organizationId: own.id, email: client.email, role: 'owner', requestId: randomUUID() }));
    expect(await service.acceptBrandInvitation({ sql, verifiedEmail: client.email! }, client, { token: invitation.token })).toMatchObject({ ok: true, organizationId: own.id });
    expect((await service.loadBrandWorkspace({ sql }, client)).organizations).toEqual([expect.objectContaining({ id: own.id, role: 'owner' })]);
    expect(await service.loadBrandMembers({ sql }, client, own.id)).not.toBeNull();
    expect(await service.updateBrandSettings({ sql }, client, { organizationId: own.id, name: 'Managed brand', website: '', description: '', contactEmail: '', expectedRevision: 0 })).toMatchObject({ ok: true });
    expect(await service.createBrandInvitation({ sql }, client, { organizationId: own.id, email: colleague.email, role: 'editor', requestId: randomUUID() })).toMatchObject({ ok: true });
    expect(await service.loadBrandSettings({ sql }, client, other.id)).toBeNull();
    expect(await service.loadBrandMembers({ sql }, client, other.id)).toBeNull();
    expect(await service.createStudioOrganization({ sql }, client, { name: 'Forbidden studio action', requestId: randomUUID() })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await sql.query('select is_admin from profiles where id=$1', [client.userId])).rows[0]?.is_admin).toBe(false);
    expect(await service.revokeBrandMember({ sql }, client, { organizationId: own.id, userId: client.userId })).toMatchObject({ ok: false });
  } finally { await db.close(); }
});
