import { PublicLink } from '@/components/admin/public-link';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary, type Dictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { formatDate, interpolate } from '@/lib/i18n/format';
import {
  loadAllContests,
  loadEntriesForModeration,
  type ContestRow,
  type EntryRow,
} from '@/lib/contests/repo';
import { contestPhase, contestTiming } from '@/lib/contests/phase';
import {
  HOST_KINDS,
  PLACEMENTS,
  PRIZE_KINDS,
  parseContestMedia,
  publishBlockers,
  toDateTimeLocal,
  type Placement,
} from '@/lib/contests/schemas';
import {
  ADMIN_CONTESTS_PATH,
  adminContestPreviewPath,
  contestHref,
} from '@/lib/contests/links';
import { adminMediaPath, contestAdminRef } from '@/lib/media/admin-authorize';
import {
  AdminShell,
  BUTTON,
  BUTTON_PRIMARY,
  Field,
  INPUT,
  LABEL,
  LocalePair,
  OpForm,
  OutcomeBanner,
  Panel,
} from '@/components/admin/chrome';

/**
 * `/admin/contests` — PLAN §14.2: CRUD, the entry moderation queue and the placements editor, in
 * one screen.
 *
 * Same doctrine as the rest of the CMS (§3.8/§4): a dense utilitarian tool, every control a plain
 * `<form>` posting to the ONE guarded server action, and no client JavaScript anywhere. The
 * operations live in `lib/admin/contest-operations.ts` inside the same registry every other admin
 * mutation is in, which is what makes `tests/admin/auth.test.ts` cover them without being told they
 * exist.
 *
 * Order is the working order: what is live (and therefore has entries waiting), then what is being
 * written, then the form that starts a new one. Every contest carries its own entry queue inline
 * rather than in a separate screen — moderating a film means reading the brief it was made for.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

type Dict = ReturnType<typeof getDictionary>;

/** The staged (unpublished) poster, playable — the whole point of an admin preview path. */
/** `publishBlockers` speaks English literals (the operation's refusal detail); the banner speaks the dictionary. */
const BLOCKER_KEYS: Record<string, keyof Dict['admin']> = {
  'title (en + ko)': 'blockerTitle',
  'summary (en + ko)': 'blockerSummary',
  'prize (en + ko)': 'blockerPrize',
  'rules (en + ko)': 'blockerRules',
  'start date': 'blockerStart',
  deadline: 'blockerDeadline',
  'a deadline after the start': 'blockerDeadlineOrder',
  'poster image': 'blockerPoster',
};

function blockerLabel(a: Dict['admin'], blocker: string): string {
  const key = BLOCKER_KEYS[blocker];
  return key ? String(a[key]) : blocker;
}

function StagedMedia({ row, dict }: { row: ContestRow; dict: Dict }) {
  const media = parseContestMedia(row.media);
  const a = dict.admin;
  if (!media.poster && !media.video) {
    return <p className="font-mono text-[0.72rem] opacity-50">{a.noMedia}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>{a.previewMedia}</span>
      {media.video && (
        <video
          src={adminMediaPath(contestAdminRef(row.id, 'video'))}
          controls
          muted
          playsInline
          preload="metadata"
          className="w-full max-w-sm border border-hairline"
          {...(media.poster ? { poster: adminMediaPath(contestAdminRef(row.id, 'poster')) } : {})}
        />
      )}
      {!media.video && media.poster && (
        // eslint-disable-next-line @next/next/no-img-element -- staging object behind the admin gate
        <img
          src={adminMediaPath(contestAdminRef(row.id, 'poster'))}
          alt=""
          className="w-full max-w-sm border border-hairline"
        />
      )}
    </div>
  );
}

/** The stored tier for a place, or `null` — the editor renders three rows either way. */
function tierValue(row: ContestRow | null, place: Placement) {
  return row?.prizeTiers.find((tier) => tier.place === place)?.value ?? null;
}

/** The §14.1 form body, shared by "new contest" and every editor — one field list, one truth. */
function ContestFields({ row, dict }: { row: ContestRow | null; dict: Dict }) {
  const a = dict.admin;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={a.fieldContestSlug} hint={a.contestSlugHint}>
          <input type="text" name="slug" defaultValue={row?.slug ?? ''} className={INPUT} />
        </Field>
        <Field label={a.fieldHostName}>
          <input type="text" name="hostName" defaultValue={row?.hostName ?? ''} className={INPUT} />
        </Field>
        {/* Who is asking (2026-08-15). A contest is not a brand thing — the kind is what lets a
            platform, a studio or one creator host without being mislabelled on every card. */}
        <Field label={a.fieldHostKind} hint={a.hostKindHint}>
          <select name="hostKind" defaultValue={row?.hostKind ?? 'brand'} className={INPUT}>
            {HOST_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {a.hostKinds[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={a.fieldHostUrl}>
          <input
            type="url"
            name="hostUrl"
            placeholder="https://"
            defaultValue={row?.hostUrl ?? ''}
            className={INPUT}
          />
        </Field>
        <Field label={a.fieldPrizeKind} hint={a.prizeKindHint}>
          <select name="prizeKind" defaultValue={row?.prizeKind ?? 'cash'} className={INPUT}>
            {PRIZE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {a.prizeKinds[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={a.fieldStartsAt} hint={a.contestDatesHint}>
          <input
            type="datetime-local"
            name="startsAt"
            defaultValue={toDateTimeLocal(row?.startsAt)}
            className={INPUT}
          />
        </Field>
        <Field label={a.fieldDeadlineAt}>
          <input
            type="datetime-local"
            name="deadlineAt"
            defaultValue={toDateTimeLocal(row?.deadlineAt)}
            className={INPUT}
          />
        </Field>
        <Field label={a.fieldAnnounceAt} hint={a.contestAnnounceHint}>
          <input
            type="datetime-local"
            name="announceAt"
            defaultValue={toDateTimeLocal(row?.announceAt)}
            className={INPUT}
          />
        </Field>
      </div>

      {/* §5.2 "display lines manually broken" — a contest title is set as a POSTER, so the editor
          has to be able to author the break. Three rows rather than one line, so a line ending is a
          decision the author took rather than whatever the browser's wrapping produced
          (M9 design review, finding 8). */}
      <LocalePair label={a.fieldContestTitle} name="title" value={row?.title ?? null} multiline />
      <LocalePair label={a.fieldContestSummary} name="summary" value={row?.summary ?? null} multiline />
      <LocalePair
        label={a.fieldContestPrize}
        name="prizeTotal"
        value={row?.prizeTotal ?? null}
        hint={a.contestPrizeHint}
      />

      {/* The podium, one row per place. Three fixed rows rather than an add-a-row control: a
          JS-free form (§3.8) cannot grow, and a contest has exactly three places to give. Leaving a
          row blank drops that tier — most contests fill one or none. */}
      <fieldset className="grid gap-3">
        <legend className={LABEL}>{a.fieldPrizeTiers}</legend>
        <p className="font-mono text-[0.72rem] opacity-50">{a.prizeTiersHint}</p>
        {PLACEMENTS.map((place) => (
          <LocalePair
            key={place}
            label={place === 1 ? a.placement1 : place === 2 ? a.placement2 : a.placement3}
            name={`prizeTier${place}`}
            value={tierValue(row, place)}
          />
        ))}
      </fieldset>
      <LocalePair
        label={a.fieldContestRules}
        name="rules"
        value={row?.rules ?? null}
        hint={a.contestRulesHint}
        multiline
        rows={8}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={a.fieldContestPoster} hint={a.contestMediaHint}>
          <input type="file" name="poster" accept="image/*" className={INPUT} />
        </Field>
        <Field label={a.fieldContestVideo}>
          <input type="file" name="video" accept="video/*" className={INPUT} />
        </Field>
      </div>
    </>
  );
}

/**
 * The placements editor (§14.2).
 *
 * Rendered as a disabled-looking notice before the deadline rather than as a hidden control: a
 * moderator should be able to SEE that placements exist and that they open later. The server
 * refuses early placements regardless (`lib/admin/contest-operations.ts`), so this is an
 * explanation, not a gate.
 */
function PlacementControl({
  entry,
  closed,
  dict,
}: {
  entry: EntryRow;
  closed: boolean;
  dict: Dict;
}) {
  const a = dict.admin;
  if (!closed) {
    return <p className="font-mono text-[0.72rem] opacity-50">{a.placementLocked}</p>;
  }
  return (
    <OpForm op="contestEntry.placement" back={ADMIN_CONTESTS_PATH} className="flex items-end gap-2">
      <input type="hidden" name="id" value={entry.id} />
      <Field label={a.colPlacement}>
        <select name="placement" defaultValue={entry.placement ?? 'none'} className={INPUT}>
          <option value="none">{a.placementNone}</option>
          {PLACEMENTS.map((value) => (
            <option key={value} value={value}>
              {value === 1 ? a.placement1 : value === 2 ? a.placement2 : a.placement3}
            </option>
          ))}
        </select>
      </Field>
      <button type="submit" className={BUTTON}>
        {a.savePlacement}
      </button>
    </OpForm>
  );
}

function EntryRowView({
  entry,
  closed,
  dict,
}: {
  entry: EntryRow;
  closed: boolean;
  dict: Dict;
}) {
  const a = dict.admin;
  const statusLabel =
    entry.status === 'approved'
      ? a.entryStatusApproved
      : entry.status === 'rejected'
        ? a.entryStatusRejected
        : a.entryStatusPending;

  return (
    <li data-contest-entry={entry.id} data-status={entry.status} className="border border-hairline p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-mono text-code">{entry.title}</span>
        <span className="font-label text-[0.62rem] tracking-[0.1em] uppercase opacity-50">
          {statusLabel}
          {entry.placement !== null ? ` · ${entry.placement}` : ''} ·{' '}
          {formatDate(entry.createdAt, 'en') ?? ''}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 font-mono text-[0.75rem] sm:grid-cols-2">
        <div>
          <dt className={LABEL}>{a.colEntryTitle}</dt>
          <dd className="mt-1 break-all">
            <a href={entry.videoUrl} target="_blank" rel="noopener noreferrer" className="text-accent">
              {entry.videoUrl}
            </a>
          </dd>
        </div>
        <div>
          <dt className={LABEL}>{a.colEntrySns}</dt>
          <dd className="mt-1 break-all">
            <a href={entry.snsUrl} target="_blank" rel="noopener noreferrer" className="text-accent">
              {entry.snsUrl}
            </a>
          </dd>
        </div>
      </dl>

      {entry.note && (
        <div className="mt-3">
          <span className={LABEL}>{a.colEntryNote}</span>
          <p className="mt-1 max-w-detail text-[0.85rem] opacity-75">{entry.note}</p>
        </div>
      )}

      {entry.rejectReason && (
        <p className="mt-2 font-mono text-[0.72rem] opacity-55">
          {a.rejectReason}: {entry.rejectReason}
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="flex flex-wrap items-end gap-2">
          {entry.status !== 'approved' && (
            <OpForm op="contestEntry.approve" back={ADMIN_CONTESTS_PATH}>
              <input type="hidden" name="id" value={entry.id} />
              {/* The stale-review token (§14.2 / M9 review): if the entrant replaces the film
                  between this render and the press, the guarded UPDATE matches nothing and the
                  moderator is told to watch the new one rather than blessing it unseen. */}
              <input type="hidden" name="version" value={entry.version} />
              <button type="submit" className={BUTTON_PRIMARY}>
                {a.approveEntry}
              </button>
            </OpForm>
          )}
          <PlacementControl entry={entry} closed={closed} dict={dict} />
        </div>

        {entry.status !== 'rejected' && (
          <OpForm op="contestEntry.reject" back={ADMIN_CONTESTS_PATH} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={entry.id} />
            <input type="hidden" name="version" value={entry.version} />
            <Field label={a.rejectReason} hint={a.entryRejectHint}>
              <textarea name="reason" rows={2} required minLength={3} className={INPUT} />
            </Field>
            <div>
              <button type="submit" className={BUTTON}>
                {a.rejectEntry}
              </button>
            </div>
          </OpForm>
        )}
      </div>
    </li>
  );
}

function ContestEditor({
  row,
  entries,
  locale,
  dict,
  now,
}: {
  row: ContestRow;
  entries: EntryRow[];
  locale: string;
  dict: Dict;
  now: number;
}) {
  const a = dict.admin;
  const phase = contestPhase(row, now);
  const timing = contestTiming(row, now);
  const blockers = publishBlockers(row);
  const phaseWord =
    phase === 'open' ? a.contestPhaseOpen : phase === 'upcoming' ? a.contestPhaseUpcoming : a.contestPhaseClosed;

  return (
    <Panel
      title={`${row.slug} · ${contestStatusLabel(a, row.status)}`}
      action={
        <span className="font-label text-[0.62rem] tracking-[0.1em] uppercase opacity-55">
          {a.contestPhaseLabel}: {phaseWord}
          {timing.dDay ? ` · ${timing.dDay}` : ''}
        </span>
      }
    >
      <div data-admin-contest={row.slug} className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <a href={adminContestPreviewPath(row.slug)} className={BUTTON}>
            {a.previewContest}
          </a>
          {row.status === 'published' && (
            <PublicLink href={contestHref(locale, row.slug)} className={BUTTON}>
              {a.open}
            </PublicLink>
          )}
          {row.status !== 'published' ? (
            <OpForm op="contest.publish" back={ADMIN_CONTESTS_PATH}>
              <input type="hidden" name="id" value={row.id} />
              <button type="submit" className={BUTTON_PRIMARY} disabled={blockers.length > 0}>
                {a.publishContest}
              </button>
            </OpForm>
          ) : (
            <OpForm op="contest.unpublish" back={ADMIN_CONTESTS_PATH}>
              <input type="hidden" name="id" value={row.id} />
              <button type="submit" className={BUTTON}>
                {a.unpublishContest}
              </button>
            </OpForm>
          )}
          <OpForm op="contest.archive" back={ADMIN_CONTESTS_PATH}>
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="archived" value={row.status === 'archived' ? 'false' : 'true'} />
            <button type="submit" className={BUTTON}>
              {row.status === 'archived' ? a.unarchive : a.archive}
            </button>
          </OpForm>
        </div>

        {/* The publish gate, stated before it is pressed. `publishBlockers` is the same function
            the operation calls, so this line cannot promise something the server then refuses. */}
        <p
          data-publish-readiness={blockers.length === 0 ? 'ready' : 'blocked'}
          className="font-mono text-[0.75rem] opacity-60"
        >
          {blockers.length === 0
            ? a.contestReady
            : interpolate(a.contestNotReady, {
                missing: blockers.map((blocker) => blockerLabel(a, blocker)).join(', '),
              })}
        </p>
        <p className="font-mono text-[0.72rem] opacity-45">{a.publishContestHint}</p>

        <StagedMedia row={row} dict={dict} />

        <OpForm op="contest.update" back={ADMIN_CONTESTS_PATH} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={row.id} />
          <ContestFields row={row} dict={dict} />
          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.saveContest}
            </button>
          </div>
        </OpForm>

        <section className="border-t border-hairline pt-5">
          <h3 className="font-label text-eyebrow uppercase">
            {a.entriesHeading} ({entries.length})
          </h3>
          {entries.length === 0 ? (
            <p className="mt-3 font-mono text-code opacity-60">{a.entriesEmpty}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {entries.map((entry) => (
                <EntryRowView
                  key={entry.id}
                  entry={entry}
                  closed={phase === 'closed'}
                  dict={dict}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Panel>
  );
}

export default async function AdminContestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [locale, params, sql] = await Promise.all([
    getLocaleFromHeaders(),
    searchParams,
    getSqlRunner(),
  ]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const now = Date.now();

  const rows: ContestRow[] = sql === null ? [] : await loadAllContests(sql);
  const entriesByContest = new Map<string, EntryRow[]>();
  if (sql !== null) {
    for (const row of rows) {
      entriesByContest.set(row.id, await loadEntriesForModeration(sql, row.id));
    }
  }

  return (
    <AdminShell dict={a} locale={locale} active="contests">
      <p className="text-accent font-label text-eyebrow uppercase">{a.navContests}</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">
        {a.contestsHeading}
      </h1>
      <p className="mt-3 max-w-detail text-body opacity-60">{a.contestsLede}</p>

      <OutcomeBanner
        dict={a}
        {...(one(params, 'ok') ? { ok: one(params, 'ok')! } : {})}
        {...(one(params, 'err') ? { err: one(params, 'err')! } : {})}
        {...(one(params, 'detail') ? { detail: one(params, 'detail')! } : {})}
      />

      {rows.length === 0 ? (
        <Panel title={a.contestListHeading}>
          <p className="font-mono text-code opacity-60">{a.contestListEmpty}</p>
        </Panel>
      ) : (
        rows.map((row) => {
          const entries = entriesByContest.get(row.id) ?? [];
          const pending = entries.filter((entry) => entry.status === 'pending').length;
          // Folded by default (2026-09-03): the page was one full editor per contest, stacked —
          // the scroll the prompts board was rebuilt to remove. A contest with entries waiting
          // opens itself; the rest open on a click.
          return (
            <details
              key={row.id}
              open={pending > 0}
              data-contest-fold={row.slug}
              className="mt-6 border border-hairline"
            >
              <summary className="cursor-pointer px-4 py-3 font-label text-eyebrow uppercase">
                {row.slug} · {contestStatusLabel(a, row.status)}
                {pending > 0 && (
                  <span className="text-accent"> · {interpolate(a.contestFoldPending, { count: String(pending) })}</span>
                )}
              </summary>
              <div className="px-4 pb-4">
                <ContestEditor row={row} entries={entries} locale={locale} dict={dict} now={now} />
              </div>
            </details>
          );
        })
      )}

      <Panel title={a.newContestHeading}>
        <p className="mb-4 max-w-detail font-mono text-[0.75rem] opacity-55">{a.newContestLede}</p>
        <OpForm op="contest.create" back={ADMIN_CONTESTS_PATH} className="flex flex-col gap-4">
          <ContestFields row={null} dict={dict} />
          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.createContest}
            </button>
          </div>
        </OpForm>
      </Panel>
    </AdminShell>
  );
}

/** Contest rows use the same three words as playbooks (draft / published / archived), from the dictionary. */
function contestStatusLabel(a: Dictionary['admin'], status: string): string {
  return status === 'published' ? a.statusPublished : status === 'archived' ? a.statusArchived : a.statusDraft;
}
