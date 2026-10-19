import { afterAll,afterEach,beforeAll,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { freshDb,runner } from '@/tests/helpers/pglite';
import type { PGlite } from '@electric-sql/pglite';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { creatorProgramOpen } from '@/lib/creator-platform/links';

const FLAGS=['TWINGS_COMMUNITY','TWINGS_FORMAT_CREATORS','TWINGS_CREATOR_APPLICATIONS','TWINGS_IMAGE_REWARDS'] as const;
describe('format creator gates',()=>{
 let db:PGlite;
 beforeAll(async()=>{db=await freshDb();});
 afterAll(async()=>{await db?.close();});
 afterEach(()=>{for(const flag of FLAGS)vi.stubEnv(flag,'');vi.unstubAllEnvs();});

 it('keeps public intake closed unless both the supplier and the application gate are on',()=>{
  expect(creatorProgramOpen({})).toBe(false);
  expect(creatorProgramOpen({TWINGS_FORMAT_CREATORS:'on'})).toBe(false);
  expect(creatorProgramOpen({TWINGS_CREATOR_APPLICATIONS:'on'})).toBe(false);
  expect(creatorProgramOpen({TWINGS_FORMAT_CREATORS:'on',TWINGS_CREATOR_APPLICATIONS:'ON'})).toBe(false);
  expect(creatorProgramOpen({TWINGS_FORMAT_CREATORS:'on',TWINGS_CREATOR_APPLICATIONS:'on'})).toBe(true);
 });

 it('opens applications only with both gates and the 0050 schema; the old supplier gate alone collects nothing new',async()=>{
  const sql=runner(db);
  expect(await platformAccess(sql)).toMatchObject({ready:true,onboarding:true,creators:false,applications:false});
  vi.stubEnv('TWINGS_FORMAT_CREATORS','on');
  expect(await platformAccess(sql)).toMatchObject({creators:true,applications:false});
  vi.stubEnv('TWINGS_CREATOR_APPLICATIONS','on');
  expect(await platformAccess(sql)).toMatchObject({creators:true,applications:true});
  await db.exec('alter table platform_formats drop column review_note');
  expect(await platformAccess(sql)).toMatchObject({ready:true,creators:true,onboarding:false,applications:false});
 });
});
