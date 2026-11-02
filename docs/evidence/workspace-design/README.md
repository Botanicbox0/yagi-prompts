# Workspace design verification

## Outcome

Brand home now presents pending reviews, campaign covers/status and the latest content versions. Studio operations prioritizes new briefs and requested revisions in a compact list. Both use a quiet workspace canvas, the existing TWINGS lockup, Helvetica Neue and Pretendard Variable. Brand login describes actual content categories beside corresponding images; landscape examples retain their full composition.

## Scope and dependencies

- Branch: `codex/brand-workspace-design`.
- Based on campaign reporting PR #11; integrates locale/auth PRs #13 and #14.
- Merge predecessor PRs first, then retarget this PR to main and recheck the final diff.
- No new migration, cloud database write, live OAuth submission, production merge, secret/environment modification or generation flag change.
- Screenshot campaign names and metrics are explicitly local QA fixtures. Published public media is reused only inside these labelled local fixtures; no real customer project receives sample assets.

## Data and permission contract

- Project list is authorized through active membership or database-verified studio access before two batched overview queries run.
- Only the newest version per content slot contributes to pending/change counts. At most four latest content items are projected per campaign.
- Preview URLs use the existing authenticated attachment endpoint. Storage paths, creator fees, margins and profile identities are never included in the new overview.
- Ready attachments only. Missing images and nonvisual files have a neutral fallback, with no third-party stock replacement.
- Completed/cancelled campaigns are excluded from approval attention prompts.

## Automated verification

Required order, all passed:

1. `npx tsc --noEmit` — exit 0.
2. `npx vitest run` — **123 files / 1,397 tests passed**.
3. `npm run build:local` — exit 0.
4. `npm run start:local` — production server on port 3000.
5. `npm run sweep:anon` — **SWEEP PASSED — 627/627**.

New service tests were observed failing before the overview implementation and passing afterwards. They cover current-version aggregation, separate requested changes, whitelisted projection and revoked/unrelated membership. New UI tests cover localized protected previews, closed campaign attention suppression, and studio request routing without invented covers. Existing authorization, legal, dictionary and OAuth-routing tests also passed.

## Browser verification

Chrome, 1440×1000 and 390×844. Screenshots beside this file were inspected directly.

| Surface | KO / EN | Interaction evidence |
| --- | --- | --- |
| Brand home | Both, desktop/mobile | Search with no match, clear search, requested filter, all filter, review link to project |
| Studio operations | Both, desktop/mobile | Search, requested filter, detail navigation |
| Brand login | Both, desktop/mobile | Slideshow pause, direct beauty selection, correct image framing; production-mode capture |

Home/studio checks: document width equals viewport width, zero broken images, zero browser page errors. Computed font stack resolves to TWINGS Helvetica Neue and Pretendard Variable. Mobile navigation scrolls horizontally within its own rail.

Brand/admin authenticated screenshots use local fixture identities, not live customer accounts. These do not establish real Google/Kakao authorization or live private project availability. The production preview is checked separately for page availability; no live campaign is created.
