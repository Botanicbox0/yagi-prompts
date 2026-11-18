import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Dock, type DockProps } from "@/components/brand-studio/dock";
import { initialDraft, withMedium } from "@/components/brand-studio/dock-model";
import { PromptHighlight, resolvePromptMentions } from "@/components/brand-studio/prompt-highlight";
import { trayItemFromAsset, trayLabels } from "@/components/brand-studio/refs";
import { Tray } from "@/components/brand-studio/tray";
import type { FilmSheet } from "@/lib/brand-studio/contracts";
import {
  ArgonMediaAnalyzerStub,
  classifyPromptIntent,
  compileDirectorPrompt,
  composeDirectorFallbackPrompt,
  createMediaAnalyzer,
  DIRECTOR_NO_BGM_AUDIO_LINE,
  DIRECTOR_THUMBS_MAX,
  GeminiFlashMediaAnalyzer,
  resolveDirectorProvider,
} from "@/lib/brand-studio/director";
import { enhancePrompt, THUMBS_MAX } from "@/lib/brand-studio/enhancer";
import {
  compactFilmSheet,
  FILM_SHEET_TTL_DAYS,
  FILM_SHEET_TTL_MS,
  purgeProjectFilmSheets,
  readCachedFilmSheet,
  sweepExpiredFilmSheets,
  writeCachedFilmSheet,
} from "@/lib/brand-studio/film-sheet";
import { dropUnreferencedStudioKeys } from "@/lib/brand-studio/physical-cleanup";
import type { SqlRunner } from "@/lib/db/sql-runner";
import { ENV, mockGemini, sentBody, SHEET } from "./intel/helpers";
import { requestId, seedVideoAsset, studioDeps, studioFixture } from "./server/helpers";
import { allowance, asset, copyFor } from "./ui/fixtures";

const SAMPLE_SHEET: FilmSheet = {
  ...SHEET,
  shots: SHEET.shots.map((shot, idx) => ({
    ...shot,
    transition: idx < SHEET.shots.length - 1 ? "hard cut" : "end",
  })),
  subjects: [{ id: "A", what: "woman in charcoal coat", count: 1 }],
  setting: "wet evening alley with warm shopfront spill",
};

describe("1. Shot-Sheet Cache Lifecycle (14d sliding TTL + project completion purge)", () => {
  it("defines 14-day TTL, strips accidental base64 frame data, slides expiry on hit, and clears on expiry", async () => {
    expect(FILM_SHEET_TTL_DAYS).toBe(14);
    expect(FILM_SHEET_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);

    const f = await studioFixture();
    try {
      const deps = studioDeps(f.sql);
      const videoId = await seedVideoAsset(deps, f.orgId, f.ids.editor, 8);
      const t0 = new Date("2026-11-01T00:00:00.000Z");

      const dirtySheet: FilmSheet = {
        ...SAMPLE_SHEET,
        summary: "8초 세 컷 구성입니다. data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
      };
      const compacted = compactFilmSheet(dirtySheet);
      expect(compacted.summary).not.toContain("base64");

      await writeCachedFilmSheet(f.sql, {
        organizationId: f.orgId,
        assetId: videoId,
        locale: "ko",
        depth: "blueprint",
        sheet: dirtySheet,
        now: t0,
      });

      const stored0 = (
        await f.sql.query<{ film_sheets: Record<string, unknown>; exp: Date }>(
          "select film_sheets, film_sheets_expires_at as exp from brand_studio_assets where id = $1",
          [videoId],
        )
      ).rows[0]!;
      expect(JSON.stringify(stored0.film_sheets)).not.toContain("base64");
      expect(new Date(stored0.exp).getTime()).toBe(t0.getTime() + FILM_SHEET_TTL_MS);

      // Cache hit 5 days later slides TTL forward to tHit + 14 days.
      const tHit = new Date("2026-11-06T00:00:00.000Z");
      const hit = await readCachedFilmSheet(f.sql, {
        organizationId: f.orgId,
        assetId: videoId,
        locale: "ko",
        depth: "blueprint",
        now: tHit,
      });
      expect(hit?.seconds).toBe(SAMPLE_SHEET.seconds);

      const storedHit = (
        await f.sql.query<{ exp: Date }>(
          "select film_sheets_expires_at as exp from brand_studio_assets where id = $1",
          [videoId],
        )
      ).rows[0]!;
      expect(new Date(storedHit.exp).getTime()).toBe(tHit.getTime() + FILM_SHEET_TTL_MS);

      // Reading 15 days after last hit treats cache as expired and clears columns to null.
      const tExpired = new Date(tHit.getTime() + 15 * 24 * 60 * 60 * 1000);
      const miss = await readCachedFilmSheet(f.sql, {
        organizationId: f.orgId,
        assetId: videoId,
        locale: "ko",
        depth: "blueprint",
        now: tExpired,
      });
      expect(miss).toBeNull();

      const cleared = (
        await f.sql.query<{ film_sheets: unknown; upd: unknown; exp: unknown }>(
          "select film_sheets, film_sheets_updated_at as upd, film_sheets_expires_at as exp from brand_studio_assets where id = $1",
          [videoId],
        )
      ).rows[0]!;
      expect(cleared.film_sheets).toBeNull();
      expect(cleared.upd).toBeNull();
      expect(cleared.exp).toBeNull();
    } finally {
      await f.db.close();
    }
  });

  it("purges unshared reference video shot-sheets on project completion while preserving shared active ones, and sweeps expired rows", async () => {
    const f = await studioFixture();
    try {
      const deps = studioDeps(f.sql);
      const unsharedVideoId = await seedVideoAsset(deps, f.orgId, f.ids.editor, 6);
      const sharedVideoId = await seedVideoAsset(deps, f.orgId, f.ids.editor, 10);
      const expiredVideoId = await seedVideoAsset(deps, f.orgId, f.ids.editor, 5);

      const now = new Date("2026-11-13T00:00:00.000Z");
      for (const id of [unsharedVideoId, sharedVideoId]) {
        await writeCachedFilmSheet(f.sql, {
          organizationId: f.orgId,
          assetId: id,
          locale: "ko",
          sheet: SAMPLE_SHEET,
          now,
        });
      }
      // Expired 2 days ago.
      await writeCachedFilmSheet(f.sql, {
        organizationId: f.orgId,
        assetId: expiredVideoId,
        locale: "ko",
        sheet: SAMPLE_SHEET,
        now: new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000),
      });

      const projCompleted = randomUUID();
      const projActive = randomUUID();
      await f.sql.query(
        `insert into brand_studio_video_projects (id, organization_id, title, status, aspect, timeline, created_by, request_id)
         values
           ($1, $3, '완료된 프로젝트', 'completed', '9:16', $4::jsonb, $6, $7),
           ($2, $3, '진행 중 프로젝트', 'active', '9:16', $5::jsonb, $6, $8)`,
        [
          projCompleted,
          projActive,
          f.orgId,
          JSON.stringify({ referenceAssetIds: [unsharedVideoId, sharedVideoId] }),
          JSON.stringify({ clips: [{ refVideoAssetId: sharedVideoId }] }),
          f.ids.editor,
          requestId(),
          requestId(),
        ],
      );

      const purgedCount = await purgeProjectFilmSheets(
        f.sql,
        f.orgId,
        [unsharedVideoId, sharedVideoId],
        projCompleted,
      );
      expect(purgedCount).toBe(1);

      const unsharedAfter = await readCachedFilmSheet(f.sql, {
        organizationId: f.orgId,
        assetId: unsharedVideoId,
        locale: "ko",
        now,
      });
      const sharedAfter = await readCachedFilmSheet(f.sql, {
        organizationId: f.orgId,
        assetId: sharedVideoId,
        locale: "ko",
        now,
      });
      expect(unsharedAfter).toBeNull();
      expect(sharedAfter?.seconds).toBe(SAMPLE_SHEET.seconds);

      // Opportunistic sweep via physical-cleanup clears expired shot-sheets without breaking signature.
      await dropUnreferencedStudioKeys(f.sql, deps.media, []);
      const expiredRow = (
        await f.sql.query<{ film_sheets: unknown }>(
          "select film_sheets from brand_studio_assets where id = $1",
          [expiredVideoId],
        )
      ).rows[0]!;
      expect(expiredRow.film_sheets).toBeNull();
      expect(await sweepExpiredFilmSheets(f.sql, now)).toBe(0);
    } finally {
      await f.db.close();
    }
  });

  it("tolerates legacy DB schemas where film_sheets_expires_at does not exist yet", async () => {
    const legacySql: SqlRunner = {
      async query(text) {
        if (text.includes("film_sheets_expires_at")) {
          const err = new Error('column "film_sheets_expires_at" does not exist') as Error & { code: string };
          err.code = "42703";
          throw err;
        }
        if (text.startsWith("select film_sheets from")) {
          return { rows: [{ film_sheets: { ko: SAMPLE_SHEET } }] } as never;
        }
        return { rows: [] } as never;
      },
      async transaction(fn) {
        return fn(legacySql);
      },
    };
    const read = await readCachedFilmSheet(legacySql, {
      organizationId: randomUUID(),
      assetId: randomUUID(),
      locale: "ko",
    });
    expect(read?.seconds).toBe(SAMPLE_SHEET.seconds);
    expect(await sweepExpiredFilmSheets(legacySql)).toBe(0);
  });
});

describe("2. Silent Multimodal Video-Creator Director (MediaAnalyzer + 3-Mode PromptCompiler)", () => {
  it("raises THUMBS_MAX to 9 and gracefully falls back from Argon stub to GeminiFlashMediaAnalyzer", async () => {
    expect(THUMBS_MAX).toBe(9);
    expect(DIRECTOR_THUMBS_MAX).toBe(9);
    expect(resolveDirectorProvider({})).toBe("gemini-4-hydrogen");
    expect(resolveDirectorProvider({ BRAND_STUDIO_DIRECTOR_PROVIDER: "gemini-3.8-flash" })).toBe("gemini-4-hydrogen");
    expect(resolveDirectorProvider({ BRAND_STUDIO_DIRECTOR_PROVIDER: "argon" })).toBe("argon");

    const thumb = { bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" };
    const tenRefs = Array.from({ length: 10 }, (_, idx) => ({
      index: idx + 1,
      kind: "image" as const,
      label: `이미지 ${idx + 1}`,
      role: "product" as const,
      thumb,
    }));

    const analyzerFetch = mockGemini({
      paletteHex: ["#14181F", "#EAE4DC", "#0033FF"],
      lightingNotes: "motivated soft window key from camera-left with grounded shadow floor",
      textureNotes: "natural skin pores and matte ceramic grain",
      subjectNotes: "matte serum bottle and off-axis model",
      referenceNotes: [{ token: "@Image 1", visualNotes: "matte glass bottle" }],
    });

    const reasons: string[] = [];
    const argonAnalyzer = createMediaAnalyzer({ BRAND_STUDIO_DIRECTOR_PROVIDER: "argon" });
    expect(argonAnalyzer).toBeInstanceOf(ArgonMediaAnalyzerStub);

    const digest = await argonAnalyzer.analyze(
      { locale: "ko", prompt: "세럼 병 클로즈업", references: tenRefs, sheet: SAMPLE_SHEET },
      { fetch: analyzerFetch as unknown as typeof fetch, env: ENV, onFallback: (r) => reasons.push(r) },
    );

    expect(reasons).toContain("argon_unconfigured");
    expect(digest.provider).toBe("gemini-4-hydrogen");
    expect(digest.paletteHex).toEqual(["#14181F", "#EAE4DC", "#0033FF"]);
    const sentParts = sentBody(analyzerFetch).contents[0]!.parts;
    expect(sentParts.filter((p) => "inlineData" in p)).toHaveLength(9);

    // Also verify enhancePrompt sends up to 9 inline reference thumbnails.
    const enhanceFetch = mockGemini({
      prompt: "Figure 1 to Figure 9 arranged cleanly in soft side light; keep Figure 1 exact.",
      notes: "아홉 장의 참조 구도를 정리했어요.",
    });
    await enhancePrompt(
      {
        kind: "image",
        profile: "seedream",
        locale: "ko",
        prompt: "이미지 1 중심으로 배치",
        references: tenRefs,
      },
      { fetch: enhanceFetch as unknown as typeof fetch, env: ENV },
    );
    expect(sentBody(enhanceFetch).contents[0]!.parts.filter((p) => "inlineData" in p)).toHaveLength(9);
  });

  it("classifies prompt intent into passthrough, slot_fill, and expand accurately", () => {
    // Passthrough: Visual style header, shot timeline markers, or >= 260 chars of technical direction.
    expect(
      classifyPromptIntent(
        "Visual style: #181A1F shadow floor, soft side key.\n0.0s–4.0s: 18° medium shot, she turns. Hard cut.\n4.0s–8.0s: close-up.",
      ),
    ).toBe("passthrough");
    expect(classifyPromptIntent("0–3s: wide tracking shot down the corridor. 3–6s: close-up on the bottle.")).toBe(
      "passthrough",
    );
    const longTechnical =
      "Camera begins in a low 35mm handheld tracking shot following her boots across wet basalt pavement under warm tungsten shopfront rim light and deep shadow floor, then pushes into a tight over-the-shoulder framing as she lifts the glass bottle toward the rain-streaked window with subtle off-axis eyeline and grounded ambient reflections.";
    expect(longTechnical.length).toBeGreaterThanOrEqual(260);
    expect(classifyPromptIntent(longTechnical)).toBe("passthrough");

    // Slot-fill: medium-detail prose missing Reference authority or shot boundary cuts.
    expect(
      classifyPromptIntent(
        "창가 테이블에서 여자가 천천히 이미지 1 세럼 병을 들어 올리고 카메라가 부드럽게 클로즈업으로 다가간다. 따뜻한 아침 햇살이 옆에서 비춘다.",
        false,
        1,
      ),
    ).toBe("slot_fill");

    // Expand: short Korean or English brief.
    expect(classifyPromptIntent("비 오는 서울 밤거리에서 우산 쓴 여자")).toBe("expand");
    expect(classifyPromptIntent("Bottle spinning on dark stone")).toBe("expand");
  });

  it("preserves user prose in passthrough mode while binding @Image N tokens, and enforces Video-Creator rules + No-BGM default + playbooks in expand/slot_fill", async () => {
    const f = await studioFixture();
    try {
      await f.sql.query(
        `insert into brand_studio_playbooks (organization_id, title, body_md, tags, inject_director, status, created_by, request_id)
         values
           ($1, 'Brand Lighting', 'Always keep warm tungsten rim light and matte stone surfaces.', '{lighting}', true, 'published', $2, $3),
           ($1, 'Draft Note', 'Unpublished draft rule.', '{}', true, 'draft', $2, $4)`,
        [f.orgId, f.ids.owner, requestId(), requestId()],
      );

      // 1) Passthrough preserves user text, strips redundant boilerplate header, and binds @Image 1.
      const structured = [
        "Create a Seedance 2.5 video",
        "Visual style: #12151C shadow floor, #D9D2C5 limestone.",
        "0.0s–4.0s: 18° medium close-up, model holds 이미지 1 bottle in rain. Hard cut.",
        "4.0s–8.0s: 45° close-up on label.",
      ].join("\n");

      const passthroughFetch = vi.fn();
      const passRes = await compileDirectorPrompt(
        {
          kind: "video",
          profile: "seedance",
          locale: "ko",
          prompt: structured,
          references: [{ index: 1, kind: "image", label: "이미지 1", role: "product" }],
          video: { seconds: 8, aspect: "9:16", audio: "on" },
        },
        {
          fetch: passthroughFetch as unknown as typeof fetch,
          env: ENV,
          sql: f.sql,
          organizationId: f.orgId,
        },
      );
      expect(passRes.intent).toBe("passthrough");
      expect(passthroughFetch).not.toHaveBeenCalled();
      expect(passRes.prompt).not.toMatch(/Create a Seedance/i);
      expect(passRes.prompt).toContain("@Image 1");
      expect(passRes.prompt).toContain("0.0s–4.0s:");
      expect(passRes.playbooksApplied).toBe(1);

      // 2) Expand mode injects Video-Creator system rules, scrubs plastic-skin & BGM hallucinations, and enforces Strict No-BGM default.
      const modelFetch = mockGemini({
        prompt: [
          "Create a Seedance video.",
          "Reference authority: lock identity and bottle geometry to @Image 1.",
          "Visual style: #181B20 shadow floor, #E6DFD5 linen, #3875C5 accent; motivated window key light matching ambient shadow floor and color spill, poreless porcelain glass-skin.",
          "0.0s–4.0s: 18° off-axis medium shot, she lifts @Image 1 with calm off-axis eyeline; slow push-in. Hard cut.",
          "4.0s–8.0s: OTS close-up on @Image 1 resting on stone, same as original video.",
          "Audio: soft glass click on stone, quiet piano background music rises.",
        ].join("\n"),
        notes: "조명과 컷 전환을 다듬었어요.",
      });

      const expanded = await compileDirectorPrompt(
        {
          kind: "video_remix",
          profile: "seedance",
          locale: "ko",
          prompt: "이미지 1 세럼을 드는 장면",
          references: [{ index: 1, kind: "image", label: "이미지 1", role: "product" }],
          video: {
            seconds: 8,
            aspect: "9:16",
            audio: "on",
            method: "blueprint",
            keep: ["camera", "timing", "look"],
            sheet: SAMPLE_SHEET,
          },
        },
        {
          fetch: modelFetch as unknown as typeof fetch,
          env: ENV,
          sql: f.sql,
          organizationId: f.orgId,
          analyzer: new GeminiFlashMediaAnalyzer(),
        },
      );

      expect(expanded.intent).toBe("expand");
      expect(expanded.source).toBe("model");
      expect(expanded.playbooksApplied).toBe(1);

      const sys = sentBody(modelFetch).systemInstruction.parts[0]!.text;
      expect(sys).toMatch(/Reference authority:/);
      expect(sys).toMatch(/Visual style:/);
      expect(sys).toMatch(/zero plastic\/waxy beauty-filter glare/);
      expect(sys).toMatch(/18° \/ 45° \/ 90° \/ OTS/);
      expect(sys).toMatch(/no background music, no score, no musical instruments/);

      expect(expanded.prompt).not.toMatch(/Create a Seedance/i);
      expect(expanded.prompt).not.toMatch(/glass-skin|poreless porcelain/i);
      expect(expanded.prompt).not.toMatch(/same as original video/i);
      expect(expanded.prompt).toMatch(/no background music, no score, no musical instruments/i);
      expect(expanded.prompt).not.toMatch(/piano background music/i);

      // 3) Deterministic fallback when Gemini times out / returns HTTP 500 never blocks generation.
      const failingFetch = vi.fn(async () => new Response("server down", { status: 500 }));
      const fallbackReasons: string[] = [];
      const fb = await compileDirectorPrompt(
        {
          kind: "video",
          profile: "seedance",
          locale: "ko",
          prompt: "짧은 브리프",
          references: [{ index: 1, kind: "image", label: "이미지 1", role: "person" }],
          video: { seconds: 8, aspect: "9:16", audio: "sfx" },
        },
        {
          fetch: failingFetch as unknown as typeof fetch,
          env: ENV,
          onFallback: (r) => fallbackReasons.push(r),
        },
      );

      expect(fb.source).toBe("fallback");
      expect(fallbackReasons).toContain("gemini_http_500");
      expect(fb.prompt).toContain("Reference authority:");
      expect(fb.prompt).toMatch(/Visual style:.*#[0-9A-F]{6}/);
      expect(fb.prompt).toContain("natural skin texture faithful to @Image 1, zero plastic/waxy beauty-filter glare");
      expect(fb.prompt).toContain("match ambient shadow floor and color spill, never pasted-on or flat front-lit");
      expect(fb.prompt).toContain("0.0s–");
      expect(fb.prompt).toContain(DIRECTOR_NO_BGM_AUDIO_LINE);

      // Direct music performance request is respected when audio === 'on'.
      const singingFb = composeDirectorFallbackPrompt({
        kind: "video",
        profile: "seedance",
        locale: "ko",
        prompt: "가수가 무대에서 라이브로 노래를 부르며 기타를 연주한다",
        references: [],
        video: { seconds: 6, aspect: "9:16", audio: "on" },
      });
      expect(singingFb.prompt).toMatch(/Audio:.*musical performance/i);
    } finally {
      await f.db.close();
    }
  });
});

describe("3. Zero-Drift <PromptHighlight>, Bidirectional Tray Ring, Collapsed Dock & Absence of Manual Enhance UI", () => {
  it("highlights bound @image1/@video1/@이미지1 with light-blue marks, marks unbound @image9 false, and preserves trailing newline space", () => {
    const img1 = trayItemFromAsset(asset(1, { kind: "image" }));
    const vid1 = trayItemFromAsset(asset(2, { kind: "video" }));
    const tray = [img1, vid1];

    const prompt = "@image1 과 @video1 그리고 @이미지1 은 바인딩되고 @image9 는 미첨부입니다\n";
    const resolved = resolvePromptMentions(prompt, tray);
    expect([...resolved.mentionedKeys]).toEqual([img1.key, vid1.key]);

    const html = renderToStaticMarkup(createElement(PromptHighlight, { prompt, tray }));
    expect(html).toContain('class="bs-prompt-backdrop"');
    expect(html).toContain('data-prompt-highlight=""');
    const mark = (bound: boolean, text: string, key?: string) =>
      new RegExp(`<mark class="bs-mention-mark" data-mention-bound="${bound}" data-mention-start="\\d+"${key ? ` data-mention-keys="${key}"` : ""}>${text}</mark>`);
    expect(html).toMatch(mark(true, "@image1", img1.key));
    expect(html).toMatch(mark(true, "@video1", vid1.key));
    expect(html).toMatch(mark(true, "@이미지1", img1.key));
    expect(html).toMatch(mark(false, "@image9"));
    // Ends with `\n </div>` so CSS pre-wrap mirrors `<textarea>`'s trailing blank line without drift.
    expect(html.endsWith("\n </div>")).toBe(true);
  });

  it("renders bidirectional data-mentioned on Tray items, supports collapsed Dock pill, and removes manual enhance switch", () => {
    const img1 = trayItemFromAsset(asset(1, { kind: "image" }));
    const img2 = trayItemFromAsset(asset(2, { kind: "image" }));
    const vid1 = trayItemFromAsset(asset(3, { kind: "video", seconds: 8 }));
    const tray = [img1, img2, vid1];
    const copy = copyFor("ko");
    const labels = trayLabels(tray, copy);

    const { mentionedKeys } = resolvePromptMentions("@image1 인물과 @video1 카메라 무빙", tray);
    expect(mentionedKeys.has(img1.key)).toBe(true);
    expect(mentionedKeys.has(img2.key)).toBe(false);
    expect(mentionedKeys.has(vid1.key)).toBe(true);

    const trayHtml = renderToStaticMarkup(
      createElement(Tray, {
        items: tray,
        labels,
        medium: "video",
        copy,
        dropActive: false,
        uploading: [],
        mentionedKeys,
        onUpdate: () => {},
        onRemove: () => {},
        onMove: () => {},
        onBrowse: () => {},
      }),
    );
    // Only @image1 and @video1 carry data-mentioned=""; @image2 does not.
    expect(trayHtml).toMatch(/data-virtual-tag="@image1" data-mentioned=""/);
    expect(trayHtml).not.toMatch(/data-virtual-tag="@image2" data-mentioned=""/);
    expect(trayHtml).toMatch(/data-virtual-tag="@video1" data-mentioned=""/);

    const baseDockProps: DockProps = {
      mode: "video",
      draft: { ...withMedium(initialDraft(), "video"), prompt: "@image1 과 @image9" },
      tray,
      labels,
      copy,
      locale: "ko",
      allowance: allowance(),
      credits: 420,
      busy: false,
      message: null,
      film: null,
      uploading: [],
      onDraft: () => {},
      onTrayUpdate: () => {},
      onTrayRemove: () => {},
      onSubmit: () => {},
      onDropSource: () => {},
      onFiles: () => {},
      onBrowse: () => {},
    };

    const expandedHtml = renderToStaticMarkup(createElement(Dock, baseDockProps));
    expect(expandedHtml).not.toContain("data-studio-enhance");
    expect(expandedHtml).not.toContain("data-studio-enhance-now");
    expect(expandedHtml).not.toContain("data-studio-enhance-group");
    expect(expandedHtml).toMatch(/data-mention-bound="true" data-mention-start="0" data-mention-keys="[^"]+">@image1<\/mark>/);
    expect(expandedHtml).toMatch(/data-mention-bound="false" data-mention-start="\d+">@image9<\/mark>/);

    const collapsedHtml = renderToStaticMarkup(
      createElement(Dock, {
        ...baseDockProps,
        collapsed: true,
        collapsedLabel: "새 컷 만들기",
      }),
    );
    expect(collapsedHtml).toContain('class="bs-dock bs-dock-collapsed"');
    expect(collapsedHtml).toContain("data-studio-dock");
    expect(collapsedHtml).toContain('data-collapsed=""');
    expect(collapsedHtml).toContain("새 컷 만들기");
    expect(collapsedHtml).toContain("참조 3");
    expect(collapsedHtml).toContain("남은 크레딧");

    // Verify CSS rules for zero-drift metrics, light-blue pill, amber dotted unbound underline, and #0033FF Tray ring.
    const css = readFileSync(path.resolve(process.cwd(), "app/(brand)/studio-v2.css"), "utf8");
    expect(css).toContain(".bs-prompt, .bs-prompt-backdrop");
    expect(css).toContain('data-mention-bound="true"');
    expect(css).toContain("color-mix(in srgb, var(--ys-accent, #ff58ae) 16%, transparent)");
    expect(css).toContain("border-bottom: 1.5px dotted #D97706");
    expect(css).toContain("color-mix(in srgb, var(--ys-accent, #ff58ae) 55%, transparent)");
    expect(css).not.toMatch(/#ebf5ff/i);
  });
});
