import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { freshDb } from '@/tests/helpers/pglite';
describe('creator-platform direct database access',()=>{
 it('denies every platform table to browser roles, including recipes and ledgers',async()=>{
  const db=await freshDb();try{
   await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
   await db.exec(await readFile('supabase/migrations/0131_glue_creator_platform.sql','utf8'));
   await db.exec(await readFile('supabase/migrations/0138_glue_creator_onboarding.sql','utf8'));
   await db.exec(await readFile('supabase/migrations/0142_glue_maker_recipes.sql','utf8'));
   // 0193 (2026-11-25): the studio's own formats' recipe revisions, server-only like the rest.
   await db.exec(await readFile('supabase/migrations/0193_glue_format_revision.sql','utf8'));
   const tables=await db.query<{tablename:string}>('select tablename from pg_tables where schemaname=\'public\' and tablename like \'platform_%\'');
   expect(tables.rows.length).toBe(17);
   expect(tables.rows.map(r=>r.tablename)).toContain('platform_format_revisions');
   for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    for(const {tablename} of tables.rows)await expect(db.query(`select * from ${tablename}`)).rejects.toThrow();
    await db.exec('reset role');
   }
   const flags=await db.query<{relrowsecurity:boolean;relforcerowsecurity:boolean}>('select relrowsecurity,relforcerowsecurity from pg_class where relname like \'platform_%\' and relkind=\'r\'');
   expect(flags.rows.every(r=>r.relrowsecurity&&r.relforcerowsecurity)).toBe(true);
  }finally{await db.close();}
 });
 it('0207 — the evidence stamp and the recipe guard are no browser-callable function',async()=>{
  const db=await freshDb();try{
   await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
   await db.exec(await readFile('supabase/migrations/0131_glue_creator_platform.sql','utf8'));
   await db.exec(await readFile('supabase/migrations/0193_glue_format_revision.sql','utf8'));
   const glue=await readFile('supabase/migrations/0207_glue_format_revision_txid.sql','utf8');
   expect(glue.startsWith('-- 클라우드 적용 필요')).toBe(true);
   await db.exec(glue);
   await db.exec(glue);
   const grants=await db.query<{fn:string;role:string;can:boolean}>(
    `select fn,role,has_function_privilege(role,fn,'execute') as can
       from unnest(array['platform_stamp_txid()','platform_private_format()']) fn, unnest(array['public','anon','authenticated']) role`);
   expect(grants.rows.filter(r=>r.can)).toEqual([]);
   const paths=await db.query<{proname:string;proconfig:string[]}>("select proname,proconfig from pg_proc where proname in ('platform_stamp_txid','platform_private_format') order by proname");
   expect(paths.rows).toEqual([
    {proname:'platform_private_format',proconfig:['search_path=public, pg_temp']},
    {proname:'platform_stamp_txid',proconfig:['search_path=public, pg_temp']},
   ]);
  }finally{await db.close();}
 });
});
