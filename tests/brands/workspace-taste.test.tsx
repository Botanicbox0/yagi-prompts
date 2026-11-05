import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { TwingsStudioLockup } from "@/components/brand/twings-mark";
import { YagiLogo, YagiStudioLockup } from "@/components/brand/yagi-mark";
import { BrandBriefStudio } from "@/components/brand-workspace/brand-brief-studio";
import { CampaignMoatShowcase } from "@/components/brand-workspace/campaign-moat-showcase";
import { ProjectTabs } from "@/components/brand-workspace/project-tabs";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * brand.twings.app follows docs/design/TASTE.md: ink, white and one blue, never the global YAGI v1.2
 * red. /admin loads the same stylesheet with its own token bridge, so shared rules may keep the old red
 * only as a var() fallback that the brand host never reaches.
 */
const css = readFileSync(join(process.cwd(), "app", "(brand)", "workspace.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("\n}", start));
};
const brandTokens = block("html[data-brand-workspace]");
const adminTokens = block("html[data-workspace-admin]");
const rules = css.replace(brandTokens, "").replace(adminTokens, "");

describe("brand workspace taste", () => {
  it("defines the brand host on one key colour token, with red only as a low-chroma danger state", () => {
    expect(brandTokens).toMatch(/--ys-accent: #[0-9a-f]{6};/);
    expect(brandTokens).toContain("--color-blue: var(--ys-accent-text);");
    expect(brandTokens).toContain("--ys-accent-text: color-mix(in srgb, var(--ys-accent) 85%, #000);");
    // The key colour may change: every other blue derives from --ys-accent, none is written out.
    expect(rules + brandTokens.replace(/--ys-accent: #[0-9a-f]{6};/, "")).not.toMatch(/#0000ee|rgba\(0, 0, 238|#4355e8|#3875c5/i);
    // Blue as text uses the darker same-hue shade, so small labels pass AA on white, alabaster and tints.
    expect(rules).not.toMatch(/(^|[;{ ])color: ?var\(--ys-accent[,)]/m);
    expect(brandTokens).toContain("--ys-red: var(--ys-danger);");
    expect(brandTokens).not.toMatch(/#ed1e1e|#dc2626/i);
  });

  it("keeps the YAGI red out of every shared rule except as an Admin fallback", () => {
    for (const { 0: hex, index: at } of rules.matchAll(/#(?:ed1e1e|dc2626|c41212|c81414|c81616)\b/gi)) {
      expect(rules.slice(Math.max(0, at - 120), at), `bare ${hex}`).toMatch(/var\(--ys-[a-z-]+,[^;{}]*$/);
    }
    const bare = [...rules.matchAll(/var\(--ys-red(?:-soft)?\)/g)].filter((m) => !/,\s*[^,;{}]*$/.test(rules.slice(Math.max(0, m.index - 48), m.index)));
    expect(bare.map((m) => rules.slice(m.index - 30, m.index + 20))).toEqual([]);
  });

  it("keeps right-hand rails off the brand host: no activity rail, no conversation dock beside a tab", () => {
    expect(css).not.toContain("[data-home-recent] .bw-content-grid");
    for (const tab of ["review", "brief"]) {
      expect(css).toContain(`:where([data-brand-workspace]) .bw-project-sections[data-project-tab='${tab}'] #conversation`);
    }
    expect(css).toContain("[data-project-tab='brief'] #conversation { display: none; }");
  });

  it("draws the TWINGS STUDIO header lockup and Powered by YAGI footer mark without the red live dot", () => {
    const twingsStudio = renderToStaticMarkup(<TwingsStudioLockup size={22} />);
    expect(twingsStudio).toContain("data-twings-studio-lockup");
    expect(twingsStudio).toContain("data-twings-logo");
    expect(twingsStudio).toContain("STUDIO");
    expect(twingsStudio).not.toContain("ys-brand-live-dot");

    const yagiPowered = renderToStaticMarkup(<YagiLogo size={16} />);
    expect(yagiPowered).toContain("data-yagi-logo");
    expect(yagiPowered).toContain("YAGI");

    const legacyLockup = renderToStaticMarkup(<YagiStudioLockup size={22} />);
    expect(legacyLockup).toContain("data-yagi-studio-lockup");
    expect(legacyLockup).not.toContain("ys-brand-live-dot");
  });

  it("tailors the studio to the brand's pre-selected category without a 5-industry tab bar", () => {
    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-beauty"
        organizationName="GlowLab Skincare"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );
    expect(html).toContain('data-active-studio-category="beauty_skincare"');
    expect(html).toContain('data-studio-category-pill="beauty_skincare"');
    expect(html).not.toContain('data-studio-category-pill="fashion_apparel"');
    expect(html).not.toContain('data-studio-category-pill="fnb_hospitality"');
  });

  it("gives only the open campaign tab the gliding pill", () => {
    const html = renderToStaticMarkup(<ProjectTabs b={getDictionary("ko").brandWorkspace}><div /></ProjectTabs>);
    expect(html.match(/bw-tab-indicator/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"><span class="bw-tab-indicator" aria-hidden="true"><\/span>/);
  });

  it("keeps decorative emojis and circled numbers out of every brand-workspace component", () => {
    const dir = join(process.cwd(), "components", "brand-workspace");
    const banned = /[⚡🔇🔊🔒🎛🔓✦🔗📋🎬✨🔁🤔📄💡🛠✅📁⚙📱💧💬📍🎙⚠📌🔬🎵📅💳☰①②③④⑤]/u;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".tsx")) continue;
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(banned);
    }
  });

  it("renders the campaign showcase reel with uncropped 4:5 passepartout cards and captions below media", () => {
    const html = renderToStaticMarkup(
      <CampaignMoatShowcase
        locale="ko"
        organizationId="f5a6993b-1951-497e-a4da-3f221892f85e"
        studioOpen={true}
        canRequest={true}
      />,
    );
    expect(html).toContain('class="bw-showcase-reel"');
    expect(html).toContain('class="bw-showcase-card"');
    expect(html).toContain('class="bw-showcase-caption"');
    expect(html).toContain('class="bw-showcase-tracks"');
    expect(html).not.toContain("height:200px");
  });
});
