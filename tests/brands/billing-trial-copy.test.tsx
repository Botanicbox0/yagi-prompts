import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { BillingPageClient } from '@/components/brand-billing/billing-page-client';
import { errorLine } from '@/components/brand-studio/copy';
import { AllowanceLine } from '@/components/brand-studio/dock';
import { SoundStudio } from '@/components/brand-studio/sound/sound-studio';
import { StudioApp } from '@/components/brand-studio/studio-app';
import { StudioAllowanceNotice } from '@/components/brand-studio/studio-allowance-notice';
import { VideoStudioWorkspace } from '@/components/brand-studio/video/workspace';
import { WorkflowsHub } from '@/components/brand-studio/workflows/workflows-hub';
import { HomeCredits } from '@/components/brand-workspace/home/home-credits';
import { CreditsMeter } from '@/components/brand-workspace/rail-activity';
import { MemberUsageSection } from '@/components/brand-workspace/rail-usage';
import { allowanceViewWithRefill } from '@/lib/brand-studio/allowance-refill';
import type { StudioAllowanceView } from '@/lib/brand-studio/contracts';
import { allowanceView, loadAllowance } from '@/lib/brand-studio/usage';
import { loadBrandBillingPageState, loadCustomerExtraGrants } from '@/lib/brands/billing-page-data';
import { approveWorkspace, carryTrialGrants } from '@/lib/brands/billing/workspace-approval';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { asset, ORG, studioState } from '@/tests/brand-studio/ui/fixtures';
import { pre0184Db, recorder } from '@/tests/brands/helpers/workspace-approval-parity';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/**
 * R4: an organization whose only credits are its trial (approved workspace, no plan, no allowance override, base cap 0)
 * is told the truth — the trial words with the trial's real last day, never "다시 채워져요" / "초기화". An organization
 * with only extra credits loses the refill line. Everybody else (override, plan, env default above 0) keeps every
 * character, API field and SQL statement it has today; only the credit list names a trial grant as a trial.
 */

type Locale = 'ko' | 'en';

/** Today's text, pinned literally: an accidental edit of an existing key fails here, not only on screen. */
const TODAY = {
  ko: {
    railRefill: '{date}에 다시 채워져요',
    summary: '크레딧 {total} 중 {left} 남았어요. {date}에 다시 채워져요.',
    teamRefill: '{date}에 다시 채워져요',
    dockResets: '{date}에 다시 채워져요',
    reset: '다음 초기화 예정일: {resetDate} (한국 시간 기준)',
    explainer: '크레딧은 이미지, 영상, 사운드, 워크플로우 제작 시 사용하는 월간 한도입니다. 남은 크레딧은 매달 1일(한국 시간 기준)에 초기화됩니다.',
    exhaustedGeneric: '이번 달 크레딧을 모두 사용했습니다. 다음 초기화일은 {resetDate}입니다.',
    exhaustedWithQuote: '이번 달 크레딧이 부족합니다 (필요 {needed} · 남음 {left}). 다음 초기화일은 {resetDate}입니다.',
    extraGrantItem: '{credits} 크레딧 · 만료일 {expiryDate}',
    allowanceExhausted: '이번 달 한도를 넘어서 만들 수 없어요.',
  },
  en: {
    railRefill: 'Refills on {date}',
    summary: '{left} of {total} credits left. Refills on {date}.',
    teamRefill: 'Refills on {date}',
    dockResets: 'Refills on {date}',
    reset: 'Next reset: {resetDate} (KST)',
    explainer:
      'Credits measure monthly studio creation across image, video, sound, and workflows. Monthly credits reset on the 1st of each month (KST).',
    exhaustedGeneric: 'This month’s credits are used up. Resets on {resetDate}.',
    exhaustedWithQuote: 'Not enough credits this month ({needed} needed · {left} left). Resets on {resetDate}.',
    extraGrantItem: '{credits} credits · expires {expiryDate}',
    allowanceExhausted: 'This run would go over this month’s limit.',
  },
} as const;
type Key = keyof (typeof TODAY)['ko'];

/** The approved trial drafts (대표 확인 대기, 2026-11-24, local Gemma two passes). */
const TRIAL: Record<Locale, Record<Key, string>> = {
  ko: {
    railRefill: '{date}까지 사용할 수 있어요',
    summary: '크레딧 {total} 중 {left} 남았어요. {date}까지 사용할 수 있어요.',
    teamRefill: '{date}까지 사용할 수 있어요',
    dockResets: '{date}까지 사용할 수 있어요',
    // The screen's own placeholder name ({resetDate}) is kept.
    reset: '체험 크레딧 만료일: {resetDate} (한국 시간 기준)',
    explainer:
      '크레딧은 이미지, 영상, 사운드, 워크플로우 제작 시 사용합니다. 체험 크레딧은 {date}까지 사용할 수 있습니다. 이후에도 계속 제작하시려면 플랜을 시작해 주세요.',
    exhaustedGeneric: '체험 크레딧을 모두 사용했습니다. 계속 제작하려면 플랜을 시작해 주세요.',
    exhaustedWithQuote: '체험 크레딧이 부족합니다 (필요 {needed} · 남음 {left}). 계속 제작하려면 플랜을 시작해 주세요.',
    extraGrantItem: '체험 크레딧 {credits} · 만료일 {expiryDate}',
    allowanceExhausted: '체험 크레딧을 모두 사용해서 만들 수 없어요.',
  },
  en: {
    railRefill: 'Available until {date}',
    summary: '{left} of {total} credits left. Available until {date}.',
    teamRefill: 'Available until {date}',
    dockResets: 'Available until {date}',
    reset: 'Trial credit expiration date: {resetDate} (KST)',
    explainer:
      'Credits are used to create images, videos, sounds, and workflows. Trial credits are available until {date}. To continue creating after that, please start a plan.',
    exhaustedGeneric: "You've used all your trial credits. Please start a plan to continue.",
    exhaustedWithQuote: 'Not enough trial credits ({needed} needed · {left} left). Please start a plan to continue.',
    extraGrantItem: 'Trial credits {credits} · Expires {expiryDate}',
    allowanceExhausted: 'Cannot create more as trial credits are exhausted.',
  },
};

/** Grants without a trial: the existing sentence without its refill sentence (no new sentence is written). */
const GRANTS_ONLY = {
  ko: {
    summary: '크레딧 {total} 중 {left} 남았어요.',
    explainer: '크레딧은 이미지, 영상, 사운드, 워크플로우 제작 시 사용하는 월간 한도입니다.',
    exhaustedGeneric: '이번 달 크레딧을 모두 사용했습니다.',
    exhaustedWithQuote: '이번 달 크레딧이 부족합니다 (필요 {needed} · 남음 {left}).',
  },
  en: {
    summary: '{left} of {total} credits left.',
    explainer: 'Credits measure monthly studio creation across image, video, sound, and workflows.',
    exhaustedGeneric: 'This month’s credits are used up.',
    exhaustedWithQuote: 'Not enough credits this month ({needed} needed · {left} left).',
  },
} as const;

/** The dictionary keys behind each string: [existing key, its trial sibling]. */
function keys(locale: Locale): Record<Key, [string, string]> {
  const d = getDictionary(locale);
  const c = d.brandBilling.customer;
  return {
    railRefill: [d.studioShell.credits.refill, d.studioShell.credits.refillTrial],
    summary: [d.studioShell.credits.summary, d.studioShell.credits.summaryTrial],
    teamRefill: [d.studioShell.usage.refill, d.studioShell.usage.refillTrial],
    dockResets: [d.brandStudio.dock.resets, d.brandStudio.dock.resetsTrial],
    reset: [c.usageSection.reset, c.usageSection.resetTrial],
    explainer: [c.usageSection.explainer, c.usageSection.explainerTrial],
    exhaustedGeneric: [c.studioStates.exhaustedGeneric, c.studioStates.exhaustedGenericTrial],
    exhaustedWithQuote: [c.studioStates.exhaustedWithQuote, c.studioStates.exhaustedWithQuoteTrial],
    extraGrantItem: [c.usageSection.extraGrantItem, c.usageSection.extraGrantItemTrial],
    allowanceExhausted: [d.brandStudio.errors.allowance_exhausted, d.brandStudio.errorsTrial.allowance_exhausted],
  };
}

/** How `renderToStaticMarkup` writes text. */
const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
/** Refill / reset words in any form, ko and en. */
const REFILL_WORDS = /다시 채워|초기화|refill|reset/i;

const FLAG_ON = { BRAND_WORKSPACE_APPROVAL: 'on' };
const ENV0 = { defaultMonthlyKrw: 0, planGraceDays: 14 };
const ENV50 = { defaultMonthlyKrw: 50_000, planGraceDays: 14 };
const APPROVED = new Date('2026-11-24T01:00:00Z'); // 24 Nov, Korea time
const NOV = new Date('2026-11-25T01:00:00Z');
const CARRY = new Date('2026-12-01T00:30:00Z'); // the hourly job's first run in December (09:30 KST)
const DEC = new Date('2026-12-03T01:00:00Z');
/** The trial's last usable day: the last day of the month after approval (the carry keeps it). */
const THROUGH = '2026-12-31';
const THROUGH_LABEL = { rail: { ko: '12월 31일', en: 'December 31' }, dock: { ko: '12월 31일', en: 'Dec 31' } } as const;

let f: StudioFixture;
const org = { trial: '', grantsOnly: '', override: '', plan: '' };
/** Read in November before the hourly job carried what was left of the trials into December, and the job's result. */
let novemberBeforeCarry: StudioAllowanceView;
let carryResult: unknown;
const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });

async function addOrg(name: string): Promise<string> {
  const id = randomUUID();
  await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, name, f.ids.owner, randomUUID()]);
  await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [id, f.ids.owner]);
  return id;
}
const used = (orgId: string, krw: number, iso: string) =>
  f.sql.query(
    `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, estimate_krw, usage_krw, created_at, finished_at)
     values ($1, $2, $3, 'image', 'succeeded', 'seedream-5.5', 'p', $4, $4, $5, $5)`,
    [orgId, f.ids.owner, `use_${randomUUID().slice(0, 12)}`, krw, iso],
  );
async function approve(orgId: string): Promise<void> {
  const res = await approveWorkspace({ sql: f.sql, now: () => APPROVED, env: FLAG_ON }, admin(), { organizationId: orgId });
  expect(res).toMatchObject({ ok: true, created: true });
  // The grant row takes the database clock; pin it to the approval day so the plan cycle's attachment does not depend on
  // the day this test runs.
  await f.sql.query("update brand_allowance_grants set created_at = $2 where organization_id = $1 and kind = 'trial'", [orgId, APPROVED.toISOString()]);
}

/** The view a screen receives (with the refill fact), and the statements the refill loader issued for it. */
async function view(orgId: string, now: Date, env = ENV0): Promise<StudioAllowanceView> {
  return allowanceViewWithRefill(f.sql, orgId, await loadAllowance(f.sql, orgId, env, now), { now });
}

beforeAll(async () => {
  vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'on');
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
  f = await studioFixture({ capKrw: null });
  await f.sql.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000)");
  org.trial = f.orgId;
  await approve(org.trial);
  await used(org.trial, 1_000, '2026-11-24T05:00:00Z'); // 100 of the 400 trial credits used in November
  org.grantsOnly = await addOrg('Grants fixture');
  await f.sql.query(
    "insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason, created_at) values ($1, 20000, '2026-11', 'fixture', $2), ($1, 30000, '2026-12', 'fixture', $3)",
    [org.grantsOnly, '2026-11-20T01:00:00Z', '2026-12-02T01:00:00Z'],
  );
  org.override = await addOrg('Override fixture');
  await f.sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, 500000)', [org.override]);
  await approve(org.override);
  org.plan = await addOrg('Plan fixture');
  await f.sql.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-17', null, 1)",
    [org.plan],
  );
  await approve(org.plan);
  novemberBeforeCarry = await view(org.trial, NOV);
  carryResult = await carryTrialGrants({ sql: f.sql, now: () => CARRY, env: FLAG_ON, studio: ENV0 });
}, 60_000);

beforeEach(() => {
  vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'on');
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await f?.db.close();
});

/* ------------------------------------------------------------------ screens */

const notice = (v: StudioAllowanceView, locale: Locale, opts: { quote: boolean; dictionary: boolean }) =>
  renderToStaticMarkup(
    <StudioAllowanceNotice
      kind="exhausted"
      organizationId={ORG}
      locale={locale}
      billingCopy={opts.dictionary ? getDictionary(locale).brandBilling.customer : undefined}
      neededCredits={opts.quote ? 40 : null}
      remainingCredits={opts.quote ? 12 : null}
      resetsAt={v.resetsAt}
      allowanceWindow={v.window}
      allowanceRefill={v.refill}
      surface="studio_image"
    />,
  );

function screens(v: StudioAllowanceView, locale: Locale) {
  const d = getDictionary(locale);
  return {
    rail: renderToStaticMarkup(<CreditsMeter allowance={v} copy={d.studioShell} locale={locale} expanded={false} />),
    home: renderToStaticMarkup(<HomeCredits allowance={v} copy={d.studioShell} locale={locale} />),
    team: renderToStaticMarkup(<MemberUsageSection rows={[]} members={[]} allowance={v} copy={d.studioShell.usage} otherOwner="-" locale={locale} />),
    dock: renderToStaticMarkup(<AllowanceLine allowance={v} copy={d.brandStudio} locale={locale} />),
    noticeGeneric: notice(v, locale, { quote: false, dictionary: true }),
    noticeQuote: notice(v, locale, { quote: true, dictionary: true }),
    fallbackGeneric: notice(v, locale, { quote: false, dictionary: false }),
    fallbackQuote: notice(v, locale, { quote: true, dictionary: false }),
    error: errorLine(d.brandStudio, 'allowance_exhausted', v.window, v.refill),
  };
}

async function billingPage(orgId: string, now: Date, locale: Locale, env = ENV0, staff = false) {
  const state = await loadBrandBillingPageState(
    { sql: f.sql, env, now: () => now, locale },
    staff ? { ...viewerOf(f.ids.admin), isAdmin: true } : viewerOf(f.ids.owner, locale),
    { id: orgId, name: 'Fixture', role: staff ? 'studio' : 'owner' },
  );
  if (state.kind !== 'ready') throw new Error(`billing state ${state.kind}`);
  const html = renderToStaticMarkup(
    <BillingPageClient
      organizationId={orgId}
      organizationName="Fixture"
      initialBilling={state.billing}
      copy={getDictionary(locale).brandBilling.customer}
      locale={locale}
      readOnly={staff}
    />,
  );
  return { billing: state.billing, html, usage: html.match(/data-billing-section="usage"[\s\S]*?<\/section>/)![0]! };
}
/** The text a person reads: tags dropped, entities left as the markup writes them. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ');
/** Markup without class names and attribute names: text plus attribute values (tooltips, aria text) a person can meet. */
const readable = (html: string) => html.replace(/\sclass="[^"]*"/g, '').replace(/\s[\w:-]+(?==")/g, ' ');

describe('the dictionaries', () => {
  it('keep every existing key exactly as it is today, and hold the approved trial drafts in new sibling keys', () => {
    for (const locale of ['ko', 'en'] as const) {
      for (const [name, [existing, trial]] of Object.entries(keys(locale)) as [Key, [string, string]][]) {
        expect(existing, `${locale}.${name} (existing)`).toBe(TODAY[locale][name]);
        expect(trial, `${locale}.${name} (trial)`).toBe(TRIAL[locale][name]);
      }
    }
  });
});

describe('the refill fact each organization gets', () => {
  it('trial only: no refill, usable through the last day of the month after approval — in November and after the carry into December', async () => {
    expect(novemberBeforeCarry.refill).toEqual({ kind: 'none', trialThrough: THROUGH });
    expect((await view(org.trial, NOV)).refill).toEqual({ kind: 'none', trialThrough: THROUGH });
    // The trial organization and the override organization carry what is left; the plan organization's trial belongs to its cycle.
    expect(carryResult).toMatchObject({ ok: true, carried: 2, planOrganization: 1, errors: 0 });
    const december = await view(org.trial, DEC);
    expect(december.capKrw).toBe(3_000); // what was left of the trial, carried once
    expect(december.refill).toEqual({ kind: 'none', trialThrough: THROUGH });
  });

  it('grants without a trial: no refill, no trial day', async () => {
    expect((await view(org.grantsOnly, NOV)).refill).toEqual({ kind: 'none' });
    expect((await view(org.grantsOnly, DEC)).refill).toEqual({ kind: 'none' });
  });

  it('override, plan and env default above 0 (each with a trial): the view and the statements are exactly today\'s', async () => {
    const cases = [
      { orgId: org.override, env: ENV0 },
      { orgId: org.plan, env: ENV0 },
      { orgId: org.trial, env: ENV50 },
      { orgId: org.grantsOnly, env: ENV50 },
    ];
    for (const now of [NOV, DEC]) {
      for (const c of cases) {
        const before = recorder(f.db);
        const allowance = await loadAllowance(before.sql, c.orgId, c.env, now);
        const after = recorder(f.db);
        const v = await allowanceViewWithRefill(after.sql, c.orgId, await loadAllowance(after.sql, c.orgId, c.env, now), { now });
        expect(after.log, `${c.orgId} statements`).toEqual(before.log);
        expect(v).toEqual(allowanceView(allowance));
        expect(Object.keys(v)).not.toContain('refill');
      }
    }
  });

  it('a closed allowance (cap 0) runs no statement either', async () => {
    const closed = await addOrg('Closed fixture');
    const r = recorder(f.db);
    const allowance = await loadAllowance(f.sql, closed, ENV0, DEC);
    expect(allowance.capKrw).toBe(0);
    expect(await allowanceViewWithRefill(r.sql, closed, allowance, { now: DEC })).toEqual(allowanceView(allowance));
    expect(r.log).toEqual([]);
  });
});

describe('a trial-only organization reads the trial words with its real last day', () => {
  for (const locale of ['ko', 'en'] as const) {
    for (const [month, now] of [['November', NOV], ['December, after the carry', DEC]] as const) {
      it(`${locale} · ${month}: rail, home, team page, studio header, notices and refusals`, async () => {
        const v = await view(org.trial, now);
        const exhausted = { ...v, usedKrw: v.capKrw };
        const s = screens(exhausted, locale);
        const t = TRIAL[locale];
        const left = '0';
        const total = new Intl.NumberFormat(locale === 'ko' ? 'ko-KR' : 'en-US').format(v.capKrw / 10);
        const rail = THROUGH_LABEL.rail[locale];
        expect(s.rail).toContain(esc(fill(t.railRefill, { date: rail })));
        expect(s.rail).toContain(esc(fill(t.summary, { left, total, date: rail })));
        expect(s.home).toContain(esc(fill(t.summary, { left, total, date: rail })));
        expect(s.team).toContain(esc(fill(t.teamRefill, { date: rail })));
        expect(s.dock).toContain(esc(fill(t.dockResets, { date: THROUGH_LABEL.dock[locale] })));
        for (const html of [s.noticeGeneric, s.fallbackGeneric]) expect(html).toContain(esc(t.exhaustedGeneric));
        for (const html of [s.noticeQuote, s.fallbackQuote]) expect(html).toContain(esc(fill(t.exhaustedWithQuote, { needed: '40', left: '12' })));
        expect(s.error).toBe(t.allowanceExhausted);
        for (const [name, html] of Object.entries(s)) expect(readable(html), name).not.toMatch(REFILL_WORDS);
      });

      it(`${locale} · ${month}: the billing page — trial expiry, explainer and the trial row, no refill words anywhere`, async () => {
        const page = await billingPage(org.trial, now, locale);
        const t = TRIAL[locale];
        expect(page.usage).toContain(esc(fill(t.reset, { resetDate: THROUGH })));
        expect(page.usage).toContain(esc(fill(t.explainer, { date: THROUGH })));
        const credits = now === NOV ? '400' : '300';
        expect(page.usage).toContain(esc(fill(t.extraGrantItem, { credits, expiryDate: THROUGH })));
        expect(page.billing.extraGrants).toEqual([expect.objectContaining({ kind: 'trial', expiresOn: THROUGH })]);
        expect(textOf(page.html)).not.toMatch(REFILL_WORDS);
      });
    }
  }

  it('staff open the same page read-only and see the same words', async () => {
    const page = await billingPage(org.trial, DEC, 'ko', ENV0, true);
    expect(page.usage).toContain(esc(fill(TRIAL.ko.reset, { resetDate: THROUGH })));
    expect(page.usage).toContain(esc(fill(TRIAL.ko.extraGrantItem, { credits: '300', expiryDate: THROUGH })));
    expect(textOf(page.html)).not.toMatch(REFILL_WORDS);
  });

  it('reaches the notice through the image, video, sound and workflows studios with the allowance they hold', async () => {
    const v = await view(org.trial, DEC);
    const a = { ...v, usedKrw: v.capKrw };
    const dict = getDictionary('ko');
    const noticeOf = (html: string) => html.match(/data-studio-allowance-notice="exhausted"[\s\S]*?<\/p>/)?.[0] ?? '';
    const htmls = [
      renderToStaticMarkup(
        <StudioApp
          organizationId={ORG}
          organizationName="Fixture"
          locale="ko"
          copy={dict.brandStudio}
          libraryCopy={dict.studioLibrary}
          layersCopy={dict.studioLayers}
          mode="image"
          initialState={studioState({ allowance: a, assets: [asset(1)] })}
        />,
      ),
      renderToStaticMarkup(
        <VideoStudioWorkspace
          organizationId={ORG}
          organizationName="Fixture"
          locale="ko"
          copy={dict.brandStudio}
          libraryCopy={dict.studioLibrary}
          videoCopy={dict.studioVideo}
          initialState={studioState({ allowance: a, assets: [asset(1)] })}
        />,
      ),
      renderToStaticMarkup(
        <SoundStudio
          organizationId={ORG}
          locale="ko"
          copy={dict.studioSound}
          creditsCopy={dict.brandStudio.credits}
          initialTab="music"
          initialTracks={[]}
          initialJobs={[]}
          maxMode={false}
          canCreate
          audioMaxMb={20}
          hrefs={{ page: '/brand/studio/sound', compose: '/brand/studio/compose', video: '/brand/studio/video' }}
          initialAllowance={a}
        />,
      ),
      renderToStaticMarkup(
        <WorkflowsHub
          organizationId={ORG}
          locale="ko"
          canCreate
          copy={dict.studioWorkflows}
          imageStudioHref="/brand/studio"
          videoStudioHref="/brand/studio/video"
          assetsHref="/brand/library"
          initialStarters={[]}
          initialWorkflows={[]}
          initialPlaybooks={[]}
          initialRecentRuns={[]}
          initialImageAssets={[]}
          initialVideoAssets={[]}
          initialImageOutputs={[]}
          initialMcpTokens={[]}
          initialAllowance={a}
        />,
      ),
    ];
    for (const [i, html] of htmls.entries()) {
      const line = noticeOf(html);
      expect(line, `screen ${i}`).toMatch(/체험 크레딧(이 부족합니다|을 모두 사용했습니다)/);
      expect(readable(line), `screen ${i}`).not.toMatch(REFILL_WORDS);
    }
    // The image studio's header line carries the trial day in its tooltip.
    expect(htmls[0]).toContain(esc(fill(TRIAL.ko.dockResets, { date: '12월 31일' })));
  });
});

describe('an organization with extra credits and no trial loses the refill line, nothing else', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`${locale}: no refill line; sentences that carried one keep the rest of their words`, async () => {
      const v = await view(org.grantsOnly, NOV);
      const s = screens({ ...v, usedKrw: v.capKrw }, locale);
      const total = new Intl.NumberFormat(locale === 'ko' ? 'ko-KR' : 'en-US').format(v.capKrw / 10);
      const g = GRANTS_ONLY[locale];
      expect(s.rail).not.toContain('bw-rail-credits-refill');
      expect(s.rail).toContain(esc(fill(g.summary, { left: '0', total })));
      expect(s.home).toContain(esc(fill(g.summary, { left: '0', total })));
      expect(s.team).toContain('data-team-credit-total');
      expect(s.dock).not.toContain('title=');
      for (const html of [s.noticeGeneric, s.fallbackGeneric]) expect(html).toContain(`>${esc(g.exhaustedGeneric)}<`);
      for (const html of [s.noticeQuote, s.fallbackQuote]) expect(html).toContain(`>${esc(fill(g.exhaustedWithQuote, { needed: '40', left: '12' }))}<`);
      expect(s.error).toBe(TODAY[locale].allowanceExhausted);
      for (const [name, html] of Object.entries(s)) expect(readable(html), name).not.toMatch(REFILL_WORDS);

      const page = await billingPage(org.grantsOnly, NOV, locale);
      expect(page.usage).toContain(`>${esc(g.explainer)}<`);
      expect(page.usage).toContain(esc(fill(TODAY[locale].extraGrantItem, { credits: '2,000', expiryDate: '2026-11-30' })));
      expect(page.billing.extraGrants?.map((x) => x.kind)).toEqual([undefined]);
      expect(textOf(page.html)).not.toMatch(REFILL_WORDS);
    });
  }
});

describe('override, plan and env default above 0: today\'s words exactly; only the credit list names the trial', () => {
  const CASES = [
    { name: 'override + trial', orgId: () => org.override, env: ENV0, refill: { NOV: '2026-12-01', DEC: '2027-01-01' }, cycle: false },
    { name: 'plan + trial', orgId: () => org.plan, env: ENV0, refill: { NOV: '2026-12-17', DEC: '2026-12-17' }, cycle: true },
    { name: 'env default above 0 + trial', orgId: () => org.trial, env: ENV50, refill: { NOV: '2026-12-01', DEC: '2027-01-01' }, cycle: false },
  ] as const;
  const label = (day: string, locale: Locale, short = false) =>
    new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
      month: locale === 'ko' || !short ? 'long' : 'short',
      day: 'numeric',
      timeZone: 'Asia/Seoul',
    }).format(new Date(`${day}T00:00:00+09:00`));

  for (const locale of ['ko', 'en'] as const) {
    for (const c of CASES) {
      for (const [month, now] of [['NOV', NOV], ['DEC', DEC]] as const) {
        it(`${locale} · ${c.name} · ${month}`, async () => {
          const v = await view(c.orgId(), now, c.env);
          const refill = c.refill[month];
          const s = screens({ ...v, usedKrw: v.capKrw }, locale);
          const total = new Intl.NumberFormat(locale === 'ko' ? 'ko-KR' : 'en-US').format(v.capKrw / 10);
          const today = TODAY[locale];
          expect(s.rail).toContain(esc(fill(today.railRefill, { date: label(refill, locale) })));
          expect(s.rail).toContain(esc(fill(today.summary, { left: '0', total, date: label(refill, locale) })));
          expect(s.home).toContain(esc(fill(today.summary, { left: '0', total, date: label(refill, locale) })));
          expect(s.team).toContain(esc(fill(today.teamRefill, { date: label(refill, locale) })));
          expect(s.dock).toContain(esc(fill(today.dockResets, { date: label(refill, locale, true) })));
          expect(s.error).toBe(c.cycle ? getDictionary(locale).brandStudio.errorsCycle.allowance_exhausted : today.allowanceExhausted);
          if (!c.cycle) {
            expect(s.noticeGeneric).toContain(esc(fill(today.exhaustedGeneric, { resetDate: refill })));
            expect(s.noticeQuote).toContain(esc(fill(today.exhaustedWithQuote, { needed: '40', left: '12', resetDate: refill })));
          }
          for (const html of Object.values(s)) expect(readable(html)).not.toMatch(/체험|trial/i);

          const page = await billingPage(c.orgId(), now, locale, c.env);
          expect(page.usage).toContain(esc(fill(today.reset, { resetDate: refill })));
          expect(page.usage).toContain(
            esc(c.cycle ? fill(getDictionary(locale).brandBilling.customer.usageSection.explainerCycle, { date: refill }) : today.explainer),
          );
          // The list is the only place that changes: the trial row, until the day the allowance stops counting it.
          const trialRows = (page.billing.extraGrants ?? []).filter((g) => g.kind === 'trial');
          expect(trialRows).toHaveLength(1);
          expect(trialRows[0]!.expiresOn).toBe(c.cycle ? '2026-12-16' : THROUGH);
          expect(page.usage).toContain(esc(fill(TRIAL[locale].extraGrantItem, { credits: String(trialRows[0]!.credits), expiryDate: trialRows[0]!.expiresOn })));
          expect(page.billing.allowance).not.toHaveProperty('refill');
        });
      }
    }
  }
});

describe('flag off or the 0184 schema not ready: nothing changes, nothing throws', () => {
  it('flag off: the trial-only organization keeps today\'s words and the loader runs no statement', async () => {
    vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'off');
    const r = recorder(f.db);
    const allowance = await loadAllowance(f.sql, org.trial, ENV0, DEC);
    const v = await allowanceViewWithRefill(r.sql, org.trial, allowance, { now: DEC });
    expect(r.log).toEqual([]);
    expect(v).toEqual(allowanceView(allowance));
    const s = screens(v, 'ko');
    expect(s.rail).toContain(esc(fill(TODAY.ko.railRefill, { date: '1월 1일' })));
    const page = await billingPage(org.trial, DEC, 'ko');
    expect(page.usage).toContain(esc(fill(TODAY.ko.reset, { resetDate: '2027-01-01' })));
    expect(page.usage).toContain(esc(TODAY.ko.explainer));
    expect(page.usage).toContain(esc(fill(TODAY.ko.extraGrantItem, { credits: '300', expiryDate: '2026-12-31' })));
    expect(page.billing.extraGrants?.map((g) => g.kind)).toEqual([undefined]);
  });

  it('schema before 0184 with the flag on: no refill fact, the list as before, no throw', async () => {
    const db = await pre0184Db();
    try {
      const sql = runner(db);
      const owner = randomUUID();
      await seedProfile(sql, { id: owner, email: 'r4-pre0184@fixture.invalid' });
      const orgId = randomUUID();
      await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [orgId, 'Pre 0184', owner, randomUUID()]);
      await sql.query("insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason) values ($1, 4000, '2026-12', 'fixture')", [orgId]);
      const allowance = await loadAllowance(sql, orgId, ENV0, DEC);
      expect(allowance.capKrw).toBe(4_000);
      expect(await allowanceViewWithRefill(sql, orgId, allowance, { now: DEC })).toEqual(allowanceView(allowance));
      expect((await loadCustomerExtraGrants(sql, orgId, DEC)).map((g) => g.kind)).toEqual([undefined]);
    } finally {
      await db.close();
    }
  });
});
