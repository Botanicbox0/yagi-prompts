import { PublicLink } from '@/components/admin/public-link';
import { notFound } from 'next/navigation';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { localize } from '@/lib/i18n/format';
import { loadEditor } from '@/lib/admin/repo';
import { BLOCK_KINDS, type BlockKind } from '@/lib/content/schemas';
import { AdminShell, BUTTON, OutcomeBanner } from '@/components/admin/chrome';
import {
  HeroPanel,
  MetadataForm,
  PreviewPanel,
  PublishPanel,
  RevisionBanner,
  VisibilityTable,
} from '@/components/admin/editor-panels';
import { StepEditor } from '@/components/admin/step-editor';

/**
 * `/admin/p/[id]` — the v1 editor (§3.8), deliberately minimal and deliberately JS-free.
 *
 * The editor always targets the DRAFT revision, because that is the only thing the database will
 * let anyone write to (§6 triggers). A playbook with no draft shows the banner and one button —
 * "Edit published playbook" — which clones the live revision. That asymmetry is the revision model
 * made visible, not a missing feature.
 *
 * `?add={stepId}&kind={kind}` is how the block kind picker works without a line of client script:
 * a GET form re-renders this page with the right type-specific add form open.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function AdminEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, query, locale, sql] = await Promise.all([
    params,
    searchParams,
    getLocaleFromHeaders(),
    getSqlRunner(),
  ]);
  if (sql === null) notFound();

  const editor = await loadEditor(sql, id);
  if (editor === null) notFound();

  const dict = getDictionary(locale);
  const a = dict.admin;

  const addForStep = one(query, 'add') ?? null;
  const rawKind = one(query, 'kind');
  const addKind: BlockKind | null =
    rawKind !== undefined && (BLOCK_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as BlockKind)
      : null;

  // Every form returns HERE, keeping the open add-form and losing only the previous banner.
  const back =
    addForStep && addKind
      ? `/admin/p/${id}?add=${addForStep}&kind=${addKind}`
      : `/admin/p/${id}`;

  const title = editor.draft ? localize(editor.draft.title, locale) : editor.playbook.slug;

  return (
    <AdminShell dict={a} locale={locale} active="playbooks">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a href="/admin/playbooks" className="font-label text-eyebrow uppercase text-accent">
          ← {a.editorBack}
        </a>
        <PublicLink href={`/${locale}/p/${editor.playbook.slug}`} className={BUTTON}>
          {a.navSite}
        </PublicLink>
      </div>

      <h1 className="mt-4 font-display text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[0.95] font-black uppercase">
        {title || editor.playbook.slug}
      </h1>
      <p className="mt-2 font-mono text-code opacity-60">
        {editor.playbook.slug} · {editor.playbook.status === 'published' ? a.statusPublished : editor.playbook.status === 'archived' ? a.statusArchived : a.statusDraft}
      </p>

      <OutcomeBanner
        dict={a}
        {...(one(query, 'ok') ? { ok: one(query, 'ok')! } : {})}
        {...(one(query, 'err') ? { err: one(query, 'err')! } : {})}
        {...(one(query, 'detail') ? { detail: one(query, 'detail')! } : {})}
      />

      <RevisionBanner dict={dict} editor={editor} locale={locale} back={back} />

      {editor.draft !== null && (
        <>
          <MetadataForm dict={dict} editor={editor} revision={editor.draft} back={back} />
          <HeroPanel dict={dict} revision={editor.draft} back={back} />
          <StepEditor
            dict={dict}
            revision={editor.draft}
            policy={editor.policy}
            back={back}
            addForStep={addForStep}
            addKind={addKind}
          />
          <VisibilityTable
            dict={dict}
            revision={editor.draft}
            policy={editor.policy}
            locale={locale}
            back={back}
          />
          <PreviewPanel
            dict={a}
            playbookId={editor.playbook.id}
            hasSteps={editor.draft.steps.length > 0}
          />
          <PublishPanel dict={a} editor={editor} revision={editor.draft} back={back} />
        </>
      )}
    </AdminShell>
  );
}
