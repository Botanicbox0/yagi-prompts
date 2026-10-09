import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { interpolate } from '@/lib/i18n/format';
import { loadAllCampaigns, loadCampaignCounts, loadPayoutQueue } from '@/lib/campaigns/repo';
import { ADMIN_CAMPAIGNS_PATH, ADMIN_INQUIRIES_PATH } from '@/lib/campaigns/links';
import { loadAllPrompts } from '@/lib/prompts/repo';
import { summarizeRenderJobs } from '@/lib/renders/repo';
import { countBrandInquiries } from '@/lib/brands/repo';
import { countRenderFeedback } from '@/lib/renders/feedback';
import { AdminShell, BUTTON, BUTTON_PRIMARY } from '@/components/admin/chrome';
import { ADMIN_PROMPTS_PATH, ADMIN_PROMPT_NEW_PATH } from '@/lib/prompts/links';
import { requireAdmin } from '@/lib/auth/viewer';
import { loadStudioInbox } from '@/lib/brands/workspace/inbox';

/**
 * `/admin` — the dashboard (founder, 2026-09-11). The old front door was the playbook list, a
 * screen from a product TWINGS no longer is; it lives at /admin/playbooks now.
 *
 * Four panels, one question each: is anything waiting on the campaigns board, on the template
 * queue, in the render pipeline, in the brand inbox. Every number is a link to the list it counts.
 */
export const dynamic = 'force-dynamic';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function Stat({ href, label, count, hot }: { href: string | null; label: string; count: number; hot?: boolean }) {
  const text = interpolate(label, { count: count.toLocaleString() });
  const className = ['font-mono text-code', hot && count > 0 ? 'text-accent' : 'opacity-80'].join(' ');
  return (
    <li data-admin-stat={count}>
      {href ? (
        <a href={href} className={`${className} underline-offset-4 hover:underline`}>
          {text}
        </a>
      ) : (
        <span className={className}>{text}</span>
      )}
    </li>
  );
}

function Card({ title, href, children }: { title: string; href: string | null; children: React.ReactNode }) {
  return (
    <section data-admin-card className="border border-hairline">
      <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h2 className="font-label text-eyebrow uppercase">{title}</h2>
        {href && (
          <a href={href} className="text-accent font-label text-[0.62rem] tracking-[0.1em] uppercase">
            →
          </a>
        )}
      </header>
      <ul className="flex flex-col gap-2 p-4">{children}</ul>
    </section>
  );
}

export default async function AdminHomePage() {
  const [locale, sql, viewer] = await Promise.all([getLocaleFromHeaders(), getSqlRunner(), requireAdmin()]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const now = new Date();

  const campaigns = sql === null ? [] : await loadAllCampaigns(sql);
  const counts = sql === null ? new Map() : await loadCampaignCounts(sql, campaigns.map((row) => row.id));
  const recruiting = campaigns.filter((row) => row.status === 'recruiting').length;
  const applicants = [...counts.values()].reduce((sum, c) => sum + (c as { applied: number }).applied, 0);
  const payouts = sql === null ? 0 : (await loadPayoutQueue(sql, now)).length;

  const prompts = sql === null ? [] : await loadAllPrompts(sql);
  const pending = prompts.filter((row) => row.status === 'pending').length;
  const published = prompts.filter((row) => row.status === 'published').length;

  const renders = sql === null ? { recent: 0, failed: 0, held: 0, running: 0 } : await summarizeRenderJobs(sql, new Date(now.getTime() - WEEK_MS));
  const inquiries = sql === null ? 0 : await countBrandInquiries(sql, 'new');
  const feedback = sql === null ? 0 : await countRenderFeedback(sql, 'new');
  const waiting = sql === null ? 0 : ((await loadStudioInbox({ sql }, viewer))?.length ?? 0);

  return (
    <AdminShell dict={a} locale={locale} active="home">
      <p className="text-accent font-label text-eyebrow uppercase">{a.navHome}</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">{a.dashHeading}</h1>
      <p className="mt-3 max-w-detail text-body opacity-60">{a.dashLede}</p>

      {/* Discoverability (2026-09-25): registering a template was only reachable through the small
          arrow on the templates card. It is the most common admin task, so it gets its own row. */}
      <div data-admin-template-actions className="mt-6 flex flex-wrap items-center gap-3 border border-hairline px-4 py-3">
        <p className="min-w-48 flex-1 font-mono text-[0.75rem] opacity-70">{a.dashTemplateAction}</p>
        <a href={ADMIN_PROMPT_NEW_PATH} data-admin-new-template className={BUTTON_PRIMARY}>
          + {a.promptsNew}
        </a>
        <a href={ADMIN_PROMPTS_PATH} className={BUTTON}>
          {a.dashTemplateManage}
        </a>
      </div>

      <div data-admin-dashboard className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title={a.dashCampaigns} href={ADMIN_CAMPAIGNS_PATH}>
          <Stat href={`${ADMIN_CAMPAIGNS_PATH}#status-recruiting`} label={a.dashRecruiting} count={recruiting} />
          <Stat href={ADMIN_CAMPAIGNS_PATH} label={a.dashApplicants} count={applicants} hot />
          <Stat href={payouts > 0 ? `${ADMIN_CAMPAIGNS_PATH}#payout-queue` : ADMIN_CAMPAIGNS_PATH} label={a.dashPayouts} count={payouts} hot />
        </Card>
        <Card title={a.dashTemplates} href="/admin/prompts">
          <Stat href="/admin/prompts?tab=pending" label={a.dashPending} count={pending} hot />
          <Stat href="/admin/prompts?tab=published" label={a.dashPublished} count={published} />
        </Card>
        <Card title={a.dashRenders} href={null}>
          <Stat href={null} label={a.dashRendersWeek} count={renders.recent} />
          <Stat href={null} label={a.dashRendersFailed} count={renders.failed} hot />
          <Stat href={null} label={a.dashRendersHeld} count={renders.held} />
          <Stat href={`${ADMIN_INQUIRIES_PATH}?kind=feedback&status=new`} label={a.dashFeedbackNew} count={feedback} hot />
        </Card>
        <Card title={a.dashInquiries} href={ADMIN_INQUIRIES_PATH}>
          <Stat href={`${ADMIN_INQUIRIES_PATH}?kind=brand&status=new`} label={a.dashInquiriesNew} count={inquiries} hot />
          <Stat href="/admin/brand-workspace#studio-inbox" label={a.dashInbox} count={waiting} hot />
        </Card>
      </div>
    </AdminShell>
  );
}
