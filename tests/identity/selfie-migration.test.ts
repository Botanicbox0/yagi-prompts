import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import { runner } from '@/tests/helpers/pglite';
import { seedProfile, USER } from '@/tests/helpers/billing';
import { currentSelfie, saveSelfie, savedSelfiePhoto, selfieLibrary } from '@/lib/identity/selfie-service';
import type { RenderStore } from '@/lib/renders/store';
import sharp from 'sharp';

/**
 * 0050 carries each account's CHOSEN generated portrait over as its default photo, so the PG
 * review account (and anyone else who finished the old flow) pays without uploading again
 * (cross-session note 2026-10-22, docs/IDENTITY-SELFIE.md §4). The old bytes are not copied.
 * The schema holds the library's shape: the 2.0 columns, one default among the active photos, a
 * short label — and no "one photo per account" index any more (the limit lives in the service).
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

it('turns a chosen generated portrait into the default photo, and a fresh upload replaces it', async () => {
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
  expect(carried).toMatchObject({ user_id: USER.buyer, input_key: `${chosen}/result.png`, width: 1344, height: 2016, replaced_at: null, deleted_at: null, is_default: true, last_used_at: null, label: null });
  expect(carried!.consent_at).toEqual(new Date('2026-10-22T05:15:00Z'));
  expect(carried!.created_at).toEqual(new Date('2026-10-22T05:17:00Z'));
  expect(await currentSelfie(sql, USER.other)).toBeNull();
  expect((await sql.query('select count(*)::int n from identity_selfies')).rows[0]).toEqual({ n: 1 });
  expect(await selfieLibrary(sql, USER.buyer, 1)).toMatchObject({ limit: 1, defaultId: carried!.id, items: [{ id: carried!.id, isDefault: true }] });

  // The order path reads the portrait's own object through the selfie row: no upload, no copy.
  objects.set(`${chosen}/result.png`, new Uint8Array([9, 9, 9]));
  const photo = await savedSelfiePhoto(sql, store, USER.buyer, carried!.id);
  expect(photo).toEqual({ bytes: new Uint8Array([9, 9, 9]), mime: 'image/png' });
  expect(await savedSelfiePhoto(sql, store, USER.other, carried!.id)).toBeNull();

  // At the default limit of 1 a real selfie REPLACES the carried-over row (it never piles up beside it),
  // takes over as the default, and nothing about the old tables changes.
  const fresh = new Uint8Array(await sharp({ create: { width: 320, height: 400, channels: 3, background: '#ccc' } }).png().toBuffer());
  expect(await saveSelfie({ sql, store, limit: 1 }, USER.buyer, { bytes: fresh, mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'limit_reached' });
  const saved = await saveSelfie({ sql, store, limit: 1 }, USER.buyer, { bytes: fresh, mime: 'image/png', consent: true, replaceId: carried!.id });
  expect(saved).toMatchObject({ ok: true, replaced: true, unchanged: false });
  expect(await currentSelfie(sql, USER.buyer)).toMatchObject({ is_default: true });
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
  // Running the carry-over statement twice must not create a second default (the partial unique index refuses).
  const carryOver = readMigration('0050_core_identity_selfies.sql').split('insert into identity_selfies')[1]!;
  await expect(db.exec(`insert into identity_selfies${carryOver}`)).rejects.toThrow(/identity_selfie_default/);
  const carried = await currentSelfie(sql, USER.buyer);
  expect(carried).toMatchObject({ width: 1664, height: 2496, is_default: true });
  objects.set(`${chosen}/result.png`, new Uint8Array([1, 2, 3, 4]));
  const photo = await savedSelfiePhoto(sql, store, USER.buyer, carried!.id);
  expect(photo?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  // The review-mode order on a saved selfie is exercised in tests/billing/toss-checkout.test.ts; here only the lineage columns.
  expect((await sql.query("select column_name from information_schema.columns where table_name='billing_payments' and column_name='identity_selfie_id'")).rows).toHaveLength(1);
});

it('has the 2.0 library shape: the new columns, one active default, a short label, no one-photo index', async () => {
  const sql = runner(db);
  await db.exec(readMigration('0050_core_identity_selfies.sql'));
  const columns = (await sql.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    "select column_name,data_type,is_nullable,column_default from information_schema.columns where table_name='identity_selfies' and column_name in ('is_default','last_used_at','deleted_at','label') order by column_name")).rows;
  expect(columns).toEqual([
    { column_name: 'deleted_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
    { column_name: 'is_default', data_type: 'boolean', is_nullable: 'NO', column_default: 'false' },
    { column_name: 'label', data_type: 'text', is_nullable: 'YES', column_default: null },
    { column_name: 'last_used_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
  ]);
  const indexes = new Map((await sql.query<{ indexname: string; indexdef: string }>("select indexname,indexdef from pg_indexes where tablename='identity_selfies'")).rows.map(row => [row.indexname, row.indexdef]));
  expect(indexes.has('identity_selfie_current')).toBe(false);
  expect(indexes.get('identity_selfie_default')).toMatch(/UNIQUE INDEX identity_selfie_default ON (public\.)?identity_selfies USING btree \(user_id\) WHERE \(is_default AND \(deleted_at IS NULL\) AND \(replaced_at IS NULL\)\)/);
  expect(indexes.has('identity_selfie_owner')).toBe(true);

  // Several active photos per account are fine; two active defaults, a 41-character label or a deleted default are not.
  await seedProfile(sql, { id: USER.buyer });
  const insert = (sha: string, extra = '', values = '') => sql.query(
    `insert into identity_selfies(id,user_id,input_key,sha256,width,height,consent_at${extra}) values(gen_random_uuid(),$1,'k','${sha.repeat(64)}',10,10,now()${values})`, [USER.buyer]);
  await insert('a', ',is_default', ',true');
  await insert('b');
  await insert('c', ',label', ",'안경'");
  await expect(insert('d', ',is_default', ',true')).rejects.toThrow(/identity_selfie_default/);
  await expect(insert('e', ',label', `,'${'가'.repeat(41)}'`)).rejects.toThrow(/identity_selfies_label_check/);
  await expect(insert('f', ',label', ",''")).rejects.toThrow(/identity_selfies_label_check/);
  await expect(insert('1', ',is_default,deleted_at', ',true,now()')).rejects.toThrow(/identity_selfies_default_active/);
  await insert('2', ',is_default,deleted_at', ',false,now()');
  expect((await sql.query('select count(*)::int n from identity_selfies where user_id=$1 and deleted_at is null', [USER.buyer])).rows[0]).toEqual({ n: 3 });
});

it('keeps the photos owner-only through server routes: RLS forced, no browser role, no hard delete', () => {
  // Glue binds to Supabase roles that PGlite does not have; its text is the contract here.
  const glue = readMigration('0137_glue_identity_selfies.sql');
  expect(glue).toMatch(/CLOUD APPLICATION REQUIRED/);
  expect(glue).toMatch(/force row level security/);
  expect(glue).toMatch(/revoke all on public\.%I from public,anon,authenticated/);
  expect(glue).toMatch(/grant select,insert,update on public\.identity_selfies to service_role;/);
  expect(glue).not.toMatch(/grant[^;]*delete[^;]*identity_selfies/i);
  expect(readMigration('0050_core_identity_selfies.sql')).toMatch(/^-- CLOUD APPLICATION REQUIRED/);
});
