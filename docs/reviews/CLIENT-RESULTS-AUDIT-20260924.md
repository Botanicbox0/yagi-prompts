# Client campaign-results audit — 2026-09-24

Branch `codex/brand-results-client-audit`, base `origin/main` `b72f1537` (PR #27 + #28). Implementation by Claude Code (Opus 5.5) on Windows, in three passes: first pass, then two root review follow-ups. Nothing is committed, pushed or deployed. Root owns release, the full AGENTS §3 loop and desktop/mobile QA.

Scope: the brand customer's campaign page `/brand/projects/[id]` (all tabs), the report page `/brand/projects/[id]/reports/[reportId]`, the results CSV, the content library and the project DTO `loadBrandProject`. I read the code. No browser, live DB, Instagram, env or `.next` was touched.

## What the brand customer sees vs what only the TWINGS team sees

Tabs (`components/brand-workspace/project-tabs.tsx`): 캠페인 성과 / 브리프 / 콘텐츠 확인 / 코멘트 / 리포트 / 파일 / 계약서 / 2차 활용.

| Item | Owner / editor | Viewer (member) | Campaign-only guest | TWINGS staff on the brand page (`role: studio`) | Why |
| --- | --- | --- | --- | --- | --- |
| Results, top posts, all posts, report list and report page, CSV | yes | yes | yes | yes (read-only) | The customer's core deliverable |
| Brief incl. client-entered budget and tax basis | yes | yes | yes | yes | The customer's own request; kept |
| Content review, approve / request changes | approve | read | read | read | Role rule, unchanged |
| Comments | write | read, or write if invited to comment | same | read + staff notice | Unchanged |
| Files tab | upload + list | list | list | list incl. display images | Studio thumbnails and studio-uploaded covers are not listed to clients |
| Contracts | shared ones only | shared only | shared only | all, marked shared/unshared | `service.ts` filters `shared=true` for non-staff |
| 2nd-usage tab (inquiry, quote, payment) | yes | read | **hidden** (`loadBrandUsage` → null) | read | Commercial matter of the brand |
| Staff notice, "not yet shared" marker, admin link | no | no | no | yes | Rendered only when `role === "studio"` |
| Metric-collection console, post-card admin, raw post codes as text, creator compensation, consents, margins, payment keys | no | no | no | admin pages only (`/admin/...`) | Not rendered by `ProjectDetail`; the usage DTO has no creator amount by type |

## Findings

| # | Finding | Status |
| --- | --- | --- |
| 1 | Results CSV: internal post UUID in column 1; stored codes (`external_import`, `creator_evidence`, `instagram`, `true/false`) | **Fixed.** Row number instead of id. Platform, figure source (with "not yet verified" where true) and "approximate" are written as localized words. The origin column is removed (`lib/brands/workspace/performance.ts` `campaignCsv`) |
| 2 | A cover image uploaded by the TWINGS team was also listed in the client's Files tab | **Fixed** (`service.ts` `detail()`): hidden from clients only when uploaded by a TWINGS admin; a brand-uploaded cover stays listed. Still readable through the attachment route |
| 3 | Source + verification repeated ("스튜디오 확인 · 스튜디오 확인 완료") | **Fixed** with `metricProvenance()`: the studio's own verified check shows once. Creator-provided or unverified figures still say so, in the UI and the CSV |
| 4 | Ingestion/approval bookkeeping explained to the customer: the linked-post banner (`data-linked-posts`), the per-post "링크로 등록한 게시물" tag in cards and the report table, and the CSV origin column | **Removed from customer output** (pass 2). The `origin` field and its data are unchanged in the DB, the DTO and staff screens. Removed keys: `performance.linkedNote`, `performance.linkedPost`, `csvOrigin`, `csvOriginLabels` |
| 5 | Unknown publish date was only mentioned inside the linked-post banner | **Kept truthful** as its own note (`data-undated-posts`, reworded `undatedNote`), plus "게시일 미확인" per post and `reportUndated` on reports |
| 6 | `sourceNotice` claimed every post's measurement time differs (batch saves share one timestamp) | **Fixed**: "게시물마다 집계 시각이 다를 수 있습니다…" / "Posts may be measured at different times…" |
| 7 | Collection jargon in source labels ("크리에이터 제출 증빙", "미제공") | **Fixed**: 크리에이터 제공 자료 / 스튜디오 직접 확인 / 아직 수치 없음 / 스튜디오 검증 전·완료 (EN equivalents). Staff dropdowns reuse these labels with the same meaning |
| 8 | Tab label "비공개 파일" / "Private files" | **Fixed**: "파일" / "Files". Tab id `#files` and deep links unchanged |
| 9 | Pending-card note described tooling | **Fixed**: the posts join the gallery once their images are ready, and the totals already include them |
| 10 | Contracts empty state read as if the client should add one | **Fixed**: `managed.contractEmptyClient` for customers; staff keeps the old text |
| 11 | Campaign-only guests can download shared contract PDFs while the 2nd-usage tab is hidden from them | **Not changed. Needs a decision from the CEO** |
| 12 | Studio-uploaded images never assigned to a post (or other studio-shared files) stay in the client's Files tab under their upload filename | **Remaining.** The studio can share files on purpose this way. Check Morphic's Files tab after the thumbnail agent finishes |
| 13 | The 2nd-usage tab labelled external-post subjects "링크로 추가한 게시물" / "Linked post" (key `secondaryUsage.linkedPost`, also shown on the staff usage page) | **Fixed** (pass 3): "게시 콘텐츠" / "Published content". Subject identifiers, `origin` and usage logic are unchanged |
| 14 | `ProjectTabs` opened `#usage` (and `#usage=post:<id>`) even for viewers without the usage tab, leaving an empty panel | **Fixed** (pass 3, `project-tabs.tsx`): `tabForViewer()`. A tab the viewer lacks falls back to results. A non-tab fragment (in-page anchor or junk) changes nothing and never throws. An authorized `#usage=post:<id>` still opens usage. The effect re-subscribes if `usage` changes. No auth change |
| 15 | English notices read "1 posts" | **Fixed** for the notices changed in this audit: `undatedNote` "Posts without a confirmed publish date: {count}." and `pendingCards` "Posts awaiting images: {count}. …". **Not changed** (pre-existing, outside the edit): `coverage` "{known} / {total} posts measured", `rateCoverage` "Based on {count} posts…", unused `metricAction` |

## Remaining exposure, classified

**Financial / private: none found on customer output.**
- The client sees their own budget, their own quote totals and their own payment amounts, as agreed.
- The usage DTO carries no creator amount, consent, margin, internal reason or payment key. This is enforced by `lib/brands/usage/types.ts` and the existing usage tests. I did not re-audit that service line by line in this pass.
- Unshared contracts, and staff-only contract uploads (`contractUploads` is empty for non-staff), are not sent to the customer.

**Harmless internal identifiers (not visible text, no private meaning).** These are needed for mutations, deep links and the sweep:
- `ActionForm` hidden fields: `projectId`, `contentVersionId`, `expectedRevision`.
- `data-post-card`, `data-content-version` and `data-usage-cta` attributes, and `#usage=post:<uuid>` links.
- The RSC payload of the client component `CampaignPerformance`. It carries the full post DTO: `id`, `origin`, `verification`, `metricsSource`, `metricRevision`, `presentation.revision`, `followersSource`. `origin` is still in this payload, as root requested (data intact), but is no longer rendered or exported.
- Attachment URLs are private routes that re-authorize every read.

## Pass 3 test note

The repo has no DOM test environment (no jsdom, happy-dom or testing-library), and no dependency was added. `tests/brands/project-tabs-hash.test.tsx` therefore captures React's `useEffect`/`useState` for that file only. It renders the real `ProjectTabs`, runs its registered effect against a stubbed `location`/`window`/`document`, fires `hashchange` and checks the tab the setter opens, the scroll target and listener cleanup. Against the original `project-tabs.tsx`, the guest `#usage` case failed (2 of 6 tests failed: that case and the new-helper test). With the fix, 6 of 6 pass. This is not a real-browser test; root's browser QA covers that.

## Files

- `lib/brands/workspace/service.ts` — client file list excludes a staff-uploaded cover
- `lib/brands/workspace/performance.ts` — `metricProvenance()`, `CampaignCsvLabels` (`platform`, `source`, `verification`, `yes`, `no`), row-number CSV without an origin column
- `components/brand-workspace/performance.tsx` — no linked banner or tag, standalone undated note, provenance, localized CSV
- `components/brand-workspace/project-detail.tsx` — report table: no linked tag, publish date or "unconfirmed", provenance
- `components/brand-workspace/contracts.tsx` — client empty state
- `components/brand-workspace/project-tabs.tsx` — `tabForViewer()`, unavailable-tab fallback
- `messages/ko.ts`, `messages/en.ts` — copy above
- Tests: `tests/brands/client-results-audit.test.tsx` (new, 13 tests), `tests/brands/project-tabs-hash.test.tsx` (new, 6 tests), `tests/brands/post-presentation.test.ts` (+2 service tests: staff cover hidden / brand cover kept; content-version image kept even as cover, with attachment-route access unchanged for owner, staff, other-campaign guest and outsider), updated assertions in `tests/brands/client-sharing-ui.test.tsx`, `tests/brands/post-cards-ui.test.tsx`, `tests/brands/client-sharing.test.ts`

## Verification (final, run by me after pass 3)

- `npx tsc --noEmit` → exit 0
- `npx vitest run tests/brands/project-tabs-hash.test.tsx tests/brands/post-presentation.test.ts tests/brands/client-results-audit.test.tsx` → 3 files, 33 tests passed (6 + 14 + 13)
- `npx vitest run` on project-tabs-hash, post-presentation, client-results-audit, usage-ui, project-polish-ui, post-cards-ui, client-sharing-ui and tests/i18n → 10 files, 116 tests passed
- `npx vitest run tests/brands tests/i18n` → 43 files, 418 tests passed

### Earlier (pass 2)

- `npx tsc --noEmit` → exit 0
- `npx vitest run tests/brands/client-results-audit.test.tsx tests/brands/client-sharing-ui.test.tsx tests/brands/post-cards-ui.test.tsx tests/brands/client-sharing.test.ts tests/brands/performance.test.ts` → 5 files, 74 tests passed
- `npx vitest run tests/brands/client-results-audit.test.tsx tests/brands/post-presentation.test.ts` → 2 files, 26 tests passed (13 + 13)
- `npx vitest run tests/brands tests/i18n` → 42 files, 411 tests passed

Skipped (root owns these): full `vitest run`, `build:local`, `start:local`, `sweep:anon`, desktop/mobile visual QA, live data checks. No sweep marker was used by `scripts/` for the removed `data-linked-posts` (grep: none).

## Risks

- Anyone who parsed the old CSV (`Post ID`, `origin` column, code values) must switch to the post URL. The file now has 13 columns.
- Staff console dropdowns show the new source/verification wording.
- Finding 11 needs a CEO decision. Finding 12 needs a data check on the live campaign.

## Independent executor review (2026-09-24)

- Verified the CLI result identifies `claude-opus-5-5`; root reviewed its diff and requested removal of all customer-facing ingestion-origin bookkeeping, including CSV and secondary-usage labels.
- A normal brand-owner local fixture was opened in installed Chrome at 1440px and 390px, in Korean and English. All eight tabs opened; four real CSV downloads had 13 columns and no stored origin/source codes; no page errors or horizontal document overflow. Screenshots were inspected. This is browser viewport verification, not testing on a physical phone.
- Owner/editor/viewer/campaign-guest visibility is covered in component/service regressions. The live authenticated browser is a TWINGS staff account, so its staff notice is expected and does not prove customer-role rendering. No real customer account was impersonated.
- Operational data check found zero ready workspace images unassigned to posts, covers or content versions for the current client campaign. Finding 12 requires no cleanup there. Uploaded files were not deleted.
- Shared-contract access for campaign guests remains the existing explicitly-shared policy; no new access was granted. Financial amounts, legal text, auth/billing policies, provider flags and frozen report data were not changed.
- The final Opus pass fixes unavailable `#usage` deep links by opening performance, with effect/hashchange regression coverage; authorized deep links stay intact. It also checks cover/content attachment visibility and access, and uses count-neutral English notices.
- Final Opus focused checks: typecheck passed; 10 affected test files / 116 tests passed; brands+i18n 43 files / 418 tests passed. Full release checks are recorded below after execution.

### Release validation

- `npx tsc --noEmit`: passed.
- `npx vitest run`: 176 files / 1,930 tests passed.
- `npm run build:local`: passed.
- `npm run start:local`: production server started on 3000.
- `npm run sweep:anon`: SWEEP PASSED, 664/664.
- `node scripts/smoke-workspace-hosts.mjs 3000`: 97/97 passed.
- No migrations, environment changes, or public-generation flag changes.
- Preview / production deployment evidence will be attached to the PR after deployment. Remote CI is not claimed by these local checks.
