import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { publishContestMedia, stageContestUpload } from '@/lib/contests/media';
import {
  approveEntry,
  countPlacedEntries,
  insertContest,
  loadContestById,
  loadEntryById,
  publishContest,
  rejectEntry,
  setContestArchived,
  setEntryPlacement,
  unpublishContest,
  updateContest,
  updateContestMedia,
} from '@/lib/contests/repo';
import { contestPhase } from '@/lib/contests/phase';
import {
  ContestFormSchema,
  ContestIdSchema,
  EntryApprovalSchema,
  EntryRejectionSchema,
  PlacementSchema,
  parseContestMedia,
  publishBlockers,
  type ContestMedia,
} from '@/lib/contests/schemas';
import { ADMIN_CONTESTS_PATH } from '@/lib/contests/links';
import { fail, ok, type AdminContext, type AdminOutcome } from './context';
import * as f from './form';
import type { AdminOperation, ParseResult } from './operations';

/**
 * PLAN §14.2/§14 admin — contest CRUD, entry moderation and placements, registered in the M4
 * dispatcher.
 *
 * They live in their own module but in the SAME registry, on purpose: `tests/admin/auth.test.ts`
 * enumerates `ADMIN_OPERATIONS` and refuses every entry for a non-admin, so an operation added here
 * is covered by the security acceptance the moment it exists. M6 collected on that property; M9
 * collects on it again without touching the dispatcher.
 *
 * Division of labour, unchanged: zod validates the §14.1 payloads at this boundary, the DATABASE
 * owns uniqueness, the placement podium and the publish CHECKs, and rejections are classified in
 * `errors.ts`. Where a rule exists on both sides — publishability, placements-after-deadline — the
 * TypeScript half runs first so the moderator gets a sentence instead of a constraint name, and the
 * database half stays as the thing that is actually true.
 */

function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  const result = schema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, detail: issues(result.error) };
}

/** Every contest mutation lands back on the moderation surface. */
const BACK = ADMIN_CONTESTS_PATH;
const NOT_FOUND_DETAIL = 'the contest this form points at no longer exists';

/** The §14.1 contest form, read out of a plain multipart POST. */
function contestFields(form: FormData) {
  const rules = f.optionalLocalized(form, 'rules');
  return {
    slug: f.str(form, 'slug'),
    title: f.localized(form, 'title'),
    summary: f.localized(form, 'summary'),
    prize: f.localized(form, 'prize'),
    rules,
    brandName: f.str(form, 'brandName'),
    brandUrl: f.str(form, 'brandUrl') || null,
    startsAt: f.str(form, 'startsAt') || null,
    deadlineAt: f.str(form, 'deadlineAt') || null,
  };
}

/**
 * Stage the posted files onto an existing media object.
 *
 * Absent file ⇒ keep whatever is already there (the same "leave empty to keep the staged file"
 * affordance every other form in this CMS has). A rejected file aborts the whole operation — a
 * half-replaced media object is worse than a refused save.
 */
async function applyUploads(
  ctx: AdminContext,
  contestId: string,
  form: FormData,
  existing: ContestMedia,
): Promise<{ ok: true; value: ContestMedia } | { ok: false; detail: string }> {
  const next: ContestMedia = { ...existing };
  for (const kind of ['poster', 'video'] as const) {
    const file = f.file(form, kind);
    if (file === null) continue;
    const staged = await stageContestUpload(ctx.storage, contestId, kind, file);
    if (!staged.ok) return { ok: false, detail: `${kind}: ${staged.reason}` };
    next[kind] = staged.value.ref;
  }
  return { ok: true, value: next };
}

// ---------------------------------------------------------------------------
// contest CRUD
// ---------------------------------------------------------------------------

const create: AdminOperation<{ input: z.infer<typeof ContestFormSchema>; form: FormData }> = {
  parse(form) {
    const base = parsed(ContestFormSchema, contestFields(form));
    if (!base.ok) return base;
    return { ok: true, value: { input: base.value, form } };
  },
  async run(ctx, { input, form }) {
    const id = randomUUID();
    const staged = await applyUploads(ctx, id, form, {});
    if (!staged.ok) return fail('upload', staged.detail);

    // Born a draft, and the media stays in PRIVATE staging with it. §14.1: "Publishing is the
    // founder's act (a prize is a public commitment)" — so nothing about a new contest is
    // disclosed, not the poster and not the prize.
    await insertContest(ctx.sql, {
      id,
      status: 'draft',
      ...input,
      media: Object.keys(staged.value).length === 0 ? null : staged.value,
    });

    // No revalidate: a draft was never on the listing, so nothing cached can be stale.
    return ok('created', { detail: input.slug, to: BACK });
  },
};

const update: AdminOperation<{
  id: string;
  input: z.infer<typeof ContestFormSchema>;
  form: FormData;
}> = {
  parse(form) {
    const id = z.string().uuid().safeParse(f.str(form, 'id'));
    if (!id.success) return { ok: false, detail: 'id: must be a uuid' };
    const base = parsed(ContestFormSchema, contestFields(form));
    if (!base.ok) return base;
    return { ok: true, value: { id: id.data, input: base.value, form } };
  },
  async run(ctx, { id, input, form }) {
    const row = await loadContestById(ctx.sql, id);
    if (row === null) return fail('notFound', NOT_FOUND_DETAIL);

    const staged = await applyUploads(ctx, id, form, parseContestMedia(row.media));
    if (!staged.ok) return fail('upload', staged.detail);

    // A LIVE contest's newly uploaded poster has to be copied now — it is already public surface.
    // A draft's stays staged until publish. One branch, and it is the status.
    const media =
      row.status === 'published'
        ? (await publishContestMedia(ctx.storage, staged.value)).media
        : staged.value;
    await updateContestMedia(ctx.sql, id, Object.keys(media).length === 0 ? null : media);

    /**
     * §14.1 / M9 R3 — a judged contest's deadline cannot be pushed outwards, and the guard is
     * atomic: `updateContest` locks the contest row, counts placements under that lock, and only
     * then writes. `setEntryPlacement` takes the same lock, so a medal can never slip in between
     * the check and the save. Shortening, or moving an unjudged deadline, stays free; the refusal
     * names the way out (clear the placements first).
     */
    const saved = await updateContest(ctx.sql, { id, ...input });
    if (saved === 'placementsLocked') return fail('placementsLocked', row.slug);
    if (saved === 'notFound') return fail('notFound', NOT_FOUND_DETAIL);

    if (row.status === 'published') ctx.revalidateContests?.();
    return ok('saved', { detail: input.slug, to: BACK });
  },
};

const publish: AdminOperation<z.infer<typeof ContestIdSchema>> = {
  parse: (form) => parsed(ContestIdSchema, { id: f.str(form, 'id') }),
  async run(ctx, input) {
    const row = await loadContestById(ctx.sql, input.id);
    if (row === null) return fail('notFound', NOT_FOUND_DETAIL);

    // The gate, before anything is copied anywhere: once a poster reaches `public-content` it is
    // permanently disclosed (§6), so a contest that cannot publish must not have its bytes copied
    // "just in case".
    const blockers = publishBlockers({ ...row, media: row.media });
    if (blockers.length > 0) return fail('notPublishable', blockers.join(', '));

    const { media } = await publishContestMedia(ctx.storage, parseContestMedia(row.media));
    await updateContestMedia(ctx.sql, input.id, media);

    const moved = await publishContest(ctx.sql, input.id);
    if (!moved) return fail('notFound', 'only a draft or archived contest can be published');

    ctx.revalidateContests?.();
    return ok('published', { detail: row.slug, to: BACK });
  },
};

const unpublish: AdminOperation<z.infer<typeof ContestIdSchema>> = {
  parse: (form) => parsed(ContestIdSchema, { id: f.str(form, 'id') }),
  async run(ctx, input) {
    const moved = await unpublishContest(ctx.sql, input.id);
    if (!moved) return fail('notFound', 'only a published contest can be unpublished');
    ctx.revalidateContests?.();
    return ok('unpublished', { to: BACK });
  },
};

const Archive = z.object({ id: z.string().uuid(), archived: z.boolean() });

const archive: AdminOperation<z.infer<typeof Archive>> = {
  parse: (form) => parsed(Archive, { id: f.str(form, 'id'), archived: f.bool(form, 'archived') }),
  async run(ctx, input) {
    const changed = await setContestArchived(ctx.sql, input.id, input.archived);
    if (!changed) return fail('notFound', NOT_FOUND_DETAIL);
    ctx.revalidateContests?.();
    return ok(input.archived ? 'archived' : 'unarchived', { to: BACK });
  },
};

// ---------------------------------------------------------------------------
// entry moderation
// ---------------------------------------------------------------------------

/**
 * Tell a STALE review apart from every other reason a moderation write matched no row.
 *
 * The version guard and the status predicate live in the same `WHERE`, so a zero-row result is
 * ambiguous until the row is read back — and the two cases need different sentences: "someone else
 * already handled this" versus "the entrant replaced the film you just watched".
 */
async function moderationFailure(
  ctx: AdminContext,
  id: string,
  version: string,
  fallback: string,
): Promise<AdminOutcome> {
  const row = await loadEntryById(ctx.sql, id);
  if (row === null) return fail('notFound', 'the entry this form points at no longer exists');
  if (row.version !== version) return fail('staleReview', row.title);
  return fail('notFound', fallback);
}

const approve: AdminOperation<z.infer<typeof EntryApprovalSchema>> = {
  parse: (form) =>
    parsed(EntryApprovalSchema, { id: f.str(form, 'id'), version: f.str(form, 'version') }),
  async run(ctx, input) {
    const moved = await approveEntry(ctx.sql, input.id, input.version);
    if (!moved) {
      return moderationFailure(
        ctx,
        input.id,
        input.version,
        'only a pending or rejected entry can be approved',
      );
    }
    // The entries rail and the card's count both live on the cached listing/detail.
    ctx.revalidateContests?.();
    return ok('approved', { to: BACK });
  },
};

const reject: AdminOperation<z.infer<typeof EntryRejectionSchema>> = {
  parse: (form) =>
    parsed(EntryRejectionSchema, {
      id: f.str(form, 'id'),
      reason: f.text(form, 'reason'),
      version: f.str(form, 'version'),
    }),
  async run(ctx, input) {
    const row = await loadEntryById(ctx.sql, input.id);
    if (row === null) return fail('notFound', 'the entry this form points at no longer exists');

    const moved = await rejectEntry(ctx.sql, input.id, input.reason, input.version);
    if (!moved) {
      return moderationFailure(
        ctx,
        input.id,
        input.version,
        'only a pending or approved entry can be rejected',
      );
    }

    // Only a visible entry disappearing changes a public page. Rejecting a pending one does not.
    if (row.status === 'approved') ctx.revalidateContests?.();
    return ok('rejected', { to: BACK });
  },
};

/**
 * §14.1 — "placement int null (1/2/3 set by admin post-deadline)".
 *
 * Two guards, and they refuse different things:
 *   · the DEADLINE guard is here, because "post-deadline" is a fact about the clock and a CHECK
 *     constraint cannot see one without becoming non-immutable;
 *   · the APPROVED guard and the one-medal-per-place rule are in the database, because the first is
 *     a fact about the row and the second is a race.
 *
 * Clearing a placement (`null`) is allowed at any time: correcting a mistake must not need a
 * deadline to move.
 */
const placement: AdminOperation<z.infer<typeof PlacementSchema>> = {
  parse: (form) => {
    const raw = f.str(form, 'placement');
    const value = raw === '' || raw === 'none' ? null : Number(raw);
    return parsed(PlacementSchema, { id: f.str(form, 'id'), placement: value });
  },
  async run(ctx, input) {
    // BOTH rules live in the UPDATE itself (`lib/contests/repo.ts`), so there is no window between
    // reading the deadline and writing the medal. A zero-row result is then read back only to
    // decide WHICH refusal to name.
    const changed = await setEntryPlacement(ctx.sql, input.id, input.placement);
    if (changed) {
      ctx.revalidateContests?.();
      return ok('saved', { to: BACK });
    }

    const entry = await loadEntryById(ctx.sql, input.id);
    if (entry === null) return fail('notFound', 'the entry this form points at no longer exists');
    const contest = await loadContestById(ctx.sql, entry.contestId);
    if (contest === null) return fail('notFound', NOT_FOUND_DETAIL);
    if (input.placement !== null && contestPhase(contest, Date.now()) !== 'closed') {
      return fail('deadlineNotPassed', contest.slug);
    }
    return fail('notFound', 'only an approved entry can be placed');
  },
};

// ---------------------------------------------------------------------------
// registry fragment
// ---------------------------------------------------------------------------

export const CONTEST_OPERATIONS = {
  'contest.create': create,
  'contest.update': update,
  'contest.publish': publish,
  'contest.unpublish': unpublish,
  'contest.archive': archive,
  'contestEntry.approve': approve,
  'contestEntry.reject': reject,
  'contestEntry.placement': placement,
};
