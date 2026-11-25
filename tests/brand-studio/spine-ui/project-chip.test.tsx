import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioBrandProject } from "@/lib/brand-studio/contracts";
import type { StudioSpineProps } from "@/lib/brand-studio/open-project";
import {
  PROJECT_SEARCH_THRESHOLD,
  ProjectChip,
  ProjectGoneNotice,
  ProjectSpineProvider,
  createProjectErrorLine,
  filterProjects,
  formatRelativeTime,
  nextListIndex,
  projectCoverThumb,
  projectSecondLine,
} from "@/components/brand-studio/project-chip";
import { getDictionary } from "@/lib/i18n/dictionaries";

const ORG = "a0000000-0000-4000-8000-00000000000a";
const NOW = new Date("2026-11-25T12:00:00.000Z");

const proj = (n: number, patch: Partial<StudioBrandProject> = {}): StudioBrandProject => ({
  id: `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`,
  title: `Project ${n}`,
  origin: "self",
  lastActivityAt: "2026-11-25T10:00:00.000Z", // 2 hours before NOW
  ...patch,
});

function renderChip(
  initial: Omit<StudioSpineProps, "noticeSource"> & { noticeSource?: StudioSpineProps["noticeSource"] },
  opts: {
    locale?: "ko" | "en";
    initialOpen?: boolean;
    initialCreating?: boolean;
    initialSearch?: string;
    initialCreateError?: string | null;
    withNotice?: boolean;
  } = {},
) {
  const locale = opts.locale ?? "ko";
  const dict = getDictionary(locale);
  const fullInitial: StudioSpineProps = {
    ...initial,
    noticeSource: initial.noticeSource ?? (initial.notice === "gone" ? "cookie" : null),
  };
  return renderToStaticMarkup(
    <ProjectSpineProvider organizationId={ORG} locale={locale} copy={dict.projectSpine} initial={fullInitial}>
      <ProjectChip
        initialOpen={opts.initialOpen}
        initialCreating={opts.initialCreating}
        initialSearch={opts.initialSearch}
        initialCreateError={opts.initialCreateError}
        now={NOW}
      />
      {opts.withNotice && <ProjectGoneNotice />}
    </ProjectSpineProvider>,
  );
}

describe("ProjectChip pure helpers", () => {
  it("picks image thumbUrl ?? url, video thumbUrl only, and null otherwise", () => {
    expect(projectCoverThumb({ cover: { kind: "image", url: "https://m/full.png", thumbUrl: "https://m/thumb.webp" } })).toBe(
      "https://m/thumb.webp",
    );
    expect(projectCoverThumb({ cover: { kind: "image", url: "https://m/full.png", thumbUrl: null } })).toBe("https://m/full.png");
    expect(projectCoverThumb({ cover: { kind: "video", url: "https://m/clip.mp4", thumbUrl: "https://m/poster.webp" } })).toBe(
      "https://m/poster.webp",
    );
    expect(projectCoverThumb({ cover: { kind: "video", url: "https://m/clip.mp4", thumbUrl: null } })).toBeNull();
    expect(projectCoverThumb({})).toBeNull();
  });

  it("filters projects by title case-insensitively", () => {
    const list = [proj(1, { title: "봄 향수 론칭" }), proj(2, { title: "Denim Lookbook 26SS" }), proj(3, { title: "겨울 립 컬렉션" })];
    expect(filterProjects(list, "")).toHaveLength(3);
    expect(filterProjects(list, "  denim ")).toEqual([list[1]]);
    expect(filterProjects(list, "향수")).toEqual([list[0]]);
    expect(filterProjects(list, "없는이름")).toEqual([]);
  });

  it("formats relative activity time and team tag on the second line", () => {
    const ko = getDictionary("ko").projectSpine;
    const en = getDictionary("en").projectSpine;
    const twoHoursAgo = formatRelativeTime("2026-11-25T10:00:00.000Z", "ko", NOW);
    expect(twoHoursAgo).toContain("2");
    expect(projectSecondLine(proj(1), ko, "ko", NOW)).toBe(`마지막 작업 ${twoHoursAgo}`);
    expect(projectSecondLine(proj(1, { origin: "team" }), ko, "ko", NOW)).toBe(`야기 팀과 · 마지막 작업 ${twoHoursAgo}`);
    expect(projectSecondLine(proj(1, { origin: "team" }), en, "en", NOW)).toContain("With the YAGI team");
    expect(projectSecondLine(proj(1, { origin: "team" }), en, "en", NOW)).toContain("Last activity");
  });

  it("maps too_many_running to createLimit and every other failure to createFailed", () => {
    const ko = getDictionary("ko").projectSpine;
    const en = getDictionary("en").projectSpine;
    expect(createProjectErrorLine("too_many_running", ko)).toBe(ko.createLimit);
    expect(createProjectErrorLine("too_many_running", en)).toBe(en.createLimit);
    expect(createProjectErrorLine("failed", ko)).toBe(ko.createFailed);
    expect(createProjectErrorLine("invalid", en)).toBe(en.createFailed);
    expect(createProjectErrorLine(null, ko)).toBe(ko.createFailed);
  });

  it("moves active listbox index with ArrowDown, ArrowUp, Home and End", () => {
    expect(nextListIndex(0, "ArrowDown", 4)).toBe(1);
    expect(nextListIndex(3, "ArrowDown", 4)).toBe(0);
    expect(nextListIndex(0, "ArrowUp", 4)).toBe(3);
    expect(nextListIndex(2, "Home", 4)).toBe(0);
    expect(nextListIndex(1, "End", 4)).toBe(3);
    expect(nextListIndex(0, "ArrowDown", 0)).toBe(-1);
  });
});

describe("ProjectChip markup, markers and list states (§4.2)", () => {
  it("renders the closed chip with required markers and accessible name", () => {
    const p1 = proj(1, {
      title: "봄 향수 론칭",
      cover: { kind: "image", url: "https://m/full.png", thumbUrl: "https://m/thumb.webp" },
    });
    const html = renderChip({ projects: [p1], open: { kind: "project", id: p1.id }, canCreate: true, notice: null });
    expect(html).toContain("data-project-chip");
    expect(html).toContain(`data-project-open="${p1.id}"`);
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="저장 위치: 봄 향수 론칭"');
    expect(html).toContain('src="https://m/thumb.webp"');
    expect(html).not.toContain("data-project-picker");
  });

  it("renders 0 projects: 미분류 selected, new-project row, guide line, no search", () => {
    const ko = getDictionary("ko").projectSpine;
    const html = renderChip(
      { projects: [], open: { kind: "unfiled" }, canCreate: true, notice: null },
      { initialOpen: true },
    );
    expect(html).toContain('data-project-open="unfiled"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("data-project-picker");
    expect(html).toContain(ko.saveTo);
    expect(html).toContain('data-project-row="unfiled"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain(ko.selectedMark);
    expect(html).toContain("data-project-new");
    expect(html).toContain(ko.newProject);
    expect(html).toContain(ko.newProjectDesc);
    expect(html).toContain(ko.pickerEmpty);
    expect(html).toContain(ko.pickerFooter);
    expect(html).not.toContain(ko.pickerSearch);
  });

  it("renders 1-5 projects: thumbnails/neutral tiles, team tag, divider, 미분류, new-project, no search", () => {
    const ko = getDictionary("ko").projectSpine;
    const p1 = proj(1, {
      title: "봄 향수 론칭",
      origin: "self",
      cover: { kind: "image", url: "https://m/p1.png", thumbUrl: null },
    });
    const p2 = proj(2, { title: "겨울 립 필름", origin: "team" });
    const html = renderChip(
      { projects: [p1, p2], open: { kind: "project", id: p1.id }, canCreate: true, notice: null },
      { initialOpen: true },
    );
    expect(html).toContain(`data-project-row="${p1.id}"`);
    expect(html).toContain(`data-project-row="${p2.id}"`);
    expect(html).toContain('data-project-row="unfiled"');
    expect(html).toContain('src="https://m/p1.png"');
    expect(html).toContain(ko.pickerTeamTag);
    expect(html).toContain(ko.pickerUnfiledDesc);
    expect(html).toContain("data-project-new");
    expect(html).not.toContain(ko.pickerSearch);
    expect(html).not.toContain(ko.pickerEmpty);
  });

  it("renders 6 or more projects with search input and scrollable list, and filters in the browser", () => {
    const ko = getDictionary("ko").projectSpine;
    const many = Array.from({ length: PROJECT_SEARCH_THRESHOLD }, (_, i) => proj(i + 1, { title: `캠페인 ${i + 1}` }));
    const html = renderChip(
      { projects: many, open: { kind: "project", id: many[0]!.id }, canCreate: true, notice: null },
      { initialOpen: true },
    );
    expect(html).toContain(`placeholder="${ko.pickerSearch}"`);
    expect(html).toContain('data-project-scroll="true"');

    const filtered = renderChip(
      { projects: many, open: { kind: "project", id: many[0]!.id }, canCreate: true, notice: null },
      { initialOpen: true, initialSearch: "캠페인 5" },
    );
    expect(filtered).toContain("캠페인 5");
    expect(filtered).not.toContain("캠페인 2");
  });

  it("hides new-project row and shows viewerHint in footer for viewers (canCreate: false)", () => {
    const ko = getDictionary("ko").projectSpine;
    const html = renderChip(
      { projects: [proj(1)], open: { kind: "unfiled" }, canCreate: false, notice: null },
      { initialOpen: true },
    );
    expect(html).not.toContain("data-project-new");
    expect(html).toContain(ko.viewerHint);
    expect(html).not.toContain(ko.pickerFooter);
  });

  it("renders the inline new-project form with maxlength 120, one filled submit button, and limit error", () => {
    const ko = getDictionary("ko").projectSpine;
    const html = renderChip(
      { projects: [], open: { kind: "unfiled" }, canCreate: true, notice: null },
      { initialOpen: true, initialCreating: true, initialCreateError: ko.createLimit },
    );
    expect(html).toContain("data-project-new-form");
    expect(html).toContain(ko.createLabel);
    expect(html).toContain(`placeholder="${ko.createPlaceholder}"`);
    expect(html).toContain('maxLength="120"');
    expect(html).toContain(ko.createSubmit);
    expect(html).toContain(ko.cancel);
    expect(html).toContain(ko.createLimit);
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
  });

  it("renders the dismissible gone notice under the header when notice is 'gone'", () => {
    const ko = getDictionary("ko").projectSpine;
    const withGone = renderChip(
      { projects: [], open: { kind: "unfiled" }, canCreate: true, notice: "gone" },
      { withNotice: true },
    );
    expect(withGone).toContain("data-project-gone-notice");
    expect(withGone).toContain(ko.goneNotice);

    const withoutGone = renderChip(
      { projects: [], open: { kind: "unfiled" }, canCreate: true, notice: null },
      { withNotice: true },
    );
    expect(withoutGone).not.toContain("data-project-gone-notice");
  });

  it("renders English strings accurately when locale is 'en'", () => {
    const en = getDictionary("en").projectSpine;
    const html = renderChip(
      { projects: [proj(1, { title: "Spring Launch", origin: "team" })], open: { kind: "unfiled" }, canCreate: true, notice: "gone" },
      { locale: "en", initialOpen: true, withNotice: true },
    );
    expect(html).toContain('aria-label="Save to: Unfiled"');
    expect(html).toContain(en.saveTo);
    expect(html).toContain(en.pickerTeamTag);
    expect(html).toContain(en.pickerUnfiledDesc);
    expect(html).toContain(en.newProject);
    expect(html).toContain(en.pickerFooter);
    expect(html.replace(/&#x27;/g, "'")).toContain(en.goneNotice);
  });
});
