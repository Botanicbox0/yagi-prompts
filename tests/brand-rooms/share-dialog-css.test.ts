import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The share dialog opens on the dark workspace (room review and storyboards). It once painted a fixed
 * white glass while inheriting the workspace's light ink, so its heading, labels and checkboxes vanished.
 * The surface and the ink must come from the same workspace tokens, with light fallbacks for surfaces that
 * define none (admin).
 */
const css = readFileSync(path.join(process.cwd(), "components/brand-rooms/share/share.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of every rule whose selector list is exactly `selector`. */
function rules(selector: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const selectors = m[1]!.split(",").map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out;
}

describe("share dialog colours", () => {
  const dialog = rules(".brh-dialog").join("\n");

  it("paints no fixed light background", () => {
    const backgrounds = [...dialog.matchAll(/(?:^|;|\s)background(?:-color)?\s*:\s*([^;]+)/g)].map((m) => m[1]!.trim());
    expect(backgrounds.length).toBeGreaterThan(0);
    for (const value of backgrounds) {
      expect(value.startsWith("var(")).toBe(true);
      expect(value).not.toMatch(/^(#fff|#ffffff|white|rgba?\(\s*255)/i);
    }
  });

  it("sets its ink together with the background, from the same theme", () => {
    expect(dialog).toMatch(/background:\s*var\(--brh-glass\)/);
    expect(dialog).toMatch(/color:\s*var\(--brh-ink\)/);
    const tokens = rules(".brh-dialog").concat(rules(".brh-open")).join("\n");
    expect(tokens).toMatch(/--brh-glass:\s*var\(--ys-glass,/);
    expect(tokens).toMatch(/--brh-ink:\s*var\(--ys-ink,/);
  });

  it("keeps fields and the result box visible on the glass", () => {
    expect(dialog).toMatch(/--brh-well:\s*inset 0 0 0 1px var\(--brh-line-strong\)/);
    expect(rules(".brh-dialog .brh-made").join("")).toMatch(/box-shadow/);
  });

  it("finds dark workspace tokens for that glass and ink", () => {
    const workspace = readFileSync(path.join(process.cwd(), "app/(brand)/workspace.css"), "utf8");
    expect(workspace).toMatch(/--ys-glass:\s*rgba\(24, 24, 27/);
    expect(workspace).toMatch(/--ys-ink:\s*#ededed/);
  });
});
