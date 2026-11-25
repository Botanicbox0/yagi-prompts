import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import { getViewer } from '@/lib/auth/viewer';
import { notFound } from 'next/navigation';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { interpolate } from '@/lib/i18n/format';
import { AdminShell, OpForm, OutcomeBanner, INPUT, BUTTON_PRIMARY } from '@/components/admin/chrome';
import { AdminPageHeader, FilterPills } from '@/components/admin/patterns';
import { SocialQueue } from '@/components/admin/social-queue';
import { RecipeReviewPanel } from '@/components/recipes/review-panel';
import { makerBlogOpen } from '@/lib/posts/flag';
import { makerBlogPostHref } from '@/lib/posts/links';
import {
  COMMUNITY_SECTIONS,
  communitySectionHref,
  loadAdminCommunity,
  parseCommunitySection,
} from '@/lib/admin/community';
import { formatCount } from '@/lib/admin/format';

export const dynamic = 'force-dynamic';

export default async function PlatformAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, sql, locale, query] = await Promise.all([
    getViewer(),
    getSqlRunner(),
    getLocaleFromHeaders(),
    searchParams,
  ]);
  if (!viewer.isAdmin) notFound();

  const dict = getDictionary(locale);
  const c = dict.community;
  const cm = dict.adminConsole.community;
  const section = parseCommunitySection(query);
  const board = await loadAdminCommunity(sql);

  const showSocial = section === 'all' || section === 'social';
  const showIntake = section === 'all' || section === 'intake';
  const showFeedback = section === 'all' || section === 'feedback';
  const showPolicy = section === 'all' || section === 'policy';
  const blogEnabled = makerBlogOpen();

  const social = showSocial ? (
    <SocialQueue copy={dict.social} locale={locale} queue={board.socialQueue} worker={board.socialWorker} />
  ) : null;

  const quickNav = (
    <nav
      data-admin-community-nav
      aria-label={cm.title}
      className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-y border-hairline bg-surface/95 py-2.5 backdrop-blur"
    >
      <a href="#social" className="rounded-full border border-hairline px-3 py-1 font-mono text-xs hover:border-current">
        {cm.anchors.social}
      </a>
      <a href="#applications" className="rounded-full border border-hairline px-3 py-1 font-mono text-xs hover:border-current">
        {cm.anchors.applications}
      </a>
      <a href="#formats" className="rounded-full border border-hairline px-3 py-1 font-mono text-xs hover:border-current">
        {cm.anchors.formats}
      </a>
      <a href="#threads" className="rounded-full border border-hairline px-3 py-1 font-mono text-xs hover:border-current">
        {cm.anchors.threads}
      </a>
      <a href="#claims" className="rounded-full border border-hairline px-3 py-1 font-mono text-xs hover:border-current">
        {cm.anchors.claims}
      </a>
      <a href="#ratings" className="rounded-full border border-hairline px-3 py-1 font-mono text-xs hover:border-current">
        {cm.anchors.ratings}
      </a>
      {blogEnabled ? (
        <a href="#posts" className="rounded-full border border-hairline px-3 py-1 font-mono text-xs hover:border-current">
          {cm.anchors.posts}
        </a>
      ) : null}
    </nav>
  );

  const wrap = (children: ReactNode) => (
    <AdminShell dict={dict.admin} locale={locale} active="community">
      <AdminPageHeader
        title={cm.title}
        {...(board.ready
          ? {
              count: formatCount(board.counts.totalWaiting, locale),
              countLabel: interpolate(cm.count, { count: formatCount(board.counts.totalWaiting, locale) }),
            }
          : {})}
        lede={cm.lede}
      />
      {board.ready ? (
        <div className="admin-toolbar">
          <FilterPills
            label={cm.sectionFilter}
            pills={COMMUNITY_SECTIONS.map((key) => ({
              key,
              label: cm.sections[key],
              href: communitySectionHref(key),
              ...(key !== 'all'
                ? { count: formatCount(board.counts[key], locale) }
                : { count: formatCount(board.counts.totalWaiting, locale) }),
              current: section === key,
            }))}
          />
        </div>
      ) : null}
      <div className="space-y-6">
        {quickNav}
        <OutcomeBanner
          dict={dict.admin}
          ok={typeof query.ok === 'string' ? query.ok : undefined}
          err={typeof query.err === 'string' ? query.err : undefined}
        />
        {social}
        {children}
      </div>
    </AdminShell>
  );

  if (!board.ready) return wrap(<p>{cm.unavailable}</p>);

  const { threads, messages, formats, ratings, claims, creators, offers, history, applications, notes, recipes } = board;
  const posts = board.posts ?? [];
  const mr = dict.makerRecipe;
  const mediums = { video: mr.mediumVideo, image: mr.mediumImage, carousel: mr.mediumCarousel };
  const onboarding = applications !== null;
  const p = dict.creatorProgram;

  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const input = (name: string, label: string, type = 'text', step?: string) => (
    <label className="block text-sm">
      {label}
      <input className={`${INPUT} mt-1 min-h-10`} name={name} type={type} step={step} required maxLength={type === 'text' ? 2000 : undefined} />
    </label>
  );
  const reason = () => input('reason', c.reason);
  const check = (name: string, label: string) => (
    <label className="flex items-center gap-3 text-sm">
      {hidden(name, 'false')}
      <input type="checkbox" name={name} value="true" />
      {label}
    </label>
  );
  const PLATFORM_OP_BY_ACTION = {
    creator: 'creative.grant',
    application: 'creative.application',
    format: 'creative.format',
    settle: 'creative.settle',
    reply: 'community.reply',
    moderate: 'community.moderate',
    quality: 'community.quality',
    claim: 'community.claim',
    policy: 'community.policy',
    offer: 'community.offer',
    offerDisable: 'community.offerDisable',
  } as const;
  const form = (action: keyof typeof PLATFORM_OP_BY_ACTION, children: ReactNode, id?: string) => (
    <OpForm op={PLATFORM_OP_BY_ACTION[action]} back="/admin/community" className="space-y-3 rounded-xl border border-hairline p-4">
      {hidden('action', action)}
      {id ? hidden('id', id) : null}
      {children}
      {reason()}
    </OpForm>
  );
  const submit = (label: string, name?: string, value?: string) => (
    <button className={`${BUTTON_PRIMARY} min-h-10`} name={name} value={value}>
      {label}
    </button>
  );
  const optional = (name: string, label: string, hint: string, rows = 3) => (
    <label className="block text-sm">
      {label}
      <textarea className={`${INPUT} mt-1`} name={name} maxLength={1000} rows={rows} />
      <span className="mt-1 block text-xs opacity-60">{hint}</span>
    </label>
  );
  const when = (value: string) =>
    new Date(value).toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Seoul',
    });
  const link = (href: string, label: string) => (
    <a key={href} className="block break-all text-sm underline" href={href} target="_blank" rel="noopener noreferrer nofollow">
      {label} ↗
    </a>
  );
  const applicationCard = (a: NonNullable<typeof applications>['open'][number]) => (
    <section key={a.id} data-creator-application={a.id} data-status={a.status} className="space-y-3 rounded-xl border border-hairline p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="break-words font-semibold">{a.displayName}</h3>
        <span className="text-xs opacity-60">
          {c.applicationStatus[a.status]} · {when(a.createdAt)}
        </span>
      </div>
      <p className="text-xs opacity-60">
        {a.mediums.map((m) => c[m as 'image' | 'video']).join(' · ')}
        {a.tools ? ` · ${c.tools}: ${a.tools}` : ''}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{a.message}</p>
      <div className="space-y-1">
        {link(a.portfolioUrl, c.portfolio)}
        {a.sampleUrls.map((u, i) => link(u, `${c.samples} ${i + 1}`))}
      </div>
      {a.decisionNote ? (
        <p className="whitespace-pre-wrap break-words rounded-lg bg-on-surface/5 p-3 text-sm">
          <strong>{c.decisionNote}: </strong>
          {a.decisionNote}
        </p>
      ) : null}
      <p className="break-all text-xs opacity-50">
        {c.accountId} {a.userId}
      </p>
      {a.status === 'submitted'
        ? form(
            'application',
            <>
              <label className="block text-sm">
                {c.contract}
                <input className={`${INPUT} mt-1 min-h-10`} name="contract" maxLength={120} />
                <span className="mt-1 block text-xs opacity-60">{c.approveContractHint}</span>
              </label>
              {optional('note', c.decisionNote, c.decisionNoteHint)}
              <div className="flex flex-wrap gap-3">
                {submit(c.decideApprove, 'decision', 'approve')}
                {submit(c.decideDecline, 'decision', 'decline')}
              </div>
            </>,
            a.id,
          )
        : null}
    </section>
  );

  return wrap(
    <div data-platform-admin className="grid items-start gap-8 xl:grid-cols-2">
      <div className="space-y-5">
        {showFeedback ? (
          <>
            <h2 id="threads" className="scroll-mt-24 text-lg font-semibold">
              {cm.anchors.threads}
            </h2>
            {threads.map((t) => (
              <section key={t.id} className="space-y-3 border-b border-hairline pb-5">
                <p className="break-all text-xs opacity-60">{t.user_id}</p>
                {messages
                  .filter((m) => m.thread_id === t.id)
                  .map((m) => (
                    <p key={m.id} className="whitespace-pre-wrap break-words text-sm">
                      <strong>{m.from_studio ? cm.studioSender : cm.memberSender}: </strong>
                      {m.body}
                    </p>
                  ))}
                {form(
                  'reply',
                  <>
                    {hidden('requestId', randomUUID())}
                    <label className="block text-sm">
                      {c.message}
                      <textarea name="message" required maxLength={2000} className={INPUT} />
                    </label>
                    {submit(c.reply)}
                  </>,
                  t.id,
                )}
              </section>
            ))}
          </>
        ) : null}

        {showIntake ? (
          <>
            <h2 id="formats" className="scroll-mt-24 text-lg font-semibold">
              {cm.anchors.formats}
            </h2>
            {formats.map((f) => (
              <section key={f.id} id={`format-${f.id}`} data-platform-format={f.id} className="scroll-mt-24 space-y-3 rounded-xl border border-hairline p-4">
                <h3>{f.title}</h3>
                {f.example_url ? (
                  <a className="text-sm underline" href={f.example_url} target="_blank" rel="noopener noreferrer">
                    {c.example} ↗
                  </a>
                ) : null}
                {recipes.get(f.id) ? (
                  <RecipeReviewPanel
                    entry={recipes.get(f.id)!}
                    copy={mr}
                    mediums={mediums}
                    locale={locale}
                    submitted={f.status === 'submitted'}
                    acceptLabel={c.accept}
                    rejectLabel={c.reject}
                    reason={reason()}
                    note={onboarding ? optional('note', c.formatNote, c.formatNoteHint) : null}
                  />
                ) : (
                  <details>
                    <summary className="cursor-pointer text-sm">{c.recipe}</summary>
                    <pre className="mt-3 whitespace-pre-wrap break-words text-xs">{f.recipe}</pre>
                  </details>
                )}
                {notes.get(f.id) ? (
                  <p className="whitespace-pre-wrap break-words rounded-lg bg-on-surface/5 p-3 text-sm">
                    <strong>{c.formatNote}: </strong>
                    {notes.get(f.id)}
                  </p>
                ) : null}
                {f.status === 'submitted' && !recipes.get(f.id)
                  ? form(
                      'format',
                      <>
                        {onboarding ? optional('note', c.formatNote, c.formatNoteHint) : null}
                        <div className="flex flex-wrap gap-3">
                          {submit(c.accept, 'accept', 'true')}
                          {submit(c.reject, 'accept', 'false')}
                        </div>
                      </>,
                      f.id,
                    )
                  : null}
                {f.template_status ? (
                  <p className="text-sm">
                    {c.templateStatus}: {p.templateState[f.template_status as keyof typeof p.templateState] ?? f.template_status}
                  </p>
                ) : null}
                {f.template_id ? (
                  <a href={`/admin/prompts/${f.template_id}`} className="underline">
                    {c.manageTemplate}
                  </a>
                ) : null}
              </section>
            ))}
          </>
        ) : null}

        {showFeedback ? (
          <>
            <h2 id="ratings" className="scroll-mt-24 text-lg font-semibold">
              {cm.anchors.ratings}
            </h2>
            {ratings.map((r) => (
              <section key={r.id} className="space-y-3">
                <p className="text-sm">
                  {r.stars} ★ · {r.template_id}
                </p>
                <p className="whitespace-pre-wrap text-sm">{r.message}</p>
                {form(
                  'moderate',
                  <>
                    {hidden('excluded', String(!r.excluded))}
                    {r.excluded ? (
                      hidden('category', 'restore')
                    ) : (
                      <label className="block text-sm">
                        {c.category}
                        <select name="category" className={INPUT}>
                          <option value="duplicate">{c.duplicate}</option>
                          <option value="fraud">{c.fraud}</option>
                          <option value="abuse">{c.abuse}</option>
                        </select>
                      </label>
                    )}
                    {submit(r.excluded ? c.restore : c.exclude)}
                  </>,
                  r.id,
                )}
              </section>
            ))}
            {form(
              'quality',
              <>
                {input('id', c.templateId)}
                {input('score', c.score, 'number', '0.1')}
                {submit(c.quality)}
              </>,
            )}
          </>
        ) : null}
      </div>

      <div className="space-y-5">
        {showIntake ? (
          <>
            <section id="applications" data-creator-applications className="scroll-mt-24 space-y-4">
              <h2 className="text-lg font-semibold">{cm.anchors.applications}</h2>
              {applications === null ? (
                <p className="text-sm opacity-65">{c.applicationsUnavailable}</p>
              ) : (
                <>
                  {applications.open.length ? applications.open.map(applicationCard) : <p className="text-sm opacity-65">{c.applicationsEmpty}</p>}
                  {applications.decided.length ? (
                    <details className="space-y-3 rounded-xl border border-hairline p-4">
                      <summary className="cursor-pointer py-2 font-medium">{c.applicationsDecided}</summary>
                      {applications.decided.map(applicationCard)}
                    </details>
                  ) : null}
                </>
              )}
            </section>
            <h2 className="text-lg font-semibold">{c.inviteTitle}</h2>
            {form(
              'creator',
              <>
                {input('id', c.userId)}
                {input('contract', c.contract)}
                <label className="block text-sm" data-creator-payout>
                  {c.payout}
                  <select name="payout" defaultValue="company" className={`${INPUT} mt-1 min-h-10`}>
                    <option value="company">{c.payoutCompany}</option>
                    <option value="external">{c.payoutExternal}</option>
                  </select>
                  <span className="mt-1 block text-xs opacity-60">{c.payoutHint}</span>
                </label>
                <div className="flex flex-wrap gap-3">
                  {submit(c.grant, 'active', 'true')}
                  {submit(c.revoke, 'active', 'false')}
                </div>
              </>,
            )}
            {creators.map((u) => (
              <p key={u.user_id} data-creator-row={u.payout ?? 'external'} className="break-all text-xs">
                {u.user_id} · {u.active ? c.grant : c.revoke} · {u.contract_version} · {u.payout === 'company' ? c.payoutCompany : c.payoutExternal}
              </p>
            ))}
          </>
        ) : null}

        {showSocial ? (
          <>
            <h2 id="claims" className="scroll-mt-24 text-lg font-semibold">
              {cm.anchors.claims}
            </h2>
            {claims.map((r) => (
              <section key={r.id} className="space-y-3 border-b border-hairline pb-5">
                <a className="block break-all text-sm underline" href={r.post_url} target="_blank" rel="noopener noreferrer">
                  {r.post_url} ↗
                </a>
                <a href={`/api/admin/community/${r.id}/media`} target="_blank" rel="noopener noreferrer" className="text-xs underline">
                  {r.render_id}
                </a>
                <p className="text-sm">
                  {c.status[r.status as keyof typeof c.status]} · {r.credits}
                </p>
                {r.status === 'submitted' || r.status === 'approved'
                  ? form(
                      'claim',
                      <>
                        {check('ownership', c.verifiedOwner)}
                        {check('content', c.verifiedContent)}
                        {check('disclosure', c.verifiedDisclosure)}
                        <div className="flex flex-wrap gap-3">
                          {r.status === 'submitted' ? (
                            <>
                              {submit(c.approve, 'decision', 'approve')}
                              {submit(c.reject, 'decision', 'reject')}
                            </>
                          ) : (
                            submit(c.revokeAward, 'decision', 'revoke')
                          )}
                        </div>
                      </>,
                      r.id,
                    )
                  : null}
              </section>
            ))}
          </>
        ) : null}

        {blogEnabled && (showFeedback || showPolicy) ? (
          <section data-admin-community-posts className="space-y-4">
            <h2 id="posts" className="scroll-mt-24 text-lg font-semibold">
              {cm.postsPanel.heading}
            </h2>
            {posts.length === 0 ? (
              <p className="text-sm opacity-65">{cm.postsPanel.empty}</p>
            ) : (
              posts.map((post) => {
                const statusLabel =
                  post.status === 'published'
                    ? cm.postsPanel.statusPublished
                    : post.status === 'hidden'
                      ? cm.postsPanel.statusHidden
                      : cm.postsPanel.statusDraft;
                const actionOp = post.status === 'hidden' ? 'post.restore' : 'post.hide';
                const actionLabel =
                  post.status === 'hidden' ? cm.postsPanel.restore : cm.postsPanel.hide;
                return (
                  <div
                    key={post.id}
                    data-admin-post={post.id}
                    data-status={post.status}
                    className="space-y-3 rounded-xl border border-hairline p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium break-words">{post.title}</p>
                        <p className="font-mono text-xs opacity-65">
                          {post.handle ? `@${post.handle}` : post.user_id} · {post.slug} ·{' '}
                          {post.block_count} {cm.postsPanel.blocksUnit}
                        </p>
                      </div>
                      <span className="rounded-full border border-hairline px-2.5 py-0.5 font-mono text-xs">
                        {statusLabel}
                      </span>
                    </div>
                    {post.handle && post.status === 'published' ? (
                      <p className="text-xs">
                        <a
                          href={makerBlogPostHref('ko', post.handle, post.slug)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-4"
                        >
                          {makerBlogPostHref('ko', post.handle, post.slug)} ↗
                        </a>
                      </p>
                    ) : null}
                    {post.hidden_reason ? (
                      <p className="rounded-lg bg-on-surface/5 px-3 py-2 text-xs">{post.hidden_reason}</p>
                    ) : null}
                    <OpForm
                      op={actionOp}
                      back="/admin/community#posts"
                      className="flex flex-wrap items-center gap-2"
                    >
                      {hidden('id', post.id)}
                      <div className="min-w-[14rem] flex-1">{reason()}</div>
                      <button type="submit" className={BUTTON_PRIMARY}>
                        {actionLabel}
                      </button>
                    </OpForm>
                  </div>
                );
              })
            )}
          </section>
        ) : null}

        {showPolicy ? (
          <>
            <details className="space-y-4 rounded-xl border border-hairline p-4">
              <summary className="cursor-pointer py-2 font-medium">{c.settle}</summary>
              {form(
                'settle',
                <>
                  {input('id', c.renderId)}
                  {input('tax', c.tax, 'number', '1')}
                  {input('fees', c.fees, 'number', '1')}
                  {input('fx', c.fx, 'number', '0.000001')}
                  {submit(c.settle)}
                </>,
              )}
            </details>
            <details className="space-y-4 rounded-xl border border-hairline p-4">
              <summary className="cursor-pointer py-2 font-medium">{c.policy}</summary>
              <p className="text-sm opacity-65">{c.policyHint}</p>
              {form(
                'policy',
                <>
                  {input('version', c.version)}
                  {input('termsVersion', c.termsVersion)}
                  {input('costPerCredit', c.cost, 'number', '1')}
                  {input('cap', c.cap, 'number', '1')}
                  {submit(c.configure)}
                </>,
              )}
            </details>
            <details className="space-y-4 rounded-xl border border-hairline p-4">
              <summary className="cursor-pointer py-2 font-medium">{c.offer}</summary>
              {form(
                'offer',
                <>
                  {input('id', c.templateId)}
                  {input('credits', c.credits, 'number', '1')}
                  {input('maxCost', c.maxCost, 'number', '1')}
                  {submit(c.offerAdd)}
                </>,
              )}
              {offers.map((o) => (
                <section key={o.id}>
                  <p className="my-3 text-sm">
                    {o.title} · {o.credits}
                  </p>
                  {form('offerDisable', submit(c.offerDisable), o.id)}
                </section>
              ))}
            </details>
            <details className="space-y-4 rounded-xl border border-hairline p-4">
              <summary className="cursor-pointer py-2 font-medium">{c.auditHistory}</summary>
              {history.length ? (
                history.map((h) => (
                  <section key={h.id} className="space-y-2 border-t border-hairline pt-3 text-xs">
                    <p className="break-all opacity-65">
                      {String(h.created_at)} · {h.actor_id}
                    </p>
                    <p>{h.action}</p>
                    <p className="whitespace-pre-wrap break-words">{h.reason}</p>
                  </section>
                ))
              ) : (
                <p className="text-sm">{c.auditEmpty}</p>
              )}
            </details>
          </>
        ) : null}
      </div>
    </div>,
  );
}
