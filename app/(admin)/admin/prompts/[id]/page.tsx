import { notFound } from 'next/navigation';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n/format';
import { loadPromptById, type PromptRow } from '@/lib/prompts/repo';
import { ADMIN_PROMPTS_PATH, adminPromptPath, promptHref } from '@/lib/prompts/links';
import { slugify } from '@/lib/prompts/schemas';
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
import { PromptFields, StagedMedia, UseCaseChecks } from '@/components/admin/prompt-fields';

/**
 * `/admin/prompts/{id}` — one prompt, everything you can do to it (2026-08-15).
 *
 * The board's cards link here, which is what let the board stop rendering an editor per row. What
 * lives on this page is decided by the row's STATUS, because a prompt's admin surface genuinely
 * differs by state and pretending otherwise is what made the old single screen unreadable:
 *
 *   · pending  → the submitted text, its staged media, and approve / reject side by side;
 *   · rejected → the reason, and a one-press re-approval (a rejection nobody can revisit is a hole);
 *   · anything else → the full editor plus the quick actions (visibility, feature, archive).
 *
 * `back` is THIS page for edits and quick actions — the founder is mid-edit and expects to still be
 * looking at the thing they edited — and the BOARD for the two acts that take the row out of this
 * screen's purpose (approve, reject).
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

type Dict = ReturnType<typeof getDictionary>;

function Header({ row, dict }: { row: PromptRow; dict: Dict }) {
  const a = dict.admin;
  return (
    <>
      <a href={ADMIN_PROMPTS_PATH} className="font-mono text-[0.72rem] opacity-60">
        ← {a.backToPrompts}
      </a>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[0.95] font-black uppercase">
            {row.titleKo || row.title}
          </h1>
          <p className="mt-2 font-mono text-[0.72rem] opacity-50">
            {a.statusLabels[row.status]} · {row.textVisibility} ·{' '}
            {row.source === 'yagi' ? a.sourceYagi : a.sourceCommunity} ·{' '}
            {formatDate(row.publishedAt ?? row.createdAt, 'en') ?? '—'}
          </p>
        </div>
        {row.status === 'published' && (
          <a href={promptHref('ko', row.slug)} className={BUTTON} rel="noreferrer">
            {a.viewLive}
          </a>
        )}
      </div>
    </>
  );
}

export default async function AdminPromptItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [locale, { id }, query, sql] = await Promise.all([
    getLocaleFromHeaders(),
    params,
    searchParams,
    getSqlRunner(),
  ]);
  const dict = getDictionary(locale);
  const a = dict.admin;

  const row = sql === null ? null : await loadPromptById(sql, id);
  if (row === null) notFound();

  const back = adminPromptPath(row.id);
  const banner = (
    <OutcomeBanner
      dict={a}
      {...(one(query, 'ok') ? { ok: one(query, 'ok')! } : {})}
      {...(one(query, 'err') ? { err: one(query, 'err')! } : {})}
      {...(one(query, 'detail') ? { detail: one(query, 'detail')! } : {})}
    />
  );

  if (row.status === 'pending') {
    return (
      <AdminShell dict={a} locale={locale} active="prompts">
        <Header row={row} dict={dict} />
        {banner}

        <Panel title={a.queueHeading}>
          <pre className="max-h-96 overflow-auto border border-hairline bg-transparent p-3 font-mono text-[0.75rem] whitespace-pre-wrap">
            {row.promptText}
          </pre>
          {row.sourceUrl && (
            <p className="mt-3 font-mono text-[0.72rem] opacity-60">{row.sourceUrl}</p>
          )}
          <div className="mt-4">
            <StagedMedia row={row} dict={dict} />
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
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
                <input
                  type="text"
                  name="handle"
                  defaultValue={row.authorHandle ?? ''}
                  className={INPUT}
                />
              </Field>
              <div>
                <span className={LABEL}>{a.colUseCase}</span>
                <div className="mt-1.5">
                  <UseCaseChecks dict={dict} selected={row.useCase} />
                </div>
              </div>
              <label className="flex items-center gap-2 font-label text-eyebrow uppercase">
                <input
                  type="checkbox"
                  name="featured"
                  className="h-3.5 w-3.5"
                  style={{ accentColor: 'var(--accent)' }}
                />
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
        </Panel>
      </AdminShell>
    );
  }

  if (row.status === 'rejected') {
    return (
      <AdminShell dict={a} locale={locale} active="prompts">
        <Header row={row} dict={dict} />
        {banner}

        <Panel title={a.rejectedHeading}>
          <p data-prompt-rejected={row.slug} className="font-mono text-[0.75rem] opacity-60">
            {row.rejectReason}
          </p>
          <pre className="mt-4 max-h-64 overflow-auto border border-hairline bg-transparent p-3 font-mono text-[0.75rem] whitespace-pre-wrap">
            {row.promptText}
          </pre>
          <OpForm op="prompt.approve" back={ADMIN_PROMPTS_PATH} className="mt-4">
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
        </Panel>
      </AdminShell>
    );
  }

  return (
    <AdminShell dict={a} locale={locale} active="prompts">
      <Header row={row} dict={dict} />
      {banner}

      <Panel title={a.publishedHeading}>
        <OpForm
          op="prompt.update"
          back={back}
          className="flex flex-col gap-4"
          data-prompt-published={row.slug}
        >
          <input type="hidden" name="id" value={row.id} />
          <PromptFields row={row} dict={dict} />
          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.saveEdits}
            </button>
          </div>
        </OpForm>

        <div className="mt-6 flex flex-wrap gap-2 border-t border-hairline pt-5">
          {/* Founder direction (2026-08-13): free presets are ONE press. YAGI rows only — a
              community row is always public, so a toggle there would be a control that lies. */}
          {row.source === 'yagi' && row.textVisibility !== 'hidden' && (
            <OpForm op="prompt.visibility" back={back}>
              <input type="hidden" name="id" value={row.id} />
              <input
                type="hidden"
                name="textVisibility"
                value={row.textVisibility === 'pro' ? 'public' : 'pro'}
              />
              <button type="submit" className={BUTTON} data-visibility-toggle={row.slug}>
                {row.textVisibility === 'pro' ? a.makePublic : a.makePro}
              </button>
            </OpForm>
          )}
          <OpForm op="prompt.feature" back={back}>
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="featured" value={row.featured ? 'false' : 'true'} />
            <button type="submit" className={BUTTON}>
              {row.featured ? a.unfeature : a.feature}
            </button>
          </OpForm>
          <OpForm op="prompt.archive" back={ADMIN_PROMPTS_PATH}>
            <input type="hidden" name="id" value={row.id} />
            <input
              type="hidden"
              name="archived"
              value={row.status === 'archived' ? 'false' : 'true'}
            />
            <button type="submit" className={BUTTON}>
              {row.status === 'archived' ? a.unarchive : a.archive}
            </button>
          </OpForm>
        </div>
      </Panel>
    </AdminShell>
  );
}
