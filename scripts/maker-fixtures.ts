import type { SqlRunner } from '@/lib/db/sql-runner';
import { saveMakerProfile } from '@/lib/makers/profile';
import { FIXTURE_USERS } from './fixtures';

/**
 * docs/PLATFORM-2.0.md §7.5 — one public template maker in the LOCAL snapshot only, so the anon
 * sweep can open a real `/{locale}/makers/{handle}` page. The pro fixture already authored the
 * published community fixture `cafe-window-timelapse` as `@jun`; here that account becomes an
 * approved maker who turned their profile on, through the same `saveMakerProfile` a maker uses.
 * Never part of the base `seed()` (tests build their own makers) and never cloud data.
 */
export const LOCAL_MAKER = { userId: FIXTURE_USERS.pro.id, handle: 'jun', bio: 'TEST ONLY · 로컬 검증용 메이커 프로필입니다.' } as const;

export async function seedMakerFixtures(sql: SqlRunner): Promise<void> {
  await sql.query(
    `insert into platform_creators(user_id, active, contract_version) values ($1, true, 'local-fixture')
     on conflict (user_id) do nothing`,
    [LOCAL_MAKER.userId],
  );
  await saveMakerProfile(sql, LOCAL_MAKER.userId, { handle: LOCAL_MAKER.handle, bio: LOCAL_MAKER.bio, publicProfile: true });
}
