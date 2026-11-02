import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import { loadAdminList, type AdminListRow } from '@/lib/admin/repo';
import {
  AdminShell,
  BUTTON,
  BUTTON_PRIMARY,
  Field,
  INPUT,
  LocalePair,
  OpForm,
  OutcomeBanner,
  Panel,
} from '@/components/admin/chrome';
import { CATEGORIES, categoryLabel } from '@/components/admin/labels';

/**
 * `/admin` — the playbook list (§3.8).
 *
 * Columns are the ones the plan names: title, slug, status, category, showcase (from BOTH the
 * published and the draft revision, because `is_showcase` is revisioned), updated, and the
 * has-draft-revision indicator. "Refresh caches" lives in the shell; "New playbook" is below the
 * table and creates the playbook plus its rev-1 draft in one action.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function AdminListPage({
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
  const rows: AdminListRow[] = sql === null ? [] : await loadAdminList(sql);

  const statusLabel = (status: AdminListRow['status']) =>
    status === 'published' ? a.statusPublished : status === 'archived' ? a.statusArchived : a.statusDraft;

  return (
    <AdminShell dict={a} locale={locale} active="playbooks">
      <p className="text-accent font-label text-eyebrow uppercase">{a.navPlaybooks}</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">
        {a.listHeading}
      </h1>
      <p className="mt-3 max-w-detail text-body opacity-60">{a.listLede}</p>

      <OutcomeBanner
        dict={a}
        {...(one(params, 'ok') ? { ok: one(params, 'ok')! } : {})}
        {...(one(params, 'err') ? { err: one(params, 'err')! } : {})}
        {...(one(params, 'detail') ? { detail: one(params, 'detail')! } : {})}
      />

      <Panel title={a.listHeading}>
        {rows.length === 0 ? (
          <p className="font-mono text-code opacity-60">{a.listEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] border-collapse text-left">
              <thead>
                <tr className="font-label text-[0.68rem] uppercase tracking-[0.12em] opacity-50">
                  <th className="border-b border-hairline py-2 pr-4">{a.colTitle}</th>
                  <th className="border-b border-hairline py-2 pr-4">{a.colSlug}</th>
                  <th className="border-b border-hairline py-2 pr-4">{a.colStatus}</th>
                  <th className="border-b border-hairline py-2 pr-4">{a.colCategory}</th>
                  <th className="border-b border-hairline py-2 pr-4">{a.colShowcase}</th>
                  <th className="border-b border-hairline py-2 pr-4">{a.colDraft}</th>
                  <th className="border-b border-hairline py-2 pr-4">{a.colUpdated}</th>
                  <th className="border-b border-hairline py-2" />
                </tr>
              </thead>
              <tbody className="font-mono text-code">
                {rows.map((row) => (
                  <tr key={row.id} data-playbook={row.slug} className="align-top">
                    <td className="border-b border-hairline py-2.5 pr-4">
                      <a href={`/admin/p/${row.id}`} className="text-accent">
                        {row.title ? localize(row.title, locale) : row.slug}
                      </a>
                    </td>
                    <td className="border-b border-hairline py-2.5 pr-4 opacity-70">{row.slug}</td>
                    <td className="border-b border-hairline py-2.5 pr-4" data-status={row.status}>
                      {statusLabel(row.status)}
                    </td>
                    <td className="border-b border-hairline py-2.5 pr-4 opacity-70">
                      {categoryLabel(dict, row.category)}
                    </td>
                    <td className="border-b border-hairline py-2.5 pr-4 opacity-70">
                      {row.publishedShowcase ? `${a.showcaseLive}` : ''}
                      {row.publishedShowcase && row.draftShowcase ? ' · ' : ''}
                      {row.draftRevisionId && row.draftShowcase ? `${a.showcaseNext}` : ''}
                      {!row.publishedShowcase && !(row.draftRevisionId && row.draftShowcase)
                        ? a.showcaseOff
                        : ''}
                    </td>
                    <td
                      className="border-b border-hairline py-2.5 pr-4"
                      data-has-draft={row.draftRevisionId === null ? 'false' : 'true'}
                    >
                      {row.draftRevisionId === null ? (
                        <span className="opacity-40">{a.draftNo}</span>
                      ) : (
                        <span className="text-accent">
                          {interpolate(a.draftYes, { n: row.draftRevNo ?? 1 })}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-hairline py-2.5 pr-4 opacity-60">
                      {formatDate(row.updatedAt, locale) ?? '—'}
                    </td>
                    <td className="border-b border-hairline py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={`/admin/p/${row.id}`} className={BUTTON}>
                          {a.open}
                        </a>
                        <OpForm op="playbook.archive" back="/admin/playbooks">
                          <input type="hidden" name="playbookId" value={row.id} />
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={a.newHeading}>
        <p className="font-mono text-code opacity-60">{a.newLede}</p>
        <OpForm op="playbook.create" back="/admin/playbooks" className="mt-4 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={a.newSlug} hint={a.newSlugHint}>
              <input type="text" name="slug" required className={INPUT} />
            </Field>
            <Field label={a.newCategory}>
              <select name="category" defaultValue="pipeline" className={INPUT}>
                {CATEGORIES.map((key) => (
                  <option key={key} value={key}>
                    {categoryLabel(dict, key)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <LocalePair label={a.fieldTitle} name="title" value={null} />
          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.newCreate}
            </button>
          </div>
        </OpForm>
      </Panel>
    </AdminShell>
  );
}
