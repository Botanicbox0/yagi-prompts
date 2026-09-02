import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { ADMIN_PROMPTS_PATH, ADMIN_PROMPT_NEW_PATH } from '@/lib/prompts/links';
import { AdminShell, BUTTON_PRIMARY, OpForm, Panel } from '@/components/admin/chrome';
import { PromptFields } from '@/components/admin/prompt-fields';

/**
 * `/admin/prompts/new` — one form, nothing else (2026-08-15).
 *
 * This page exists because of where the form used to be: at the bottom of the board, under every
 * published prompt's inline editor. The founder's complaint was literally the scroll. A dedicated
 * route makes "add a prompt" a link in the header, and makes the form the only thing on the screen
 * — which is also the state in which a long shot-by-shot brief is actually pleasant to paste.
 *
 * SUCCESS lands on the board (the operation's own `to`), where the new card now is, with the
 * outcome banner over it. `back` is this page: a refused submission (a short title, a missing
 * poster) returns HERE with the reason, not to the board with the reason and no form. The
 * fields also carry `required`/`minLength`, so the browser refuses the obvious cases before a
 * 15,000-character brief is posted and lost (UX audit, 2026-09-03).
 */
export const dynamic = 'force-dynamic';

export default async function AdminPromptNewPage() {
  const locale = await getLocaleFromHeaders();
  const dict = getDictionary(locale);
  const a = dict.admin;

  return (
    <AdminShell dict={a} locale={locale} active="prompts">
      <a href={ADMIN_PROMPTS_PATH} className="font-mono text-[0.72rem] opacity-60">
        ← {a.backToPrompts}
      </a>
      <h1 className="mt-4 font-display text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[0.95] font-black uppercase">
        {a.authorHeading}
      </h1>
      <p className="mt-3 max-w-detail font-mono text-[0.75rem] opacity-55">{a.authorLede}</p>

      <Panel title={a.authorHeading}>
        <OpForm op="prompt.create" back={ADMIN_PROMPT_NEW_PATH} className="flex flex-col gap-4">
          <PromptFields row={null} dict={dict} />
          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.publishPrompt}
            </button>
          </div>
        </OpForm>
      </Panel>
    </AdminShell>
  );
}
