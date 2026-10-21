import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { migratedDb } from '@/tests/helpers/pglite';
describe('creator-platform direct database access',()=>{
 it('denies every platform table to browser roles, including recipes and ledgers',async()=>{
  const db=await migratedDb();try{
   await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
   await db.exec(await readFile('supabase/migrations/0131_glue_creator_platform.sql','utf8'));
   const tables=await db.query<{tablename:string}>('select tablename from pg_tables where schemaname=\'public\' and tablename like \'platform_%\'');
   expect(tables.rows.length).toBe(14);
   for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    for(const {tablename} of tables.rows)await expect(db.query(`select * from ${tablename}`)).rejects.toThrow();
    await db.exec('reset role');
   }
   const flags=await db.query<{relrowsecurity:boolean;relforcerowsecurity:boolean}>('select relrowsecurity,relforcerowsecurity from pg_class where relname like \'platform_%\' and relkind=\'r\'');
   expect(flags.rows.every(r=>r.relrowsecurity&&r.relforcerowsecurity)).toBe(true);
  }finally{await db.close();}
 });
});
