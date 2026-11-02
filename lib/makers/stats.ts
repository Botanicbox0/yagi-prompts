import type { SqlRunner } from '@/lib/db/sql-runner';
import { creativeProfilesReady } from './profile';

/**
 * docs/PLATFORM-2.0.md §20.4 — what a creative learns about their published recipes: how many
 * signed-in members opened each one (ever and in the last 7 days) and how often. Counts only —
 * never who. This is the number that tells a creative whether the link in their bio or their
 * "comment for the recipe" DM is working.
 */
export interface RecipeStat { slug: string; title: string; members: number; members7d: number; opens: number }

export async function makerStats(sql: SqlRunner, userId: string): Promise<RecipeStat[]> {
  if (!(await creativeProfilesReady(sql))) return [];
  const { rows } = await sql.query<{ slug: string; title: string; members: number; members7d: number; opens: number }>(
    `select p.slug, coalesce(f.title, p.title) title,
            count(u.user_id)::int members,
            count(u.user_id) filter (where u.first_at > now() - interval '7 days')::int "members7d",
            coalesce(sum(u.opens),0)::int opens
       from platform_formats f
       join prompt_items p on p.id=f.template_id and p.status='published'
       left join recipe_unlocks u on u.template_id=p.id
      where f.user_id=$1 and f.status='accepted'
      group by p.slug, f.title, p.title
      order by members desc, p.slug`, [userId]);
  return rows.map((row) => ({ slug: row.slug, title: row.title, members: Number(row.members), members7d: Number(row.members7d), opens: Number(row.opens) }));
}
