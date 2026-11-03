import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { loadAllPrompts, type PromptRow } from '@/lib/prompts/repo';
import {
  ADMIN_PROMPTS_PATH,
  ADMIN_PROMPT_NEW_PATH,
  adminPromptPath,
} from '@/lib/prompts/links';
import { AdminShell, OutcomeBanner } from '@/components/admin/chrome';
import { AdminPageHeader } from '@/components/admin/patterns';
import { formatCount } from '@/lib/admin/format';
import { PromptCard } from '@/components/admin/prompt-fields';

/**
 * `/admin/prompts` — the BOARD (rebuilt 2026-08-15).
 *
 * Founder direction, with a reference screenshot: "관리자 페이지에서 프롬프트 등록하는 거 방식
 * 불편함. 내가 스크롤 계속 내려서 추가 등록해야 해서… 지금 공개된 프롬프트 박스로 볼 수 있고 새로
 * 추가 가능한 구조."
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

/** The tabs, in working order: what needs a decision first, then what is live. */
const TABS = ['all', 'pending', 'published', 'archived', 'rejected'] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | undefined): value is Tab {
  return value !== undefined && (TABS as readonly string[]).includes(value);
}

function inTab(row: PromptRow, tab: Tab): boolean {
  return tab === 'all' ? true : row.status === tab;
}

/** Substring over the fields a moderator actually remembers: both titles, the slug, the handle. */
function matches(row: PromptRow, query: string): boolean {
  if (query === '') return true;
  const hay = [row.title, row.titleKo ?? '', row.slug, row.authorHandle ?? '']
    .join(' ')
    .toLowerCase();
  return hay.includes(query);
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
  const c = dict.adminConsole;
  const rows: PromptRow[] = sql === null ? [] : await loadAllPrompts(sql);

  const rawTab = one(params, 'tab');
  const tab: Tab = isTab(rawTab) ? rawTab : 'all';
  const query = (one(params, 'q') ?? '').trim().toLowerCase();

  const counts: Record<Tab, number> = {
    all: rows.length,
    pending: rows.filter((row) => row.status === 'pending').length,
    published: rows.filter((row) => row.status === 'published').length,
    archived: rows.filter((row) => row.status === 'archived').length,
    rejected: rows.filter((row) => row.status === 'rejected').length,
  };
  const shown = rows.filter((row) => inTab(row, tab) && matches(row, query));

  const tabHref = (value: Tab) => {
    const search = new URLSearchParams();
    if (value !== 'all') search.set('tab', value);
    if (query !== '') search.set('q', query);
    const rest = search.toString();
    return rest === '' ? ADMIN_PROMPTS_PATH : `${ADMIN_PROMPTS_PATH}?${rest}`;
  };

  return (
    <AdminShell dict={a} locale={locale} active="prompts">
      <AdminPageHeader
        eyebrow={a.navPrompts}
        title={a.promptsHeading}
        count={formatCount(shown.length, locale)}
        countLabel={a.promptsCount.replace('{count}', String(shown.length))}
        lede={a.promptsLede}
        actions={
          <a href={ADMIN_PROMPT_NEW_PATH} data-prompt-new className="admin-btn admin-btn-primary">
            + {a.promptsNew}
          </a>
        }
      />

      <OutcomeBanner
        dict={a}
        {...(one(params, 'ok') ? { ok: one(params, 'ok')! } : {})}
        {...(one(params, 'err') ? { err: one(params, 'err')! } : {})}
        {...(one(params, 'detail') ? { detail: one(params, 'detail')! } : {})}
      />

      <div className="admin-toolbar mt-6">
        <nav className="admin-filters" aria-label={a.promptsFilterLabel}>
          <ul>
            {TABS.map((value) => (
              <li key={value}>
                <a
                  href={tabHref(value)}
                  data-tab={value}
                  data-filter={value}
                  aria-current={value === tab ? 'true' : undefined}
                >
                  {a.promptTabs[value]}
                  <span className="admin-filter-count">{formatCount(counts[value], locale)}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* A GET form: the query lands in the URL, which is what makes a filtered board shareable
            and survivable across the redirect every mutation performs. */}
        <form method="get" action={ADMIN_PROMPTS_PATH} className="admin-search" role="search">
          {tab !== 'all' && <input type="hidden" name="tab" value={tab} />}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={a.promptsSearch}
            aria-label={a.promptsSearch}
          />
          <button type="submit" className="admin-btn">
            {c.list.find}
          </button>
        </form>
      </div>

      <p className="mt-4 font-mono text-[0.72rem] opacity-50">
        {a.promptsCount.replace('{count}', String(shown.length))}
      </p>

      {shown.length === 0 ? (
        <p className="admin-empty mt-6">
          {rows.length === 0 ? a.publishedEmpty : a.promptsNoMatch}
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((row) => (
            <PromptCard key={row.id} row={row} dict={dict} href={adminPromptPath(row.id)} locale={locale} />
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
