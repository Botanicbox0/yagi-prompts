import { randomUUID } from 'node:crypto';
import { after, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandRoomsOpen, brandStudioV2Open } from '@/lib/flags';
import { notifySlackBrandConcierge } from '@/lib/brands/concierge-slack';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { StudioDenied, requireCreate, studioSeat, type StudioSeat } from '@/lib/brand-studio/access';
import { studioJson } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { roomReviewReady } from '@/lib/brand-studio/review';
import { REVIEW_LIMITS, reviewHref } from '@/lib/brand-studio/review-contracts';
import { studioLog } from '@/lib/brand-studio/runtime';
import { runRoomOperation, type RoomNotice } from '@/lib/brand-rooms/messages';
import { SHARE_LIMITS, shareHttpStatus, sharePath, type ShareLink } from '@/lib/brand-rooms/share-contracts';
import { createShare as createRoomShare, listShares } from '@/lib/brand-rooms/shares';

/**
 * `/api/brand-studio/share-bridge` — 1-click bridge between Brand Studio (Image / Video / Compose /
 * Assets / Review) and external `/s/[token]` review links + client project rooms.
 *
 * Security chain (strict order):
 *   1. `sameOriginMutation` (`403`)
 *   2. `brandStudioV2Open()` (`404`)
 *   3. `getViewer()` (`401`)
 *   4. `studioSeat()` -> membership -> Morphic/sandboxed & `generative_media` policy hardline (`404`),
 *      excluding campaign-only guests (`404`).
 */
export const dynamic = 'force-dynamic';

export const DEFAULT_REVIEW_WORKSPACE_TITLE = '스튜디오 공유 · 검수함';
export const DEFAULT_REVIEW_WORKSPACE_OBJECTIVE = '브랜드 스튜디오 작업물 외부 공유 및 팀·고객사 피드백 검수 공간';

const BODY_MAX = 32_768;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ContextInputSchema = z
  .object({
    organizationId: z.uuid(),
    reviewId: z.uuid().nullish(),
    assetId: z.uuid().nullish(),
    outputId: z.uuid().nullish(),
  })
  .refine((v) => !(v.assetId && v.outputId), { message: 'choose one subject' });

const EnsureReviewInputSchema = z
  .object({
    organizationId: z.uuid(),
    reviewId: z.uuid().nullish(),
    assetId: z.uuid().nullish(),
    outputId: z.uuid().nullish(),
    title: z
      .string()
      .max(240)
      .nullish()
      .transform((s) => (s ? s.replace(/\s+/g, ' ').trim().slice(0, REVIEW_LIMITS.titleMax) : '')),
  })
  .refine((v) => Boolean(v.reviewId) || Boolean(v.assetId) !== Boolean(v.outputId), {
    message: 'subject required',
  });

const CreateShareInputSchema = z
  .object({
    organizationId: z.uuid(),
    reviewId: z.uuid().nullish(),
    assetId: z.uuid().nullish(),
    outputId: z.uuid().nullish(),
    title: z
      .string()
      .max(240)
      .nullish()
      .transform((s) => (s ? s.replace(/\s+/g, ' ').trim().slice(0, REVIEW_LIMITS.titleMax) : '')),
    projectId: z.uuid().nullish(),
    allowComments: z.boolean().default(true),
    allowDownload: z.boolean().default(false),
    password: z
      .string()
      .max(SHARE_LIMITS.passphraseMax)
      .nullish()
      .transform((s) => (s ? s.trim() : ''))
      .pipe(z.union([z.literal(''), z.string().min(SHARE_LIMITS.passphraseMin)])),
    expiresInDays: z.number().int().min(1).max(SHARE_LIMITS.expiryDaysMax).default(SHARE_LIMITS.expiryDaysDefault),
    postToChat: z.boolean().default(false),
    chatNote: z
      .string()
      .max(4000)
      .nullish()
      .transform((s) => (s ? s.replace(/\r\n/g, '\n').trim() : '')),
    issueShareLink: z.boolean().default(true),
  })
  .refine((v) => Boolean(v.reviewId) || Boolean(v.assetId) !== Boolean(v.outputId), {
    message: 'subject required',
  });

function statusForStudioCode(code: string): number {
  switch (code) {
    case 'sign_in_required':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
    case 'feature_unavailable':
    case 'studio_closed':
      return 404;
    case 'invalid':
      return 400;
    case 'conflict':
      return 409;
    case 'provider_unavailable':
      return 503;
    default:
      return 500;
  }
}

async function bridgeSeat(sql: SqlRunner, userId: string | null | undefined, organizationId: string): Promise<StudioSeat> {
  const seat = await studioSeat(sql, userId, organizationId);
  if (seat.role === 'guest') throw new StudioDenied('not_found');
  return seat;
}

function tellTheTeam(sql: SqlRunner, notice: RoomNotice | null): void {
  if (!notice) return;
  after(async () => {
    try {
      await notifySlackBrandConcierge(sql, notice);
    } catch (error) {
      studioLog('share_bridge_notice_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    }
  });
}

interface ResolvedReview {
  id: string;
  title: string;
  status: string;
  projectId: string | null;
  stackId: string | null;
}

async function findExistingReview(
  sql: SqlRunner,
  organizationId: string,
  opts: { reviewId?: string | null; assetId?: string | null; outputId?: string | null },
  ready: boolean,
): Promise<ResolvedReview | null> {
  const extraCols = ready ? ', project_id, stack_id' : '';
  if (opts.reviewId) {
    const row = (
      await sql.query<{ id: string; title: string; status: string; project_id?: string | null; stack_id?: string | null }>(
        `select id, title, status${extraCols} from brand_studio_reviews where id = $1 and organization_id = $2 and deleted_at is null`,
        [opts.reviewId, organizationId],
      )
    ).rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
      projectId: row.project_id ? String(row.project_id) : null,
      stackId: row.stack_id ? String(row.stack_id) : null,
    };
  }
  const col = opts.assetId ? 'asset_id' : opts.outputId ? 'output_id' : null;
  const subjectId = opts.assetId ?? opts.outputId ?? null;
  if (!col || !subjectId) return null;
  const row = (
    await sql.query<{ id: string; title: string; status: string; project_id?: string | null; stack_id?: string | null }>(
      `select id, title, status${extraCols} from brand_studio_reviews where organization_id = $1 and ${col} = $2 and deleted_at is null`,
      [organizationId, subjectId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    projectId: row.project_id ? String(row.project_id) : null,
    stackId: row.stack_id ? String(row.stack_id) : null,
  };
}

async function ensureReviewRecord(
  sql: SqlRunner,
  seat: StudioSeat,
  opts: { reviewId?: string | null; assetId?: string | null; outputId?: string | null; title?: string },
  ready: boolean,
): Promise<ResolvedReview> {
  if (opts.reviewId) {
    const found = await findExistingReview(sql, seat.organizationId, { reviewId: opts.reviewId }, ready);
    if (!found) throw new StudioDenied('not_found');
    if (ready && !found.stackId) {
      await sql.query('update brand_studio_reviews set stack_id = id where id = $1 and organization_id = $2 and stack_id is null', [
        found.id,
        seat.organizationId,
      ]);
      found.stackId = found.id;
    }
    return found;
  }

  let defaultTitle = opts.title || '스튜디오 작업물';
  if (opts.assetId) {
    const asset = (
      await sql.query<{ id: string; kind: string; name: string }>(
        'select id, kind, name from brand_studio_assets where id = $1 and organization_id = $2 and deleted_at is null',
        [opts.assetId, seat.organizationId],
      )
    ).rows[0];
    if (!asset) throw new StudioDenied('not_found');
    if (asset.kind !== 'image' && asset.kind !== 'video') throw new StudioDenied('invalid');
    if (!opts.title && asset.name) defaultTitle = String(asset.name).trim().slice(0, REVIEW_LIMITS.titleMax) || defaultTitle;
  } else if (opts.outputId) {
    const out = (
      await sql.query<{ id: string; kind: string; prompt: string | null }>(
        `select o.id, o.kind, j.prompt
           from brand_studio_outputs o
           left join brand_studio_jobs j on j.id = o.job_id
          where o.id = $1 and o.organization_id = $2 and o.deleted_at is null`,
        [opts.outputId, seat.organizationId],
      )
    ).rows[0];
    if (!out) throw new StudioDenied('not_found');
    if (out.kind !== 'image' && out.kind !== 'video') throw new StudioDenied('invalid');
    if (!opts.title && out.prompt) defaultTitle = String(out.prompt).replace(/\s+/g, ' ').trim().slice(0, REVIEW_LIMITS.titleMax) || defaultTitle;
  } else {
    throw new StudioDenied('invalid');
  }

  const col = opts.assetId ? 'asset_id' : 'output_id';
  const subjectId = (opts.assetId ?? opts.outputId)!;
  await sql.query(
    `insert into brand_studio_reviews (organization_id, ${col}, title, created_by, created_role)
       values ($1, $2, $3, $4, 'brand')
     on conflict (organization_id, ${col}) where deleted_at is null and ${col} is not null do nothing`,
    [seat.organizationId, subjectId, defaultTitle, seat.userId],
  );

  const resolved = await findExistingReview(sql, seat.organizationId, { assetId: opts.assetId, outputId: opts.outputId }, ready);
  if (!resolved) throw new StudioDenied('conflict');
  if (ready && !resolved.stackId) {
    await sql.query('update brand_studio_reviews set stack_id = id where id = $1 and organization_id = $2 and stack_id is null', [
      resolved.id,
      seat.organizationId,
    ]);
    resolved.stackId = resolved.id;
  }
  return resolved;
}

async function resolveOrCreateReviewProject(
  sql: SqlRunner,
  seat: StudioSeat,
  requestedProjectId: string | null | undefined,
  existingProjectId: string | null,
): Promise<{ id: string; title: string }> {
  if (requestedProjectId) {
    const chosen = (
      await sql.query<{ id: string; title: string }>(
        `select id, title from brand_projects
          where id = $1 and organization_id = $2 and client_visible = true and status <> 'cancelled'`,
        [requestedProjectId, seat.organizationId],
      )
    ).rows[0];
    if (!chosen) throw new StudioDenied('not_found');
    return { id: String(chosen.id), title: String(chosen.title) };
  }

  if (existingProjectId) {
    const linked = (
      await sql.query<{ id: string; title: string }>(
        `select id, title from brand_projects
          where id = $1 and organization_id = $2 and client_visible = true and status <> 'cancelled'`,
        [existingProjectId, seat.organizationId],
      )
    ).rows[0];
    if (linked) return { id: String(linked.id), title: String(linked.title) };
  }

  // Serialize workspace project creation per organization so concurrent shares never create duplicate workspace rooms.
  await sql.query('select id from brand_organizations where id = $1 for update', [seat.organizationId]);
  const existingWorkspace = (
    await sql.query<{ id: string; title: string }>(
      `select id, title from brand_projects
        where organization_id = $1 and title = $2 and client_visible = true and status <> 'cancelled'
        order by created_at asc limit 1`,
      [seat.organizationId, DEFAULT_REVIEW_WORKSPACE_TITLE],
    )
  ).rows[0];
  if (existingWorkspace) {
    return { id: String(existingWorkspace.id), title: String(existingWorkspace.title) };
  }

  const created = (
    await sql.query<{ id: string; title: string }>(
      `insert into brand_projects (
         organization_id,
         title,
         objective,
         audience,
         production_mode,
         status,
         created_by,
         request_id,
         client_visible
       ) values ($1, $2, $3, '', 'studio', 'active', $4, $5, true)
       returning id, title`,
      [seat.organizationId, DEFAULT_REVIEW_WORKSPACE_TITLE, DEFAULT_REVIEW_WORKSPACE_OBJECTIVE, seat.userId, randomUUID()],
    )
  ).rows[0]!;
  return { id: String(created.id), title: String(created.title) };
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) {
    return studioJson({ ok: false, code: 'forbidden' }, 403);
  }
  if (!brandStudioV2Open()) {
    return studioJson({ ok: false, code: 'studio_closed' }, 404);
  }
  const viewer = await getViewer();
  if (!viewer.userId) {
    return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  }
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) {
    return studioJson({ ok: false, code: 'invalid' }, 413);
  }

  let body: { operation?: unknown; input?: unknown };
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || !body.input || typeof body.input !== 'object') {
      return studioJson({ ok: false, code: 'invalid' }, 400);
    }
  } catch {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }

  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);

  const rawOrgId = (body.input as { organizationId?: unknown }).organizationId;
  if (typeof rawOrgId !== 'string' || !UUID_RE.test(rawOrgId)) {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }

  try {
    // Gate first on every operation: Morphic/sandboxed, generative_media-denied, non-members and guests receive 404.
    const gateSeat = await sql.transaction((tx) => bridgeSeat(tx, viewer.userId, rawOrgId));
    const media = createStudioMediaStore();

    if (body.operation === 'bridge.context') {
      const parsed = ContextInputSchema.safeParse(body.input);
      if (!parsed.success) return studioJson({ ok: false, code: 'invalid' }, 400);
      const input = parsed.data;

      const contextData = await sql.transaction(async (tx) => {
        const seat = await bridgeSeat(tx, viewer.userId, input.organizationId);
        const ready = await roomReviewReady(tx);
        const projectRows = (
          await tx.query<{ id: string; title: string; status: string }>(
            `select id, title, status from brand_projects
              where organization_id = $1 and client_visible = true and status <> 'cancelled'
              order by (title = $2) desc, created_at desc limit 50`,
            [seat.organizationId, DEFAULT_REVIEW_WORKSPACE_TITLE],
          )
        ).rows;
        const review = await findExistingReview(
          tx,
          seat.organizationId,
          { reviewId: input.reviewId, assetId: input.assetId, outputId: input.outputId },
          ready,
        );
        return { seat, ready, projectRows, review };
      });

      let shares: ShareLink[] = [];
      if (contextData.review && contextData.seat.canCreate && contextData.ready) {
        const listed = await listShares(
          { sql, media },
          viewer,
          { organizationId: input.organizationId, kind: 'review', targetId: contextData.review.id },
        );
        if (listed.ok) {
          shares = listed.shares.filter((s) => s.state === 'live');
        }
      }

      return studioJson({
        ok: true,
        canWrite: gateSeat.canCreate,
        roomsOpen: brandRoomsOpen(),
        review: contextData.review
          ? {
              id: contextData.review.id,
              title: contextData.review.title,
              status: contextData.review.status,
              projectId: contextData.review.projectId,
              reviewHref: reviewHref(input.organizationId, contextData.review.id),
            }
          : null,
        projects: contextData.projectRows.map((p) => ({
          id: String(p.id),
          title: String(p.title),
          status: String(p.status),
          isDefaultWorkspace: String(p.title) === DEFAULT_REVIEW_WORKSPACE_TITLE,
        })),
        shares,
      });
    }

    if (body.operation === 'bridge.ensure_review') {
      const parsed = EnsureReviewInputSchema.safeParse(body.input);
      if (!parsed.success) return studioJson({ ok: false, code: 'invalid' }, 400);
      const input = parsed.data;
      const ensured = await sql.transaction(async (tx) => {
        const seat = await bridgeSeat(tx, viewer.userId, input.organizationId);
        requireCreate(seat);
        const ready = await roomReviewReady(tx);
        return ensureReviewRecord(
          tx,
          seat,
          { reviewId: input.reviewId, assetId: input.assetId, outputId: input.outputId, title: input.title || undefined },
          ready,
        );
      });
      return studioJson({
        ok: true,
        reviewId: ensured.id,
        reviewHref: reviewHref(input.organizationId, ensured.id),
      });
    }

    if (body.operation === 'bridge.create_share' || body.operation === 'bridge.post_chat') {
      const rawWithDefaults =
        body.operation === 'bridge.post_chat'
          ? { ...(body.input as Record<string, unknown>), issueShareLink: false, postToChat: true }
          : body.input;
      const parsed = CreateShareInputSchema.safeParse(rawWithDefaults);
      if (!parsed.success) return studioJson({ ok: false, code: 'invalid' }, 400);
      const input = parsed.data;

      const prepared = await sql.transaction(async (tx) => {
        const seat = await bridgeSeat(tx, viewer.userId, input.organizationId);
        requireCreate(seat);
        const ready = await roomReviewReady(tx);
        if (!ready) throw new StudioDenied('provider_unavailable');

        const review = await ensureReviewRecord(
          tx,
          seat,
          { reviewId: input.reviewId, assetId: input.assetId, outputId: input.outputId, title: input.title || undefined },
          ready,
        );

        const project = await resolveOrCreateReviewProject(tx, seat, input.projectId, review.projectId);
        await tx.query(
          `update brand_studio_reviews
              set project_id = $3,
                  stack_id = coalesce(stack_id, id),
                  updated_at = now()
            where organization_id = $1
              and (id = $2 or stack_id = $2)`,
          [seat.organizationId, review.id, project.id],
        );

        return { review, project };
      });

      let shareUrl: string | null = null;
      let share: ShareLink | null = null;
      if (input.issueShareLink) {
        const created = await createRoomShare({ sql, media }, viewer, {
          organizationId: input.organizationId,
          kind: 'review',
          targetId: prepared.review.id,
          allowComments: input.allowComments,
          allowDownload: input.allowDownload,
          passphrase: input.password || '',
          expiresInDays: input.expiresInDays,
        });
        if (!created.ok) {
          return studioJson({ ok: false, code: created.code }, shareHttpStatus(created.code));
        }
        shareUrl = sharePath(created.token);
        share = created.share;
      }

      let postedMessageId: string | null = null;
      if (input.postToChat && brandRoomsOpen()) {
        const noteBody = input.chatNote || `${prepared.review.title} — 시안 검수 및 피드백을 부탁드립니다.`;
        const sent = await runRoomOperation({ sql, media }, viewer, 'message.send', {
          organizationId: input.organizationId,
          projectId: prepared.project.id,
          requestId: randomUUID(),
          body: noteBody,
          ref: { kind: 'review', reviewId: prepared.review.id },
        });
        if (sent.result.ok && 'message' in sent.result) {
          postedMessageId = sent.result.message.id;
          tellTheTeam(sql, sent.notice);
        }
      }

      return studioJson(
        {
          ok: true,
          reviewId: prepared.review.id,
          reviewHref: reviewHref(input.organizationId, prepared.review.id),
          projectId: prepared.project.id,
          projectTitle: prepared.project.title,
          roomChatHref: `/brand/rooms/${encodeURIComponent(prepared.project.id)}?organizationId=${encodeURIComponent(input.organizationId)}&tab=chat`,
          shareUrl,
          share,
          postedMessageId,
        },
        input.issueShareLink ? 201 : 200,
      );
    }

    return studioJson({ ok: false, code: 'invalid' }, 400);
  } catch (error) {
    if (error instanceof StudioDenied) {
      return studioJson({ ok: false, code: error.code }, statusForStudioCode(error.code));
    }
    studioLog('share_bridge_failed', {
      operation: String(body.operation ?? '').slice(0, 40),
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
