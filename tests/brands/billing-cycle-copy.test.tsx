import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BillingPageClient } from '@/components/brand-billing/billing-page-client';
import { errorLine } from '@/components/brand-studio/copy';
import { soundErrorLine, SoundStudio } from '@/components/brand-studio/sound/sound-studio';
import { StudioApp } from '@/components/brand-studio/studio-app';
import { StudioAllowanceNotice } from '@/components/brand-studio/studio-allowance-notice';
import { reverseRunLine } from '@/components/brand-studio/video/reverse';
import { VideoStudioWorkspace } from '@/components/brand-studio/video/workspace';
import { workflowErrorLine, WorkflowsHub } from '@/components/brand-studio/workflows/workflows-hub';
import { FirstRunChecklist } from '@/components/brand-workspace/home/first-run-checklist';
import { MemberUsageSection } from '@/components/brand-workspace/rail-usage';
import type { StudioAllowanceView } from '@/lib/brand-studio/contracts';
import { memberUsage } from '@/lib/brand-studio/member-usage';
import { allowanceView, allowanceWindow, loadAllowance } from '@/lib/brand-studio/usage';
import { loadBrandBillingPageState, loadCustomerExtraGrants } from '@/lib/brands/billing-page-data';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { asset, ORG, studioState } from '@/tests/brand-studio/ui/fixtures';

/**
 * R1: the thirteen "이번 달" / "매달 1일" strings on the brand side. A calendar-month organization (an allowance
 * override, or no plan) keeps every character it sees today, in ko and en; a plan organization, whose credits run on a
 * billing cycle (B1c), sees the "이번 이용 기간" wording with its cycle's real dates.
 */

type Locale = 'ko' | 'en';
type Key =
  | 'explainer'
  | 'allowanceUsedLabel'
  | 'exhaustedWithQuote'
  | 'exhaustedGeneric'
  | 'readyBody'
  | 'dockUsage'
  | 'allowanceExhausted'
  | 'usageTitle'
  | 'usageHint'
  | 'usageEmpty'
  | 'soundAllowance'
  | 'videoClosed'
  | 'workflowsExhausted';

/** Today's text, pinned literally: an accidental edit of an existing key fails here, not only on screen. */
const TODAY: Record<Locale, Record<Key, string>> = {
  ko: {
    explainer: '크레딧은 이미지, 영상, 사운드, 워크플로우 제작 시 사용하는 월간 한도입니다. 남은 크레딧은 매달 1일(한국 시간 기준)에 초기화됩니다.',
    allowanceUsedLabel: '이번 달 사용량',
    exhaustedWithQuote: '이번 달 크레딧이 부족합니다 (필요 {needed} · 남음 {left}). 다음 초기화일은 {resetDate}입니다.',
    exhaustedGeneric: '이번 달 크레딧을 모두 사용했습니다. 다음 초기화일은 {resetDate}입니다.',
    readyBody: '이번 달 제작 크레딧이 준비되어 바로 사용하실 수 있습니다.',
    dockUsage: '이번 달 크레딧',
    allowanceExhausted: '이번 달 한도를 넘어서 만들 수 없어요.',
    usageTitle: '이번 달 크레딧 사용',
    usageHint: '이번 달 1일부터 멤버마다 쓴 크레딧이에요. 실패하거나 취소한 작업은 세지 않아요.',
    usageEmpty: '이번 달에는 아직 쓴 크레딧이 없어요.',
    soundAllowance: '이번 달 크레딧이 부족해요.',
    videoClosed: '이번 달 크레딧이 없어서 지금은 만들 수 없어요.',
    workflowsExhausted: '이번 달 남은 크레딧이 부족해 모든 단계를 실행할 수 없습니다.',
  },
  en: {
    explainer:
      'Credits measure monthly studio creation across image, video, sound, and workflows. Monthly credits reset on the 1st of each month (KST).',
    allowanceUsedLabel: 'Used this month',
    exhaustedWithQuote: 'Not enough credits this month ({needed} needed · {left} left). Resets on {resetDate}.',
    exhaustedGeneric: 'This month’s credits are used up. Resets on {resetDate}.',
    readyBody: "This month's creation credits are ready to use.",
    dockUsage: 'Credits this month',
    allowanceExhausted: 'This run would go over this month’s limit.',
    usageTitle: 'Credits used this month',
    usageHint: 'What each person has used since the 1st, Korea time. Failed and canceled runs are not counted.',
    usageEmpty: 'Nobody has used credits this month yet.',
    soundAllowance: 'Not enough credits this month.',
    videoClosed: 'Your team has no credits this month, so nothing can be made right now.',
    workflowsExhausted: 'Not enough credits left this month to run all steps.',
  },
};

/** The approved cycle drafts (대표 확인 대기, 2026-11-24). */
const CYCLE: Record<Locale, Record<Key, string>> = {
  ko: {
    explainer: '크레딧은 이미지, 영상, 사운드, 워크플로우 제작 시 사용하는 월간 한도입니다. 남은 크레딧은 {date}(한국 시간 기준)에 초기화됩니다.',
    allowanceUsedLabel: '이번 이용 기간 사용량',
    exhaustedWithQuote: '이번 이용 기간 크레딧이 부족합니다 (필요 {needed} · 남음 {left}). 다음 초기화일은 {resetDate}입니다.',
    exhaustedGeneric: '이번 이용 기간 크레딧을 모두 사용했습니다. 다음 초기화일은 {resetDate}입니다.',
    readyBody: '제작 크레딧이 준비되어 바로 사용하실 수 있습니다.',
    dockUsage: '이번 이용 기간 크레딧',
    allowanceExhausted: '이번 이용 기간 한도를 넘어서 만들 수 없어요.',
    usageTitle: '이번 이용 기간 크레딧 사용',
    usageHint: '{date}부터 멤버마다 쓴 크레딧이에요. 실패하거나 취소한 작업은 세지 않아요.',
    usageEmpty: '이번 이용 기간에는 아직 쓴 크레딧이 없어요.',
    soundAllowance: '크레딧이 부족해요.',
    videoClosed: '크레딧이 없어서 지금은 만들 수 없어요.',
    workflowsExhausted: '이번 이용 기간 남은 크레딧이 부족해 모든 단계를 실행할 수 없습니다.',
  },
  en: {
    explainer: 'Credits are the monthly limit for creating images, videos, sounds, and workflows. Remaining credits reset on {date} (KST).',
    allowanceUsedLabel: 'Usage for this usage period',
    // The existing en sibling puts the numbers first ("{needed} needed · {left} left"); kept.
    exhaustedWithQuote: 'Not enough credits for this usage period ({needed} needed · {left} left). Resets on {resetDate}.',
    exhaustedGeneric: 'This usage period’s credits are used up. Resets on {resetDate}.',
    readyBody: 'Your production credits are ready to use.',
    dockUsage: 'Credits for this usage period',
    allowanceExhausted: 'You’ve reached this usage period’s limit, so nothing can be made right now.',
    usageTitle: 'Credit use this usage period',
    usageHint: 'Credits each member has used since {date}. Failed or cancelled work isn’t counted.',
    usageEmpty: 'No credits used yet in this usage period.',
    soundAllowance: 'Not enough credits.',
    videoClosed: 'Your team has no credits, so nothing can be made right now.',
    workflowsExhausted: 'Not enough credits left in this usage period to run every step.',
  },
};

/** The dictionary keys behind each string: [existing key, its cycle sibling]. */
function keys(locale: Locale): Record<Key, [string, string]> {
  const d = getDictionary(locale);
  const c = d.brandBilling.customer;
  return {
    explainer: [c.usageSection.explainer, c.usageSection.explainerCycle],
    allowanceUsedLabel: [c.allowanceUsedLabel, c.allowanceUsedLabelCycle],
    exhaustedWithQuote: [c.studioStates.exhaustedWithQuote, c.studioStates.exhaustedWithQuoteCycle],
    exhaustedGeneric: [c.studioStates.exhaustedGeneric, c.studioStates.exhaustedGenericCycle],
    readyBody: [d.brandHome.checklist.usage.readyBody, d.brandHome.checklist.usage.readyBodyCycle],
    dockUsage: [d.brandStudio.dock.usage, d.brandStudio.dock.usageCycle],
    allowanceExhausted: [d.brandStudio.errors.allowance_exhausted, d.brandStudio.errorsCycle.allowance_exhausted],
    usageTitle: [d.studioShell.usage.title, d.studioShell.usage.titleCycle],
    usageHint: [d.studioShell.usage.hint, d.studioShell.usage.hintCycle],
    usageEmpty: [d.studioShell.usage.empty, d.studioShell.usage.emptyCycle],
    soundAllowance: [d.studioSound.errors.allowance, d.studioSound.errors.allowanceCycle],
    videoClosed: [d.studioVideo.reverse.run.closed, d.studioVideo.reverse.run.closedCycle],
    workflowsExhausted: [d.studioWorkflows.errors.allowanceExhausted, d.studioWorkflows.errors.allowanceExhaustedCycle],
  };
}

/** How `renderToStaticMarkup` writes text. */
const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

const NOW = new Date('2026-12-03T01:00:00Z'); // 3 Dec, Korea time: inside the Nov 17 → Dec 17 cycle
const CLAMP_NOW = new Date('2027-03-10T01:00:00Z'); // 10 Mar 2027: the Jan 31 plan's Feb 28 → Mar 31 cycle
const ENV = { defaultMonthlyKrw: 50_000, planGraceDays: 14 };

let f: StudioFixture;
const org = { plan: '', override: '', noPlan: '', clamp: '' };

async function addOrg(name: string): Promise<string> {
  const id = randomUUID();
  await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, name, f.ids.owner, randomUUID()]);
  await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [id, f.ids.owner]);
  return id;
}
const plan = (orgId: string, startedOn: string) =>
  f.sql.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', $2, null, 1)",
    [orgId, startedOn],
  );
const grant = (orgId: string, krw: number, month: string, createdIso: string, revoked = false) =>
  f.sql.query(
    `insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason, created_at, revoked_at)
     values ($1, $2, $3, 'fixture', $4, $5)`,
    [orgId, krw, month, createdIso, revoked ? createdIso : null],
  );
const used = (orgId: string, krw: number, iso: string) =>
  f.sql.query(
    `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, estimate_krw, usage_krw, created_at, finished_at)
     values ($1, $2, $3, 'image', 'succeeded', 'seedream-5.5', 'p', $4, $4, $5, $5)`,
    [orgId, f.ids.owner, `use_${randomUUID().slice(0, 12)}`, krw, iso],
  );
const view = async (orgId: string, now = NOW): Promise<StudioAllowanceView> => allowanceView(await loadAllowance(f.sql, orgId, ENV, now));

beforeAll(async () => {
  f = await studioFixture({ capKrw: null });
  await f.sql.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000)");
  org.plan = f.orgId;
  await plan(org.plan, '2026-11-17');
  // An override wins over a plan: still the calendar month.
  org.override = await addOrg('Override fixture');
  await f.sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, 500000)', [org.override]);
  await plan(org.override, '2026-11-17');
  org.noPlan = await addOrg('No plan fixture');
  org.clamp = await addOrg('Clamp fixture');
  await plan(org.clamp, '2027-01-31');
}, 60_000);

afterAll(async () => {
  await f?.db.close();
});

describe('the dictionaries', () => {
  it('keep every existing key exactly as it is today, and hold the approved cycle drafts in new sibling keys', () => {
    for (const locale of ['ko', 'en'] as const) {
      for (const [name, [existing, cycle]] of Object.entries(keys(locale)) as [Key, [string, string]][]) {
        expect(existing, `${locale}.${name} (existing)`).toBe(TODAY[locale][name]);
        expect(cycle, `${locale}.${name} (cycle)`).toBe(CYCLE[locale][name]);
      }
    }
  });
});

describe('the window each organization runs on', () => {
  it('a plan organization: its cycle (17th → 17th); an override or no plan: the calendar month; Jan 31 clamps to Feb 28 → Mar 31', async () => {
    expect((await view(org.plan)).window).toEqual({ kind: 'cycle', start: '2026-11-17', end: '2026-12-17' });
    expect((await view(org.override)).window).toEqual({ kind: 'month', start: '2026-12-01', end: '2027-01-01' });
    expect((await view(org.noPlan)).window).toEqual({ kind: 'month', start: '2026-12-01', end: '2027-01-01' });
    expect((await view(org.clamp, CLAMP_NOW)).window).toEqual({ kind: 'cycle', start: '2027-02-28', end: '2027-03-31' });
    expect((await view(org.clamp, new Date('2027-03-31T01:00:00Z'))).window).toEqual({ kind: 'cycle', start: '2027-03-31', end: '2027-04-30' });
  });
});

/** Every month case (the override and the no-plan organization) and the cycle cases with their dates. */
const MONTH_CASES = [
  { name: 'override', orgId: () => org.override, now: NOW },
  { name: 'no plan', orgId: () => org.noPlan, now: NOW },
] as const;
const CYCLE_CASES = [
  // refill = the cycle's end day (the next 17th); since = this cycle's 17th
  { name: 'plan from the 17th', orgId: () => org.plan, now: NOW, refill: '2026-12-17', since: { ko: '11월 17일', en: 'November 17' } },
  { name: 'plan from Jan 31 (clamped)', orgId: () => org.clamp, now: CLAMP_NOW, refill: '2027-03-31', since: { ko: '2월 28일', en: 'February 28' } },
] as const;

describe('1. billing page: the usage explainer', () => {
  async function usageSection(orgId: string, now: Date, locale: Locale): Promise<string> {
    const state = await loadBrandBillingPageState({ sql: f.sql, env: ENV, now: () => now, locale }, viewerOf(f.ids.owner), {
      id: orgId,
      name: 'Fixture',
      role: 'owner',
    });
    if (state.kind !== 'ready') throw new Error(`billing state ${state.kind}`);
    const html = renderToStaticMarkup(
      <BillingPageClient organizationId={orgId} organizationName="Fixture" initialBilling={state.billing} copy={getDictionary(locale).brandBilling.customer} locale={locale} />,
    );
    return html.match(/data-billing-section="usage"[\s\S]*?<\/section>/)![0]!;
  }

  for (const locale of ['ko', 'en'] as const) {
    for (const c of MONTH_CASES) {
      it(`${locale} · ${c.name}: today's text`, async () => {
        const html = await usageSection(c.orgId(), c.now, locale);
        expect(html).toContain(esc(TODAY[locale].explainer));
      });
    }
    for (const c of CYCLE_CASES) {
      it(`${locale} · ${c.name}: refills on ${c.refill}`, async () => {
        const html = await usageSection(c.orgId(), c.now, locale);
        expect(html).toContain(esc(fill(CYCLE[locale].explainer, { date: c.refill })));
        expect(html).not.toContain(esc(TODAY[locale].explainer));
      });
    }
  }
});

describe('3, 4. the exhausted notice (dictionary copy and the component fallback copy)', () => {
  function notice(v: StudioAllowanceView, locale: Locale, opts: { quote: boolean; dictionary: boolean }) {
    return renderToStaticMarkup(
      <StudioAllowanceNotice
        kind="exhausted"
        organizationId={ORG}
        locale={locale}
        billingCopy={opts.dictionary ? getDictionary(locale).brandBilling.customer : undefined}
        neededCredits={opts.quote ? 40 : null}
        remainingCredits={opts.quote ? 12 : null}
        resetsAt={v.resetsAt}
        allowanceWindow={v.window}
        surface="studio_image"
      />,
    );
  }
  const quoteValues = (resetDate: string) => ({ needed: '40', left: '12', resetDate });

  for (const locale of ['ko', 'en'] as const) {
    for (const dictionary of [true, false]) {
      const source = dictionary ? 'dictionary' : 'fallback';
      for (const c of MONTH_CASES) {
        it(`${locale} · ${source} · ${c.name}: today's text, reset on the next 1st`, async () => {
          const v = await view(c.orgId(), c.now);
          expect(notice(v, locale, { quote: true, dictionary })).toContain(esc(fill(TODAY[locale].exhaustedWithQuote, quoteValues('2027-01-01'))));
          expect(notice(v, locale, { quote: false, dictionary })).toContain(esc(fill(TODAY[locale].exhaustedGeneric, { resetDate: '2027-01-01' })));
        });
      }
      for (const c of CYCLE_CASES) {
        it(`${locale} · ${source} · ${c.name}: cycle text, reset on ${c.refill}`, async () => {
          const v = await view(c.orgId(), c.now);
          expect(notice(v, locale, { quote: true, dictionary })).toContain(esc(fill(CYCLE[locale].exhaustedWithQuote, quoteValues(c.refill))));
          expect(notice(v, locale, { quote: false, dictionary })).toContain(esc(fill(CYCLE[locale].exhaustedGeneric, { resetDate: c.refill })));
        });
      }
    }
  }

  it('reaches the notice through the image, video, sound and workflows studios with the allowance they hold', async () => {
    const exhausted = (v: StudioAllowanceView): StudioAllowanceView => ({ ...v, usedKrw: v.capKrw });
    const dict = getDictionary('ko');
    const noticeOf = (html: string) => html.match(/data-studio-allowance-notice="exhausted"[\s\S]*?<\/p>/)?.[0] ?? '';
    const screens = (a: StudioAllowanceView) => [
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
    const month = screens(exhausted(await view(org.override)));
    const cycle = screens(exhausted(await view(org.plan)));
    for (const [i, html] of month.entries()) {
      const line = noticeOf(html);
      expect(line, `month screen ${i}`).toMatch(/이번 달 크레딧(이 부족합니다|을 모두 사용했습니다)/);
      expect(line, `month screen ${i}`).toContain('2027-01-01');
      expect(line, `month screen ${i}`).not.toContain('이번 이용 기간');
    }
    for (const [i, html] of cycle.entries()) {
      const line = noticeOf(html);
      expect(line, `cycle screen ${i}`).toMatch(/이번 이용 기간 크레딧(이 부족합니다|을 모두 사용했습니다)/);
      expect(line, `cycle screen ${i}`).toContain('2026-12-17');
      expect(line, `cycle screen ${i}`).not.toContain('이번 달');
    }
  });

  it('without a window (an allowance the screen got from an older response) keeps today\'s text', () => {
    const html = renderToStaticMarkup(
      <StudioAllowanceNotice kind="exhausted" organizationId={ORG} locale="ko" resetsAt="2026-12-16T15:00:00.000Z" surface="studio_image" />,
    );
    expect(html).toContain(esc(fill(TODAY.ko.exhaustedGeneric, { resetDate: '2026-12-17' })));
  });
});

describe('5. home: the first-run checklist', () => {
  const render = (v: StudioAllowanceView | null, locale: Locale) =>
    renderToStaticMarkup(
      <FirstRunChecklist
        organizationId={ORG}
        locale={locale}
        checklist={{ show: true, hasTeammate: false, hasLogo: false, hasUploads: false, usageApproved: true, hasFirstImage: false }}
        copy={getDictionary(locale).brandHome.checklist}
        allowanceWindow={v?.window ?? null}
      />,
    );
  for (const locale of ['ko', 'en'] as const) {
    it(`${locale}: today's text for the month organizations and an unknown window, the cycle text for plan organizations`, async () => {
      for (const c of MONTH_CASES) expect(render(await view(c.orgId(), c.now), locale)).toContain(esc(TODAY[locale].readyBody));
      expect(render(null, locale)).toContain(esc(TODAY[locale].readyBody));
      for (const c of CYCLE_CASES) {
        const html = render(await view(c.orgId(), c.now), locale);
        expect(html).toContain(esc(CYCLE[locale].readyBody));
        expect(html).not.toContain(esc(TODAY[locale].readyBody));
      }
    });
  }
});

describe('7, 11, 12, 13. refusals in the image/video, sound, reverse and workflows studios', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`${locale}: today's text for the month organizations and an unknown window, the cycle text for plan organizations`, async () => {
      const d = getDictionary(locale);
      const lines = (window: StudioAllowanceView['window'] | null) => ({
        allowanceExhausted: errorLine(d.brandStudio, 'allowance_exhausted', window),
        soundAllowance: soundErrorLine(d.studioSound, 'allowance_exhausted', window),
        videoClosed: reverseRunLine(d.studioVideo.reverse.run, { canCreate: true, runOpen: false, window }),
        workflowsExhausted: workflowErrorLine(d.studioWorkflows, 'allowance_exhausted', window),
      });
      const pick = (source: Record<Key, string>) => ({
        allowanceExhausted: source.allowanceExhausted,
        soundAllowance: source.soundAllowance,
        videoClosed: source.videoClosed,
        workflowsExhausted: source.workflowsExhausted,
      });
      for (const c of MONTH_CASES) expect(lines((await view(c.orgId(), c.now)).window)).toEqual(pick(TODAY[locale]));
      expect(lines(null)).toEqual(pick(TODAY[locale]));
      expect(lines(undefined)).toEqual(pick(TODAY[locale]));
      for (const c of CYCLE_CASES) expect(lines((await view(c.orgId(), c.now)).window)).toEqual(pick(CYCLE[locale]));
      // Every other code reads as before, whatever the window.
      const cycleWindow = (await view(org.plan)).window;
      expect(errorLine(d.brandStudio, 'allowance_closed', cycleWindow)).toBe(d.brandStudio.errors.allowance_closed);
      expect(soundErrorLine(d.studioSound, 'allowance_closed', cycleWindow)).toBe(d.studioSound.errors.closed);
      expect(workflowErrorLine(d.studioWorkflows, 'allowance_closed', cycleWindow)).toBe(d.studioWorkflows.errors.allowanceClosed);
      expect(reverseRunLine(d.studioVideo.reverse.run, { canCreate: false, runOpen: false, window: cycleWindow })).toBe(d.studioVideo.reverse.run.readOnly);
      expect(reverseRunLine(d.studioVideo.reverse.run, { canCreate: true, runOpen: true, window: cycleWindow })).toBeNull();
    });
  }
});

describe('8, 9, 10. team page: credits each member used', () => {
  const render = (v: StudioAllowanceView, locale: Locale) =>
    renderToStaticMarkup(
      <MemberUsageSection rows={[]} members={[]} allowance={v} copy={getDictionary(locale).studioShell.usage} otherOwner="-" locale={locale} />,
    );
  for (const locale of ['ko', 'en'] as const) {
    it(`${locale}: today's title, hint and empty line for the month organizations`, async () => {
      for (const c of MONTH_CASES) {
        const html = render(await view(c.orgId(), c.now), locale);
        for (const key of ['usageTitle', 'usageHint', 'usageEmpty'] as const) expect(html, key).toContain(esc(TODAY[locale][key]));
      }
    });
    it(`${locale}: the cycle title, hint (since the cycle start) and empty line for plan organizations`, async () => {
      for (const c of CYCLE_CASES) {
        const html = render(await view(c.orgId(), c.now), locale);
        expect(html).toContain(esc(CYCLE[locale].usageTitle));
        expect(html).toContain(esc(fill(CYCLE[locale].usageHint, { date: c.since[locale] })));
        expect(html).toContain(esc(CYCLE[locale].usageEmpty));
        for (const key of ['usageTitle', 'usageHint', 'usageEmpty'] as const) expect(html, key).not.toContain(esc(TODAY[locale][key]));
      }
    });
  }
});

describe('figures next to these strings run on the same window as the allowance', () => {
  it('team page: a plan organization counts from its cycle start, a month organization from the 1st (unchanged)', async () => {
    await used(org.plan, 1_000, '2026-11-20T01:00:00Z'); // in the Nov 17 cycle, before Dec 1
    await used(org.plan, 2_000, '2026-12-02T01:00:00Z');
    await used(org.plan, 4_000, '2026-11-10T01:00:00Z'); // before the cycle
    await used(org.override, 1_000, '2026-11-20T01:00:00Z'); // last month
    await used(org.override, 2_000, '2026-12-02T01:00:00Z');
    const rowsOf = async (orgId: string) => {
      const allowance = await loadAllowance(f.sql, orgId, ENV, NOW);
      return { allowance, rows: await memberUsage(f.sql, orgId, NOW, allowanceWindow(allowance, NOW)) };
    };
    const planned = await rowsOf(org.plan);
    expect(planned.rows.map((r) => r.usedKrw)).toEqual([3_000]);
    expect(planned.rows[0]!.usedKrw).toBe(planned.allowance.usedKrw);
    const month = await rowsOf(org.override);
    expect(month.rows.map((r) => r.usedKrw)).toEqual([2_000]);
    expect(month.rows).toEqual(await memberUsage(f.sql, org.override, NOW));
  });

  it('billing page extra credits: a plan organization lists the grants its cycle counts, until the cycle\'s last day; a month organization as before', async () => {
    await grant(org.plan, 30_000, '2026-11', '2026-11-20T01:00:00Z'); // in the cycle, a November grant
    await grant(org.plan, 20_000, '2026-12', '2026-12-02T01:00:00Z'); // in the cycle
    await grant(org.plan, 70_000, '2026-11', '2026-11-05T01:00:00Z'); // before the plan start: no cycle
    await grant(org.plan, 90_000, '2026-12', '2026-12-02T02:00:00Z', true); // revoked
    await grant(org.override, 10_000, '2026-12', '2026-12-02T01:00:00Z');
    await grant(org.override, 40_000, '2026-11', '2026-11-20T01:00:00Z');
    // The owner's page and the staff's read-only view of it.
    const state = async (orgId: string, staff = false) => {
      const s = await loadBrandBillingPageState(
        { sql: f.sql, env: ENV, now: () => NOW, locale: 'ko' },
        staff ? { ...viewerOf(f.ids.admin), isAdmin: true } : viewerOf(f.ids.owner),
        { id: orgId, name: 'Fixture', role: staff ? 'studio' : 'owner' },
      );
      if (s.kind !== 'ready') throw new Error(s.kind);
      return s.billing;
    };
    for (const staff of [false, true]) {
      const planned = await state(org.plan, staff);
      expect(planned.extraGrants?.map((g) => ({ credits: g.credits, expiresOn: g.expiresOn })), `staff ${staff}`).toEqual([
        { credits: 2_000, expiresOn: '2026-12-16' },
        { credits: 3_000, expiresOn: '2026-12-16' },
      ]);
      // The list and the allowance agree.
      expect(planned.allowance.extraKrw).toBe(50_000);
      expect(planned.allowance.window).toEqual({ kind: 'cycle', start: '2026-11-17', end: '2026-12-17' });

      const month = await state(org.override, staff);
      expect(month.extraGrants, `staff ${staff}`).toEqual(await loadCustomerExtraGrants(f.sql, org.override, NOW));
      expect(month.extraGrants?.map((g) => ({ credits: g.credits, expiresOn: g.expiresOn }))).toEqual([{ credits: 1_000, expiresOn: '2026-12-31' }]);
      expect(month.allowance.extraKrw).toBe(10_000);
      expect(month.allowance.window).toEqual({ kind: 'month', start: '2026-12-01', end: '2027-01-01' });
    }
  });
});
