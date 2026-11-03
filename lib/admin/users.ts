import type { AdminTone } from "@/components/admin/patterns";
import type { SqlRunner } from "@/lib/db/sql-runner";

/**
 * `/admin/users` read model (docs/ADMIN.md §7.3, PLATFORM-2.0 §10).
 *
 * Minimal PII by construction:
 * - Never returns `email`, `display_name`, selfie storage keys (`input_key`), social handles/URLs,
 *   or evidence keys.
 * - An account appears as the first eight characters of its UUID (`shortId`), join date, roles,
 *   verified/submitted social platform + follower count, active selfie count, paid order count,
 *   render count, and last activity timestamp.
 * - Searching accepts an account ID prefix, a public creative handle (`@handle`), or an EXACT
 *   e-mail address (`lower(p.email) = $n`). Substring e-mail search is intentionally disallowed.
 */

export const USER_ROLES = ["admin", "creative", "social", "brand"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_PAGE_SIZE = 50;

export type SocialPlatform = "instagram" | "tiktok" | "youtube";
export type SocialStatus = "submitted" | "verified" | "rejected" | "expired";

export interface UserSocialSummary {
  platform: SocialPlatform;
  status: SocialStatus;
  followerCount: number | null;
}

export interface UserFilter {
  role: UserRole | null;
  /** Account ID prefix, `@handle`, or an exact e-mail address. */
  query: string;
  page: number;
}

export interface AdminUserRow {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  roles: UserRole[];
  creativeHandle: string | null;
  socials: UserSocialSummary[];
  selfieCount: number;
  paidOrderCount: number;
  renderCount: number;
}

export interface AdminUserDirectory {
  rows: AdminUserRow[];
  total: number;
  allCount: number;
  byRole: Record<UserRole, number>;
}

const OPTIONAL_TABLES = [
  "platform_creators",
  "social_accounts",
  "brand_memberships",
  "identity_selfies",
  "billing_payments",
  "render_jobs",
] as const;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function userFilter(params: Record<string, string | string[] | undefined>): UserFilter {
  const rawRole = first(params.role);
  const role = (USER_ROLES as readonly string[]).includes(rawRole) ? (rawRole as UserRole) : null;
  const query = first(params.q).trim().slice(0, 120);
  const parsedPage = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 1 ? parsedPage : 1;
  return { role, query, page };
}

export function userHref(
  filter: UserFilter,
  patch: Partial<{ role: UserRole | null; query: string; page: number }> = {},
): string {
  const next: UserFilter = {
    role: "role" in patch ? (patch.role ?? null) : filter.role,
    query: "query" in patch ? (patch.query ?? "") : filter.query,
    page: "page" in patch ? (patch.page ?? 1) : 1,
  };
  const sp = new URLSearchParams();
  if (next.role) sp.set("role", next.role);
  if (next.query.trim()) sp.set("q", next.query.trim());
  if (next.page > 1) sp.set("page", String(next.page));
  const qs = sp.toString();
  return qs ? `/admin/users?${qs}` : "/admin/users";
}

export function socialTone(status: SocialStatus): AdminTone {
  switch (status) {
    case "verified":
      return "done";
    case "submitted":
      return "action";
    case "rejected":
      return "fail";
    case "expired":
      return "hold";
  }
}

async function presentTables(sql: SqlRunner, names: readonly string[]): Promise<Set<string>> {
  const { rows } = await sql.query<{ name: string }>(
    "select name from unnest($1::text[]) as name where to_regclass('public.' || name) is not null",
    [names],
  );
  return new Set(rows.map((row) => row.name));
}

async function hasColumn(sql: SqlRunner, table: string, column: string): Promise<boolean> {
  const { rows } = await sql.query<{ ok: boolean }>(
    `select exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = $2
     ) as ok`,
    [table, column],
  );
  return rows[0]?.ok === true;
}

function roleCondition(role: UserRole, present: Set<string>): string {
  switch (role) {
    case "admin":
      return "p.is_admin = true";
    case "creative":
      return present.has("platform_creators")
        ? "exists (select 1 from platform_creators pc where pc.user_id = p.id and pc.active = true)"
        : "false";
    case "social":
      return present.has("social_accounts")
        ? "exists (select 1 from social_accounts sa where sa.user_id = p.id and sa.status = 'verified')"
        : "false";
    case "brand":
      return present.has("brand_memberships")
        ? "exists (select 1 from brand_memberships bm where bm.user_id = p.id and bm.status = 'active')"
        : "false";
  }
}

function buildWhere(
  filter: UserFilter,
  present: Set<string>,
  hasCreatorHandle: boolean,
): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  if (filter.role) {
    parts.push(roleCondition(filter.role, present));
  }

  const q = filter.query.trim().toLowerCase();
  if (q !== "") {
    if (q.includes("@") && !q.startsWith("@")) {
      // Exact e-mail match only (docs/ADMIN.md §7.3); never substring match on e-mail.
      params.push(q);
      parts.push(`lower(p.email) = $${params.length}`);
    } else if (q.startsWith("@")) {
      const handle = q.slice(1);
      if (handle && present.has("platform_creators") && hasCreatorHandle) {
        params.push(handle);
        parts.push(
          `exists (select 1 from platform_creators pc where pc.user_id = p.id and pc.active = true and lower(pc.handle) = $${params.length})`,
        );
      } else {
        parts.push("false");
      }
    } else {
      const escapedPrefix = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(escapedPrefix);
      const idMatch = `lower(p.id::text) like $${params.length} escape '\\'`;
      if (present.has("platform_creators") && hasCreatorHandle) {
        params.push(q);
        parts.push(
          `(${idMatch} or exists (select 1 from platform_creators pc where pc.user_id = p.id and pc.active = true and lower(pc.handle) = $${params.length}))`,
        );
      } else {
        parts.push(idMatch);
      }
    }
  }

  return {
    clause: parts.length > 0 ? `where ${parts.join(" and ")}` : "",
    params,
  };
}

type RawUserRow = {
  id: string;
  is_admin: boolean;
  created_at: unknown;
  updated_at: unknown;
  is_creative: boolean;
  creative_handle: string | null;
  has_verified_social: boolean;
  is_brand_member: boolean;
  selfie_count: number | string;
  paid_order_count: number | string;
  render_count: number | string;
  last_active_at: unknown;
};

export async function loadAdminUsers(sql: SqlRunner, filter: UserFilter): Promise<AdminUserDirectory> {
  const present = await presentTables(sql, OPTIONAL_TABLES);
  const hasCreatorHandle = present.has("platform_creators")
    ? await hasColumn(sql, "platform_creators", "handle")
    : false;

  const { clause, params } = buildWhere(filter, present, hasCreatorHandle);
  const page = Math.max(1, Math.floor(filter.page));

  const creativeExpr = present.has("platform_creators")
    ? "exists (select 1 from platform_creators pc where pc.user_id = p.id and pc.active = true)"
    : "false";
  const handleExpr =
    present.has("platform_creators") && hasCreatorHandle
      ? "(select pc.handle from platform_creators pc where pc.user_id = p.id and pc.active = true limit 1)"
      : "null::text";
  const socialExpr = present.has("social_accounts")
    ? "exists (select 1 from social_accounts sa where sa.user_id = p.id and sa.status = 'verified')"
    : "false";
  const brandExpr = present.has("brand_memberships")
    ? "exists (select 1 from brand_memberships bm where bm.user_id = p.id and bm.status = 'active')"
    : "false";
  const selfieExpr = present.has("identity_selfies")
    ? "(select count(*)::int from identity_selfies s where s.user_id = p.id and s.deleted_at is null)"
    : "0";
  const paidOrderExpr = present.has("billing_payments")
    ? "(select count(*)::int from billing_payments b where b.user_id = p.id and b.status = 'paid')"
    : "0";
  const renderExpr = present.has("render_jobs")
    ? "(select count(*)::int from render_jobs r where r.user_id = p.id)"
    : "0";

  const activityDates = ["p.created_at", "p.updated_at"];
  if (present.has("render_jobs")) {
    activityDates.push("(select max(r.created_at) from render_jobs r where r.user_id = p.id)");
  }
  if (present.has("billing_payments")) {
    activityDates.push("(select max(b.created_at) from billing_payments b where b.user_id = p.id)");
  }
  if (present.has("identity_selfies")) {
    activityDates.push("(select max(s.created_at) from identity_selfies s where s.user_id = p.id)");
  }
  const lastActiveExpr = `greatest(${activityDates.join(", ")})`;

  const [listRes, totalRes, countsRes] = await Promise.all([
    sql.query<RawUserRow>(
      `select
         p.id,
         p.is_admin,
         p.created_at,
         p.updated_at,
         ${creativeExpr} as is_creative,
         ${handleExpr} as creative_handle,
         ${socialExpr} as has_verified_social,
         ${brandExpr} as is_brand_member,
         ${selfieExpr} as selfie_count,
         ${paidOrderExpr} as paid_order_count,
         ${renderExpr} as render_count,
         ${lastActiveExpr} as last_active_at
       from profiles p
       ${clause}
       order by p.created_at desc, p.id desc
       limit $${params.length + 1}::int offset $${params.length + 2}::int`,
      [...params, USER_PAGE_SIZE, (page - 1) * USER_PAGE_SIZE],
    ),
    sql.query<{ n: number | string }>(`select count(*)::int as n from profiles p ${clause}`, params),
    sql.query<{
      all_count: number | string;
      admin_count: number | string;
      creative_count: number | string;
      social_count: number | string;
      brand_count: number | string;
    }>(
      `select
         count(*)::int as all_count,
         count(*) filter (where ${roleCondition("admin", present)})::int as admin_count,
         count(*) filter (where ${roleCondition("creative", present)})::int as creative_count,
         count(*) filter (where ${roleCondition("social", present)})::int as social_count,
         count(*) filter (where ${roleCondition("brand", present)})::int as brand_count
       from profiles p`,
    ),
  ]);

  const userIds = listRes.rows.map((r) => String(r.id));
  const socialsByUser = new Map<string, UserSocialSummary[]>();
  if (userIds.length > 0 && present.has("social_accounts")) {
    const socialRes = await sql.query<{
      user_id: string;
      platform: SocialPlatform;
      status: SocialStatus;
      follower_count: number | string | null;
    }>(
      `select user_id, platform, status, follower_count
       from social_accounts
       where user_id = any($1::uuid[])
       order by case when status = 'verified' then 0 when status = 'submitted' then 1 else 2 end,
                follower_count desc nulls last,
                created_at desc`,
      [userIds],
    );
    for (const s of socialRes.rows) {
      const uid = String(s.user_id);
      const list = socialsByUser.get(uid) ?? [];
      list.push({
        platform: s.platform,
        status: s.status,
        followerCount:
          s.follower_count === null || s.follower_count === undefined ? null : Number(s.follower_count),
      });
      socialsByUser.set(uid, list);
    }
  }

  const rows: AdminUserRow[] = listRes.rows.map((raw) => {
    const id = String(raw.id);
    const roles: UserRole[] = [];
    if (raw.is_admin === true) roles.push("admin");
    if (raw.is_creative === true) roles.push("creative");
    if (raw.has_verified_social === true) roles.push("social");
    if (raw.is_brand_member === true) roles.push("brand");

    const createdAt = iso(raw.created_at) ?? "";
    const lastActiveAt = iso(raw.last_active_at) ?? createdAt;

    return {
      id,
      createdAt,
      lastActiveAt,
      roles,
      creativeHandle: raw.creative_handle ? String(raw.creative_handle) : null,
      socials: socialsByUser.get(id) ?? [],
      selfieCount: Number(raw.selfie_count ?? 0),
      paidOrderCount: Number(raw.paid_order_count ?? 0),
      renderCount: Number(raw.render_count ?? 0),
    };
  });

  const summaryRow = countsRes.rows[0];
  return {
    rows,
    total: Number(totalRes.rows[0]?.n ?? 0),
    allCount: Number(summaryRow?.all_count ?? 0),
    byRole: {
      admin: Number(summaryRow?.admin_count ?? 0),
      creative: Number(summaryRow?.creative_count ?? 0),
      social: Number(summaryRow?.social_count ?? 0),
      brand: Number(summaryRow?.brand_count ?? 0),
    },
  };
}
