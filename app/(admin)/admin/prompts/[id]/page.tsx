import { requireAdmin } from '@/lib/auth/viewer';
import { PublicLink } from '@/components/admin/public-link';
import { notFound } from 'next/navigation';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { loadPromptById, loadPromptLook, type PromptRow } from '@/lib/prompts/repo';
import { ADMIN_PROMPTS_PATH, adminPromptPath, promptHref } from '@/lib/prompts/links';
import { slugify } from '@/lib/prompts/schemas';
import {
  AdminShell,
  BUTTON,
  BUTTON_PRIMARY,
  Field,
  INPUT,
  LABEL,
  ConfirmCheck,
  OpForm,
  OutcomeBanner,
  Panel,
} from '@/components/admin/chrome';
import { AdminPageHeader, StatusPill, type AdminTone } from '@/components/admin/patterns';
import {
  LockBlockRefusalNote,
  PromptFields,
  stylingPartLabels,
  StagedMedia,
  TemplateSpecSummaryCard,
  UseCaseChecks,
} from '@/components/admin/prompt-fields';
import { visibilityLabel } from '@/components/admin/labels';
import { TemplateMarksEditor } from '@/components/admin/template-marks-editor';
import { adminMediaPath, promptAdminRef } from '@/lib/media/admin-authorize';
import { KEYFRAMES_MAX, loadPromptKeyframesBySlug, splitKeyframes } from '@/lib/prompts/keyframes';
import { parsePromptMedia } from '@/lib/prompts/schemas';
import { declaredPartKeysOfPrompt, partLabel } from '@/lib/template-director/parts-view';
import { templateCardStyling, templateCompileSource } from '@/lib/template-director/compile-prompts';
import { recipeSchemaReady } from '@/lib/recipes/repo';
import { TemplateStylingPanel } from '@/components/admin/template-styling-panel';
import { FormatRevisionPanel } from '@/components/admin/format-revision-panel';
import { loadFormatRevisionView } from '@/lib/creator-platform/format-revision';

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

const STATUS_TONE: Record<PromptRow['status'], AdminTone> = {
  pending: 'action',
  published: 'done',
  archived: 'hold',
  rejected: 'fail',
};

function Header({ row, dict, locale }: { row: PromptRow; dict: Dict; locale: string }) {
  const a = dict.admin;
  return (
    <AdminPageHeader
      back={{ href: ADMIN_PROMPTS_PATH, label: a.backToPrompts }}
      title={row.titleKo || row.title}
      status={<StatusPill tone={STATUS_TONE[row.status]}>{a.statusLabels[row.status]}</StatusPill>}
      lede={`${visibilityLabel(a, row.textVisibility)} · ${
        row.source === 'yagi' ? a.sourceYagi : a.sourceCommunity
      } · ${formatDate(row.publishedAt ?? row.createdAt, locale) ?? '—'}`}
      actions={
        row.status === 'published' ? (
          <PublicLink href={promptHref(locale, row.slug)} className={BUTTON} target="_blank" rel="noopener noreferrer">
            {a.viewLive}
          </PublicLink>
        ) : undefined
      }
    />
  );
}

export default async function AdminPromptItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  // The layout's check is not enough on its own: a client navigation request can ask for this page
  // segment alone, and then the layout does not run. Every admin page verifies the admin itself.
  await requireAdmin();
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
  // docs/PERSONAL-STUDIO.md §3.4.10 — the style select, once 0190 is applied (null without it: no select).
  const look = sql === null ? null : await loadPromptLook(sql, row.id);

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
        <Header row={row} dict={dict} locale={locale} />
        {banner}

        <Panel title={a.queueHeading}>
          <pre className="max-h-96 overflow-auto border border-hairline bg-transparent p-3 font-mono text-[0.75rem] whitespace-pre-wrap">
            {row.promptText}
          </pre>
          {row.sourceUrl && (
            <a
              href={row.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-accent mt-3 inline-block font-mono text-[0.72rem] break-all"
            >
              {row.sourceUrl} ↗
            </a>
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
                <textarea name="reason" rows={4} required minLength={3} className={INPUT} />
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
        <Header row={row} dict={dict} locale={locale} />
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

  // docs/PERSONAL-STUDIO.md §3.4.9 (S2): the prompts an order compiles (a recipe's result steps, else the main text)
  // and the styling they declare alike — what the catalogue card shows.
  const stylingSource = sql === null
    ? { recipe: null, recipeReady: false }
    : {
        recipe: (await sql.query<{ recipe: unknown }>("select to_jsonb(p.*)->'recipe' as recipe from prompt_items p where id = $1", [row.id])).rows[0]?.recipe ?? null,
        recipeReady: await recipeSchemaReady(sql),
      };
  const cardStyling = templateCardStyling({ promptText: row.promptText, ...stylingSource, cast: row.cast });
  // docs/CREATOR-PLATFORM.md (2026-11-25): the audited recipe text revision — only for an accepted format the studio's
  // own company-payout account owns (null for every other template, a creative's format included).
  const revisionView = sql === null || row.audience === 'brand' ? null : await loadFormatRevisionView(sql, row.id);

  // docs/PERSONAL-STUDIO.md §3.4.4 (T1a): a film whose saved prompt declares parts gets the marks editor (a short
  // description and an example-video range per part, `prompt.marks`) under the editor, with the same lock line.
  const declared = row.medium === 'video' ? declaredPartKeysOfPrompt(row.promptText, cardStyling) : [];
  const markParts = declared.flatMap((key) => {
    const label = partLabel(key, dict.editSheet);
    return label === null ? [] : [{ key, label }];
  });
  // The lock line names the locked parts only; the styled and photo parts have their own line (§3.4.9).
  const lockedKeys = declaredPartKeysOfPrompt(row.promptText, null);
  const lockedMarkParts = markParts.filter((part) => lockedKeys.includes(part.key));
  const stored = markParts.length > 0 && sql !== null ? splitKeyframes((await loadPromptKeyframesBySlug(sql, row.slug)) ?? []) : null;
  const marksEditor =
    stored === null ? null : (
      <section data-template-marks-panel className="mt-4 flex flex-col gap-3">
        {lockedMarkParts.length > 0 && (
          <p data-template-marks-locks className="font-mono text-[0.72rem] opacity-70">
            {interpolate(a.templateLocksLine, { parts: lockedMarkParts.map((part) => part.label).join(' · ') })}
          </p>
        )}
        {cardStyling && (
          <p data-template-marks-styling className="font-mono text-[0.72rem] opacity-70">
            {interpolate(a.templateStylingLine, { parts: stylingPartLabels(cardStyling, dict).join(' · ') })}
          </p>
        )}
        <TemplateMarksEditor
          op="prompt.marks"
          promptId={row.id}
          back={back}
          durationSeconds={row.runtimeSeconds ?? 10}
          videoSrc={parsePromptMedia(row.media).video ? adminMediaPath(promptAdminRef(row.id, 'video')) : null}
          parts={markParts}
          initialMarks={stored.marks.filter((mark) => declared.includes(mark.part))}
          maxMarks={KEYFRAMES_MAX - stored.beats.length}
          copy={a.templateMarks}
          locale={locale}
        />
      </section>
    );

  return (
    <AdminShell dict={a} locale={locale} active="prompts">
      <Header row={row} dict={dict} locale={locale} />
      {banner}
      {/* docs/PERSONAL-STUDIO.md §3.3 (C3): a save refused for its lock block, in sentences. */}
      {one(query, 'err') === 'invalid' && <LockBlockRefusalNote detail={one(query, 'detail')} dict={dict} />}

      <TemplateSpecSummaryCard row={row} dict={dict} />

    {/* Quick actions FIRST (2026-09-03): they were the last thing on the page, under a
        12-row textarea and two 10-row ones. Feature / open / archive are one press each. */}
    <div data-quick-actions className="mt-4 flex flex-wrap items-center gap-2">
      <span className="mr-2 font-label text-[0.62rem] tracking-[0.1em] uppercase opacity-50">{a.quickActions}</span>
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

      {/* The weekly drop's mail (2026-09-13): one press, one time, everyone with the switch on. */}
      {row.status === 'published' && (
        <Panel title={a.announceTemplate}>
          <p className="font-mono text-[0.75rem] opacity-55">{a.announceHint}</p>
          {row.announcedAt ? (
            <p data-announced className="mt-3 font-mono text-code">
              {interpolate(a.announcedAt, { date: formatDate(row.announcedAt, locale) ?? '' })}
            </p>
          ) : (
            <OpForm op="prompt.announce" back={back} className="mt-3 flex flex-col items-start gap-2">
              <input type="hidden" name="id" value={row.id} />
              <ConfirmCheck label={a.confirmAnnounce} />
              <button type="submit" className={BUTTON_PRIMARY} data-announce={row.slug}>
                {a.announceTemplate}
              </button>
            </OpForm>
          )}
        </Panel>
      )}

      <Panel title={row.status === 'archived' ? a.statusLabels.archived : a.publishedHeading}>
        <OpForm
          op="prompt.update"
          back={back}
          className="flex flex-col gap-4"
          data-prompt-published={row.slug}
        >
          <input type="hidden" name="id" value={row.id} />
          {/* §3.4.9, rule 3: a recipe template's styling is declared in its steps (the panel below), not in this text. */}
          <PromptFields
            row={row}
            dict={dict}
            {...(look !== null ? { look } : {})}
            recipeTemplate={templateCompileSource({ promptText: row.promptText, ...stylingSource }).kind === 'recipe'}
          />

          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.saveEdits}
            </button>
          </div>
        </OpForm>
        {marksEditor}
      </Panel>

      {row.audience !== 'brand' && <TemplateStylingPanel op="prompt.declareStyling" row={row} source={stylingSource} dict={dict} back={back} />}
      {revisionView && (
        <FormatRevisionPanel
          op="format.reviseRecipe"
          templateId={row.id}
          view={revisionView}
          dict={dict}
          locale={locale}
          back={back}
          detail={one(query, 'err') ? one(query, 'detail') : null}
        />
      )}
    </AdminShell>
  );
}
