/**
 * PLAN §3.5 — "delivery ships in M5; zero notification UI before that. Until M5, the publish RPC
 * is called with p_notify_kind = NULL (enforced by a server flag) and no checkbox exists in admin."
 *
 * This is that server flag. **M5 flipped it**, and flipping it is what turns on, together:
 *   · the admin publish checkbox (`components/admin/editor-panels.tsx`) and the `p_notify_kind`
 *     argument it reaches the RPC through (`lib/publish/pipeline.ts`);
 *   · the two `/account` toggles;
 *   · the worker's willingness to find work at all — with no jobs enqueued, it has none.
 * Turning it back off stops NEW jobs being enqueued; jobs already in the outbox stay valid, which
 * is the correct kill-switch semantics for a durable queue.
 */
export const NOTIFICATIONS_ENABLED = true;

/** PLAN §3.6 — the ad rail is a single house placeholder until a real advertiser exists. */
export const AD_SLOTS_DB_BACKED = false;

/**
 * PLAN §4 — `/[locale]/p/[slug]`. M2 shipped it, so the §3.1 split is live again: showcase cards
 * link to the public detail page, everything else funnels through the login wall.
 */
export const PLAYBOOK_DETAIL_ROUTE_READY = true;

/**
 * PLAN §13.2 — "Nav becomes: **Prompts · Pricing** (+ locale toggle, sign in). Library/playbooks
 * denavigated behind `PLAYBOOKS_IN_NAV=false` (routes stay functional; fixtures keep the machinery
 * tested)."
 *
 * DENAVIGATED, not deleted, and the distinction is the whole point of the flag: `/library`,
 * `/[locale]/p/[slug]`, the media gateway, the publish RPCs and every one of their tests keep
 * working exactly as merged. Flipping this back to `true` restores the link in the nav and the
 * footer and nothing else has to change — which is what "leave the nav until re-activated" asks
 * for, as one greppable constant rather than a deletion somebody has to undo by hand.
 */
export const PLAYBOOKS_IN_NAV = false;

/**
 * docs/TEMPLATES-IA.md §8 — the render queue is LIVE for admins and a demo for everyone else until
 * payment is live. Opening it lets every signed-in reader pay (Toss) and start a render; the studio
 * follows through `/api/renders/access`.
 *
 * Going live is an ENVIRONMENT change, not a code deploy (docs/qa/toss-checkout/README.md "운영
 * 개시"): `RENDER_PIPELINE_PUBLIC=on` in Vercel, then redeploy. Production additionally refuses to
 * open unless BOTH Toss keys are a live widget pair (`live_gck_`/`live_gsk_`, `tossKeyKind`) — a
 * test key there would take no money and hand every visitor a free film. Preview and local runs
 * may open on test keys for QA.
 *
 * `=review` is the third state, and it exists because `=on` alone cannot pass a PG review.
 * 토스페이먼츠 심사 체크리스트(notice/20057)는 **테스트 API 키로 결제창 연동을 끝낸 상태**와
 * **판매 가능한 상품 1개 이상**을 요구한다. 그런데 라이브 키는 그 심사를 통과해야 발급된다. 즉
 * `=on`의 라이브 키 조건은 심사를 구조적으로 통과 불가능하게 만든다 — 이것이 반려의 실제 원인이다.
 *
 * `review` resolves that without handing anyone a free film: the storefront reads as open (a real
 * price and a real buy CTA, which is what an anonymous reviewer checks), but only the server-marked
 * 심사 계정(`app_metadata.purpose = 'toss_review'`, lib/auth/review-login.ts)이 결제·생성까지 끝낼
 * 수 있다. Ordinary customers keep seeing the closed studio, so test keys can never take a real
 * order. It is NOT 공개 판매 개시 — that stays `=on`, and stays 대표 결정 (AGENTS.md §6).
 */
export type RenderPipelineMode = 'off' | 'review' | 'on';

/**
 * The one rule for a usable Toss key pair, shared with `lib/billing/toss-gateway.ts`: a payment-widget
 * client key (`*_gck_`) and the secret key of the same kind (`*_gsk_`). null = not a usable pair.
 *
 * docs/PLATFORM-2.0.md §2.2-3 — production reads the keys by THIS rule, not by a `live_` prefix: `on`
 * needs a live widget pair, `review` a test widget pair. Anything else closes the pipeline with one
 * error line, because an open storefront whose every payment the gateway refuses is worse than a
 * closed one. Preview and local runs keep opening on any keys, for QA.
 */
export function tossKeyKind(env: Record<string, string | undefined>): 'test' | 'live' | null {
  const client = env.TOSS_CLIENT_KEY?.trim() ?? '';
  const secret = env.TOSS_SECRET_KEY?.trim() ?? '';
  const kind = client.startsWith('test_gck_') ? 'test' : client.startsWith('live_gck_') ? 'live' : null;
  return kind !== null && secret.startsWith(`${kind}_gsk_`) ? kind : null;
}

type FlagLog = Pick<Console, 'warn' | 'error'>;

export function renderPipelineMode(
  env: Record<string, string | undefined> = process.env,
  log: FlagLog = console,
): RenderPipelineMode {
  const setting = env.RENDER_PIPELINE_PUBLIC?.trim().toLowerCase();
  if (setting !== 'review' && setting !== 'on') return 'off';
  // A documentation example key takes no payment at THIS shop: no review evidence, no sale. Said, not blocked.
  if (`${env.TOSS_CLIENT_KEY ?? ''} ${env.TOSS_SECRET_KEY ?? ''}`.includes('_docs_'))
    log.warn(`[billing] ${JSON.stringify({ event: 'toss_docs_key', setting })}`);
  if (env.VERCEL_ENV !== 'production') return setting;
  const required = setting === 'on' ? 'live' : 'test';
  const keys = tossKeyKind(env);
  if (keys === required) return setting;
  // Kinds only, never a key value.
  log.error(`[billing] ${JSON.stringify({ event: 'render_pipeline_closed', setting, required, keys: keys ?? 'invalid' })}`);
  return 'off';
}

/** Unchanged meaning: the pipeline is open to EVERY signed-in reader. `review` is not that. */
export function renderPipelinePublic(env: Record<string, string | undefined> = process.env): boolean {
  return renderPipelineMode(env) === 'on';
}

export const RENDER_PIPELINE_MODE = renderPipelineMode();
export const RENDER_PIPELINE_PUBLIC = RENDER_PIPELINE_MODE === 'on';

/**
 * docs/TEMPLATES-IA.md §12 (2026-09-14) — how a person's photo becomes a ModelArk reference.
 *
 *   `virtual`   the AIGC ("digital character") library: no camera check, one group per account,
 *               the photo is the asset. What the product runs on — BytePlus's account manager
 *               confirmed in writing (2026-09-13) that a person's own consented selfie may use it.
 *   `liveness`  the H5 real-person check first, then assets compared to the verified face. Kept
 *               whole; `ARK_ASSET_MODE=liveness` switches back without a deploy of new code, and
 *               tests pin their mode explicitly.
 */
export const ASSET_LIBRARY_MODE: 'virtual' | 'liveness' = 'virtual';

/**
 * docs/TEMPLATES-IA.md §12 (founder, 2026-09-30) — on the free asset tier, a person's face stays at
 * the bank only while one of their renders is in flight; each render pass then deletes it
 * (lib/identity/rotation.ts `releaseAfterUse`). `ARK_RELEASE_AFTER_USE=off` stops it without a code
 * change — e.g. after moving to the paid tier, where keeping faces saves a re-upload.
 */
export const ASSET_RELEASE_AFTER_USE = true;

/**
 * docs/SECONDARY-USAGE.md — on-site payment for brand secondary-usage ("2차 활용") quotes. Default
 * OFF: open only when the server environment says exactly `BRAND_USAGE_PAYMENTS=on`. Independent of
 * `RENDER_PIPELINE_PUBLIC` (neither opens the other). Inquiries, the studio's scope/consent/quote work
 * and the brand's view of a quote all work while it is off; only acceptance and payment wait for it.
 * Payment recovery (reconcile, admin refund) runs regardless, so an in-flight payment is never stranded.
 */
export function brandUsagePaymentsOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BRAND_USAGE_PAYMENTS === 'on';
}

/**
 * docs/BRAND-STUDIO-V2.md — the brand studio v2 (real generation, asset library, campaign handoff).
 * Default OFF: open only when the server environment says exactly `BRAND_STUDIO_V2=on`. Off means
 * every studio v2 API answers `studio_closed` and the screens stay as they were.
 */
export function brandStudioV2Open(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BRAND_STUDIO_V2 === 'on';
}

/**
 * "빈 곳 채우기" in the studio's layer editor: fills the empty canvas around a picture with ordinary
 * partial edits (`region_edit`). Not yet proven with a real edit model, so default OFF: open only when
 * the server environment says exactly `BRAND_STUDIO_OUTPAINT=on`. Off means the studio state carries no
 * `canFillEmpty` and the editor renders no button; nothing else changes.
 */
export function brandStudioOutpaintOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_STUDIO_OUTPAINT === 'on';
}

/**
 * Region edit v2 ("부분 수정", docs/BRAND-STUDIO-V6-PLAN.md): every partial edit runs on one engine we
 * chose (Seedream 5.5, no model or quality choice), the engine sees a wide window of the picture and only
 * what changed near the box is pasted back. Default OFF: open only when the server environment says
 * exactly `BRAND_STUDIO_REGION_V2=on`. Off means every screen, request and answer is as it was.
 */
export function brandStudioRegionV2Open(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_STUDIO_REGION_V2 === 'on';
}

/**
 * The clip edit panel as a conversation (docs/BRAND-STUDIO-VIDEO-REMIX.md §3, slice D1): no method cards;
 * the customer says what to change, we answer with how it will be made, why and the credits, and one
 * button makes it. Drafts and finals are named, the step to the final sits on a draft's version card, and
 * a version made from an earlier one shows where it came from. Default OFF: open only when the server
 * environment says exactly `BRAND_STUDIO_REVISE_V2=on`. Off means every screen, request and answer is as
 * it was.
 */
export function brandStudioReviseV2Open(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_STUDIO_REVISE_V2 === 'on';
}

/**
 * "말로 편집" in the editing studio (docs/BRAND-EDITING-STUDIO.md §4, §7 E1): an instruction becomes a
 * validated plan of timeline steps that the screen previews and applies (compose operation `assist.plan`).
 * Default OFF: open only when the server environment says exactly `BRAND_STUDIO_EDIT_ASSIST=on`. Off means
 * `assist.plan` answers exactly like an unknown operation and every other screen, request and answer is as
 * it was (`chat.edit` included).
 */
export function brandStudioEditAssistOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_STUDIO_EDIT_ASSIST === 'on';
}

/**
 * The rebuilt editing studio (docs/BRAND-EDITING-STUDIO-V2.md): four workspaces (cut, colour, sound,
 * captions) around one preview and one timeline. Since V1 the flag opens `/brand/studio/editor` on the
 * organization's own film (the film the current editor keeps, on frames, with a frame-exact export);
 * `?sample=1` still opens the sample film (for a listed organization only while
 * `BRAND_WORKSPACE_PROTOTYPE_LAYER=on`, see below). Default OFF: open only when the server environment says
 * exactly `BRAND_STUDIO_EDITOR_V2=on`. Off means the route answers 404 and every other screen is as it
 * was. The studio route guard runs first, so a sandboxed organization gets 404 whatever this flag says.
 *
 * Which organizations it opens for by default: `BRAND_STUDIO_EDITOR_V2_ORGS`, a comma-separated list of
 * organization ids (spaces around ids and empty entries ignored, ids compared exactly). For a listed
 * organization, and only while this flag is on, `/brand/studio/compose` sends the person to the new
 * editor after the studio guard (`brandStudioEditorV2DefaultFor`); `?classic=1` keeps the current editor.
 * An entry `all` (any case) or `*`, anywhere in the list, counts every organization as listed; the studio
 * guard still runs first. The ids live only in the deployment's environment, never in the repository.
 * Unset or empty: nobody.
 */
export function brandStudioEditorV2Open(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_STUDIO_EDITOR_V2 === 'on';
}

/** The organizations listed in `BRAND_STUDIO_EDITOR_V2_ORGS` (see `brandStudioEditorV2Open`). */
export function brandStudioEditorV2Orgs(env: Record<string, string | undefined> = process.env): string[] {
  return (env.BRAND_STUDIO_EDITOR_V2_ORGS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

/**
 * Whether `/brand/studio/compose` opens the new editor for this organization: only with
 * `BRAND_STUDIO_EDITOR_V2=on` AND the organization listed in `BRAND_STUDIO_EDITOR_V2_ORGS`
 * (or `BRAND_STUDIO_EDITOR_V2_ORGS` contains `all` or `*`).
 */
export function brandStudioEditorV2DefaultFor(
  organizationId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!brandStudioEditorV2Open(env) || !organizationId) return false;
  const orgs = brandStudioEditorV2Orgs(env);
  if (orgs.some((entry) => entry === '*' || entry.toLowerCase() === 'all')) return true;
  return orgs.includes(organizationId);
}

/**
 * Music generation in the editing studio and the video studio (docs/BRAND-EDITING-STUDIO.md §8-5): no
 * commercially cleared music engine is confirmed, so it stays closed. Default OFF: open only when the server
 * environment says exactly `BRAND_STUDIO_MUSIC_GENERATION=on`. Off means `music.generate` answers
 * `feature_unavailable` before any credit is reserved and the screens show no generation controls.
 * `music.status` stays open so a job already running still finishes or refunds. Uploading and using your own
 * audio, its volume and removal, and sound effects are not affected.
 */
export function brandStudioMusicGenerationOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_STUDIO_MUSIC_GENERATION === 'on';
}

/**
 * The sound studio (docs/BRAND-SOUND-STUDIO.md §7): `/brand/studio/sound`, its rail item and home card, and
 * the two "send to a project" operations. Default OFF: open only when the server environment says exactly
 * `BRAND_SOUND_STUDIO=on`. Off means the route answers 404, the rail and home are as they were, and the two
 * operations answer like unknown ones. The studio route guard and the `sound` feature policy run first, so a
 * sandboxed organization gets 404 whatever this flag says.
 */
export function brandSoundStudioOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_SOUND_STUDIO === 'on';
}

/**
 * "더 고르게 만들기" (the music engine's Max Mode, twice the credits) in the sound studio (docs/BRAND-SOUND-STUDIO.md
 * §4.2, §8-4). Hidden until the founder decides (after the paid smoke test, 2026-11-20): shown only when the
 * server environment says exactly `BRAND_SOUND_MAX_MODE=on`. Hidden means the switch is not drawn and a request
 * still carrying it is refused before anything is reserved.
 */
export function brandSoundMaxModeShown(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_SOUND_MAX_MODE === 'on';
}

/**
 * A studio run can belong to a project (docs/BRAND-STUDIO-V6-PLAN.md §7 C, migration 0091): the image
 * studio gets the video studio's project switcher, new runs carry the chosen project, and the assets page
 * can put an existing run in a project. Default OFF: open only when the server environment says exactly
 * `BRAND_STUDIO_PROJECTS=on`. Off means every screen, request and answer is as it was; on still stays
 * closed until `brand_studio_jobs.project_id` exists.
 */
export function brandStudioProjectsOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_STUDIO_PROJECTS === 'on';
}

/**
 * The brand project spine (docs/BRAND-PROJECT-SPINE.md §3–§4, slice 1): one project for both sides
 * (`brand_projects.origin`), studio runs, uploads and films filed in a project (`brand_project_id`), and the
 * three operations `project.list` / `project.create` / `project.move`. Default OFF: the master switch is open
 * only when the server environment says exactly `BRAND_PROJECT_SPINE=on`.
 *
 * Which organizations it opens for: `BRAND_PROJECT_SPINE_ORGS`, a comma-separated list of organization ids
 * (spaces around ids and empty entries ignored, ids compared without regard to case). An entry `all` (any case) or `*`, anywhere
 * in the list, counts every organization. Unset or empty: nobody. The ids live only in the deployment's
 * environment, never in the repository. Closed (switch off, or the organization not listed) means every screen,
 * request and answer is as it was: the three operations answer like unknown ones, a `brandProjectId` in a
 * request is not even looked at, and no answer carries the new fields. The server additionally keeps it closed
 * until migration 0194's columns exist (lib/brand-studio/brand-projects.ts `brandProjectSpineOpen`), and the
 * studio guard runs first, so a sandboxed organization gets 404 whatever this says.
 */
export function brandProjectSpineOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_PROJECT_SPINE === 'on';
}

/** The organizations listed in `BRAND_PROJECT_SPINE_ORGS` (see `brandProjectSpineOn`). */
export function brandProjectSpineOrgs(env: Record<string, string | undefined> = process.env): string[] {
  return (env.BRAND_PROJECT_SPINE_ORGS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

/**
 * Whether the spine is switched on for this organization: `BRAND_PROJECT_SPINE=on` AND the organization listed
 * in `BRAND_PROJECT_SPINE_ORGS` (or the list contains `all` or `*`). The environment half only; the server asks
 * `brandProjectSpineOpen` (lib/brand-studio/brand-projects.ts), which also needs the columns.
 */
export function brandProjectSpineFor(
  organizationId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!brandProjectSpineOn(env) || !organizationId) return false;
  // Ids compared case-insensitively on both sides (a uuid is the same uuid in either case).
  const orgs = brandProjectSpineOrgs(env).map((entry) => entry.toLowerCase());
  if (orgs.some((entry) => entry === '*' || entry === 'all')) return true;
  return orgs.includes(organizationId.toLowerCase());
}

/**
 * The home's news slot (docs/BRAND-PROJECT-SPINE.md §6, slice 3b; migrations 0196/0197): one announcement on the
 * 직접 만들기 home, written from the admin console (`brandNews.save` / `brandNews.publish` / `brandNews.end`) and
 * closed by each person for themselves (`news.dismiss`). Default OFF: open only when the server environment says
 * exactly `BRAND_NEWS=on`. Off means the home read answers "none" without asking the database, `news.dismiss` answers
 * exactly like an unknown operation and the three admin operations refuse with `disabled`. The server additionally
 * keeps it closed until both tables of 0196 exist (lib/brand-news/service.ts `brandNewsReady`). There is no
 * organization list: an announcement's own `audience.orgs` is how it is tried on a test organization first. The
 * hardline gates (sandboxed client, generation closed) run before anything is read, whatever this says.
 */
export function brandNewsOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_NEWS === 'on';
}

/**
 * docs/CAST-CATEGORIES.md §4 — couple templates (the buyer and one partner). Default OFF: open only
 * when the server environment says exactly `TWINGS_COUPLE_TEMPLATES=on`. Terms §5.3 say "your own
 * face only" and cannot change while Toss reviews subscription billing, so off means couples do not
 * exist anywhere: the catalogue drops couple templates, `/{locale}/couple` and their template pages
 * answer 404, no chip or section mentions them, and the make and render APIs refuse a partner photo.
 */
export function coupleTemplatesOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.TWINGS_COUPLE_TEMPLATES === 'on';
}

/**
 * docs/PERSONAL-STUDIO.md §5.1, §9 — the personal Sunra lane: a person's face (the buyer's verified selfie
 * and a consenting partner's photo) may go to Sunra as a short-lived signed URL. Default OFF: open only when
 * the server environment says exactly `TWINGS_PERSONAL_SUNRA_FACES=on`. This is the one switch for
 * `sunraSignedFaceAllowed`; off means no job is routed to Sunra and the adapter refuses to submit
 * (lib/renders/engines-sunra.ts). A Sunra job already submitted is still polled to its end.
 * Turning it on waits for the founder and the conditions in §5.1 (DPA, training opt-out or a true policy line,
 * revised terms in force, the 19+ check working).
 */
export function personalSunraFacesOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.TWINGS_PERSONAL_SUNRA_FACES === 'on';
}

/**
 * docs/CAST-CATEGORIES.md §3 — pet templates. Default OFF: open only when the server environment says
 * exactly `TWINGS_PET_TEMPLATES=on`. Off means the same as couples off: the catalogue drops pet
 * templates, `/{locale}/pet` and their template pages answer 404, and the make and render APIs refuse.
 * A pet photo skips the face rules, so it is accepted only after the person check (lib/renders/pet-photo-check.ts).
 */
export function petTemplatesOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.TWINGS_PET_TEMPLATES === 'on';
}

/**
 * docs/PERSONAL-STUDIO.md §2.3, §9 — the personal edit sheet (P1a). Default OFF: open only when the server
 * environment says exactly `TWINGS_PERSONAL_EDIT_SHEET=on`. Off means today's director exactly: the
 * `/api/template-director` route ignores a `sheet` field and answers the chips shape, and the compiler ignores a
 * stored `directorSpec.sheet` and builds from the chips written alongside it.
 */
export function personalEditSheetOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.TWINGS_PERSONAL_EDIT_SHEET === 'on';
}

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — the template style preference (founder decision 2026-11-25). Default OFF: open only
 * when the server environment says exactly `TWINGS_TEMPLATE_LOOK=on`. Off means today exactly: no question, no settings
 * row, no `data-look` on any card, no label, no filtering, and nothing reads `prompt_items.look` or
 * `profiles.template_look` (the catalogue does not even select the column). Storing the choice needs a privacy-policy
 * line the founder approves first; the lists are static, so the switch must be set for the build and the server alike.
 */
export function templateLookOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.TWINGS_TEMPLATE_LOOK === 'on';
}

/**
 * docs/BRAND-ROOMS.md — project rooms (messages, storyboards and deliverable review with the YAGI
 * team). Default OFF: open only when the server environment says exactly `BRAND_ROOMS=on`. Off means
 * no room page, no messages item in the rail and every `/api/brand-rooms/*` answers 404.
 */
export function brandRoomsOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BRAND_ROOMS === 'on';
}

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §2 — mail and push notices to brand members about their project rooms.
 * Default OFF: on only when the server environment says exactly `BRAND_ROOM_NOTIFY=on` (and rooms are
 * open). Off means no notice is queued and `/api/brand-rooms/notices/tick` returns at once. Turning it on
 * waits for the founder's approval of the copy (the dictionary strings are drafts).
 */
export function brandRoomNotifyOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BRAND_ROOM_NOTIFY === 'on';
}

/**
 * docs/BRAND-PROJECT-SPINE.md §8 (slice 4) — 보내기: a member sends a studio file to colleagues with `@` on the
 * organization's members channel, and reads and answers what they were sent (the 알림함 "나에게 온 것", the bell's thread
 * lines). Default OFF: open only when the server environment says exactly `BRAND_SEND=on`. Even then 보내기 is open for
 * an organization only while `BRAND_ROOMS` and `BRAND_ROOM_NOTIFY` are on, the spine is open for it
 * (`BRAND_PROJECT_SPINE` + `BRAND_PROJECT_SPINE_ORGS` + migration 0194) and migration 0198 is applied
 * (lib/brand-rooms/members-channel.ts `brandSendOpenFor`). Closed: every `send.*` operation answers exactly what an
 * unknown operation answers, the bell and every existing read answer as before, and nothing is written.
 */
export function brandSendOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_SEND === 'on';
}

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §12 — sharing a project room by invitation: brand owners and editors invite
 * people by e-mail to one project (view only or with comments), the share dialog's two link modes
 * ("초대한 사람만" by default, "링크가 있는 누구나" only when switched on), the invitation mail, single-use
 * binding of a project invitation to the account that accepts it, and a guest's `can_comment` in rooms.
 * Default OFF: on only when the server environment says exactly `BRAND_ROOM_INVITES=on` (and rooms are
 * open). Off means today's share dialog, no `/api/brand-rooms/people` (404), no invitation mail, and the
 * strict e-mail match on every invitation.
 */
export function brandRoomInvitesOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BRAND_ROOM_INVITES === 'on' && brandRoomsOpen(env);
}

/**
 * Prototype layer on `/brand/projects/[id]` (`HumanHandoff`, `BriefConcierge`, `AestheticEngine`,
 * `ReviewStage`) and preview links to demo/sample routes: the current editor's link to the editing studio
 * v2's sample film, and in the editing studio v2 an organization's own film's way to the sample film (its
 * locked workspaces' link and `?sample=1`; an organization not in `BRAND_STUDIO_EDITOR_V2_ORGS` only ever
 * gets the sample film there). Default OFF: open only when the server environment says exactly
 * `BRAND_WORKSPACE_PROTOTYPE_LAYER=on`.
 */
export function brandWorkspacePrototypeLayerOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_WORKSPACE_PROTOTYPE_LAYER === 'on';
}

/**
 * docs/BRAND-RECURRING-BILLING.md §6.5 (B1b) — explicit workspace approval: the admin operation
 * `brandWorkspace.approve` records the approval and grants the one-time trial credits, the hourly job carries an
 * unused trial into the next month once, and an approved organization is exempt from the pre-approval upload limit.
 * Default OFF: open only when the server environment says exactly `BRAND_WORKSPACE_APPROVAL=on`. Off means no query
 * names the approval table or the grant `kind` / `carried_from` columns (migration 0184), exactly as before.
 */
export function brandWorkspaceApprovalOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_WORKSPACE_APPROVAL === 'on';
}

/**
 * Workspace team invitation e-mails (`invitation.create`). Default OFF: on only when the server
 * environment says exactly `BRAND_ORG_INVITE_EMAIL=on`. Off preserves link-only copy behavior.
 */
export function brandOrgInviteEmailOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_ORG_INVITE_EMAIL === 'on';
}

/**
 * docs/BRAND-RECURRING-BILLING.md §12, §14 (B1a) — brand subscription core: monthly auto-invoicing
 * (D-7 draft, M-01 issue), manual transfer deposit confirmation, subscription lifecycle reconciliation,
 * and admin subscription/tax-invoice controls. Default OFF: open only when the server environment says
 * exactly `BRAND_BILLING_AUTO_ISSUE=on`.
 *
 * When enabling it the operator also sets `BRAND_PLAN_GRACE_DAYS=14` (founder decision: due date + 14 days).
 * With a grace below 1 access ends on the due date itself; the job then reports `graceDaysBelowOne: true` and
 * the admin subscription card shows a warning.
 */
export function brandBillingAutoIssueOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRAND_BILLING_AUTO_ISSUE === 'on';
}
