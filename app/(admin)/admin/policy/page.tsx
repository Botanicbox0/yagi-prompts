import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { loadPolicy } from '@/lib/admin/repo';
import { BLOCK_KINDS } from '@/lib/content/schemas';
import { DEFAULT_POLICY } from '@/lib/content/visibility';
import { AdminShell, BUTTON_PRIMARY, INPUT, OpForm, OutcomeBanner, Panel } from '@/components/admin/chrome';
import { AdminPageHeader } from '@/components/admin/patterns';
import { kindLabel, visibilityOptions } from '@/components/admin/labels';

/**
 * `/admin/policy` — §3.8's global defaults per kind.
 *
 * The banner states the non-retroactivity rule verbatim, and it is not a disclaimer: `prepare_publish`
 * stamps `resolved_visibility` on every block, and the read path serves the STAMP. Editing this
 * table therefore cannot move a single byte of already-published content — which is asserted, not
 * asserted-about, in `tests/admin/visibility.test.ts` (shaped-output fingerprint before/after).
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function AdminPolicyPage({
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
  const policy = sql === null ? DEFAULT_POLICY : await loadPolicy(sql);
  const options = visibilityOptions(a);

  return (
    <AdminShell dict={a} locale={locale} active="policy">
      <AdminPageHeader
        eyebrow={a.navPolicy}
        title={a.policyHeading}
        lede={a.policyLede}
      />

      <p className="admin-outcome mt-6 border border-accent px-4 py-3 font-mono text-code text-accent">
        {a.policyBanner}
      </p>

      <OutcomeBanner
        dict={a}
        {...(one(params, 'ok') ? { ok: one(params, 'ok')! } : {})}
        {...(one(params, 'err') ? { err: one(params, 'err')! } : {})}
        {...(one(params, 'detail') ? { detail: one(params, 'detail')! } : {})}
      />

      <Panel title={a.policyHeading}>
        <OpForm op="policy.update" back="/admin/policy">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="font-label text-[0.68rem] uppercase tracking-[0.12em] opacity-50">
                <th className="border-b border-hairline py-2 pr-4">{a.colKind}</th>
                <th className="border-b border-hairline py-2">{a.colDefault}</th>
              </tr>
            </thead>
            <tbody className="font-mono text-code">
              {BLOCK_KINDS.map((kind) => (
                <tr key={kind} data-policy-kind={kind}>
                  <td className="border-b border-hairline py-2.5 pr-4">{kindLabel(dict, kind)}</td>
                  <td className="border-b border-hairline py-2.5">
                    <select
                      name={`p:${kind}`}
                      aria-label={kindLabel(dict, kind)}
                      defaultValue={policy[kind]}
                      className={`${INPUT} max-w-[14rem]`}
                    >
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4">
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.policySave}
            </button>
          </div>
        </OpForm>
      </Panel>
    </AdminShell>
  );
}
