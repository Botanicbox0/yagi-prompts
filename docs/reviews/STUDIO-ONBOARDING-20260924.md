# Self-serve studio onboarding — 2026-09-24

Branch `codex/studio-onboarding` from `main` 43df775. Author: Claude Opus 5.5 (implementation). Commit, PR, browser checks and the full §3 loop are handled by root.

## Problem

A brand opening `/brand/studio` for the first time saw a page title, a scope/terms block, and an empty panel. The panel said to "use the button above" to request a template. Nothing explained what the studio produces, why a template comes first, or how a face gets involved. The face setup appeared as soon as a contract existed, even before any template was ready. Returning brands with templates got the same guide block above their templates.

## What changed

| Area | Change |
| --- | --- |
| Stage model | `lib/brands/production/stage.ts`: `studioStage()` → `onboarding`, `requested`, `read-only`, `templates-pending`, `ready`, `used-up`. `studioRequestStatus()` finds the brand's latest template request in the existing support thread (by the ko or en `messageTitle` heading) and checks whether TWINGS wrote after it. Layout only; every action still authorizes on the server. |
| First viewport (no contract) | The heading says what the studio does ("TWINGS가 브랜드 전용 영상 포맷을 설계하면, 같은 포맷으로 영상을 여러 편 직접 만들 수 있어요") and gives the next step. **전용 템플릿 의뢰하기** is the primary button, opening the existing `StudioInquiry` dialog with the selected brand preselected. A note under the button says a request creates no contract or payment. |
| Process | Four steps: request → format design and contract → template and verified portrait → create and download. The current step gets `aria-current="step"`; earlier steps are marked done (`components/brand-workspace/studio-onboarding.tsx`). |
| Examples | `components/brand-workspace/studio-showcase.tsx`: format video **+** reference photo **=** same format with a different person. Each example starts as its poster under a real play button with a localized name ("{name} 재생" / "Play {name}"). The `<video>` (native `controls`, `playsInline`, `preload="none"`, no autoplay/mute/loop) is hidden and has no `src` until activation (see the correction below). Playing one pauses the other, so two soundtracks never overlap. The videos are never synchronized. The copy says shots and length differ between people, that results vary, that not every photo works, and that AI video may not be perfect. The photo caption says the studio accepts only the account holder's own verified face. |
| Request pending | After a request is sent, the page reports it as received with the send time and points at 스튜디오에 문의 (bottom right). Once TWINGS replies, it says a reply is waiting. The process moves to step 2 and a second request becomes a secondary button. `StudioInquiry` now calls `router.refresh()` when a sent dialog closes, so this state appears immediately. |
| Templates pending | "전용 템플릿을 준비하고 있어요" note. **No face setup yet**: the portrait query and identity prompt run only once a template exists. |
| Ready (returning) | Templates come first. The whole explanation (process, examples, scope) is folded into one closed `<details>` titled "셀프 스튜디오 이용 방법". The request button becomes secondary: "템플릿 추가 의뢰하기". |
| No usable contract | When no contract can start a video, a page-level note gives every possible cause without claiming which one applies: not started yet, ended, paused, or allowance used. The per-contract notes say which: `inactive` for a contract that is not active and `exhausted` for an allowance used up. Requesting more production becomes the primary action again. Viewers get a no-button variant. |
| Roles | Viewers: explanation and progress, no request button; when templates exist, a note that creating videos is for admins and editors, and no face-setup prompt. TWINGS team view: staff notice, folded help, no request button. Campaign-only guests: unchanged (shared-only note, no onboarding). |
| Scope guide | `serviceGuide.studio` no longer repeats the process (it was also missing the request step). It now lists what is **not included** (influencer sourcing, publishing and distribution, reports → campaign) and the usage terms. |
| Small a11y | Template preview videos get an accessible name (the template title). The request button gets `aria-haspopup="dialog"`. |

The page's "button above" instruction (`emptyTitle`/`emptyHint`) was removed.

## Correction: idle video presentation (after browser QA)

Root's 390px screenshots showed Chrome's native loading spinner over **both** idle posters. The cause was `<video controls preload="none" poster src>`: the spinner appears even though nothing has loaded. The first version's claim that "only the posters load" was true for network traffic but wrong about how the page looked.

Fix (`components/brand-workspace/studio-showcase.tsx`, CSS, ko/en keys `play`, `playVideo`, `retry`, `retryVideo`, `videoError`):
- **Idle:** a `<button class="bw-studio-play">` shows the existing poster JPG (no image editing) with a visible "재생 / Play" badge. Its accessible name includes the video name. The `<video>` is mounted but `hidden` and has **no `src`**, so no MP4 request is made and no spinner is drawn.
- **Activation (click or keyboard):** the handler sets `src` and calls `play()` in the same user gesture, so it also works where autoplay rules require a gesture (Safari). The video is shown with native controls and focus moves to it. A blocked play (`NotAllowedError`) is not treated as an error; the native play control is there.
- **One at a time:** unchanged. Starting one video pauses the other.
- **Failure:** a media `error` event or a rejected `play()` returns the tile to its poster with a "다시 시도 / Try again" button and a `role="alert"` message. Retry reloads the video inside a new user gesture.
- **Tests:** the media test now checks that the page HTML has no `.mp4` before activation, has two named play buttons with the poster image as `alt=""`, and has two hidden videos with controls, playsInline, preload none and no autoplay/muted/loop. Activation, pausing and error behaviour are browser behaviour. They are left to root's browser QA and not unit-tested with a mocked media element.

## Scope decisions

- No new DB, API, billing, provider, auth or legal changes. The request state is a read of the existing `loadBrandSupport` (same membership/staff authorization), not a new workflow.
- Identity gates are unchanged: own portrait, camera check when due, role checks, allowance and contract window, and `ProductionCreate`'s disabled conditions. The showcase uses several people only as an example; it adds no upload path and relaxes nothing.
- No prices, turnaround times or results are claimed. The theme ("하이틴 로맨스 / high-school romance") describes the supplied examples.
- Demo media paths are fixed in `STUDIO_DEMO`. The UI never shows file names or person names.
- The 9:16/16:9 aspect of real brand templates is unaffected. The examples are 1280×720 and the photo is 1206×2075, taken from root's `assets-ready.json`.

## UX audit findings (by priority; 1–2 resolved in the follow-up, 3–5 open)

1. **P2 · Studio output missing from the Library. Resolved in follow-up.** `/brand/library` still lists campaign content only. It now shows a short note that studio-made videos are in the studio's creation history, with a link to `/brand/studio?organizationId=…#studio-history`. The link keeps the selected brand and follows the sidebar's `sectionVisibility` rule: members and the TWINGS team view get it, campaign-only guests do not. No extra query or history aggregation.
2. **P2 · "스튜디오 제작" naming overlap. Resolved in follow-up.** The campaign production mode label is now **TWINGS 제작 / Produced by TWINGS**. Its hint and the matching consent error now say TWINGS. The stored value `studio` and all behaviour are unchanged.
3. **P3 · Floating support launcher vs video controls on mobile.** The fixed 54px launcher (bottom right) can cover the fullscreen control of a showcase or template video when that video's bottom edge sits at the viewport bottom. It clears once the user scrolls. Root should check this on a 390px screenshot.
4. **P3 · Request status is heading-based.** A request is recognized by the `messageTitle` heading at the start of the message. If that dictionary string changes, earlier requests stop being recognized, unless the old heading is added to `REQUEST_TITLES` in the page. A typed `kind` column would be sturdier but needs a migration, so it was out of scope.
5. **P3 · Time format.** The request note uses the workspace timestamp format ("2026년 9월 20일 10:00 KST"). A date-only format would read more naturally but needs a KST day helper.

## Tests

- New `tests/brands/studio-onboarding.test.tsx` (16 tests):
  - stage transitions
  - request detection in both languages, including studio messages quoting the heading
  - first-visit heading/CTA/no-commitment note (ko/en) and selected brand in the form
  - current step, and no face prompt or portrait query before templates
  - media attributes: two videos with controls, playsInline, preload none, poster, no autoplay/muted/loop, accessible names; lazy photo with alt; honest caption
  - request waiting/answered and viewer variants
  - viewer and staff without a contract
  - returning layout: closed details before the contracts, no hero, secondary request, face prompt present
  - templates pending with no face prompt
  - used-up and exhausted notes with a primary request
  - viewer with a contract: note, no face prompt, no request
  - a paused or not-yet-started contract: the page note does not claim the contract ended or used its allowance, and the history anchor exists
- `tests/brands/workspace-identity-ui.test.tsx`: the library link appears for owner, viewer and TWINGS team view, with the selected brand in the href, and never for a campaign-only guest. It adds no service call.
- `tests/brands/quality-pass-ui.test.tsx`: the service mock gains `loadBrandSupport`. The old `emptyHint` assertions now check the onboarding markers instead; same intent (no onboarding for guests or viewers, onboarding plus workspace creation for fresh accounts).
- Existing `tests/brands/studio-page.test.tsx` (engine name never shown, identity link hosts, result link) passes unchanged.

Commands run by the implementer (focused only, per handoff):

```
# first pass
npx vitest run tests/brands tests/i18n tests/content                       → 51 files: 50 passed, 1 failed; 523 of 524 tests passed
                                                                              (the failure was a wrong assertion in the new file, fixed)
npx vitest run tests/brands tests/i18n tests/admin/studio-inbox.test.tsx   → 42 files, 401 tests passed
npx tsc --noEmit                                                           → exit 0
# follow-up (library link, production mode label, no-usable-contract wording)
npx vitest run tests/brands tests/admin tests/i18n                         → 57 files, 509 tests passed
npx tsc --noEmit                                                           → exit 0
```

Root ran the full suite after the first pass and before the follow-up: **174 files, 1,905 tests passed**. The full suite has not been re-run after the follow-up.

Not run by the implementer: full `npx vitest run`, `npm run build:local`, `npm run start:local`, `npm run sweep:anon`, any browser or screenshot check. The sweep only checks that `/brand/studio` requires login, so no sweep marker change is needed. The project has no ESLint config (`npx eslint` reports none), so no lint was run.

## Remaining, non-blocking

- Desktop (1440) and mobile (390) screenshots in both languages, a keyboard pass (Tab to the CTA, Enter opens the dialog, Esc closes it, Tab into video controls), and a network check that no `.mp4` loads before play. Root owns these.
- Confirm the operator glyphs (+ / =) sit centred against the media at common widths. The offset in `.bw-studio-demo-op` assumes about three caption lines.

## Root browser verification (2026-09-24)

Verified using installed Chrome on local fixture accounts, independently of the implementer's report:

- Korean and English at 1440×960 and 390×844: inspected screenshots, no horizontal overflow, three images loaded, no MP4 request before activation, named request dialog opens and Escape closes it.
- Fresh fixture account: create workspace from studio → send a brief → close confirmation → request-received state appears immediately. This writes only to the local snapshot process.
- Enter/Space activates both example videos; playing the second pauses the first. Actual durations 30.045 / 24.128 seconds; no media error. Simulated media network failure shows an alert; retry plays successfully and focus returns to the video.
- Existing contract fixture: ready state, explanation initially folded, templates and history visible. The Library link retains the selected organization and lands on the studio-history anchor.
- Fixed mobile request-dialog heading squeeze by limiting the hero's full-width button selector to direct children.
- Media source durations retained; both optimized videos decoded end to end without errors. Idle posters were visually inspected after the play-button correction.
- This is browser-responsive verification, not an iOS/Android native-app device certification. No generation, real payment, cloud data mutation or external message was performed for this UI change.
- Evidence lives privately in the task's temporary `twings-studio-onboarding-20260924` directory (browser-qa.json, flow-qa.json and screenshots); no customer/session information is committed.

Latest full suite after implementation changes: 174 files / 1,907 tests passed. TypeScript passed. Build, anonymous sweep and deployment outcomes are recorded in the PR once actually run.
