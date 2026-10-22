import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import { runner } from '@/tests/helpers/pglite';
import { seedProfile, USER } from '@/tests/helpers/billing';
import { currentSelfie, saveSelfie, savedSelfiePhoto } from '@/lib/identity/selfie-service';
import type { RenderStore } from '@/lib/renders/store';
import sharp from 'sharp';

/**
 * 0050 carries each account's CHOSEN generated portrait over as its current selfie, so the PG
 * review account (and anyone else who finished the old flow) pays without uploading again
 * (cross-session note 2026-10-22, docs/IDENTITY-SELFIE.md §4). The old bytes are not copied.
 */
let db: PGlite;
const objects = new Map<string, Uint8Array>();
const store: RenderStore = { name: 'local', put: async (k, v) => { objects.set(k, v); }, read: async k => { const v = objects.get(k); if (!v) throw Error('missing'); return v; }, url: async () => null };
beforeEach(async () => {
  db = new PGlite();
  await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
  for (const file of coreMigrationFiles().filter(f => f < '0050')) await db.exec(readMigration(file));
  objects.clear();
});
afterEach(async () => db.close());

it('turns a chosen generated portrait into the current selfie, and a fresh upload replaces it', async () => {
  const sql = runner(db);
  await seedProfile(sql, { id: USER.buyer });
  await seedProfile(sql, { id: USER.other });
  const chosen = randomUUID(), rejected = randomUUID();
  for (const [id, slot, model] of [[chosen, 1, 'gpt-image-2.5-sunburst'], [rejected, 2, 'dola-seedream-5-0-pro-260628']] as const) {
    await sql.query(`insert into identity_portrait_attempts(id,user_id,request_id,slot,status,model,prompt_version,input_key,result_key,consent_at,completed_at,created_at)
      values($1,$2,$3,$4,'succeeded',$5,'v1',$6,$7,'2026-10-22T05:15:00Z','2026-10-22T05:16:00Z','2026-10-22T05:15:00Z')`, [id, USER.buyer, randomUUID(), slot, model, `${id}/input.png`, `${id}/result.png`]);
  }
  await sql.query("insert into identity_portrait_selections(user_id,attempt_id,updated_at) values($1,$2,'2026-10-22T05:17:00Z')", [USER.buyer, chosen]);
  // A failed-only account and an account with no selection get nothing carried over.
  const failed = randomUUID();
  await sql.query(`insert into identity_portrait_attempts(id,user_id,request_id,slot,status,model,prompt_version,input_key,failure_code,consent_at)
    values($1,$2,$3,1,'failed','gpt-image-2.5-sunburst','v1',$4,'provider_failed',now())`, [failed, USER.other, randomUUID(), `${failed}/input.png`]);

  await db.exec(readMigration('0050_core_identity_selfies.sql'));

  const carried = await currentSelfie(sql, USER.buyer);
  expect(carried).toMatchObject({ user_id: USER.buyer, input_key: `${chosen}/result.png`, width: 1344, height: 2016, replaced_at: null });
  expect(carried!.consent_at).toEqual(new Date('2026-10-22T05:15:00Z'));
  expect(carried!.created_at).toEqual(new Date('2026-10-22T05:17:00Z'));
  expect(await currentSelfie(sql, USER.other)).toBeNull();
  expect((await sql.query('select count(*)::int n from identity_selfies')).rows[0]).toEqual({ n: 1 });

  // The order path reads the portrait's own object through the selfie row: no upload, no copy.
  objects.set(`${chosen}/result.png`, new Uint8Array([9, 9, 9]));
  const photo = await savedSelfiePhoto(sql, store, USER.buyer, carried!.id);
  expect(photo).toEqual({ bytes: new Uint8Array([9, 9, 9]), mime: 'image/png' });
  expect(await savedSelfiePhoto(sql, store, USER.other, carried!.id)).toBeNull();

  // A real selfie later replaces the carried-over row and nothing about the old tables changes.
  const fresh = new Uint8Array(await sharp({ create: { width: 320, height: 400, channels: 3, background: '#ccc' } }).png().toBuffer());
  const saved = await saveSelfie({ sql, store }, USER.buyer, { bytes: fresh, mime: 'image/png', consent: true });
  expect(saved).toMatchObject({ ok: true, replaced: true, unchanged: false });
  expect((await currentSelfie(sql, USER.buyer))?.input_key).not.toBe(`${chosen}/result.png`);
  expect((await sql.query('select count(*)::int n from identity_portrait_selections')).rows[0]).toEqual({ n: 1 });
});

it('is idempotent on re-application and the carried-over photo feeds the order path', async () => {
  const sql = runner(db);
  await seedProfile(sql, { id: USER.buyer });
  const chosen = randomUUID();
  await sql.query(`insert into identity_portrait_attempts(id,user_id,request_id,slot,status,model,prompt_version,input_key,result_key,consent_at,completed_at)
    values($1,$2,$3,2,'succeeded','dola-seedream-5-0-pro-260628','v1',$4,$5,now(),now())`, [chosen, USER.buyer, randomUUID(), `${chosen}/input.png`, `${chosen}/result.png`]);
  await sql.query('insert into identity_portrait_selections(user_id,attempt_id) values($1,$2)', [USER.buyer, chosen]);
  await db.exec(readMigration('0050_core_identity_selfies.sql'));
  // Running the carry-over statement twice must not create a second current selfie (the partial unique index refuses).
  const carryOver = readMigration('0050_core_identity_selfies.sql').split('insert into identity_selfies')[1]!;
  await expect(db.exec(`insert into identity_selfies${carryOver}`)).rejects.toThrow(/identity_selfie_current/);
  const carried = await currentSelfie(sql, USER.buyer);
  expect(carried).toMatchObject({ width: 1664, height: 2496 });
  objects.set(`${chosen}/result.png`, new Uint8Array([1, 2, 3, 4]));
  const photo = await savedSelfiePhoto(sql, store, USER.buyer, carried!.id);
  expect(photo?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  // The review-mode order on a saved selfie is exercised in tests/billing/toss-checkout.test.ts; here only the lineage columns.
  expect((await sql.query("select column_name from information_schema.columns where table_name='billing_payments' and column_name='identity_selfie_id'")).rows).toHaveLength(1);
});
