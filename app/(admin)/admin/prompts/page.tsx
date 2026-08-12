import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n/format';
import { loadAllPrompts, type PromptRow } from '@/lib/prompts/repo';
import { promptAdminRef } from '@/lib/media/admin-authorize';
import { adminMediaPath } from '@/lib/media/admin-authorize';
import {
  DEFAULT_PROMPT_MODEL,
  USE_CASES,
  parsePromptMedia,
  slugify,
} from '@/lib/prompts/schemas';
import { ADMIN_PROMPTS_PATH } from '@/lib/prompts/links';
import { VISIBILITY_ORDER } from '@/lib/content/visibility';
import {
  AdminShell,
  BUTTON,
  BUTTON_PRIMARY,
  Field,
  INPUT,
  LABEL,
  OpForm,
  OutcomeBanner,
  Panel,
} from '@/components/admin/chrome';
import { useCaseLabel } from '@/components/prompts/labels';

/**
 * `/admin/prompts` — PLAN §13.2/F: the moderation queue and YAGI authoring, in one screen.
 *
 * Same doctrine as the rest of the CMS (§3.8/§4): a dense utilitarian tool, every control a plain
 * `<form>` posting to the ONE guarded server action, and no client JavaScript anywhere. The
 * operations themselves live in `lib/admin/prompt-operations.ts` inside the same registry every
 * other admin mutation is in, which is what makes `tests/admin/auth.test.ts` cover them without
 * being told they exist.
 *
 * Order is the working order: what needs a decision, then what is live, then the authoring form,
 * then the rejections (kept visible — a rejection the moderator cannot review is a black hole).
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

type Dict = ReturnType<typeof getDictionary>;

function UseCaseChecks({
  dict,
  selected,
}: {
  dict: Dict;
  selected: readonly string[];
}) {
  const set = new Set(selected);
  return (
    <div className="flex flex-wrap gap-2">
      {USE_CASES.map((value) => (
        <label
          key={value}
          className="flex items-center gap-1.5 border border-hairline px-2 py-1 font-label text-[0.62rem] tracking-[0.1em] uppercase"
        >
          <input
            type="checkbox"
            name="useCase"
            value={value}
            defaultChecked={set.has(value)}
            className="h-3 w-3"
            style={{ accentColor: 'var(--accent)' }}
          />
          {useCaseLabel(dict, value)}
        </label>
      ))}
    </div>
  );
}

/** Staged (unpublished) media, playable — the whole point of a moderation queue. */
function StagedMedia({ row, dict }: { row: PromptRow; dict: Dict }) {
  const media = parsePromptMedia(row.media);
  const a = dict.admin;
  if (!media.poster && !media.video) {
    return <p className="font-mono text-[0.72rem] opacity-50">{a.noMedia}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>{a.previewMedia}</span>
      {media.video && (
        <video
          src={adminMediaPath(promptAdminRef(row.id, 'video'))}
          controls
          muted
          playsInline
          preload="metadata"
          className="w-full max-w-sm border border-hairline"
          {...(media.poster
            ? { poster: adminMediaPath(promptAdminRef(row.id, 'poster')) }
            : {})}
        />
      )}
      {!media.video && media.poster && (
        // eslint-disable-next-line @next/next/no-img-element -- staging object behind the admin gate
        <img
          src={adminMediaPath(promptAdminRef(row.id, 'poster'))}
          alt=""
          className="w-full max-w-sm border border-hairline"
        />
      )}
    </div>
  );
}

function QueueItem({ row, dict }: { row: PromptRow; dict: Dict }) {
  const a = dict.admin;
  return (
    <li data-prompt-queue={row.slug} className="border border-hairline p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-mono text-code">{row.title}</span>
        <span className="font-label text-[0.62rem] tracking-[0.1em] uppercase opacity-50">
          {a.sourceCommunity} · {formatDate(row.createdAt, 'en') ?? ''}
        </span>
      </div>

      <pre className="mt-3 max-h-64 overflow-auto border border-hairline bg-transparent p-3 font-mono text-[0.75rem] whitespace-pre-wrap">
        {row.promptText}
      </pre>

      <div className="mt-4">
        <StagedMedia row={row} dict={dict} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <OpForm op="prompt.approve" back={ADMIN_PROMPTS_PATH} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={row.id} />
          <Field label={a.fieldPromptSlug}>
            <input
              type="text"
              name="slug"
              defaultValue={row.slug || slugify(row.title, `prompt-${row.id.slice(0, 8)}`)}
              className={INPUT}
            />
          </Field>
          <Field label={a.fieldPromptHandle}>
            <input type="text" name="handle" defaultValue={row.authorHandle ?? ''} className={INPUT} />
          </Field>
          <div>
            <span className={LABEL}>{a.colUseCase}</span>
            <div className="mt-1.5">
              <UseCaseChecks dict={dict} selected={row.useCase} />
            </div>
          </div>
          <label className="flex items-center gap-2 font-label text-eyebrow uppercase">
            <input type="checkbox" name="featured" className="h-3.5 w-3.5" style={{ accentColor: 'var(--accent)' }} />
            {a.fieldPromptFeatured}
          </label>
          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.approve}
            </button>
          </div>
        </OpForm>

        <OpForm op="prompt.reject" back={ADMIN_PROMPTS_PATH} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={row.id} />
          <Field label={a.rejectReason} hint={a.rejectReasonHint}>
            <textarea name="reason" rows={4} className={INPUT} />
          </Field>
          <div>
            <button type="submit" className={BUTTON}>
              {a.rejectLabel}
            </button>
          </div>
        </OpForm>
      </div>
    </li>
  );
}

function PublishedItem({ row, dict }: { row: PromptRow; dict: Dict }) {
  const a = dict.admin;
  return (
    <li data-prompt-published={row.slug} className="border border-hairline p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-mono text-code">{row.title}</span>
        <span className="font-label text-[0.62rem] tracking-[0.1em] uppercase opacity-50">
          {row.source === 'yagi' ? a.sourceYagi : a.sourceCommunity} · {row.textVisibility}
          {row.featured ? ' · ★' : ''}
        </span>
      </div>

      <OpForm op="prompt.update" back={ADMIN_PROMPTS_PATH} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="id" value={row.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={a.fieldPromptTitle}>
            <input type="text" name="title" defaultValue={row.title} className={INPUT} />
          </Field>
          <Field label={a.fieldPromptTitleKo}>
            <input type="text" name="titleKo" defaultValue={row.titleKo ?? ''} className={INPUT} />
          </Field>
          <Field label={a.fieldPromptSlug}>
            <input type="text" name="slug" defaultValue={row.slug} className={INPUT} />
          </Field>
          <Field label={a.fieldPromptHandle}>
            <input type="text" name="handle" defaultValue={row.authorHandle ?? ''} className={INPUT} />
          </Field>
        </div>

        <Field label={a.fieldPromptBody}>
          <textarea name="promptText" rows={6} defaultValue={row.promptText} className={INPUT} />
        </Field>

        <div>
          <span className={LABEL}>{a.colUseCase}</span>
          <div className="mt-1.5">
            <UseCaseChecks dict={dict} selected={row.useCase} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={a.fieldPromptVisibility} hint={a.promptVisibilityHint}>
            <select name="textVisibility" defaultValue={row.textVisibility} className={INPUT}>
              {VISIBILITY_ORDER.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 font-label text-eyebrow uppercase">
              <input
                type="checkbox"
                name="featured"
                defaultChecked={row.featured}
                className="h-3.5 w-3.5"
                style={{ accentColor: 'var(--accent)' }}
              />
              {a.fieldPromptFeatured}
            </label>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={a.fieldPromptPoster} hint={a.promptMediaHint}>
            <input type="file" name="poster" accept="image/*" className={INPUT} />
          </Field>
          <Field label={a.fieldPromptVideo}>
            <input type="file" name="video" accept="video/*" className={INPUT} />
          </Field>
        </div>

        <div>
          <button type="submit" className={BUTTON_PRIMARY}>
            {a.saveEdits}
          </button>
        </div>
      </OpForm>

      <div className="mt-3 flex flex-wrap gap-2">
        <OpForm op="prompt.feature" back={ADMIN_PROMPTS_PATH}>
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="featured" value={row.featured ? 'false' : 'true'} />
          <button type="submit" className={BUTTON}>
            {row.featured ? a.unfeature : a.feature}
          </button>
        </OpForm>
        <OpForm op="prompt.archive" back={ADMIN_PROMPTS_PATH}>
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="archived" value={row.status === 'archived' ? 'false' : 'true'} />
          <button type="submit" className={BUTTON}>
            {row.status === 'archived' ? a.unarchive : a.archive}
          </button>
        </OpForm>
      </div>
    </li>
  );
}

export default async function AdminPromptsPage({
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
  const rows: PromptRow[] = sql === null ? [] : await loadAllPrompts(sql);

  const pending = rows.filter((row) => row.status === 'pending');
  const live = rows.filter((row) => row.status === 'published' || row.status === 'archived');
  const rejected = rows.filter((row) => row.status === 'rejected');

  return (
    <AdminShell dict={a} locale={locale} active="prompts">
      <p className="text-accent font-label text-eyebrow uppercase">{a.navPrompts}</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">
        {a.promptsHeading}
      </h1>
      <p className="mt-3 max-w-detail text-body opacity-60">{a.promptsLede}</p>

      <OutcomeBanner
        dict={a}
        {...(one(params, 'ok') ? { ok: one(params, 'ok')! } : {})}
        {...(one(params, 'err') ? { err: one(params, 'err')! } : {})}
        {...(one(params, 'detail') ? { detail: one(params, 'detail')! } : {})}
      />

      <Panel title={`${a.queueHeading} (${pending.length})`}>
        {pending.length === 0 ? (
          <p className="font-mono text-code opacity-60">{a.queueEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-5">
            {pending.map((row) => (
              <QueueItem key={row.id} row={row} dict={dict} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`${a.publishedHeading} (${live.length})`}>
        {live.length === 0 ? (
          <p className="font-mono text-code opacity-60">{a.publishedEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-5">
            {live.map((row) => (
              <PublishedItem key={row.id} row={row} dict={dict} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={a.authorHeading}>
        <p className="mb-4 max-w-detail font-mono text-[0.75rem] opacity-55">{a.authorLede}</p>
        <OpForm op="prompt.create" back={ADMIN_PROMPTS_PATH} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={a.fieldPromptTitle}>
              <input type="text" name="title" className={INPUT} />
            </Field>
            <Field label={a.fieldPromptTitleKo}>
              <input type="text" name="titleKo" className={INPUT} />
            </Field>
            <Field label={a.fieldPromptSlug}>
              <input type="text" name="slug" className={INPUT} />
            </Field>
            <Field label={a.fieldItemModel}>
              <input type="text" name="model" defaultValue={DEFAULT_PROMPT_MODEL} className={INPUT} />
            </Field>
          </div>

          <Field label={a.fieldPromptBody}>
            <textarea name="promptText" rows={8} className={INPUT} />
          </Field>

          <div>
            <span className={LABEL}>{a.colUseCase}</span>
            <div className="mt-1.5">
              <UseCaseChecks dict={dict} selected={[]} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={a.fieldPromptVisibility} hint={a.promptVisibilityHint}>
              {/* §13.3-2 — YAGI text defaults to `pro`; a public teaser is a deliberate choice. */}
              <select name="textVisibility" defaultValue="pro" className={INPUT}>
                {VISIBILITY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <label className="flex items-center gap-2 font-label text-eyebrow uppercase">
                <input
                  type="checkbox"
                  name="featured"
                  className="h-3.5 w-3.5"
                  style={{ accentColor: 'var(--accent)' }}
                />
                {a.fieldPromptFeatured}
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={a.fieldPromptPoster} hint={a.promptMediaHint}>
              <input type="file" name="poster" accept="image/*" className={INPUT} />
            </Field>
            <Field label={a.fieldPromptVideo}>
              <input type="file" name="video" accept="video/*" className={INPUT} />
            </Field>
          </div>

          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.publishPrompt}
            </button>
          </div>
        </OpForm>
      </Panel>

      {rejected.length > 0 && (
        <Panel title={`${a.rejectedHeading} (${rejected.length})`}>
          <ul className="flex flex-col gap-3">
            {rejected.map((row) => (
              <li key={row.id} data-prompt-rejected={row.slug} className="border border-hairline p-3">
                <span className="font-mono text-code">{row.title}</span>
                <p className="mt-1 font-mono text-[0.72rem] opacity-55">{row.rejectReason}</p>
                <OpForm op="prompt.approve" back={ADMIN_PROMPTS_PATH} className="mt-3">
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="slug" value={row.slug} />
                  <input type="hidden" name="handle" value={row.authorHandle ?? ''} />
                  {row.useCase.map((value) => (
                    <input key={value} type="hidden" name="useCase" value={value} />
                  ))}
                  <button type="submit" className={BUTTON}>
                    {a.approve}
                  </button>
                </OpForm>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </AdminShell>
  );
}
