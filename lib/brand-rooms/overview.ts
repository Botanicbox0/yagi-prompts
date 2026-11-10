/**
 * A project room's header and overview (docs/BRAND-ROOMS.md §7, slice H): the project, who is in the
 * room, the stage line, "지금 확인할 것", the five latest activities and the tab counts.
 *
 * Read-only and server-only. The page has already passed `roomRouteContext` and checked that the project
 * belongs to the selected brand and that this person may open it; nothing here decides access.
 *
 * Tolerant by design: the storyboard (S), deliverable (R) and message (M) tables and columns arrive with
 * their own migrations (0082–0084). A missing table or column yields an empty section, never an error,
 * so the room works before and after those migrations are applied. Any other database error is thrown.
 *
 * Nothing here returns an email address: people are initials and a display name at most.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RoomStage } from '@/components/brand-rooms/seams';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ROOM_STAGES: readonly RoomStage[] = ['requested', 'storyboard', 'draft', 'revision', 'done'];
export const ROOM_TABS = ['overview', 'storyboard', 'review', 'chat'] as const;
export type RoomTab = (typeof ROOM_TABS)[number];

/** `?tab=` from the address; anything else is the overview. */
export function roomTab(value: string | string[] | undefined): RoomTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return (ROOM_TABS as readonly string[]).includes(raw ?? '') ? (raw as RoomTab) : 'overview';
}

/* ------------------------------------------------------------------ the project */

export type RoomTrack = 'creator_campaign' | 'template_build' | 'studio_film';
export type RoomProjectStatus = 'requested' | 'active' | 'completed' | 'cancelled';

export interface RoomProject {
  id: string;
  organizationId: string;
  title: string;
  status: RoomProjectStatus;
  productionMode: 'creator' | 'studio';
  track: RoomTrack;
  createdAt: string;
  updatedAt: string;
}

/** The marker the one-page commission form writes as the first line of a scale-production brief. */
const TEMPLATE_BUILD_MARKER = '[TRACK: CUSTOM STUDIO TEMPLATE BUILD]';

/**
 * The commission track of a project (lib/brands/workspace/commission-tracks.ts): a creator project is a
 * creator campaign; a studio project whose brief the scale-production form wrote is scale production;
 * every other studio project is a single video.
 */
export function roomTrack(project: { productionMode: string; objective?: string | null }): RoomTrack {
  if (project.productionMode !== 'studio') return 'creator_campaign';
  return (project.objective ?? '').trimStart().startsWith(TEMPLATE_BUILD_MARKER) ? 'template_build' : 'studio_film';
}

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** The project when it is this organization's and the brand may see it; null otherwise. */
export async function loadRoomProject(sql: SqlRunner, organizationId: string, projectId: string): Promise<RoomProject | null> {
  if (!UUID.test(projectId) || !UUID.test(organizationId)) return null;
  const row = (
    await sql.query<{
      id: string;
      organization_id: string;
      title: string;
      status: string;
      production_mode: string;
      objective: string | null;
      created_at: unknown;
      updated_at: unknown;
    }>(
      `select id, organization_id, title, status, production_mode, objective, created_at, updated_at
         from brand_projects where id = $1 and organization_id = $2 and client_visible`,
      [projectId, organizationId],
    )
  ).rows[0];
  if (!row) return null;
  const productionMode = row.production_mode === 'studio' ? 'studio' : 'creator';
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    title: String(row.title),
    status: (['requested', 'active', 'completed', 'cancelled'].includes(row.status) ? row.status : 'requested') as RoomProjectStatus,
    productionMode,
    track: roomTrack({ productionMode, objective: row.objective }),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updated_at) ?? iso(row.created_at) ?? new Date(0).toISOString(),
  };
}

/* ------------------------------------------------------------------ tolerance */

/** Undefined table / undefined column: the other slices' migrations have not run here yet. */
export function isSchemaGap(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '42P01' || code === '42703') return true;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return /\b(relation|column)\b[^\n]*\bdoes not exist\b/i.test(message);
}

async function rowsOrEmpty<T>(sql: SqlRunner, text: string, params: unknown[]): Promise<T[]> {
  try {
    return (await sql.query<T>(text, params)).rows;
  } catch (error) {
    if (isSchemaGap(error)) return [];
    throw error;
  }
}

/* ------------------------------------------------------------------ people */

export interface RoomPerson {
  id: string;
  /** One or two letters for the face circle. */
  initials: string;
  /** The display name when the person set one; never an email address. */
  name: string | null;
}

export function initialsOf(name: string | null | undefined, fallback: string | null | undefined): string {
  const source = (name ?? '').trim();
  if (source) {
    const words = source.split(/\s+/).filter(Boolean);
    // Korean names read as one block: the first character is the initial people expect.
    if (/[가-힣]/.test(source)) return [...source.replace(/\s+/g, '')][0]!;
    const letters = words.length > 1 ? `${[...words[0]!][0]}${[...words[words.length - 1]!][0]}` : [...words[0]!].slice(0, 2).join('');
    return letters.toUpperCase();
  }
  const first = [...(fallback ?? '').trim()][0];
  return first ? first.toUpperCase() : '·';
}

/** Active brand members, then the project's own invitees. The viewer is included. */
export async function loadRoomPeople(sql: SqlRunner, organizationId: string, projectId: string): Promise<RoomPerson[]> {
  const rows = await rowsOrEmpty<{ id: string; display_name: string | null; email: string | null; kind: string }>(
    sql,
    `select p.id, p.display_name, p.email, 'member' as kind, m.created_at as joined
       from brand_memberships m join profiles p on p.id = m.user_id
      where m.organization_id = $1 and m.status = 'active'
     union all
     select p.id, p.display_name, p.email, 'guest' as kind, g.created_at as joined
       from brand_project_members g join profiles p on p.id = g.user_id
      where g.organization_id = $1 and g.project_id = $2 and g.status = 'active'
        and not exists (select 1 from brand_memberships m2 where m2.organization_id = $1 and m2.user_id = g.user_id and m2.status = 'active')
      order by kind desc, joined, id`,
    [organizationId, projectId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    initials: initialsOf(row.display_name, row.email),
    name: row.display_name?.trim() ? row.display_name.trim() : null,
  }));
}

/* ------------------------------------------------------------------ overview */

export type RoomStepState = 'done' | 'current' | 'skipped' | 'ahead';
export interface RoomStep {
  stage: RoomStage;
  state: RoomStepState;
  /** When the room reached this step (ISO), when that is known. */
  at: string | null;
}

export type RoomTodo =
  | { kind: 'storyboard'; id: string; title: string; version: number }
  | { kind: 'review'; id: string; title: string; version: number; openNotes: number; waiting: boolean }
  | { kind: 'chat'; unread: number };

export type RoomActivityKind =
  | 'boardShared'
  | 'boardDraft'
  | 'boardApproved'
  | 'boardChanges'
  | 'reviewPosted'
  | 'reviewApproved'
  | 'reviewChanges'
  | 'message';

export interface RoomActivity {
  key: string;
  kind: RoomActivityKind;
  at: string;
  /** The board or deliverable it is about (its tab opens there). */
  targetId: string | null;
  title: string | null;
  version: number | null;
  /** Messages: who wrote it. */
  authorRole?: 'brand' | 'studio';
  authorName?: string | null;
  /** Messages: the first line, shortened. */
  line?: string;
}

export interface RoomOverview {
  stage: RoomStage;
  steps: RoomStep[];
  todos: RoomTodo[];
  activity: RoomActivity[];
  counts: { storyboard: number; review: number; chat: number };
  /** No storyboard, no deliverable and no message yet: the first-use explanation shows. */
  empty: boolean;
}

interface BoardRow {
  id: string;
  lineage_id: string;
  title: string;
  version: number;
  status: string;
  created_role: string;
  shared_at: unknown;
  status_changed_at: unknown;
  updated_at: unknown;
}
interface ReviewRow {
  id: string;
  stack_key: string;
  title: string;
  version: number;
  status: string;
  status_changed_at: unknown;
  created_at: unknown;
}
interface MessageRow {
  id: string;
  author_role: string;
  display_name: string | null;
  body: string;
  created_at: unknown;
}

const latestBy = <T extends { version: number }>(rows: readonly T[], key: (row: T) => string): T[] => {
  const best = new Map<string, T>();
  for (const row of rows) {
    const current = best.get(key(row));
    if (!current || Number(row.version) > Number(current.version)) best.set(key(row), row);
  }
  return [...best.values()];
};

const shorten = (text: string, max = 90): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return [...flat].length > max ? `${[...flat].slice(0, max - 1).join('')}…` : flat;
};

const minIso = (values: Array<string | null>): string | null =>
  values.filter((v): v is string => Boolean(v)).sort()[0] ?? null;
const maxIso = (values: Array<string | null>): string | null =>
  values.filter((v): v is string => Boolean(v)).sort().reverse()[0] ?? null;

export interface OverviewInput {
  organizationId: string;
  project: Pick<RoomProject, 'id' | 'status' | 'createdAt' | 'updatedAt'>;
  /** The viewer: their own messages are never unread. */
  userId: string;
}

export async function loadRoomOverview(sql: SqlRunner, input: OverviewInput): Promise<RoomOverview> {
  const { organizationId, project, userId } = input;
  const [boards, reviews, messages, unread] = await Promise.all([
    // A draft the team made stays hidden from the brand until it is shared (0083).
    rowsOrEmpty<BoardRow>(
      sql,
      `select id, lineage_id, title, version, status, created_role, shared_at, status_changed_at, updated_at
         from brand_storyboards
        where organization_id = $1 and project_id = $2 and deleted_at is null
          and (status <> 'draft' or created_role = 'brand')
        order by updated_at desc limit 100`,
      [organizationId, project.id],
    ),
    rowsOrEmpty<ReviewRow>(
      sql,
      `select id, coalesce(stack_id, id)::text as stack_key, title, version, status, status_changed_at, created_at
         from brand_studio_reviews
        where organization_id = $1 and project_id = $2 and deleted_at is null
        order by created_at desc limit 100`,
      [organizationId, project.id],
    ),
    rowsOrEmpty<MessageRow>(
      sql,
      `select m.id, m.author_role, p.display_name, m.body, m.created_at
         from brand_room_messages m left join profiles p on p.id = m.author_id
        where m.organization_id = $1 and m.channel = $2 and m.kind = 'text' and m.deleted_at is null
        order by m.created_at desc limit 5`,
      [organizationId, project.id],
    ),
    roomUnreadCounts(sql, { organizationId, userId, projectIds: [project.id] }).then((counts) => counts[project.id] ?? 0),
  ]);

  // Open notes on the deliverables (top-level notes, not replies, neither resolved nor deleted).
  const reviewIds = reviews.map((r) => String(r.id));
  const notes = reviewIds.length
    ? await rowsOrEmpty<{ review_id: string; open: number }>(
        sql,
        `select review_id, count(*)::int as open from brand_studio_review_comments
          where organization_id = $1 and review_id = any($2::uuid[]) and parent_id is null
            and resolved_at is null and deleted_at is null
          group by review_id`,
        [organizationId, reviewIds],
      )
    : [];
  const openNotes = new Map(notes.map((n) => [String(n.review_id), Number(n.open)]));

  const latestBoards = latestBy(boards, (b) => String(b.lineage_id));
  const latestReviews = latestBy(reviews, (r) => String(r.stack_key));

  /* to-do */
  const boardTodos: RoomTodo[] = latestBoards
    .filter((b) => b.status === 'shared')
    .map((b) => ({ kind: 'storyboard', id: String(b.id), title: String(b.title), version: Number(b.version) }));
  const reviewTodos: RoomTodo[] = latestReviews
    .map((r) => ({ row: r, open: openNotes.get(String(r.id)) ?? 0 }))
    .filter(({ row, open }) => row.status !== 'approved' && (row.status === 'open' || open > 0))
    .map(({ row, open }) => ({
      kind: 'review',
      id: String(row.id),
      title: String(row.title),
      version: Number(row.version),
      openNotes: open,
      waiting: row.status === 'open',
    }));
  const todos: RoomTodo[] = [...boardTodos, ...reviewTodos, ...(unread > 0 ? [{ kind: 'chat', unread } as RoomTodo] : [])];

  /* stage line */
  const sharedBoards = boards.filter((b) => b.status !== 'draft');
  const reached: Record<RoomStage, string | null | false> = {
    requested: project.createdAt,
    storyboard: sharedBoards.length ? minIso(sharedBoards.map((b) => iso(b.shared_at) ?? iso(b.updated_at))) : false,
    draft: reviews.length ? minIso(reviews.map((r) => iso(r.created_at))) : false,
    revision: (() => {
      const later = reviews.filter((r) => Number(r.version) > 1).map((r) => iso(r.created_at));
      const asked = reviews.filter((r) => r.status === 'changes_requested').map((r) => iso(r.status_changed_at) ?? iso(r.created_at));
      return later.length || asked.length ? minIso([...later, ...asked]) : false;
    })(),
    done: (() => {
      if (project.status === 'completed') return project.updatedAt;
      if (latestReviews.length && latestReviews.every((r) => r.status === 'approved')) {
        return maxIso(latestReviews.map((r) => iso(r.status_changed_at) ?? iso(r.created_at)));
      }
      return false;
    })(),
  };
  let currentIndex = 0;
  ROOM_STAGES.forEach((stage, index) => {
    if (reached[stage] !== false) currentIndex = index;
  });
  const stage = ROOM_STAGES[currentIndex]!;
  const steps: RoomStep[] = ROOM_STAGES.map((s, index) => {
    const at = reached[s] === false ? null : (reached[s] as string | null);
    const state: RoomStepState =
      index > currentIndex
        ? 'ahead'
        : index === currentIndex
          ? s === 'done'
            ? 'done'
            : 'current'
          : reached[s] === false
            ? 'skipped'
            : 'done';
    return { stage: s, state, at };
  });

  /* recent activity */
  const activity: RoomActivity[] = [];
  for (const b of boards) {
    const base = { targetId: String(b.id), title: String(b.title), version: Number(b.version) };
    const shared = iso(b.shared_at);
    if (b.status === 'draft') {
      const at = iso(b.updated_at);
      if (at) activity.push({ key: `b:${b.id}:draft`, kind: 'boardDraft', at, ...base });
      continue;
    }
    if (shared) activity.push({ key: `b:${b.id}:shared`, kind: 'boardShared', at: shared, ...base });
    const changed = iso(b.status_changed_at);
    if (changed && (b.status === 'approved' || b.status === 'changes_requested')) {
      activity.push({ key: `b:${b.id}:${b.status}`, kind: b.status === 'approved' ? 'boardApproved' : 'boardChanges', at: changed, ...base });
    }
  }
  for (const r of reviews) {
    const base = { targetId: String(r.id), title: String(r.title), version: Number(r.version) };
    const posted = iso(r.created_at);
    if (posted) activity.push({ key: `r:${r.id}:posted`, kind: 'reviewPosted', at: posted, ...base });
    const changed = iso(r.status_changed_at);
    if (changed && (r.status === 'approved' || r.status === 'changes_requested')) {
      activity.push({ key: `r:${r.id}:${r.status}`, kind: r.status === 'approved' ? 'reviewApproved' : 'reviewChanges', at: changed, ...base });
    }
  }
  for (const m of messages) {
    const at = iso(m.created_at);
    if (!at) continue;
    activity.push({
      key: `m:${m.id}`,
      kind: 'message',
      at,
      targetId: null,
      title: null,
      version: null,
      authorRole: m.author_role === 'studio' ? 'studio' : 'brand',
      authorName: m.author_role === 'studio' ? null : m.display_name?.trim() || null,
      line: shorten(String(m.body ?? '')),
    });
  }
  activity.sort((a, z) => (a.at < z.at ? 1 : a.at > z.at ? -1 : a.key.localeCompare(z.key)));

  return {
    stage,
    steps,
    todos,
    activity: activity.slice(0, 5),
    counts: { storyboard: boardTodos.length, review: reviewTodos.length, chat: unread },
    empty: boards.length === 0 && reviews.length === 0 && messages.length === 0 && unread === 0,
  };
}

/* ------------------------------------------------------------------ unread */

/**
 * Unread messages per project channel for one person: messages someone else wrote after the moment
 * this person last read that channel (never read: all of them). Projects without a channel or before
 * the message tables exist read as zero.
 */
export async function roomUnreadCounts(
  sql: SqlRunner,
  input: { organizationId: string; userId: string | null | undefined; projectIds: readonly string[] },
): Promise<Record<string, number>> {
  const ids = input.projectIds.filter((id) => UUID.test(id));
  if (!input.userId || !UUID.test(input.userId) || !UUID.test(input.organizationId) || ids.length === 0) return {};
  const rows = await rowsOrEmpty<{ channel: string; unread: number }>(
    sql,
    `select m.channel, count(*)::int as unread
       from brand_room_messages m
       left join brand_room_reads r
         on r.organization_id = m.organization_id and r.channel = m.channel and r.user_id = $2
      where m.organization_id = $1 and m.channel = any($3::text[]) and m.deleted_at is null
        and m.author_id is distinct from $2::uuid
        and (r.last_read_at is null or m.created_at > r.last_read_at)
      group by m.channel`,
    [input.organizationId, input.userId, ids],
  );
  return Object.fromEntries(rows.map((row) => [String(row.channel), Number(row.unread)]));
}
