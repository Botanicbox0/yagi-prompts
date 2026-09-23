import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * The studio's reply queue (P1-2, 2026-09-23). Read-only.
 *
 * A brand writes to the studio in two places: the private support thread per brand (which also
 * carries the "전용 템플릿 의뢰" brief from `components/brand-workspace/studio-inquiry.tsx`, sent as
 * `support.send`) and the conversation on each campaign. A thread is waiting when its latest row
 * was written by the brand side; the studio's reply is what takes it off the list.
 *
 * Studio only: the DB `is_admin` flag, re-read here like every studio loader in `./service.ts`. A
 * domain-only staff viewer (read-only brand access via verified email) is not the studio and gets
 * nothing, which is why no `verifiedEmail` is accepted.
 */

export interface StudioInboxEntry {
  kind: 'support' | 'project';
  organizationId: string;
  organizationName: string;
  projectId: string | null;
  projectTitle: string | null;
  /** When the brand's latest unanswered message arrived. */
  lastMessageAt: string;
  /** The admin page where the studio answers it. */
  href: string;
}

const stamp = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** `null` when the viewer is not the studio (or not signed in). Oldest waiting first. */
export async function loadStudioInbox(deps: { sql: SqlRunner }, viewer: Viewer): Promise<StudioInboxEntry[] | null> {
  if (!z.string().uuid().safeParse(viewer.userId).success) return null;
  const { sql } = deps;
  const me = (await sql.query<{ is_admin: boolean | null }>('select is_admin from profiles where id=$1', [viewer.userId])).rows[0];
  if (me?.is_admin !== true) return null;

  const support = (
    await sql.query<{ organization_id: string; name: string; created_at: unknown }>(
      `select latest.organization_id, o.name, latest.created_at
         from (select distinct on (organization_id) organization_id, author_role, created_at
                 from brand_support_messages
                order by organization_id, created_at desc, id desc) latest
         join brand_organizations o on o.id = latest.organization_id
        where latest.author_role = 'brand'`,
    )
  ).rows.map((r): StudioInboxEntry => ({
    kind: 'support',
    organizationId: String(r.organization_id),
    organizationName: String(r.name),
    projectId: null,
    projectTitle: null,
    lastMessageAt: stamp(r.created_at),
    href: `/admin/brand-workspace/organizations/${r.organization_id}`,
  }));

  const projects = (
    await sql.query<{ project_id: string; title: string; organization_id: string; name: string; created_at: unknown }>(
      `select latest.project_id, p.title, p.organization_id, o.name, latest.created_at
         from (select distinct on (project_id) project_id, author_role, created_at
                 from brand_messages
                order by project_id, created_at desc, id desc) latest
         join brand_projects p on p.id = latest.project_id
         join brand_organizations o on o.id = p.organization_id
        where latest.author_role = 'brand'`,
    )
  ).rows.map((r): StudioInboxEntry => ({
    kind: 'project',
    organizationId: String(r.organization_id),
    organizationName: String(r.name),
    projectId: String(r.project_id),
    projectTitle: String(r.title),
    lastMessageAt: stamp(r.created_at),
    href: `/admin/brand-workspace/${r.project_id}`,
  }));

  return [...support, ...projects].sort((a, b) => a.lastMessageAt.localeCompare(b.lastMessageAt));
}
