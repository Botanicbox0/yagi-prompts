import type { Localized } from '@/lib/content/schemas';
import type { EntryStatus, Placement } from '@/lib/contests/schemas';
import type { AssetSpec } from './fixtures';

/**
 * PLAN §14 — the contests fixture catalog.
 *
 * Built on exactly the same idea as `scripts/fixtures.ts` and `scripts/prompt-fixtures.ts`: every
 * moderation-state entry carries a unique, greppable SENTINEL, so `npm run sweep:anon` asserts a
 * real property against a real server rather than a proxy for one.
 *
 * The demo contest is a **DRAFT and stays a draft**. That is not a convenience, it is the §14.1
 * rule: "Publishing is the founder's act (a prize is a public commitment) — the seeded demo contest
 * stays DRAFT." A published fixture contest would put a fake prize on a live site, and it would
 * also destroy the sweep's most valuable assertion: with nothing published, `/contests` must render
 * the designed EMPTY STATE, which is what a real visitor meets today.
 *
 * So the fixture is shaped to exercise three things at once:
 *   · the empty listing (nothing published ⇒ empty state + the B2B CTA);
 *   · the draft's invisibility (`/{locale}/contests/{slug}` 404s; its poster is unreachable);
 *   · the admin preview path, which is the ONLY way the detail composition renders — and, because
 *     the draft carries one entry in each status, the only place the entries rail, the moderation
 *     queue and the winners strip can be seen at all before a real contest exists.
 *
 * Dates are relative (`startsInDays` / `deadlineInDays`) and resolved by the seed against `now()`,
 * because a fixture with hardcoded 2026 dates would silently become a "closed" contest the moment
 * the clock passed it.
 */

/**
 * An entrant, with their own profile.
 *
 * Deliberately NOT the `FIXTURE_USERS` entitlement fixtures, and the reason is a rule rather than a
 * preference: §14.1 makes entries `unique (contest_id, author_id)`, so four entries need four
 * people and there are only three entitlement fixtures. (The first version of this file reused
 * them and the seed silently upserted two of the four into one row — caught in render-verify, in
 * the admin queue, by counting.) The entitlement fixtures exist to test TIERS; contest entrants are
 * a different population and now say so.
 */
export interface EntrantFixture {
  id: string;
  email: string;
  displayName: string;
}

export interface ContestEntryFixture {
  id: string;
  author: EntrantFixture;
  title: string;
  videoUrl: string;
  snsUrl: string;
  note: string;
  /** Appended to the note by the seed — one token per entry, inside the moderated bytes. */
  sentinel: string;
  status: EntryStatus;
  placement?: Placement;
  rejectReason?: string;
}

export interface ContestFixture {
  id: string;
  slug: string;
  /** Draft, and it stays that way — see the module comment. */
  status: 'draft';
  title: Localized;
  summary: Localized;
  prize: Localized;
  rules: Localized;
  brandName: string;
  brandUrl: string;
  poster?: AssetSpec;
  /** Days from the seed instant. Positive = future. */
  startsInDays: number;
  deadlineInDays: number;
  entries: ContestEntryFixture[];
}

const RULES_EN = `## What we are looking for

A short film, 30–90 seconds, made with AI tools you can name. It does not have to be polished. It has to be **yours**.

## How to enter

1. Post the film wherever you post things.
2. Paste the link in the entry form, with the account you posted it from.
3. That is it. We watch every entry back before it appears on this page.

## What we judge

- Does the idea survive the first ten seconds?
- Did the tools serve the film, or the other way round?
- Would you show it to someone who does not care about AI?

Entries close at the deadline on this page. One entry per person; replace yours as often as you like before then.`;

const RULES_KO = `## 이런 작품을 찾습니다

30–90초 단편. 어떤 AI 도구를 썼는지 말할 수 있으면 됩니다. 다듬어져 있지 않아도 괜찮습니다. **본인 작품**이면 됩니다.

## 참가 방법

1. 평소 올리시는 곳에 작품을 올려 주세요.
2. 참가 폼에 그 링크와 올린 계정을 적어 주세요.
3. 끝입니다. 모든 출품작은 이 페이지에 올라가기 전에 저희가 직접 봅니다.

## 심사 기준

- 첫 10초를 아이디어가 버티는가.
- 도구가 작품을 위해 쓰였는가, 반대인가.
- AI에 관심 없는 사람에게도 보여줄 수 있는가.

접수는 이 페이지에 적힌 마감 시각에 닫힙니다. 한 사람당 한 편이며, 마감 전에는 몇 번이든 교체할 수 있습니다.`;

const ENTRANTS = {
  hana: {
    id: 'e1000000-0000-4000-8000-000000000001',
    email: 'hana@entrant.test',
    displayName: 'Hana',
  },
  jun: {
    id: 'e1000000-0000-4000-8000-000000000002',
    email: 'jun@entrant.test',
    displayName: 'Jun',
  },
  minseo: {
    id: 'e1000000-0000-4000-8000-000000000003',
    email: 'minseo@entrant.test',
    displayName: 'Minseo',
  },
  taeyang: {
    id: 'e1000000-0000-4000-8000-000000000004',
    email: 'taeyang@entrant.test',
    displayName: 'Taeyang',
  },
} as const satisfies Record<string, EntrantFixture>;

export const CONTEST_ENTRANTS: EntrantFixture[] = Object.values(ENTRANTS);

export const CONTEST_FIXTURES: ContestFixture[] = [
  {
    id: '9c000000-0000-4000-8000-000000000001',
    slug: 'yagi-prompts-launch-film-contest',
    status: 'draft',
    title: {
      en: 'YAGI PROMPTS LAUNCH FILM CONTEST',
      ko: 'YAGI PROMPTS 런칭 단편 공모전',
    },
    summary: {
      en: 'Make a short film with the prompts on this site. Post it, send us the link, and the best three get paid.',
      ko: '이 사이트의 프롬프트로 단편을 만들어 주세요. 올리고 링크만 보내주시면 됩니다. 상위 세 편에 상금을 드립니다.',
    },
    prize: {
      en: '$3,000 · 1st $1,500 / 2nd $1,000 / 3rd $500',
      ko: '총 $3,000 · 1위 $1,500 / 2위 $1,000 / 3위 $500',
    },
    rules: { en: RULES_EN, ko: RULES_KO },
    brandName: 'YAGI WORKSHOP',
    brandUrl: 'https://yagiworkshop.xyz',
    // A poster is staged but NOT published (the contest is a draft), so the public route refuses it
    // and both the listing card and the detail hero fall back to the typographic composition — the
    // exact path a real contest takes on the day before it goes live.
    poster: {
      label: 'contest-launch-film',
      ext: 'png',
      mime: 'image/png',
      w: 1600,
      h: 900,
    },
    startsInDays: 1,
    deadlineInDays: 30,
    entries: [
      {
        id: '9d000000-0000-4000-8000-000000000001',
        author: ENTRANTS.hana,
        title: 'Last train, Yeongdeungpo',
        videoUrl: 'https://www.youtube.com/watch?v=fixture-last-train',
        snsUrl: 'https://www.instagram.com/hana.films',
        note: 'Shot entirely from the neon-alley prompt, then re-timed by hand.',
        sentinel: 'SENTINEL_ENTRY_APPROVED',
        status: 'approved',
        placement: 1,
      },
      {
        id: '9d000000-0000-4000-8000-000000000002',
        author: ENTRANTS.jun,
        title: 'Kitchen at 6am',
        videoUrl: 'https://vimeo.com/fixture-kitchen-6am',
        snsUrl: 'https://vimeo.com/jun',
        note: 'Two prompts, one room, no cuts longer than three seconds.',
        sentinel: 'SENTINEL_ENTRY_APPROVED_2',
        status: 'approved',
      },
      {
        /** Must never appear anywhere public — the moderation queue is not a preview surface. */
        id: '9d000000-0000-4000-8000-000000000003',
        author: ENTRANTS.minseo,
        title: 'Untitled rooftop test',
        videoUrl: 'https://www.tiktok.com/@fixture/video/pending',
        snsUrl: 'https://www.tiktok.com/@fixture',
        note: 'Still grading. Sending it now so it is in before the deadline.',
        sentinel: 'SENTINEL_ENTRY_PENDING',
        status: 'pending',
      },
      {
        id: '9d000000-0000-4000-8000-000000000004',
        author: ENTRANTS.taeyang,
        title: 'Stock montage',
        videoUrl: 'https://x.com/fixture/status/rejected',
        snsUrl: 'https://x.com/fixture',
        note: 'Four cuts of a handshake in a glass lobby.',
        sentinel: 'SENTINEL_ENTRY_REJECTED',
        status: 'rejected',
        rejectReason:
          'It reads as stock footage rather than a film. Send something only you would have made.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// sentinels — the sweep's oracle
// ---------------------------------------------------------------------------

export interface ContestEntrySentinel {
  token: string;
  status: EntryStatus;
  /**
   * Always false in v1, and the field exists to say so out loud: the ONLY contest fixture is a
   * draft, so not one of its entries — approved included — may appear on any public surface. The
   * moment a published fixture contest exists, the approved tokens flip to true and the sweep's
   * positive controls come with them.
   */
  publicToAnon: boolean;
}

export const CONTEST_ENTRY_SENTINELS: ContestEntrySentinel[] = CONTEST_FIXTURES.flatMap((contest) =>
  contest.entries.map((entry) => ({
    token: entry.sentinel,
    status: entry.status,
    publicToAnon: false,
  })),
);

/** Every contest slug that must 404 on the public route (all of them, in v1). */
export const HIDDEN_CONTEST_SLUGS = CONTEST_FIXTURES.filter(
  (contest) => contest.status !== ('published' as string),
).map((contest) => contest.slug);
