import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {coreMigrationFiles,readMigration} from '@/lib/db/migrations';
import {runner} from '@/tests/helpers/pglite';
import {seedProfile,USER} from '@/tests/helpers/billing';
import {portraitState} from '@/lib/identity/portrait-service';
it('preserves old Sunburst selections and consumes the existing second portrait as the retry',async()=>{
 const db=new PGlite();try{
  await db.exec('create schema auth;create table auth.users(id uuid primary key)');
  for(const file of coreMigrationFiles().filter(f=>f<'0029'))await db.exec(readMigration(file));
  const sql=runner(db);await seedProfile(sql,{id:USER.buyer});
  const ids=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'];
  for(const [i,id] of ids.entries())await sql.query(`insert into identity_portrait_attempts(id,user_id,request_id,slot,status,model,prompt_version,input_key,result_key,consent_at,completed_at) values($1,$2,$1,$3,'succeeded','gpt-image-2.5-sunburst','v1','original/input.png','result.png',now(),now())`,[id,USER.buyer,i+1]);
  await sql.query('insert into identity_portrait_selections(user_id,attempt_id) values($1,$2)',[USER.buyer,ids[1]]);
  await db.exec(readMigration('0029_core_portrait_comparison.sql'));
  const state=await portraitState(sql,USER.buyer);expect(state.selected).toBe(ids[1]);expect(state.retryUsed).toBe(true);expect(state.canRetry).toBe(false);expect(state.canRecover).toBe(true);
  expect(state.attempts.find(a=>a.id===ids[1])?.slot).toBe(3);
 }finally{await db.close();}
});
