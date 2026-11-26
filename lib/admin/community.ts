import type { SqlRunner } from "@/lib/db/sql-runner";
import { platformReady } from "@/lib/creator-platform/service";
import {
  loadApplicationQueue,
  loadFormatReviewNotes,
} from "@/lib/creator-platform/onboarding";
import { loadSocialQueue } from "@/lib/influencers/admin";
import { lastSocialWorker } from "@/lib/influencers/worker";
import { loadReviewEntries, type ReviewEntry } from "@/lib/recipes/review";
import { makerBlogOpen } from "@/lib/posts/flag";
import { postsReady } from "@/lib/posts/repo";
import type { PostStatus } from "@/lib/posts/schema";

/**
 * `/admin/community` read model (docs/ADMIN.md §9 slice d, ADMIN-AUDIT-2026-11-03 C2 & M4).
 *
 * Moves all 8 platform SQL queries out of `app/(admin)/admin/community/page.tsx` and groups the
 * 10 queues/panels into four section tabs (`intake`, `social`, `feedback`, `policy`) plus `all`
 * (the default, so `/admin/community#social` and `/admin/community#format-{id}` anchors always
 * land on a rendered element).
 */

export const COMMUNITY_SECTIONS = ["all", "intake", "social", "feedback", "policy"] as const;
export type CommunitySection = (typeof COMMUNITY_SECTIONS)[number];

export function parseCommunitySection(
  params: Record<string, string | string[] | undefined>,
): CommunitySection {
  const raw = typeof params.section === "string" ? params.section.trim() : "";
  return (COMMUNITY_SECTIONS as readonly string[]).includes(raw)
    ? (raw as CommunitySection)
    : "all";
}

export function communitySectionHref(section: CommunitySection): string {
  return section === "all" ? "/admin/community" : `/admin/community?section=${section}`;
}

export interface PlatformThreadRow {
  id: string;
  user_id: string;
}

export interface PlatformMessageRow {
  id: string;
  thread_id: string;
  body: string;
  from_studio: boolean;
}

export interface PlatformFormatRow {
  id: string;
  user_id: string;
  title: string;
  recipe: string;
  example_url: string | null;
  status: string;
  template_id: string | null;
  template_status: string | null;
}

export interface PlatformRatingRow {
  id: string;
  template_id: string;
  stars: number;
  message: string;
  excluded: boolean;
}

export interface PlatformClaimRow {
  id: string;
  render_id: string;
  post_url: string;
  status: string;
  credits: number;
}

export interface PlatformCreatorRow {
  user_id: string;
  active: boolean;
  contract_version: string;
  payout: string | null;
}

export interface PlatformOfferRow {
  id: string;
  title: string;
  credits: number;
}

export interface PlatformAuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  reason: string;
  created_at: string;
}

export interface AdminCommunityCounts {
  intake: number;
  social: number;
  feedback: number;
  policy: number;
  totalWaiting: number;
}

export type AdminSocialQueue = Awaited<ReturnType<typeof loadSocialQueue>>;
export type AdminSocialWorker = Awaited<ReturnType<typeof lastSocialWorker>>;
export type AdminApplicationQueue = Awaited<ReturnType<typeof loadApplicationQueue>>;

export interface PlatformPostRow {
  id: string;
  user_id: string;
  handle: string | null;
  slug: string;
  title: string;
  status: PostStatus;
  hidden_reason: string | null;
  block_count: number;
  published_at: string | null;
  updated_at: string;
}

export type AdminCommunityBoard =
  | {
      ready: false;
      socialQueue: AdminSocialQueue | null;
      socialWorker: AdminSocialWorker | null;
    }
  | {
      ready: true;
      socialQueue: AdminSocialQueue | null;
      socialWorker: AdminSocialWorker | null;
      threads: PlatformThreadRow[];
      messages: PlatformMessageRow[];
      formats: PlatformFormatRow[];
      ratings: PlatformRatingRow[];
      claims: PlatformClaimRow[];
      creators: PlatformCreatorRow[];
      offers: PlatformOfferRow[];
      history: PlatformAuditRow[];
      posts?: PlatformPostRow[];
      applications: AdminApplicationQueue;
      notes: Map<string, string | null>;
      recipes: Map<string, ReviewEntry>;
      counts: AdminCommunityCounts;
    };

export async function loadAdminCommunity(sql: SqlRunner | null): Promise<AdminCommunityBoard> {
  // docs/PLATFORM-2.0.md §17.1 — the SNS check sits first and works without the 0051 creator tables.
  const [socialQueue, socialWorker] = sql
    ? await Promise.all([
        loadSocialQueue(sql).catch(() => null),
        lastSocialWorker(sql).catch(() => null),
      ])
    : [null, null];

  if (!sql || !(await platformReady(sql))) {
    return { ready: false, socialQueue, socialWorker };
  }

  const [threads, messages, formats, ratings, claims, creators, offers, history] = await Promise.all([
    sql.query<PlatformThreadRow>(
      "select id,user_id from platform_threads order by created_at desc limit 40",
    ),
    sql.query<PlatformMessageRow>(
      "select id,thread_id,body,from_studio from platform_messages where thread_id in (select id from platform_threads order by created_at desc limit 40) order by created_at limit 800",
    ),
    sql.query<PlatformFormatRow>(
      "select f.id,f.user_id,f.title,f.recipe,f.example_url,f.status,f.template_id,p.status template_status from platform_formats f left join prompt_items p on p.id=f.template_id where f.status<>'draft' order by f.created_at desc limit 40",
    ),
    sql.query<PlatformRatingRow>(
      "select id,template_id,stars,message,excluded from platform_ratings order by updated_at desc limit 40",
    ),
    sql.query<PlatformClaimRow>(
      "select id,render_id,post_url,status,credits from platform_claims order by created_at desc limit 40",
    ),
    sql.query<PlatformCreatorRow>(
      "select c.user_id,c.active,c.contract_version,to_jsonb(c)->>'payout' payout from platform_creators c order by c.created_at desc limit 100",
    ),
    sql.query<PlatformOfferRow>(
      "select o.id,p.title,o.credits from platform_image_offers o join prompt_items p on p.id=o.template_id where o.active order by o.created_at desc limit 100",
    ),
    sql.query<PlatformAuditRow>(
      "select id,actor_id,action,reason,created_at from platform_audit order by created_at desc limit 100",
    ),
  ]);

  const formatIds = formats.rows.map((f) => f.id);
  const [applications, notes, recipes, posts] = await Promise.all([
    loadApplicationQueue(sql),
    loadFormatReviewNotes(sql, formatIds),
    loadReviewEntries(sql, formatIds),
    makerBlogOpen() && (await postsReady(sql))
      ? sql
          .query<PlatformPostRow>(
            `select cp.id, cp.user_id, pc.handle, cp.slug, cp.title, cp.status, cp.hidden_reason,
                    coalesce(jsonb_array_length(cp.blocks), 0)::int as block_count,
                    cp.published_at::text as published_at, cp.updated_at::text as updated_at
               from creator_posts cp
               left join platform_creators pc on pc.user_id = cp.user_id
              where cp.status <> 'draft'
              order by cp.updated_at desc
              limit 40`,
          )
          .then((result) => result.rows)
      : Promise.resolve([] as PlatformPostRow[]),
  ]);

  const openApps = applications ? applications.open.length : 0;
  const submittedFormats = formats.rows.filter((f) => f.status === "submitted").length;
  const submittedSocials = socialQueue ? socialQueue.waiting.length : 0;
  const submittedClaims = claims.rows.filter((c) => c.status === "submitted").length;
  const openThreads = threads.rows.length;

  const intake = openApps + submittedFormats;
  const social = submittedSocials + submittedClaims;
  const feedback = openThreads + ratings.rows.length;
  const policy = offers.rows.length + history.rows.length;

  return {
    ready: true,
    socialQueue,
    socialWorker,
    threads: threads.rows,
    messages: messages.rows,
    formats: formats.rows,
    ratings: ratings.rows,
    claims: claims.rows,
    creators: creators.rows,
    offers: offers.rows,
    history: history.rows,
    posts,
    applications,
    notes,
    recipes,
    counts: {
      intake,
      social,
      feedback,
      policy,
      totalWaiting: openApps + submittedFormats + submittedSocials + submittedClaims,
    },
  };
}
