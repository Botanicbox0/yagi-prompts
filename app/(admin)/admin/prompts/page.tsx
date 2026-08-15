import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { loadAllPrompts, type PromptRow } from '@/lib/prompts/repo';
import {
  ADMIN_PROMPTS_PATH,
  ADMIN_PROMPT_NEW_PATH,
  adminPromptPath,
} from '@/lib/prompts/links';
import { AdminShell, BUTTON_PRIMARY, INPUT, OutcomeBanner } from '@/components/admin/chrome';
import { PromptCard } from '@/components/admin/prompt-fields';

/**
 * `/admin/prompts` — the BOARD (rebuilt 2026-08-15).
 *
 * Founder direction, with a reference screenshot: "관리자 페이지에서 프롬프트 등록하는 거 방식
 * 불편함. 내가 스크롤 계속 내려서 추가 등록해야 해서… 지금 공개된 프롬프트 박스로 볼 수 있고 새로
 * 추가 가능한 구조."
 *
 * What this replaced: ONE page that rendered the moderation queue, then a complete inline editor for
 * every published prompt, then — at the very bottom — the authoring form. Publishing a prompt meant
 * scrolling past the entire catalogue, and the page grew a screenful longer with each one. That is a
 * layout whose cost rises with success.
 *
 * The board is a wall of cards with the ADD button in the header, and the two things a card can lead
 * to are their own routes: `/admin/prompts/new` and `/admin/prompts/{id}`. Consequences worth
 * naming:
 *   · the page no longer grows an editor per row, so it stays one screen tall at any catalogue size;
 *   · a card is poster-led, because the founder recognises their own work by the frame, not the slug;
 *   · filtering and search are LINKS and a GET form. §3.8's no-JS rule is not relaxed for the admin,
 *     and a tab that is a link is also a URL a moderator can bookmark or send to themselves.
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-accent font-label text-eyebrow uppercase">{a.navPrompts}</p>
          <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">
            {a.promptsHeading}
          </h1>
          <p className="mt-3 max-w-detail text-body opacity-60">{a.promptsLede}</p>
        </div>

        {/* The whole point of the rebuild: adding a prompt is a button in the header, not a form
            below the catalogue. */}
        <a href={ADMIN_PROMPT_NEW_PATH} data-prompt-new className={BUTTON_PRIMARY}>
          + {a.promptsNew}
        </a>
      </div>

      <OutcomeBanner
        dict={a}
        {...(one(params, 'ok') ? { ok: one(params, 'ok')! } : {})}
        {...(one(params, 'err') ? { err: one(params, 'err')! } : {})}
        {...(one(params, 'detail') ? { detail: one(params, 'detail')! } : {})}
      />

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-4">
        <nav className="flex flex-wrap gap-1.5" aria-label={a.promptsFilterLabel}>
          {TABS.map((value) => (
            <a
              key={value}
              href={tabHref(value)}
              data-tab={value}
              aria-current={value === tab ? 'page' : undefined}
              className={[
                'border px-3 py-1.5 font-label text-[0.65rem] tracking-[0.1em] uppercase',
                value === tab ? 'border-current bg-black text-white' : 'border-hairline opacity-60',
              ].join(' ')}
            >
              {a.promptTabs[value]} {counts[value]}
            </a>
          ))}
        </nav>

        {/* A GET form: the query lands in the URL, which is what makes a filtered board shareable
            and survivable across the redirect every mutation performs. */}
        <form method="get" action={ADMIN_PROMPTS_PATH} className="flex items-center gap-2">
          {tab !== 'all' && <input type="hidden" name="tab" value={tab} />}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={a.promptsSearch}
            aria-label={a.promptsSearch}
            className={`${INPUT} w-48`}
          />
        </form>
      </div>

      <p className="mt-5 font-mono text-[0.72rem] opacity-50">
        {a.promptsCount.replace('{count}', String(shown.length))}
      </p>

      {shown.length === 0 ? (
        <p className="mt-6 font-mono text-code opacity-60">
          {rows.length === 0 ? a.publishedEmpty : a.promptsNoMatch}
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((row) => (
            <PromptCard key={row.id} row={row} dict={dict} href={adminPromptPath(row.id)} />
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
