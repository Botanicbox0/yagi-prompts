import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  signUnsubscribeToken,
  unsubscribePath,
  verifyUnsubscribeToken,
} from '@/lib/notify/unsubscribe';
import { disableToggle, loadPreferences, savePreferences } from '@/lib/notify/preferences';
import { renderUnsubscribed, renderUnsubscribeInvalid } from '@/lib/notify/unsubscribe-page';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '../helpers/pglite';
import { seedRecipient } from '../helpers/notify';

/**
 * PLAN §3.5 — "Every email carries a one-click unsubscribe link (signed token flips the toggle)."
 *
 * The token is a write capability that lives in an inbox for months, so the properties under test
 * are the ones that make that safe: it is bound to one user and one column, it cannot be edited
 * into someone else's, and using it twice is the same as using it once.
 */

const SECRET = 'test-only-secret-00000000000000000000';
const OTHER_SECRET = 'a-completely-different-secret-key!';

describe('unsubscribe token', () => {
  const claims = { userId: 'f0000000-0000-4000-8000-000000000002', toggle: 'notif_updates' } as const;

  it('round-trips its single-purpose payload', () => {
    const token = signUnsubscribeToken(claims, SECRET);
    const verified = verifyUnsubscribeToken(token, { secret: SECRET });
    expect(verified).toEqual({ ok: true, claims: { ...claims } });
  });

  it('refuses a tampered payload rather than throwing', () => {
    const token = signUnsubscribeToken(claims, SECRET);
    const [payload, signature] = token.split('.') as [string, string];

    // Re-encode the payload for a DIFFERENT user, keeping the original signature: the exact attack
    // the signature exists to stop — "unsubscribe someone else".
    const forgedPayload = Buffer.from(
      JSON.stringify({ u: 'f0000000-0000-4000-8000-000000000001', t: claims.toggle }),
    ).toString('base64url');
    expect(verifyUnsubscribeToken(`${forgedPayload}.${signature}`, { secret: SECRET })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });

    // And every other shape of garbage is a refusal, not an exception.
    for (const bad of ['', 'nope', `${payload}`, `${payload}.`, `.${signature}`, `${payload}.aaaa`]) {
      const result = verifyUnsubscribeToken(bad, { secret: SECRET });
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('is worthless under another signing key', () => {
    const token = signUnsubscribeToken(claims, SECRET);
    expect(verifyUnsubscribeToken(token, { secret: OTHER_SECRET })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('refuses a payload naming a column that is not a toggle', () => {
    const payload = Buffer.from(
      JSON.stringify({ u: claims.userId, t: 'is_admin' }),
    ).toString('base64url');
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const signature = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(verifyUnsubscribeToken(`${payload}.${signature}`, { secret: SECRET })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('builds a link the route can read back', () => {
    const path = unsubscribePath(claims, SECRET);
    expect(path.startsWith('/api/notify/unsubscribe?t=')).toBe(true);
    const token = decodeURIComponent(path.split('t=')[1]!);
    expect(verifyUnsubscribeToken(token, { secret: SECRET })).toEqual({ ok: true, claims: { ...claims } });
  });
});

describe('unsubscribe write (§3.5)', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await freshDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it('flips exactly one toggle, is idempotent, and answers in the profile’s language', async () => {
    const sql = runner(db);
    const user = await seedRecipient(db, {
      email: 'ko@x.test',
      locale: 'ko',
      notifNew: true,
      notifUpdates: true,
    });

    const first = await disableToggle(sql, user, 'notif_updates');
    expect(first).toEqual({ ok: true, locale: 'ko' });
    expect(await loadPreferences(sql, user)).toEqual({ newPlaybook: true, updates: false });

    // A forwarded link clicked twice is not an error state.
    const second = await disableToggle(sql, user, 'notif_updates');
    expect(second.ok).toBe(true);
    expect(await loadPreferences(sql, user)).toEqual({ newPlaybook: true, updates: false });
  });

  it('cannot reach another user’s row', async () => {
    const sql = runner(db);
    const a = await seedRecipient(db, { email: 'a@x.test', notifNew: true, notifUpdates: true });
    const b = await seedRecipient(db, { email: 'b@x.test', notifNew: true, notifUpdates: true });

    await disableToggle(sql, a, 'notif_new_playbook');
    expect(await loadPreferences(sql, a)).toEqual({ newPlaybook: false, updates: true });
    expect(await loadPreferences(sql, b)).toEqual({ newPlaybook: true, updates: true });
  });

  it('reports honestly when the profile is gone', async () => {
    const sql = runner(db);
    const result = await disableToggle(
      sql,
      'f0000000-0000-4000-8000-0000000000ff',
      'notif_updates',
    );
    expect(result.ok).toBe(false);
  });

  it('can only ever turn things OFF — enabling needs the account form', async () => {
    const sql = runner(db);
    const user = await seedRecipient(db, { email: 'off@x.test', notifNew: true });
    await disableToggle(sql, user, 'notif_new_playbook');
    expect(await loadPreferences(sql, user)).toEqual({ newPlaybook: false, updates: false });

    // The account server action is the only writer that can set `true`.
    expect(await savePreferences(sql, user, { newPlaybook: true, updates: true })).toBe(true);
    expect(await loadPreferences(sql, user)).toEqual({ newPlaybook: true, updates: true });
  });
});

describe('unsubscribe confirmation page', () => {
  it('says which switch moved, bilingually, and offers the way back', () => {
    const en = renderUnsubscribed({ locale: 'en', toggle: 'notif_new_playbook' });
    expect(en).toContain('lang="en"');
    expect(en).toContain('noindex');
    expect(en).toContain('href="/account"');

    const ko = renderUnsubscribed({ locale: 'ko', toggle: 'notif_updates' });
    expect(ko).toContain('lang="ko"');
    expect(ko).toContain('href="/ko"');
    expect(ko).not.toBe(en);
  });

  it('explains a broken link instead of pretending it worked', () => {
    const invalid = renderUnsubscribeInvalid('en');
    expect(invalid).toContain('href="/account"');
    expect(invalid).not.toContain(renderUnsubscribed({ locale: 'en', toggle: 'notif_updates' }));
  });
});
