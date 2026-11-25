import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigration } from '@/lib/db/migrations';
import { MIGRATIONS_DIR, coreMigrationFiles, expectReject, freshDb, glueMigrationFiles, runner } from '../helpers/pglite';
import { seedProfile } from '../helpers/billing';

/**
 * docs/BRAND-PROJECT-SPINE.md §3.6 — migrations 0194 (core) and 0195 (glue).
 *  - additive: every existing brand_projects row becomes origin 'team' and keeps passing its old checks;
 *  - a 'self' row needs only a 1-character name and no goal; a 'team' row keeps 3–120 / 3–2000;
 *  - a 'self' row can never be client-visible (the first layer of §3.4, as a table rule);
 *  - brand_project_id on jobs, uploads and films can only point at a project of the same organization,
 *    and becomes null (unfiled) if that project is ever removed;
 *  - the glue opens nothing to browser roles and grants the server role only the four UPDATE columns.
 */
const CORE = '0194_core_brand_project_spine.sql';
const GLUE = '0195_glue_brand_project_spine.sql';

let db: PGlite | null = null;
afterEach(async () => {
  await db?.close();
  db = null;
});

/** A database with every core migration BEFORE 0194, as production is today. */
async function before0194(): Promise<PGlite> {
  const d = new PGlite();
  await d.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
  for (const file of coreMigrationFiles().filter((f) => f < '0194')) await d.exec(readMigration(file));
  return d;
}

async function seedOrg(d: PGlite): Promise<{ org: string; user: string }> {
  const user = randomUUID();
  await seedProfile(runner(d), { id: user, email: `${user}@example.test` });
  const org = randomUUID();
  await d.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [org, 'Spine brand', user, randomUUID()]);
  return { org, user };
}

async function teamProject(d: PGlite, org: string, user: string, title = 'Spring launch', objective = 'Launch the spring line'): Promise<string> {
  const id = randomUUID();
  await d.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id)
      values ($1, $2, $3, $4, 'creator', $5, $6)`,
    [id, org, title, objective, user, randomUUID()],
  );
  return id;
}

async function selfProject(d: PGlite, org: string, user: string, title: string, objective = '', visible = false): Promise<string> {
  const id = randomUUID();
  await d.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id)
      values ($1, $2, $3, $4, 'studio', 'active', $5, 'self', $6, $7)`,
    [id, org, title, objective, visible, user, randomUUID()],
  );
  return id;
}

async function job(d: PGlite, org: string, user: string): Promise<string> {
  return (
    await d.query<{ id: string }>(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, params, refs, estimate_krw)
        values ($1, $2, $3, 'image', 'queued', 'seedream-5.5', 'bottle', '{}'::jsonb, '[]'::jsonb, 0) returning id`,
      [org, user, `req_${randomUUID().slice(0, 12)}`],
    )
  ).rows[0]!.id;
}

describe('0194 — schema', () => {
  it('applies on a fresh database and is safe to run twice', async () => {
    db = await freshDb();
    const cols = await db.query<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null }>(
      `select table_name, column_name, is_nullable, column_default from information_schema.columns
        where table_schema = current_schema()
          and ((table_name = 'brand_projects' and column_name = 'origin')
            or (column_name = 'brand_project_id' and table_name in ('brand_studio_jobs', 'brand_studio_assets', 'brand_studio_video_projects')))
        order by table_name`,
    );
    expect(cols.rows.map((c) => `${c.table_name}.${c.column_name}:${c.is_nullable}`)).toEqual([
      'brand_projects.origin:NO',
      'brand_studio_assets.brand_project_id:YES',
      'brand_studio_jobs.brand_project_id:YES',
      'brand_studio_video_projects.brand_project_id:YES',
    ]);
    expect(cols.rows[0]!.column_default).toContain("'team'");
    await db.exec(readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8'));
    const fks = await db.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conname like '%brand_project_fk' order by conname`,
    );
    expect(fks.rows.map((r) => r.conname)).toEqual([
      'brand_studio_assets_brand_project_fk',
      'brand_studio_jobs_brand_project_fk',
      'brand_studio_video_projects_brand_project_fk',
    ]);
    for (const fk of fks.rows) {
      expect(fk.def).toContain('FOREIGN KEY (organization_id, brand_project_id) REFERENCES brand_projects(organization_id, id)');
      expect(fk.def).toContain('ON DELETE SET NULL (brand_project_id)');
    }
    const idx = await db.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where indexname in
        ('idx_brand_projects_origin', 'idx_brand_studio_jobs_brand_project', 'idx_brand_studio_assets_brand_project', 'idx_brand_studio_video_projects_brand_project')
        order by indexname`,
    );
    expect(idx.rows).toHaveLength(4);
    for (const row of idx.rows.filter((r) => r.indexname !== 'idx_brand_projects_origin')) expect(row.indexdef).toContain('WHERE (brand_project_id IS NOT NULL)');
    const checks = await db.query<{ conname: string }>(
      `select conname from pg_constraint where conrelid = 'brand_projects'::regclass and conname in
        ('brand_projects_origin', 'brand_projects_self_hidden', 'brand_projects_title_check', 'brand_projects_objective_check') order by conname`,
    );
    expect(checks.rows.map((r) => r.conname)).toEqual(['brand_projects_objective_check', 'brand_projects_origin', 'brand_projects_self_hidden', 'brand_projects_title_check']);
  });

  it('lands on a database that already has rows: they become team projects and keep passing', async () => {
    db = await before0194();
    const { org, user } = await seedOrg(db);
    const a = await teamProject(db, org, user);
    const b = await teamProject(db, org, user, 'Abc', 'Why');
    const run = await job(db, org, user);
    await db.query('insert into brand_studio_video_projects (organization_id, title, status, aspect, timeline, revision, created_by, request_id) values ($1, $2, $3, $4, $5::jsonb, 1, $6, $7)', [
      org, 'Cut', 'active', '9:16', '{}', user, 'vp_req_1',
    ]);
    const beforeRows = (await db.query('select id, title, objective, status, client_visible, updated_at from brand_projects order by id')).rows;

    await db.exec(readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8'));
    await db.exec(readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8'));

    expect((await db.query('select id, title, objective, status, client_visible, updated_at from brand_projects order by id')).rows).toEqual(beforeRows);
    expect((await db.query<{ origin: string }>('select distinct origin from brand_projects')).rows).toEqual([{ origin: 'team' }]);
    expect((await db.query('select brand_project_id from brand_studio_jobs where id = $1', [run])).rows).toEqual([{ brand_project_id: null }]);
    expect((await db.query('select count(*)::int as n from brand_studio_video_projects where brand_project_id is null')).rows).toEqual([{ n: 1 }]);
    expect([a, b]).toHaveLength(2);
  });
});

describe('0194 — rules', () => {
  it('a self project needs a name of one character and no goal; a team project keeps its old rule', async () => {
    db = await freshDb();
    const { org, user } = await seedOrg(db);
    expect(await selfProject(db, org, user, 'A')).toMatch(/-/);
    expect(await selfProject(db, org, user, '  B  ', '   ')).toMatch(/-/);
    expect(await expectReject(() => selfProject(db!, org, user, '   '))).toMatch(/brand_projects_title_check/);
    expect(await expectReject(() => selfProject(db!, org, user, 'x'.repeat(121)))).toMatch(/brand_projects_title_check/);
    expect(await expectReject(() => selfProject(db!, org, user, 'Name', 'y'.repeat(2001)))).toMatch(/brand_projects_objective_check/);
    // The same short name and empty goal on a team row: refused, exactly as before.
    expect(await expectReject(() => teamProject(db!, org, user, 'A', 'Launch the line'))).toMatch(/brand_projects_title_check/);
    expect(await expectReject(() => teamProject(db!, org, user, 'Spring', ''))).toMatch(/brand_projects_objective_check/);
    expect(await expectReject(() => teamProject(db!, org, user, 'Spring', 'ab'))).toMatch(/brand_projects_objective_check/);
    expect(await teamProject(db, org, user, 'Abc', 'Why')).toMatch(/-/);
    // Only the two origins.
    expect(
      await expectReject(() =>
        db!.query(
          `insert into brand_projects (organization_id, title, objective, production_mode, origin, created_by, request_id)
            values ($1, 'Other', 'Other goal', 'studio', 'staff', $2, $3)`,
          [org, user, randomUUID()],
        ),
      ),
    ).toMatch(/brand_projects_origin/);
  });

  it('a self project can never be client-visible, on insert or later', async () => {
    db = await freshDb();
    const { org, user } = await seedOrg(db);
    expect(await expectReject(() => selfProject(db!, org, user, 'Mine', '', true))).toMatch(/brand_projects_self_hidden/);
    const mine = await selfProject(db, org, user, 'Mine');
    expect(await expectReject(() => db!.query('update brand_projects set client_visible = true where id = $1', [mine]))).toMatch(/brand_projects_self_hidden/);
    // Turning it into a team project and showing it in one statement is the only way (slice 6).
    await db.query("update brand_projects set origin = 'team', client_visible = true, objective = 'Now with the team' where id = $1", [mine]);
  });

  it('files only into a project of the same organization, and unfiles when a project is removed', async () => {
    db = await freshDb();
    const { org, user } = await seedOrg(db);
    const other = await seedOrg(db);
    const mine = await selfProject(db, org, user, 'Mine');
    const theirs = await selfProject(db, other.org, other.user, 'Theirs');
    const run = await job(db, org, user);
    await db.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [run, mine]);
    expect(await expectReject(() => db!.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [run, theirs]))).toMatch(/brand_studio_jobs_brand_project_fk/);
    const asset = (
      await db.query<{ id: string }>(
        `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, storage_key, source, status, created_by)
          values ($1, 'image', 'seed', 'image/png', 10, $2, 'upload', 'ready', $3) returning id`,
        [org, `k/${randomUUID()}`, user],
      )
    ).rows[0]!.id;
    expect(await expectReject(() => db!.query('update brand_studio_assets set brand_project_id = $2 where id = $1', [asset, theirs]))).toMatch(/brand_studio_assets_brand_project_fk/);
    await db.query('update brand_studio_assets set brand_project_id = $2 where id = $1', [asset, mine]);
    const film = (
      await db.query<{ id: string }>(
        `insert into brand_studio_video_projects (organization_id, title, status, aspect, timeline, revision, created_by, request_id)
          values ($1, 'Cut', 'active', '9:16', '{}'::jsonb, 1, $2, 'vp_req_2') returning id`,
        [org, user],
      )
    ).rows[0]!.id;
    expect(await expectReject(() => db!.query('update brand_studio_video_projects set brand_project_id = $2 where id = $1', [film, theirs]))).toMatch(
      /brand_studio_video_projects_brand_project_fk/,
    );
    await db.query('update brand_studio_video_projects set brand_project_id = $2 where id = $1', [film, mine]);

    // The application roles have no DELETE on brand_projects; as the owner role the rows stay and are unfiled.
    await db.query('delete from brand_projects where id = $1', [mine]);
    expect((await db.query('select organization_id, brand_project_id from brand_studio_jobs where id = $1', [run])).rows).toEqual([{ organization_id: org, brand_project_id: null }]);
    expect((await db.query('select brand_project_id from brand_studio_assets where id = $1', [asset])).rows).toEqual([{ brand_project_id: null }]);
    expect((await db.query('select brand_project_id from brand_studio_video_projects where id = $1', [film])).rows).toEqual([{ brand_project_id: null }]);
  });
});

describe('0195 — glue', () => {
  const glue = readFileSync(join(MIGRATIONS_DIR, GLUE), 'utf8');
  it('re-asserts the deny-all posture of all four tables and opens nothing to browser roles', () => {
    for (const table of ['brand_studio_jobs', 'brand_studio_assets', 'brand_studio_video_projects', 'brand_projects']) expect(glue, table).toContain(`'${table}'`);
    expect(glue).toContain('enable row level security');
    expect(glue).toContain('force row level security');
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(glue).not.toMatch(/create\s+policy/i);
    expect(glue.replace(/--[^\n]*/g, '')).not.toMatch(/to\s+(anon|authenticated|public)\b/i);
  });
  it('grants the server role UPDATE of exactly origin, title, objective and production_mode on brand_projects, and no DELETE', () => {
    const statements = glue.replace(/--[^\n]*/g, '');
    const grants = statements.match(/grant[^;]*brand_projects[^;]*;/gi) ?? [];
    expect(grants).toEqual(['grant update(origin,title,objective,production_mode) on public.brand_projects to service_role;']);
    expect(statements).not.toMatch(/grant[^;]*delete[^;]*brand_projects/i);
  });
  it('is the pair the migration list expects', () => {
    expect(coreMigrationFiles()).toContain(CORE);
    expect(glueMigrationFiles()).toContain(GLUE);
    for (const file of [CORE, GLUE]) expect(readFileSync(join(MIGRATIONS_DIR, file), 'utf8').startsWith('-- 클라우드 적용 필요'), file).toBe(true);
  });
});
