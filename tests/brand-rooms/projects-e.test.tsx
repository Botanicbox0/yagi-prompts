import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  IntakeBriefSchema,
  extractIntakeSuggestions,
  objectiveFromIntakeBrief,
} from "@/lib/brands/workspace/intake-brief";
import { exportReviewComments } from "@/components/brand-studio/review/stage";
import { RoomTabs } from "@/components/brand-rooms/room/room-header";
import { ProjectFilesTab } from "@/components/brand-rooms/files";
import { RoomInbox } from "@/components/brand-rooms/chat/inbox";
import { RefCard } from "@/components/brand-rooms/chat/message";
import { brandTransport } from "@/components/brand-rooms/chat/transport";
import { VISIBLE_ROOM_TABS, loadRoomBriefFiles, loadRoomProject, roomTab } from "@/lib/brand-rooms/overview";
import { loadRoomMessages, loadRoomSummary } from "@/lib/brand-rooms/messages";
import { roomRefHref } from "@/lib/brand-rooms/message-contracts";
import { runRoomReviewOperation, staffAddComment } from "@/lib/brand-studio/review";
import { countShareView, createShare, guestComment, unlockShare } from "@/lib/brand-rooms/shares";
import { isPurgeableRoomStagingKey } from "@/lib/brand-rooms/staging-cleanup";
import { isProjectOnlyArchived, studioShowroomVisible, studioV2Visible } from "@/lib/brand-studio/visibility";
import { StudioShowroom } from "@/components/brand-studio/studio-showroom";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ShareCreated } from "@/lib/brand-rooms/share-contracts";
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from "@/tests/brand-studio/server/helpers";
import { roomDraft } from "./review/fixtures";

describe("Bundle E — 3-step brief intake & auto-fill parser", () => {
  it("extracts dates, ratios, channels, duration, quantity, budget and contact without guessing missing fields", () => {
    const raw = `
      2026 겨울 신제품 런칭 숏폼 캠페인 기획안
      일정: 2026-12-01 ~ 2026-12-20
      채널: 인스타그램 릴스, 유튜브 쇼츠, 틱톡
      포맷: 9:16 세로형 및 16:9 가로형, 15초 내외 총 4편 제작 희망
      예산: 약 800만원 내외
      담당자 문의: marketing@brand.co.kr
    `;
    const suggested = extractIntakeSuggestions(raw);
    expect(suggested.startsOn).toBe("2026-12-01");
    expect(suggested.dueOn).toBe("2026-12-20");
    expect(suggested.aspectRatios).toEqual(expect.arrayContaining(["9:16", "16:9"]));
    expect(suggested.channels).toEqual(expect.arrayContaining(["instagram_reels", "youtube_shorts", "tiktok"]));
    expect(suggested.duration).toBe("15초");
    expect(suggested.quantity).toBe(4);
    expect(suggested.budgetBand).toBe("500_1000");
    expect(suggested.contactChannel).toBe("email");
    expect(suggested.contactValue).toBe("marketing@brand.co.kr");

    const empty = extractIntakeSuggestions("간단한 브랜드 소개 영상을 만들고 싶습니다.");
    expect(empty.startsOn).toBeUndefined();
    expect(empty.budgetBand).toBeUndefined();
    expect(empty.aspectRatios).toBeUndefined();

    expect(extractIntakeSuggestions("예산: 상담 후 결정").budgetBand).toBe("undecided");
    const koBudgets = getDictionary("ko").intakeBrief.budgets;
    expect(koBudgets).toEqual({
      under_300: "300만 원 미만",
      "300_500": "300만~500만 원",
      "500_1000": "500만~1,000만 원",
      "1000_3000": "1,000만~3,000만 원",
      over_3000: "3,000만 원 이상",
      undecided: "아직 모름 (상담 후 결정)",
    });
  });

  it("validates IntakeBriefSchema and builds clean customer-safe objective text", () => {
    const parsed = IntakeBriefSchema.parse({
      version: 1,
      track: "template_build",
      summary: "신제품 언박싱 전용 포맷 제작",
      briefText: "출시 첫 주 오가닉 확산용 포맷",
      briefAttachmentIds: [],
      studioAssetIds: [],
      deliverables: {
        kind: "전용 템플릿 + 예시 영상",
        duration: "15초",
        aspectRatios: ["9:16", "4:5"],
        quantity: 3,
        channels: ["instagram_reels", "tiktok"],
      },
      schedule: { startsOn: "2026-12-01", dueOn: "2026-12-15" },
      budgetBand: "500_1000",
      contact: {
        name: "김브랜드",
        channel: "email",
        value: "kim@brand.co.kr",
        approver: "박대표",
      },
    });
    const objective = objectiveFromIntakeBrief(parsed);
    expect(objective).toContain("신제품 언박싱 전용 포맷 제작");
    expect(objective).not.toMatch(/\[TRACK:|OLED|Slack|슬랙|\{\{/i);
  });
});

describe("Bundle E — Frame.io V4 review comment export & staging key guard", () => {
  it("exports comments as RFC-4180 CSV, Markdown checklist, and NLE timecode markers", () => {
    const comments = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        parentId: null,
        authorName: "김팀장",
        authorRole: "brand" as const,
        body: '로고 크기 "조금" 키워 주세요, 자막도 확인',
        atMs: 1250,
        endMs: 3500,
        x: 0.42,
        y: 0.58,
        strokes: [{ tool: "arrow" as const, color: "blue" as const, points: [[0.1, 0.2] as [number, number], [0.4, 0.5] as [number, number]] }],
        resolved: false,
        createdAt: "2026-11-11T10:00:00.000Z",
        deleted: false,
        mine: true,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        parentId: "11111111-1111-4111-8111-111111111111",
        authorName: null,
        authorRole: "studio" as const,
        body: "v2에서 반영했습니다.",
        atMs: null,
        x: null,
        y: null,
        resolved: false,
        createdAt: "2026-11-11T10:05:00.000Z",
        deleted: false,
        mine: false,
      },
    ];

    const csv = exportReviewComments("메인 필름 v1", comments, "csv");
    expect(csv.filename).toBe("메인-필름-v1-notes.csv");
    expect(csv.content).toContain("00:00:01.250,00:00:03.500,open,김팀장,brand,\"42%,58%\",true,\"로고 크기 \"\"조금\"\" 키워 주세요, 자막도 확인\"");

    const md = exportReviewComments("메인 필름 v1", comments, "markdown");
    expect(md.content).toContain("- [ ] **#1** [0:01.2–0:03.5] (김팀장): 로고 크기 \"조금\" 키워 주세요, 자막도 확인");
    expect(md.content).toContain("  - (YAGI team): v2에서 반영했습니다.");

    const markers = exportReviewComments("메인 필름 v1", comments, "markers");
    expect(markers.content).toContain("00:00:01.250\t00:00:03.500\t#1 김팀장\t로고 크기 \"조금\" 키워 주세요, 자막도 확인");
  });

  it("restricts staging cleanup strictly to room attachment and delivery staging keys", () => {
    expect(isPurgeableRoomStagingKey(`brand-rooms/deliveries/${"a".repeat(64)}.mp4`)).toBe(true);
    expect(
      isPurgeableRoomStagingKey(
        `brand-rooms/a0000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-000000000001/${"b".repeat(32)}`,
      ),
    ).toBe(true);
    expect(isPurgeableRoomStagingKey(`st/${"c".repeat(64)}.png`)).toBe(false);
    expect(isPurgeableRoomStagingKey("content/rev/123/file.png")).toBe(false);
  });
});

describe("Bundle E — deliverable room tabs, unified inbox, comment jump stream, R-09 & project-only orgs", () => {
  let f: StudioFixture;
  let deps: ReturnType<typeof studioDeps>;

  beforeEach(async () => {
    vi.stubEnv("BRAND_ROOMS", "on");
    f = await studioFixture();
    deps = studioDeps(f.sql);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f.db.close();
  });

  it("streams deliverable comments into Conversation with timecode jump links and surfaces alerts in Summary", async () => {
    const reviewId = await roomDraft(f, deps);
    const { result } = await runRoomReviewOperation(
      { sql: f.sql, media: deps.media },
      viewerOf(f.ids.owner),
      "comment.add",
      {
        organizationId: f.orgId,
        projectId: f.projectId,
        reviewId,
        body: "01초 구간 색감 보정 부탁드려요",
        atMs: 1500,
        endMs: 2800,
        x: 0.3,
        y: 0.4,
      },
    );
    expect(result.ok).toBe(true);
    const commentId = result.ok && "comment" in result ? result.comment.id : "";

    await staffAddComment({ sql: f.sql, media: deps.media }, viewerOf(f.ids.admin), {
      reviewId,
      body: "확인했습니다!",
      parentId: commentId,
    });

    const stream = await loadRoomMessages(
      { sql: f.sql, media: deps.media },
      viewerOf(f.ids.owner),
      { organizationId: f.orgId, projectId: f.projectId },
    );
    expect(stream.ok).toBe(true);
    if (!stream.ok || !("messages" in stream)) throw new Error("expected stream");

    const commentEvents = stream.messages.filter((m) => m.event === "review_commented");
    expect(commentEvents.length).toBe(2);
    const brandNoteEvent = commentEvents.find((m) => m.ref && m.ref.ref.kind === "review" && m.ref.ref.commentId === commentId)!;
    expect(brandNoteEvent.ref).toMatchObject({
      available: true,
      noteBody: "01초 구간 색감 보정 부탁드려요",
      atMs: 1500,
      endMs: 2800,
      hasSpot: true,
    });

    const href = roomRefHref(f.projectId, brandNoteEvent.ref!.ref, null, brandNoteEvent.ref?.atMs);
    expect(href).toBe(`/brand/rooms/${f.projectId}?tab=review&review=${reviewId}&comment=${commentId}&t=1500`);

    const ko = getDictionary("ko");
    const transport = brandTransport(f.orgId);
    const cardHtml = renderToStaticMarkup(
      <RefCard view={brandNoteEvent.ref!} projectId={f.projectId} copy={ko.roomsChat} refHref={transport.refHref} />,
    );
    expect(cardHtml).toContain("01초 구간 색감 보정 부탁드려요");
    expect(cardHtml).toContain("0:01");
    expect(cardHtml).toContain("t=1500");

    const summary = await loadRoomSummary({ sql: f.sql }, viewerOf(f.ids.owner), f.orgId);
    expect(summary.ok).toBe(true);
    if (!summary.ok) throw new Error("expected summary");
    expect(summary.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "review",
          projectId: f.projectId,
          targetId: reviewId,
          openNotes: 1,
        }),
      ]),
    );
  });

  it("isolates share passphrase lockouts per clientKey and skips preview bots on view counts (R-09)", async () => {
    const reviewId = await roomDraft(f, deps);
    const created = (await createShare(
      { sql: f.sql, media: deps.media },
      viewerOf(f.ids.owner),
      { organizationId: f.orgId, kind: "review", targetId: reviewId, passphrase: "correct-horse" },
    )) as ShareCreated;
    expect(created.ok).toBe(true);

    for (let i = 0; i < 8; i += 1) {
      expect(
        await unlockShare({ sql: f.sql, media: deps.media }, { token: created.token, passphrase: `bad-${i}` }, { clientKey: "attacker00000001" }),
      ).toEqual({ ok: false, code: "wrong_passphrase" });
    }
    expect(
      await unlockShare({ sql: f.sql, media: deps.media }, { token: created.token, passphrase: "correct-horse" }, { clientKey: "attacker00000001" }),
    ).toEqual({ ok: false, code: "locked" });

    // A legitimate client on another IP hash still unlocks immediately.
    const legit = await unlockShare(
      { sql: f.sql, media: deps.media },
      { token: created.token, passphrase: "correct-horse" },
      { clientKey: "client0000000002" },
    );
    expect(legit.ok).toBe(true);

    // Public link without passphrase: bot UA does not increment views; real browser does, and guest comment posts room event.
    const openLink = (await createShare(
      { sql: f.sql, media: deps.media },
      viewerOf(f.ids.owner),
      { organizationId: f.orgId, kind: "review", targetId: reviewId },
    )) as ShareCreated;
    const noCookies = { get: () => undefined };
    expect(await countShareView({ sql: f.sql, media: deps.media }, { token: openLink.token }, noCookies, { userAgent: "Slackbot-LinkExpanding 1.0" })).toMatchObject({ ok: true });
    expect((await f.sql.query<{ views: number }>("select views from brand_room_shares where id = $1", [openLink.share.id])).rows[0]!.views).toBe(0);

    expect(await countShareView({ sql: f.sql, media: deps.media }, { token: openLink.token }, noCookies, { userAgent: "Mozilla/5.0 Chrome/130.0" })).toMatchObject({ ok: true });
    expect((await f.sql.query<{ views: number }>("select views from brand_room_shares where id = $1", [openLink.share.id])).rows[0]!.views).toBe(1);

    const gNote = await guestComment(
      { sql: f.sql, media: deps.media },
      { token: openLink.token, name: "외부 임원", body: "마지막 컷 좋습니다", atMs: 2000 },
      noCookies,
    );
    expect(gNote.ok).toBe(true);
  });

  it("keeps rooms & brief files open for project-only orgs (self_studio denied) and renders Studio Showroom while Morphic stays hidden", async () => {
    await f.sql.query(
      `insert into brand_feature_policies (organization_id, denied_features) values ($1, array['self_studio'])
       on conflict (organization_id) do update set denied_features = excluded.denied_features`,
      [f.orgId],
    );
    const projectOnlyOrg = { id: f.orgId, name: "외주 전용 고객사", denied: ["self_studio"] };
    expect(studioV2Visible(projectOnlyOrg, true)).toBe(false);
    expect(studioShowroomVisible(projectOnlyOrg, true)).toBe(true);
    expect(studioShowroomVisible({ id: f.orgId, name: "Morphic Korea", denied: ["self_studio"] }, true)).toBe(false);
    expect(studioShowroomVisible({ id: f.orgId, name: "외주 전용 고객사", denied: ["generative_media", "self_studio"] }, true)).toBe(false);

    const nowMs = Date.parse("2027-04-01T00:00:00.000Z");
    expect(isProjectOnlyArchived({ status: "active", updatedAt: "2026-11-01T00:00:00.000Z" }, 90, nowMs)).toBe(false);
    expect(isProjectOnlyArchived({ status: "completed", updatedAt: "2027-02-15T00:00:00.000Z" }, 90, nowMs)).toBe(false);
    expect(isProjectOnlyArchived({ status: "completed", updatedAt: "2026-12-15T00:00:00.000Z" }, 90, nowMs)).toBe(true);

    const ko = getDictionary("ko");
    const showroomHtml = renderToStaticMarkup(
      <StudioShowroom
        focus="image"
        organizationId={f.orgId}
        organizationName="외주 전용 고객사"
        canRequest
        imageHref={`/brand/studio?organizationId=${f.orgId}`}
        videoHref={`/brand/studio/video?organizationId=${f.orgId}`}
        projectSpaceHref={`/brand?organizationId=${f.orgId}`}
        newBriefHref={`/brand/projects/new?organizationId=${f.orgId}`}
        copy={ko.studioShell.showroom}
      />,
    );
    expect(showroomHtml).toContain('data-studio-showroom="image"');
    expect(showroomHtml).toContain("월 290,000원");
    expect(showroomHtml).toContain("월 490,000원");
    expect(showroomHtml).toContain("월 690,000원");
    expect(showroomHtml).toContain("200 GB");
    expect(showroomHtml).toContain("400 GB");
    expect(showroomHtml).toContain("800 GB");
    expect(showroomHtml).toContain("플랜 전환 · 데모 요청하기");

    const summary = await loadRoomSummary({ sql: f.sql }, viewerOf(f.ids.owner), f.orgId);
    expect(summary.ok).toBe(true);
    const project = await loadRoomProject(f.sql, f.orgId, f.projectId);
    expect(project?.id).toBe(f.projectId);
    const files = await loadRoomBriefFiles(f.sql, f.orgId, f.projectId);
    expect(files).toEqual([]);
  });

  it("renders 3 room tabs (개요 · 파일 · 대화), 5 deliverable categories, and the unified 알림함", () => {
    const ko = getDictionary("ko");
    expect(roomTab("files")).toBe("files");
    expect(roomTab("storyboard")).toBe("storyboard");
    expect(roomTab("review")).toBe("review");

    const tabsHtml = renderToStaticMarkup(
      <RoomTabs
        tabs={VISIBLE_ROOM_TABS.map((t) => ({ tab: t, href: `/brand/rooms/${f.projectId}?tab=${t}`, count: t === "files" ? 3 : 0 }))}
        current="files"
        copy={ko.roomsShell.room}
      />,
    );
    expect(tabsHtml).toContain("개요");
    expect(tabsHtml).toContain("파일");
    expect(tabsHtml).toContain("대화");
    expect(tabsHtml).not.toContain('data-room-tab="storyboard"');

    const filesHtml = renderToStaticMarkup(
      <ProjectFilesTab
        organizationId={f.orgId}
        project={{
          id: f.projectId,
          organizationId: f.orgId,
          title: "26FW 런칭 영상",
          status: "active",
          productionMode: "studio",
          track: "studio_film",
          objective: "핵심 메시지 전달",
          intakeBrief: null,
          createdAt: "2026-11-11T00:00:00.000Z",
          updatedAt: "2026-11-11T00:00:00.000Z",
        }}
        briefFiles={[{ id: "33333333-3333-4333-8333-333333333333", name: "26FW_기획안.pdf", mime: "application/pdf", sizeBytes: 2_097_152, createdAt: "2026-11-11T00:00:00.000Z" }]}
        locale="ko"
        filesCopy={ko.roomsShell.files}
        intakeCopy={ko.intakeBrief}
        storyboardCopy={ko.roomsStoryboard}
        reviewCopy={ko.roomsReview}
        studioReviewCopy={ko.studioReview}
        chatCopy={ko.roomsChat}
        canEdit
        canTalk
        initialCategory="brief"
      />,
    );
    expect(filesHtml).toContain("26FW_기획안.pdf");
    expect(filesHtml).toContain('data-room-files-pill="finals"');

    const inboxHtml = renderToStaticMarkup(
      <RoomInbox
        organizationId={f.orgId}
        locale="ko"
        copy={ko.roomsChat}
        initial={{
          ok: true,
          unread: 1,
          channels: [{ projectId: f.projectId, title: "26FW 런칭 영상", unread: 1, lastAt: "2026-11-11T10:00:00.000Z", lastLine: "시안 확인 부탁드려요" }],
          alerts: [
            {
              id: `review:${f.projectId}`,
              kind: "review",
              projectId: f.projectId,
              projectTitle: "26FW 런칭 영상",
              targetId: "44444444-4444-4444-8444-444444444444",
              title: "메인 필름 1차",
              version: 2,
              openNotes: 3,
              updatedAt: "2026-11-11T10:00:00.000Z",
            },
          ],
        }}
        selected={null}
        canTalk
      />,
    );
    expect(inboxHtml).toContain("알림함");
    expect(inboxHtml).toContain('data-inbox-alert="review"');
    expect(inboxHtml).toContain("메인 필름 1차");
  });
});
