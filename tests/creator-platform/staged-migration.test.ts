import {PGlite} from '@electric-sql/pglite';
import {it,expect} from 'vitest';
import {coreMigrationFiles,readMigration} from '@/lib/db/migrations';

it('deploys on the current cloud baseline without enabling pending subscription features',async()=>{
 const db=new PGlite();try{
  await db.exec('create schema auth; create table auth.users(id uuid primary key);');
  for(const file of coreMigrationFiles().filter(f=>Number(f.slice(0,4))<=41))await db.exec(readMigration(file));
  await db.exec(readMigration('0046_core_creator_platform.sql'));
  const result=await db.query<{name:string}>("select attname as name from pg_attribute where attrelid='render_jobs'::regclass and attname in ('provider_completion_tokens','cost_source') and not attisdropped");
  expect(result.rows).toHaveLength(2);
  expect((await db.query<{name:string|null}>("select to_regclass('creator_subscription_renders')::text name")).rows[0]!.name).toBeNull();
  // Applying the deferred migrations later must not collide with shared cost columns.
  for(const file of coreMigrationFiles().filter(f=>Number(f.slice(0,4))>=42&&Number(f.slice(0,4))<=45))await db.exec(readMigration(file));
 }finally{await db.close();}
});
