import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { StorageDriver } from "@/lib/storage";
import { ApplySchema } from "@/lib/campaigns/schemas";
import { enqueueCampaignRisk } from "@/lib/campaigns/risk/queue";
import { toCampaign } from "@/lib/campaigns/repo";
import { toCampaignCard } from "@/lib/campaigns/catalog";
import type { CreatorCampaign } from "@/lib/campaigns/service";
import { audienceOf, campaignAccess as audienceAccessFor } from "@/lib/influencers/visibility";

type Row = Record<string, unknown>;
export type CollaborationCode =
  | "unavailable"
  | "sign_in_required"
  | "not_found"
  | "forbidden"
  | "invalid"
  | "conflict"
  | "not_open"
  | "not_selected"
  | "rate_limited"
  | "invitation_retry"
  | "application_ended"
  | "slots_full"
  | "influencer_required";
export type Outcome<T = { id: string }> =
  ({ ok: true } & T) | { ok: false; code: CollaborationCode };
export interface Deps {
  sql: SqlRunner;
  now?: Date;
  verifiedEmail?: string;
  storage?: Pick<StorageDriver, "putStaging" | "read">;
}
class Denied extends Error {
  constructor(readonly code: CollaborationCode) {
    super(code);
  }
}
const uuid = z.string().uuid(),
  stamp = (v: unknown) => new Date(String(v)).toISOString();
const digest = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const now = (d: Deps) => d.now ?? new Date();
const selected = ["selected", "rejected", "posted", "verified", "paid"];
function participantProfileUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function termsSnapshot(row: Row) {
  return Object.fromEntries(
    [
      "title",
      "summary",
      "brief",
      "payout",
      "requirements",
      "platforms",
      "deliverable",
      "slots",
      "applications_close_at",
      "post_deadline_at",
    ].map((key) => [
      key,
      key.endsWith("_at") && row[key] != null
        ? new Date(String(row[key])).toISOString()
        : (row[key] ?? null),
    ]),
  );
}
function termsVersion(row: Row) {
  return digest(JSON.stringify(termsSnapshot(row)));
}
/** Public terms hash only. Never returns the campaign's internal budget or database row. */
export async function campaignTermsVersion(
  sql: SqlRunner,
  slug: string,
): Promise<string | null> {
  const c = (
    await sql.query<Row>(
      "select * from campaigns where slug=$1 and status in ('recruiting','selecting','running','closed')",
      [slug],
    )
  ).rows[0];
  return c ? termsVersion(c) : null;
}
/** One statement snapshot for an anonymous invitation landing. SELECT only, no row locks. */
export async function loadInvitationLanding(
  sql: SqlRunner,
  slug: string,
): Promise<{ campaign: CreatorCampaign; version: string } | null> {
  const source = (
    await sql.query<Row>(
      `select c.*,(select count(*)::int from campaign_applications a where a.campaign_id=c.id and a.status in ('selected','rejected','posted','verified','paid')) as slots_taken from campaigns c where c.slug=$1 and c.status in ('recruiting','selecting','running','closed')`,
      [slug],
    )
  ).rows[0];
  if (!source) return null;
  const row = toCampaign(source as unknown as Parameters<typeof toCampaign>[0]);
  return {
    campaign: {
      ...toCampaignCard(row, Number(source.slots_taken)),
      payout: row.payout,
    },
    version: termsVersion(source),
  };
}
export async function collaborationReady(sql: SqlRunner) {
  if (process.env.CAMPAIGN_COLLABORATION_PUBLIC !== "on") return false;
  return (
    (
      await sql.query<{ ready: boolean }>(
        "select to_regclass('public.campaign_collaboration_links') is not null and to_regclass('public.campaign_participant_files') is not null as ready",
      )
    ).rows[0]?.ready === true
  );
}
async function run<T>(
  d: Deps,
  v: Viewer,
  fn: (sql: SqlRunner, userId: string) => Promise<T>,
): Promise<Outcome<T>> {
  if (!uuid.safeParse(v.userId).success)
    return { ok: false, code: "sign_in_required" };
  if (!(await collaborationReady(d.sql)))
    return { ok: false, code: "unavailable" };
  try {
    return await d.sql.transaction(async (sql) => ({
      ok: true as const,
      ...(await fn(sql, v.userId!)),
    }));
  } catch (e) {
    if (e instanceof Denied) return { ok: false, code: e.code };
    if ((e as { code?: string }).code === "23505")
      return { ok: false, code: "conflict" };
    throw e;
  }
}
async function studio(sql: SqlRunner, id: string) {
  return (
    (
      await sql.query<{ is_admin: boolean }>(
        "select is_admin from profiles where id=$1",
        [id],
      )
    ).rows[0]?.is_admin === true
  );
}
async function projectAccess(
  sql: SqlRunner,
  userId: string,
  projectId: string,
  write = false,
  lock = write,
) {
  const p = (
    await sql.query<Row>(
      `select * from brand_projects where id=$1 ${lock ? "for share" : ""}`,
      [projectId],
    )
  ).rows[0];
  if (!p) throw new Denied("not_found");
  if (await studio(sql, userId))
    return { p, role: "studio" as const, canWrite: true };
  if (p.client_visible !== true) throw new Denied("not_found");
  const m = (
    await sql.query<Row>(
      `select role from brand_memberships where organization_id=$1 and user_id=$2 and status='active' ${lock ? "for share" : ""}`,
      [p.organization_id, userId],
    )
  ).rows[0];
  if (!m) throw new Denied("not_found");
  if (write && m.role === "viewer") throw new Denied("forbidden");
  return { p, role: "brand" as const, canWrite: m.role !== "viewer" };
}
async function campaignAccess(
  sql: SqlRunner,
  userId: string,
  campaignId: string,
  write = false,
  lock = write,
) {
  const c = (
    await sql.query<Row>(
      `select c.id,c.slug,c.title,c.status,c.slots,c.applications_close_at,l.project_id from campaigns c join campaign_collaboration_links l on l.campaign_id=c.id where c.id=$1 ${lock ? "for share of c,l" : ""}`,
      [campaignId],
    )
  ).rows[0];
  if (!c) throw new Denied("not_found");
  return {
    ...(await projectAccess(sql, userId, String(c.project_id), write, lock)),
    c,
  };
}
async function participantAccess(
  sql: SqlRunner,
  userId: string,
  id: string,
  write = false,
  audit = true,
  lock = write,
) {
  if (!uuid.safeParse(id).success) throw new Denied("not_found");
  // Discover without a row lock, then serialize writes using the campaign root before any
  // application lock. Admin selection, invitation claims and production use this order too.
  if (write && lock) {
    // Reject callers without current write authority before they can contend on a campaign.
    // The normal checks below run again after locking to close revocation races.
    const preflight = await participantAccess(
      sql,
      userId,
      id,
      true,
      false,
      false,
    );
    await sql.query("select id from campaigns where id=$1 for update", [
      preflight.a.campaign_id,
    ]);
  }
  const a = (
    await sql.query<Row>(
      `select a.id,a.creator_id,a.status,a.campaign_id,a.sns_url,a.post_url,c.slug,c.title,c.status as campaign_status,l.project_id,p.status as project_status,p.client_visible
 from campaign_applications a join campaigns c on c.id=a.campaign_id join campaign_collaboration_links l on l.campaign_id=c.id join brand_projects p on p.id=l.project_id where a.id=$1 ${lock ? "for share of a,l,p" : ""}`,
      [id],
    )
  ).rows[0];
  if (!a) throw new Denied("not_found");
  let role: "creator" | "brand" | "studio",
    canWrite = true;
  if (a.creator_id === userId) {
    role = "creator";
    if (a.client_visible !== true) throw new Denied("not_found");
  } else {
    const access = await projectAccess(
      sql,
      userId,
      String(a.project_id),
      write,
      lock,
    );
    role = access.role;
    canWrite = access.canWrite;
  }
  if (role === "studio" && audit)
    await sql.query(
      "insert into campaign_participant_access_audit(id,application_id,actor_id,purpose) values($1,$2,$3,'participant_support')",
      [randomUUID(), id, userId],
    );
  const threadOpen = selected.includes(String(a.status));
  if (role === "brand" && !threadOpen) throw new Denied("not_found");
  if (
    write &&
    (!threadOpen ||
      a.project_status !== "active" ||
      ["draft", "archived", "closed"].includes(String(a.campaign_status)))
  )
    throw new Denied(threadOpen ? "not_open" : "not_selected");
  return {
    a,
    role,
    canWrite:
      canWrite &&
      threadOpen &&
      a.project_status === "active" &&
      !["draft", "archived", "closed"].includes(String(a.campaign_status)),
    threadOpen,
  };
}
export async function bindCollaboration(
  d: Deps,
  v: Viewer,
  input: unknown,
): Promise<Outcome> {
  const p = z
    .object({ campaignId: uuid, projectId: uuid })
    .strict()
    .safeParse(input);
  if (!p.success) return { ok: false, code: "invalid" };
  return run(d, v, async (sql, id) => {
    if (!(await studio(sql, id))) throw new Denied("forbidden");
    const c = (
      await sql.query("select id from campaigns where id=$1 for update", [
        p.data.campaignId,
      ])
    ).rows[0];
    if (!c) throw new Denied("not_found");
    const a = await projectAccess(sql, id, p.data.projectId);
    if (a.p.production_mode !== "creator") throw new Denied("invalid");
    const production = (
      await sql.query<Row>(
        "select bc.project_id from campaign_productions cp join brand_production_contracts bc on bc.id=cp.contract_id where cp.campaign_id=$1",
        [p.data.campaignId],
      )
    ).rows[0];
    if (production && production.project_id !== p.data.projectId)
      throw new Denied("conflict");
    const old = (
      await sql.query<Row>(
        "select project_id from campaign_collaboration_links where campaign_id=$1",
        [p.data.campaignId],
      )
    ).rows[0];
    if (old && old.project_id !== p.data.projectId)
      throw new Denied("conflict");
    if (!old)
      await sql.query(
        "insert into campaign_collaboration_links(campaign_id,project_id,created_by) values($1,$2,$3)",
        [p.data.campaignId, p.data.projectId, id],
      );
    return { id: p.data.campaignId };
  });
}
export async function issueInvitation(
  d: Deps,
  v: Viewer,
  input: unknown,
): Promise<Outcome<{ id: string; token: string; slug: string }>> {
  const p = z
    .object({
      campaignId: uuid,
      requestId: uuid,
      email: z.string().trim().email().max(254).optional(),
    })
    .strict()
    .safeParse(input);
  if (!p.success) return { ok: false, code: "invalid" };
  return run(d, v, async (sql, id) => {
    await campaignAccess(sql, id, p.data.campaignId, true, false);
    await sql.query("select id from campaigns where id=$1 for update", [
      p.data.campaignId,
    ]);
    const { c, p: project } = await campaignAccess(
      sql,
      id,
      p.data.campaignId,
      true,
    );
    if (
      project.status !== "active" ||
      c.status !== "recruiting" ||
      !c.applications_close_at ||
      +now(d) >= +new Date(String(c.applications_close_at))
    )
      throw new Denied("not_open");
    const previous = (
      await sql.query<Row>(
        "select id,campaign_id,email,accepted_at,revoked_at from campaign_participant_invites where created_by=$1 and request_id=$2",
        [id, p.data.requestId],
      )
    ).rows[0];
    if (previous) {
      const same =
        previous.campaign_id === p.data.campaignId &&
        (previous.email ?? null) === (p.data.email?.toLowerCase() ?? null);
      throw new Denied(
        same && !previous.accepted_at && !previous.revoked_at
          ? "invitation_retry"
          : "conflict",
      );
    }
    const n = (
      await sql.query<{ n: number }>(
        "select count(*)::int n from campaign_participant_invites where created_by=$1 and created_at>now()-interval '1 day'",
        [id],
      )
    ).rows[0]!.n;
    if (n >= 100) throw new Denied("rate_limited");
    const invitationId = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      expires = new Date(
        Math.min(
          +now(d) + 7 * 86400000,
          +new Date(String(c.applications_close_at)),
        ),
      );
    await sql.query(
      "insert into campaign_participant_invites(id,campaign_id,token_hash,email,created_by,request_id,expires_at) values($1,$2,$3,$4,$5,$6,$7)",
      [
        invitationId,
        c.id,
        digest(token),
        p.data.email?.toLowerCase() ?? null,
        id,
        p.data.requestId,
        expires,
      ],
    );
    return { id: invitationId, token, slug: String(c.slug) };
  });
}
export async function revokeInvitation(
  d: Deps,
  v: Viewer,
  input: unknown,
): Promise<Outcome> {
  const p = z.object({ invitationId: uuid }).strict().safeParse(input);
  if (!p.success) return { ok: false, code: "invalid" };
  return run(d, v, async (sql, id) => {
    const r = (
      await sql.query<Row>(
        "select campaign_id from campaign_participant_invites where id=$1",
        [p.data.invitationId],
      )
    ).rows[0];
    if (!r) throw new Denied("not_found");
    await campaignAccess(sql, id, String(r.campaign_id), true, false);
    await sql.query("select id from campaigns where id=$1 for update", [
      r.campaign_id,
    ]);
    await campaignAccess(sql, id, String(r.campaign_id), true);
    const current = (
      await sql.query<Row>(
        "select accepted_at from campaign_participant_invites where id=$1 for update",
        [p.data.invitationId],
      )
    ).rows[0];
    if (current?.accepted_at) throw new Denied("conflict");
    await sql.query(
      "update campaign_participant_invites set revoked_at=coalesce(revoked_at,$2) where id=$1",
      [p.data.invitationId, now(d)],
    );
    return { id: p.data.invitationId };
  });
}
export async function acceptInvitation(
  d: Deps,
  v: Viewer,
  input: unknown,
): Promise<Outcome> {
  const p = ApplySchema.extend({
    token: z.string().regex(/^[\w-]{43}$/),
    slug: z.string().min(1).max(160),
    termsVersion: z.string().regex(/^[a-f0-9]{64}$/),
  })
    .strict()
    .safeParse(input);
  if (!p.success) return { ok: false, code: "invalid" };
  return run(d, v, async (sql, id) => {
    const base = (
      await sql.query<Row>(
        "select i.campaign_id from campaign_participant_invites i join campaigns c on c.id=i.campaign_id where i.token_hash=$1 and c.slug=$2",
        [digest(p.data.token), p.data.slug],
      )
    ).rows[0];
    if (!base) throw new Denied("not_found");
    const c = (
      await sql.query<Row>(
        "select c.*,l.project_id,p.status as project_status,p.client_visible from campaigns c join campaign_collaboration_links l on l.campaign_id=c.id join brand_projects p on p.id=l.project_id where c.id=$1 for update of c for share of l,p",
        [base.campaign_id],
      )
    ).rows[0];
    const invite = (
      await sql.query<Row>(
        "select * from campaign_participant_invites where token_hash=$1 for update",
        [digest(p.data.token)],
      )
    ).rows[0];
    if (
      !invite ||
      invite.revoked_at ||
      +new Date(String(invite.expires_at)) <= +now(d) ||
      !c ||
      c.client_visible !== true
    )
      throw new Denied("not_found");
    if (invite.accepted_by && invite.accepted_by !== id)
      throw new Denied("not_found");
    if (invite.email && d.verifiedEmail?.toLowerCase() !== invite.email)
      throw new Denied("forbidden");
    const fingerprint = digest(
      JSON.stringify([
        p.data.pitch,
        p.data.snsUrl,
        p.data.followerCount,
        p.data.consent,
      ]),
    );
    if (invite.accepted_at) {
      if (invite.accepted_fingerprint !== fingerprint)
        throw new Denied("conflict");
      return { id: String(invite.application_id) };
    }
    if (p.data.termsVersion !== termsVersion(c)) throw new Denied("conflict");
    if (
      c.status !== "recruiting" ||
      c.project_status !== "active" ||
      !c.applications_close_at ||
      +new Date(String(c.applications_close_at)) <= +now(d)
    )
      throw new Denied("not_open");
    const issuer = await projectAccess(
      sql,
      String(invite.created_by),
      String(c.project_id),
      true,
    );
    if (!issuer.canWrite) throw new Denied("not_found");
    const old = (
      await sql.query<Row>(
        "select id,status from campaign_applications where campaign_id=$1 and creator_id=$2 for update",
        [c.id, id],
      )
    ).rows[0];
    // Ended applications require an explicit operator decision; never consume the invite.
    if (
      old &&
      ["declined", "withdrawn", "expired"].includes(String(old.status))
    )
      throw new Denied("application_ended");
    // docs/PLATFORM-2.0.md §17.2 — the link proves an invitation, not a qualification: an
    // `influencers` campaign still needs a verified 3,000+ account (or a campaign_targets row).
    if (
      !old &&
      audienceOf(c.audience) === "influencers" &&
      (await audienceAccessFor(sql, String(c.id), id)) !== "ok"
    )
      throw new Denied("influencer_required");
    const held = (
      await sql.query<{ n: number }>(
        "select count(*)::int n from campaign_applications where campaign_id=$1 and status in ('selected','rejected','posted','verified','paid')",
        [c.id],
      )
    ).rows[0]!.n;
    if (!old && held >= Number(c.slots)) throw new Denied("slots_full");
    const recent = (
      await sql.query<{ n: number }>(
        "select count(*)::int n from campaign_applications where creator_id=$1 and created_at>now()-interval '1 day'",
        [id],
      )
    ).rows[0]!.n;
    if (!old && recent >= 10) throw new Denied("rate_limited");
    const applicationId = old ? String(old.id) : randomUUID();
    if (!old)
      await sql.query(
        "insert into campaign_applications(id,campaign_id,creator_id,status,pitch,sns_url,follower_count) values($1,$2,$3,'applied',$4,$5,$6)",
        [
          applicationId,
          c.id,
          id,
          p.data.pitch,
          p.data.snsUrl,
          p.data.followerCount,
        ],
      );
    await sql.query(
      "update campaign_participant_invites set accepted_by=$2,application_id=$3,accepted_fingerprint=$4,accepted_at=$5,accepted_terms_version=$6,accepted_terms_snapshot=$7::jsonb where id=$1",
      [
        invite.id,
        id,
        applicationId,
        fingerprint,
        now(d),
        p.data.termsVersion,
        JSON.stringify(termsSnapshot(c)),
      ],
    );
    return { id: applicationId };
  });
}
export interface Participation {
  creatorProfileUrl?: string | null;
  id: string;
  campaignId: string;
  projectId: string;
  slug: string;
  title: { ko: string; en: string };
  status: string;
  role: "creator" | "brand" | "studio";
  canWrite: boolean;
  threadOpen: boolean;
  postUrl: string | null;
  messages: Array<{
    id: string;
    body: string;
    role: string;
    createdAt: string;
  }>;
  files: Array<{
    id: string;
    name: string;
    mime: string;
    sizeBytes: number;
    href: string;
    role: string;
    createdAt: string;
  }>;
}
export async function loadParticipation(
  d: Deps,
  v: Viewer,
  id: string,
): Promise<Participation | null> {
  const r = await run(d, v, async (sql, userId) => {
    const x = await participantAccess(sql, userId, id);
    const a = x.a;
    const messages = x.threadOpen
      ? (
          await sql.query<Row>(
            "select id,body,author_role,created_at from campaign_participant_messages where application_id=$1 order by created_at,id limit 500",
            [id],
          )
        ).rows
      : [];
    const files = x.threadOpen
      ? (
          await sql.query<Row>(
            "select id,name,mime,size_bytes,author_role,created_at from campaign_participant_files where application_id=$1 and status='ready' order by created_at,id limit 100",
            [id],
          )
        ).rows
      : [];
    return {
      id,
      creatorProfileUrl: participantProfileUrl(a.sns_url),
      campaignId: String(a.campaign_id),
      projectId: String(a.project_id),
      slug: String(a.slug),
      title: a.title as Participation["title"],
      status: String(a.status),
      role: x.role,
      canWrite: x.canWrite,
      threadOpen: x.threadOpen,
      postUrl: a.post_url ? String(a.post_url) : null,
      messages: messages.map((m) => ({
        id: String(m.id),
        body: String(m.body),
        role: String(m.author_role),
        createdAt: stamp(m.created_at),
      })),
      files: files.map((f) => ({
        id: String(f.id),
        name: String(f.name),
        mime: String(f.mime),
        sizeBytes: Number(f.size_bytes),
        href: `/api/campaign-collaboration/files/${f.id}`,
        role: String(f.author_role),
        createdAt: stamp(f.created_at),
      })),
    };
  });
  return r.ok ? r : null;
}
export async function sendParticipantMessage(
  d: Deps,
  v: Viewer,
  input: unknown,
): Promise<Outcome> {
  const p = z
    .object({
      applicationId: uuid,
      requestId: uuid,
      body: z.string().trim().min(1).max(4000),
    })
    .strict()
    .safeParse(input);
  if (!p.success) return { ok: false, code: "invalid" };
  return run(d, v, async (sql, id) => {
    const x = await participantAccess(sql, id, p.data.applicationId, true);
    const old = (
      await sql.query<Row>(
        "select id,application_id,body from campaign_participant_messages where created_by=$1 and request_id=$2",
        [id, p.data.requestId],
      )
    ).rows[0];
    if (old) {
      if (
        old.application_id !== p.data.applicationId ||
        old.body !== p.data.body
      )
        throw new Denied("conflict");
      return { id: String(old.id) };
    }
    const n = (
      await sql.query<{ n: number }>(
        "select count(*)::int n from campaign_participant_messages where created_by=$1 and created_at>now()-interval '1 minute'",
        [id],
      )
    ).rows[0]!.n;
    if (n >= 10) throw new Denied("rate_limited");
    const messageId = randomUUID();
    await sql.query(
      "insert into campaign_participant_messages(id,application_id,created_by,author_role,body,request_id) values($1,$2,$3,$4,$5,$6)",
      [
        messageId,
        p.data.applicationId,
        id,
        x.role,
        p.data.body,
        p.data.requestId,
      ],
    );
    await enqueueCampaignRisk(sql, {
      id: messageId,
      applicationId: p.data.applicationId,
      body: p.data.body,
      authorRole: x.role,
    });
    return { id: messageId };
  });
}
export function participantFileMime(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return "image/jpeg";
  if (
    b.length >= 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (b.length >= 5 && b.toString("ascii", 0, 5) === "%PDF-")
    return "application/pdf";
  return null;
}
export async function storeParticipantFile(
  d: Deps,
  v: Viewer,
  input: {
    applicationId: string;
    requestId: string;
    name: string;
    mime: string;
    bytes: Uint8Array;
  },
): Promise<Outcome> {
  const p = z
    .object({
      applicationId: uuid,
      requestId: uuid,
      name: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .refine((s) => !/[\x00-\x1f/\\]/.test(s)),
      mime: z.enum([
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
      ]),
    })
    .strict()
    .safeParse({
      applicationId: input.applicationId,
      requestId: input.requestId,
      name: input.name,
      mime: input.mime,
    });
  if (
    !p.success ||
    !input.bytes?.length ||
    input.bytes.length > 3000000 ||
    participantFileMime(input.bytes) !== input.mime
  )
    return { ok: false, code: "invalid" };
  if (!d.storage) return { ok: false, code: "unavailable" };
  const reservation = await run(d, v, async (sql, id) => {
    const x = await participantAccess(sql, id, input.applicationId, true);
    const hash = digest(input.bytes);
    const old = (
      await sql.query<Row>(
        "select * from campaign_participant_files where created_by=$1 and request_id=$2 for update",
        [id, input.requestId],
      )
    ).rows[0];
    if (
      old &&
      (old.application_id !== input.applicationId ||
        old.name !== p.data.name ||
        old.mime !== input.mime ||
        old.sha256 !== hash)
    )
      throw new Denied("conflict");
    if (old?.status === "ready")
      return { id: String(old.id), key: String(old.storage_key), ready: true };
    const n = (
      await sql.query<{ n: number }>(
        "select count(*)::int n from campaign_participant_files where application_id=$1",
        [input.applicationId],
      )
    ).rows[0]!.n;
    if (!old && n >= 100) throw new Denied("rate_limited");
    const fileId = old ? String(old.id) : randomUUID(),
      key = old
        ? String(old.storage_key)
        : `campaign-participants/${input.applicationId}/${fileId}`;
    if (!old)
      await sql.query(
        "insert into campaign_participant_files(id,application_id,created_by,author_role,request_id,name,mime,size_bytes,sha256,storage_key) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          fileId,
          input.applicationId,
          id,
          x.role,
          input.requestId,
          p.data.name,
          input.mime,
          input.bytes.length,
          hash,
          key,
        ],
      );
    return { id: fileId, key, ready: false };
  });
  if (!reservation.ok) return reservation;
  if (reservation.ready) return { ok: true, id: reservation.id };
  // Storage is outside every SQL transaction. A failed or revoked finalize leaves a private,
  // pending record; retrying the identical request can safely finish it without a new object.
  try {
    await d.storage.putStaging(reservation.key, input.bytes, input.mime);
  } catch {
    try {
      const existing = await d.storage.read("content", reservation.key);
      if (
        !existing ||
        existing.length !== input.bytes.length ||
        digest(existing) !== digest(input.bytes)
      )
        return { ok: false, code: "unavailable" };
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }
  return run(d, v, async (sql, id) => {
    await participantAccess(sql, id, input.applicationId, true);
    const f = (
      await sql.query<Row>(
        "select * from campaign_participant_files where id=$1 and created_by=$2 for update",
        [reservation.id, id],
      )
    ).rows[0];
    if (
      !f ||
      f.application_id !== input.applicationId ||
      f.sha256 !== digest(input.bytes)
    )
      throw new Denied("conflict");
    if (f.status !== "ready")
      await sql.query(
        "update campaign_participant_files set status='ready' where id=$1",
        [reservation.id],
      );
    return { id: reservation.id };
  });
}
export async function readParticipantFile(
  d: Deps,
  v: Viewer,
  id: string,
): Promise<{ bytes: Uint8Array; name: string; mime: string } | null> {
  if (!uuid.safeParse(id).success || !d.storage) return null;
  const r = await run(d, v, async (sql, userId) => {
    const f = (
      await sql.query<Row>(
        "select * from campaign_participant_files where id=$1 and status='ready'",
        [id],
      )
    ).rows[0];
    if (!f) throw new Denied("not_found");
    const x = await participantAccess(
      sql,
      userId,
      String(f.application_id),
      false,
      false,
    );
    if (!x.threadOpen) throw new Denied("not_found");
    return {
      applicationId: String(f.application_id),
      key: String(f.storage_key),
      size: Number(f.size_bytes),
      hash: String(f.sha256),
      name: String(f.name),
      mime: String(f.mime),
    };
  });
  if (!r.ok) return null;
  let bytes: Uint8Array;
  try {
    bytes = await d.storage.read("content", r.key);
  } catch {
    return null;
  }
  if (bytes.length !== r.size || digest(bytes) !== r.hash) return null;
  const current = await run(d, v, async (sql, userId) => {
    const x = await participantAccess(sql, userId, r.applicationId);
    if (!x.threadOpen) throw new Denied("not_found");
    return { id };
  });
  return current.ok ? { bytes, name: r.name, mime: r.mime } : null;
}
export interface CollaborationCampaign {
  id: string;
  slug: string;
  title: { ko: string; en: string };
  invitations: Array<{
    id: string;
    status: "pending" | "accepted" | "revoked" | "expired";
    expiresAt: string;
  }>;
  participants: Array<{
    id: string;
    status: string;
    profileUrl: string | null;
  }>;
}
/** Batch navigation gate. IDs only; it grants no access to the underlying records. */
export async function linkedParticipationIds(
  sql: SqlRunner,
  applicationIds: string[],
): Promise<Set<string>> {
  if (
    !applicationIds.length ||
    applicationIds.some((id) => !uuid.safeParse(id).success) ||
    !(await collaborationReady(sql))
  )
    return new Set();
  return new Set(
    (
      await sql.query<{ id: string }>(
        "select a.id from campaign_applications a join campaign_collaboration_links l on l.campaign_id=a.campaign_id where a.id=any($1::uuid[])",
        [applicationIds],
      )
    ).rows.map((r) => r.id),
  );
}
export async function loadCollaborationBindingOptions(
  d: Deps,
  v: Viewer,
  campaignId: string,
): Promise<{
  projectId: string | null;
  options: Array<{ id: string; label: string }>;
} | null> {
  const r = await run(d, v, async (sql, id) => {
    if (!(await studio(sql, id))) throw new Denied("forbidden");
    const binding = (
      await sql.query<Row>(
        "select project_id from campaign_collaboration_links where campaign_id=$1",
        [campaignId],
      )
    ).rows[0];
    const options = (
      await sql.query<{ id: string; label: string }>(
        "select p.id,o.name||' · '||p.title as label from brand_projects p join brand_organizations o on o.id=p.organization_id where p.production_mode='creator' and p.status='active' order by o.name,p.title",
      )
    ).rows;
    return { projectId: binding ? String(binding.project_id) : null, options };
  });
  return r.ok ? r : null;
}
export async function loadProjectCollaboration(
  d: Deps,
  v: Viewer,
  projectId: string,
): Promise<{ canInvite: boolean; campaigns: CollaborationCampaign[] } | null> {
  if (!uuid.safeParse(projectId).success) return null;
  const r = await run(d, v, async (sql, id) => {
    const access = await projectAccess(sql, id, projectId);
    const cs = (
      await sql.query<Row>(
        "select c.id,c.slug,c.title from campaigns c join campaign_collaboration_links l on l.campaign_id=c.id where l.project_id=$1 order by c.created_at",
        [projectId],
      )
    ).rows;
    const campaigns: CollaborationCampaign[] = [];
    for (const c of cs) {
      const invites = (
        await sql.query<Row>(
          "select id,expires_at,revoked_at,accepted_at from campaign_participant_invites where campaign_id=$1 order by created_at desc limit 100",
          [c.id],
        )
      ).rows;
      const apps = (
        await sql.query<Row>(
          "select id,status,sns_url from campaign_applications where campaign_id=$1 and status in ('selected','rejected','posted','verified','paid') order by created_at",
          [c.id],
        )
      ).rows;
      campaigns.push({
        id: String(c.id),
        slug: String(c.slug),
        title: c.title as CollaborationCampaign["title"],
        invitations: invites.map((i) => ({
          id: String(i.id),
          status: i.revoked_at
            ? "revoked"
            : i.accepted_at
              ? "accepted"
              : +new Date(String(i.expires_at)) <= +now(d)
                ? "expired"
                : "pending",
          expiresAt: stamp(i.expires_at),
        })),
        participants: apps.map((a) => ({
          id: String(a.id),
          status: String(a.status),
          profileUrl: participantProfileUrl(a.sns_url),
        })),
      });
    }
    return {
      canInvite: access.canWrite && access.p.status === "active",
      campaigns,
    };
  });
  return r.ok ? r : null;
}
