import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { YagiStudioLockup } from "@/components/brand/yagi-mark";
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
  it("defines the brand host on the TWINGS blue, with red only as a low-chroma danger state", () => {
    expect(brandTokens).toContain("--ys-accent: #0000ee;");
    expect(brandTokens).toContain("--color-blue: var(--ys-accent);");
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

  it("draws the YAGI STUDIO lockup without the red live dot", () => {
    const lockup = renderToStaticMarkup(<YagiStudioLockup size={22} />);
    expect(lockup).toContain("data-yagi-studio-lockup");
    expect(lockup).not.toContain("ys-brand-live-dot");
  });

  it("gives only the open campaign tab the gliding pill", () => {
    const html = renderToStaticMarkup(<ProjectTabs b={getDictionary("ko").brandWorkspace}><div /></ProjectTabs>);
    expect(html.match(/bw-tab-indicator/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"><span class="bw-tab-indicator" aria-hidden="true"><\/span>/);
  });
});
