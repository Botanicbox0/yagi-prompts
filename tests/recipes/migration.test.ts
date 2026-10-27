import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { freshDb, coreMigrationFiles, glueMigrationFiles, expectReject } from '@/tests/helpers/pglite';

/** 0059 / 0142 — the recipe tables, their checks and their posture. */
describe('maker recipe migrations (0059 core, 0142 glue)', () => {
  it('are numbered as assigned and the glue covers every new table', async () => {
    expect(coreMigrationFiles()).toContain('0059_core_maker_recipes.sql');
    expect(glueMigrationFiles()).toContain('0142_glue_maker_recipes.sql');
    const glue = await readFile('supabase/migrations/0142_glue_maker_recipes.sql', 'utf8');
    for (const table of ['platform_format_assets', 'render_job_recipes', 'render_job_outputs']) expect(glue).toContain(`'${table}'`);
  });

  it('checks shapes and bounds in the database, not only in code', async () => {
    const db = await freshDb();
    try {
      const user = randomUUID();
      await db.query('insert into auth.users(id) values($1)', [user]);
      await db.query("insert into profiles(id,email) values($1,'m@twings.test')", [user]);
      const format = randomUUID();
      await db.query("insert into platform_formats(id,user_id,title,recipe,medium,status) values($1,$2,'Draft','','image','draft')", [format, user]);
      // A draft needs no example and no royalty; a submitted v2 recipe needs a royalty.
      await db.query(`update platform_formats set recipe_v2='{"version":2}'::jsonb where id=$1`, [format]);
      expect(await expectReject(() => db.query("update platform_formats set status='submitted' where id=$1", [format]))).toMatch(/platform_formats_v2_complete/);
      expect(await expectReject(() => db.query('update platform_formats set royalty_krw=400 where id=$1', [format]))).toMatch(/check/);
      expect(await expectReject(() => db.query('update platform_formats set royalty_krw=5100 where id=$1', [format]))).toMatch(/check/);
      expect(await expectReject(() => db.query('update platform_formats set test_renders_used=4 where id=$1', [format]))).toMatch(/check/);
      expect(await expectReject(() => db.query(`update platform_formats set recipe_v2='{"version":1}'::jsonb where id=$1`, [format]))).toMatch(/check/);
      expect(await expectReject(() => db.query(`update platform_formats set disclosure='{"prompts":"yes","assets":false}'::jsonb where id=$1`, [format]))).toMatch(/check/);
      expect(await expectReject(() => db.query("update platform_formats set status='published' where id=$1", [format]))).toMatch(/platform_formats_status_check/);
      await db.query("update platform_formats set royalty_krw=1500,status='submitted' where id=$1", [format]);

      const asset = (id: string, mime = 'image/jpeg', kind = 'image', bytes = 10) => db.query('insert into platform_format_assets(id,format_id,user_id,kind,storage_key,mime,bytes,sha256) values($1,$2,$3,$4,$5,$6,$7,$8)', [id, format, user, kind, `${format}/${id}.bin`, mime, bytes, 'a'.repeat(64)]);
      expect(await expectReject(() => asset('products/1'))).toMatch(/check/);
      expect(await expectReject(() => asset(`ast_${'1'.repeat(32)}`, 'image/svg+xml'))).toMatch(/check/);
      expect(await expectReject(() => asset(`ast_${'2'.repeat(32)}`, 'video/mp4', 'image'))).toMatch(/check/);
      expect(await expectReject(() => asset(`ast_${'3'.repeat(32)}`, 'image/jpeg', 'image', 5_000_000))).toMatch(/check/);
      await asset(`ast_${'4'.repeat(32)}`);

      const template = (await db.query<{ id: string }>("select id from prompt_items limit 1")).rows[0];
      expect(template).toBeUndefined();
      // prompt_items: the recipe must be a v2 object; disclosure defaults to nothing shown.
      const prompt = randomUUID();
      await db.query("insert into prompt_items(id,slug,source,status,models,title,prompt_text,text_visibility) values($1,'p-recipe','yagi','pending','{gpt-image-2}','T','x','hidden')", [prompt]);
      expect((await db.query<{ disclosure: unknown; presentation: string }>('select disclosure,presentation from prompt_items where id=$1', [prompt])).rows[0]).toEqual({ disclosure: { prompts: false, assets: false }, presentation: 'make-first' });
      expect(await expectReject(() => db.query(`update prompt_items set recipe='[]'::jsonb where id=$1`, [prompt]))).toMatch(/check/);
      expect(await expectReject(() => db.query("update prompt_items set presentation='story-last' where id=$1", [prompt]))).toMatch(/check/);

      const job = randomUUID();
      await db.query("insert into render_jobs(id,user_id,template_id,template_slug,medium,engine,aspect) values($1,$2,$3,'p-recipe','image','gpt-image-2','4:5')", [job, user, prompt]);
      // A customer job carries no format; a test or review render always names one.
      expect(await expectReject(() => db.query(`insert into render_job_recipes(render_id,purpose,recipe) values($1,'maker_test','{"version":2}'::jsonb)`, [job]))).toMatch(/check/);
      expect(await expectReject(() => db.query(`insert into render_job_recipes(render_id,purpose,format_id,recipe) values($1,'customer',$2,'{"version":2}'::jsonb)`, [job, format]))).toMatch(/check/);
      await db.query(`insert into render_job_recipes(render_id,purpose,format_id,recipe) values($1,'maker_test',$2,'{"version":2}'::jsonb)`, [job, format]);
      expect(await expectReject(() => db.query("insert into render_job_outputs(render_id,position,step_id,storage_key,mime,bytes) values($1,6,'f7','k','image/jpeg',1)", [job]))).toMatch(/check/);
      await db.query("insert into render_job_outputs(render_id,position,step_id,storage_key,mime,bytes) values($1,0,'f1','k','image/jpeg',1)", [job]);
      // Deleting the job removes its recipe snapshot and outputs with it.
      await db.query('delete from render_jobs where id=$1', [job]);
      expect((await db.query<{ n: number }>('select (select count(*) from render_job_recipes)::int + (select count(*) from render_job_outputs)::int n')).rows[0]!.n).toBe(0);
    } finally { await db.close(); }
  });
});
