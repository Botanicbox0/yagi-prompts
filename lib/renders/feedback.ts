import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import type { Mailer, SendOutcome } from '@/lib/notify/mailer';
import { BUSINESS } from '@/lib/legal/documents';
import { sheet } from '@/lib/notify/sheet';
import { loadOwnRender } from './service';

/**
 * Feedback on a result (founder, 2026-09-11: "콘텐츠가 잘 안 나왔어요 같은 불만을 우리한테 넘길 수
 * 있는 시스템"). The owner says what went wrong on the result page; the studio works it from the
 * admin inbox and answers by email; the refund policy §4 (free re-render or refund) is decided here.
 *
 * One row per render. Writing again replaces the reason and message and reopens the row — a
 * person who writes twice is one conversation, not two tickets.
 */

export const FEEDBACK_REASONS = ['face', 'playback', 'mismatch', 'other'] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const FEEDBACK_STATUSES = ['new', 'replied', 'closed'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const RenderFeedbackInput = z.object({
  reason: z.enum(FEEDBACK_REASONS),
  message: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

export const FeedbackStatusChange = z.object({ id: z.uuid(), status: z.enum(FEEDBACK_STATUSES) });

export interface RenderFeedback {
  id: string;
  createdAt: string;
  updatedAt: string;
  renderId: string;
  userId: string;
  reason: FeedbackReason;
  message: string | null;
  status: FeedbackStatus;
  repliedAt: string | null;
}

/** The inbox row: the feedback plus what the studio needs to act without opening anything else. */
export interface RenderFeedbackRow extends RenderFeedback {
  templateSlug: string;
  renderStatus: string;
  medium: string;
  email: string | null;
}

interface RawRow {
  id: string;
  created_at: string | Date;
  updated_at: string | Date;
  render_id: string;
  user_id: string;
  reason: string;
  message: string | null;
  status: string;
  replied_at: string | Date | null;
  template_slug?: string;
  render_status?: string;
  medium?: string;
  email?: string | null;
}

const COLUMNS = 'f.id, f.created_at, f.updated_at, f.render_id, f.user_id, f.reason, f.message, f.status, f.replied_at';
const iso = (value: string | Date | null): string | null => (value === null ? null : value instanceof Date ? value.toISOString() : String(value));

function toFeedback(row: RawRow): RenderFeedback {
  return {
    id: row.id,
    createdAt: iso(row.created_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
    renderId: row.render_id,
    userId: row.user_id,
    reason: row.reason as FeedbackReason,
    message: row.message,
    status: row.status as FeedbackStatus,
    repliedAt: iso(row.replied_at),
  };
}

// ---------------------------------------------------------------------------
// repo
// ---------------------------------------------------------------------------

export async function upsertRenderFeedback(
  sql: SqlRunner,
  args: { renderId: string; userId: string; reason: FeedbackReason; message: string | null },
): Promise<RenderFeedback> {
  const { rows } = await sql.query<RawRow>(
    `insert into render_feedback as f (render_id, user_id, reason, message)
     values ($1, $2, $3, $4)
     on conflict (render_id) do update
       set reason = excluded.reason, message = excluded.message, status = 'new', updated_at = now()
     returning ${COLUMNS}`,
    [args.renderId, args.userId, args.reason, args.message],
  );
  const row = rows[0];
  if (!row) throw new Error('render_feedback upsert returned no row');
  return toFeedback(row);
}

export async function loadRenderFeedback(sql: SqlRunner, renderId: string): Promise<RenderFeedback | null> {
  const { rows } = await sql.query<RawRow>(`select ${COLUMNS} from render_feedback f where f.render_id = $1`, [renderId]);
  return rows[0] ? toFeedback(rows[0]) : null;
}

export async function listRenderFeedback(sql: SqlRunner, args: { statuses: readonly FeedbackStatus[]; limit: number }): Promise<RenderFeedbackRow[]> {
  if (args.statuses.length === 0) return [];
  const { rows } = await sql.query<RawRow>(
    `select ${COLUMNS}, j.template_slug, j.status as render_status, j.medium, p.email
       from render_feedback f
       join render_jobs j on j.id = f.render_id
       left join profiles p on p.id = f.user_id
      where f.status = any($1::text[])
      order by f.updated_at desc
      limit $2::int`,
    [args.statuses as string[], args.limit],
  );
  return rows.map((row) => ({
    ...toFeedback(row),
    templateSlug: row.template_slug ?? '',
    renderStatus: row.render_status ?? '',
    medium: row.medium ?? '',
    email: row.email ?? null,
  }));
}

export async function countRenderFeedback(sql: SqlRunner, status: FeedbackStatus): Promise<number> {
  const { rows } = await sql.query<{ n: number | string }>('select count(*)::int as n from render_feedback where status = $1', [status]);
  return Number(rows[0]?.n ?? 0);
}

/** `replied_at` is stamped the first time a row leaves `new`. */
export async function updateRenderFeedbackStatus(sql: SqlRunner, id: string, status: FeedbackStatus): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update render_feedback
        set status = $2,
            replied_at = case when $2 <> 'new' and replied_at is null then now() else replied_at end
      where id = $1
      returning id`,
    [id, status],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// service
// ---------------------------------------------------------------------------

export type SubmitFeedbackResult =
  | { ok: true; feedback: RenderFeedback; templateTitle: string }
  | { ok: false; code: 'sign_in_required' | 'not_found' | 'invalid' };

/** The owner, and only the owner, of a finished or failed render may say what went wrong with it. */
export async function submitRenderFeedback(deps: { sql: SqlRunner }, viewer: Viewer, renderId: string, raw: unknown): Promise<SubmitFeedbackResult> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  const parsed = RenderFeedbackInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const view = await loadOwnRender(deps.sql, viewer, renderId);
  if (view === null) return { ok: false, code: 'not_found' };
  if (view.job.status !== 'succeeded' && view.job.status !== 'failed') return { ok: false, code: 'not_found' };
  const feedback = await upsertRenderFeedback(deps.sql, { renderId, userId: viewer.userId, reason: parsed.data.reason, message: parsed.data.message });
  return { ok: true, feedback, templateTitle: view.templateTitle };
}

export interface NotifyFeedbackDeps {
  mailer: Mailer | null;
  siteUrl: string;
  siteName: string;
  studioEmail?: string;
}

/** The studio's alert. Plain and complete: who, which result, what reason, their words, where to act. */
export async function notifyRenderFeedback(
  deps: NotifyFeedbackDeps,
  feedback: RenderFeedback,
  context: { templateTitle: string; email: string | null },
): Promise<SendOutcome | null> {
  if (deps.mailer === null) return null;
  const origin = deps.siteUrl.replace(/\/+$/, '');
  const inbox = `${origin}/admin/inquiries`;
  const lines: Array<[string, string]> = [
    ['Template', context.templateTitle],
    ['Render', feedback.renderId],
    ['From', context.email ?? feedback.userId],
    ['Reason', feedback.reason],
    ['Message', feedback.message ?? '—'],
  ];
  const text = [`Result feedback — ${context.templateTitle}`, '', ...lines.map(([k, v]) => `${k}: ${v}`), '', `Inbox: ${inbox}`].join('\n');
  const html = sheet({
    title: `결과물 피드백 — ${context.templateTitle}`,
    paragraphs: [],
    rows: lines,
    button: { label: '문의함에서 열기', url: inbox },
    footer: `${deps.siteName} · render feedback ${feedback.id}`,
  });
  return deps.mailer
    .send({
      to: deps.studioEmail ?? BUSINESS.email,
      subject: `[${deps.siteName}] 결과물 피드백 — ${context.templateTitle} (${feedback.reason})`,
      html,
      text,
      // A re-submission is a new message: the key carries the update time.
      idempotencyKey: `render-feedback:${feedback.id}:${feedback.updatedAt}`,
      unsubscribeUrl: inbox,
    })
    .catch((error: unknown): SendOutcome => ({ ok: false, retryable: false, error: error instanceof Error ? error.message : String(error) }));
}
