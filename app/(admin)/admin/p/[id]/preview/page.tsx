import { notFound } from 'next/navigation';
import { getShapedPlaybook } from '@/lib/content/facade';
import type { Tier } from '@/lib/content/visibility';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { findDraftRevisionId } from '@/lib/admin/repo';
import { DetailHeader, StepTimeline } from '@/components/playbook/detail';
import { StepChips, StepIndex } from '@/components/playbook/step-index';
import { playbookLabels } from '@/components/playbook/labels';
import { AdminShell, BUTTON, Panel } from '@/components/admin/chrome';
import { categoryLabel, difficultyLabel } from '@/components/admin/labels';

/**
 * `/admin/p/[id]/preview?tier=visitor|free|pro` — §3.8 "Preview-as: render any revision as
 * visitor/free/pro via the same shaping path with an admin-verified `previewTier`".
 *
 * The point is that this is NOT a second renderer. It calls `getShapedPlaybook(slug, {revisionId,
 * previewTier})` — the one gate — and hands the result to the same `DetailHeader` / `StepTimeline`
 * / `StepIndex` the public page uses. If the lock panel is wrong here, it is wrong there.
 *
 * `is_admin` is verified inside the façade, not here: a non-admin passing `revisionId`/`previewTier`
 * gets `not_found`, never a silent downgrade to the public path (lib/content/playbook-access.ts).
 * Media resolves through `/api/admin/media/*`, because a draft's bytes have never been published
 * and the public gateway refuses them by design.
 */
export const dynamic = 'force-dynamic';

const TIERS: Record<string, Tier> = { visitor: 'anon', free: 'free', pro: 'pro' };

export default async function AdminPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query, locale, sql] = await Promise.all([
    params,
    searchParams,
    getLocaleFromHeaders(),
    getSqlRunner(),
  ]);
  if (sql === null) notFound();

  const requested = typeof query.tier === 'string' ? query.tier : 'visitor';
  const tierKey = requested in TIERS ? requested : 'visitor';
  const previewTier = TIERS[tierKey]!;

  const { rows } = await sql.query<{ slug: string }>('select slug from playbooks where id = $1', [
    id,
  ]);
  const slug = rows[0]?.slug;
  if (!slug) notFound();

  const revisionId = await findDraftRevisionId(sql, id);
  if (revisionId === null) notFound();

  const result = await getShapedPlaybook(slug, { revisionId, previewTier });
  if (result.status !== 'ok') notFound();

  const dict = getDictionary(locale);
  const a = dict.admin;
  const labels = playbookLabels(dict);
  const { playbook } = result;

  const tabs: Array<[string, string]> = [
    ['visitor', a.previewVisitor],
    ['free', a.previewFree],
    ['pro', a.previewPro],
  ];

  return (
    <AdminShell dict={a} locale={locale} active="playbooks">
      <Panel title={a.previewHeading}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {tabs.map(([key, label]) => (
              <a
                key={key}
                href={`/admin/p/${id}/preview?tier=${key}`}
                data-preview-tier={key}
                aria-current={key === tierKey ? 'page' : undefined}
                className={
                  key === tierKey ? `${BUTTON} border-accent text-accent` : BUTTON
                }
              >
                {label}
              </a>
            ))}
          </div>
          <a href={`/admin/p/${id}`} className={BUTTON}>
            ← {a.previewBack}
          </a>
        </div>
        <p className="mt-3 max-w-detail font-mono text-[0.72rem] opacity-50">
          {a.previewApproximation}
        </p>
        <p
          className="mt-1 font-mono text-[0.72rem] opacity-50"
          data-preview-locked={playbook.lockedCount}
        >
          {playbook.lockedCount} / {playbook.steps.reduce((n, step) => n + step.blocks.length, 0)}
        </p>
      </Panel>

      <div data-preview-surface data-tier={playbook.tier} className="mt-8 border border-hairline p-5">
        <div className="detail relative">
          <div className="detail__index">
            <div className="hidden lg:block">
              <StepIndex steps={playbook.steps} locale={locale} labels={labels} />
            </div>
          </div>
          <div className="detail__body">
            <DetailHeader
              playbook={playbook}
              locale={locale}
              labels={labels}
              categoryLabel={categoryLabel(dict, playbook.category)}
              difficultyLabel={difficultyLabel(dict, playbook.difficulty)}
            />
            <div className="mt-10">
              <StepChips steps={playbook.steps} locale={locale} labels={labels} />
            </div>
            <StepTimeline
              steps={playbook.steps}
              locale={locale}
              labels={labels}
              tier={playbook.tier}
            />
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
