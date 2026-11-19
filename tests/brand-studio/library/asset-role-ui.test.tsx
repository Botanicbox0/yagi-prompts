import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioAssetView } from "@/lib/brand-studio/contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { createStudioApi } from "@/components/brand-studio/api";
import { AssetDialog, ROLE_CHOICES, roleChoiceAfterKey } from "@/components/brand-studio/rail/asset-dialog";
import { UploadsTab } from "@/components/brand-studio/rail/uploads-tab";
import type { RailKit } from "@/components/brand-studio/rail/parts";
import { filterUploads } from "@/components/brand-studio/rail/text";
import { toReferences, trayItemFromAsset, updateTrayItem, withRecognisedRoles } from "@/components/brand-studio/refs";
import { ROLE_READ_DELAYS_MS, stillAwaitingRole } from "@/components/brand-studio/use-studio";

/** docs/BRAND-STUDIO-V3.md §4.1 — what the screen does with a recognised role. */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const asset = (n: number, patch: Partial<StudioAssetView> = {}): StudioAssetView => ({
  id: uuid(n),
  kind: "image",
  role: null,
  name: `Picture ${n}`,
  tags: [],
  url: `https://media.example/st/a-${n}.png`,
  thumbUrl: `https://media.example/st/a-${n}.webp`,
  width: 800,
  height: 800,
  seconds: null,
  source: "upload",
  createdAt: "2026-11-19T00:00:00Z",
  ...patch,
});
const copyFor = (locale: "ko" | "en") => getDictionary(locale).studioLibrary;
const kit = (locale: "ko" | "en" = "ko"): RailKit => ({
  copy: copyFor(locale),
  canCreate: true,
  attachOnPress: true,
  onAttach() {},
  onView() {},
  likeAction: () => ({ key: "like", label: "like", icon: "heart", run() {} }),
  fileItems: () => [],
  menu: null,
  setMenu() {},
  say() {},
});

describe("recognised roles on the screen", () => {
  it("filters by a recognised role exactly like a chosen one", () => {
    const list = [asset(1, { role: "product", roleSource: "auto" }), asset(2, { role: "product", roleSource: "user" }), asset(3), asset(4, { role: "logo", roleSource: "auto" })];
    expect(filterUploads(list, "", "product").map((a) => a.id)).toEqual([uuid(1), uuid(2)]);
    expect(filterUploads(list, "", "logo").map((a) => a.id)).toEqual([uuid(4)]);
    expect(filterUploads(list, "", "all")).toHaveLength(4);
  });

  it("labels a tile with its role, and an empty one with nothing", () => {
    const html = renderToStaticMarkup(
      <UploadsTab
        kit={kit()}
        assets={[asset(1, { role: "product", roleSource: "auto" }), asset(2)]}
        notice={null}
        uploading={[]}
        searchId="s"
        dropActive={false}
        onFiles={() => {}}
        onUpdate={async () => ({ ok: true })}
        onDelete={async () => ({ ok: true })}
      />,
    );
    expect(html.match(/data-library-role/g)).toHaveLength(1);
    expect(html).toContain(">제품</span>");
  });

  it("says in the dialog that a role was recognised, only while it is the recognised one", () => {
    for (const locale of ["ko", "en"] as const) {
      const copy = copyFor(locale);
      const render = (a: StudioAssetView) => renderToStaticMarkup(<AssetDialog asset={a} copy={copy} onUpdate={async () => ({ ok: true })} onDelete={async () => ({ ok: true })} onClose={() => {}} />);
      expect(render(asset(1, { role: "person", roleSource: "auto" }))).toContain(copy.uploads.roleAuto);
      expect(render(asset(1, { role: "person", roleSource: "user" }))).not.toContain(copy.uploads.roleAuto);
      expect(render(asset(1, { role: null, roleSource: "auto" }))).not.toContain(copy.uploads.roleAuto);
      expect(render(asset(1, { role: null }))).not.toContain(copy.uploads.roleAuto);
      // No internal words on a customer screen.
      expect(copy.uploads.roleAuto).not.toMatch(/\b(gemini|ai|model|classifier)\b|인공지능|모델|분류기|정확도|%/i);
    }
  });

  it("reads the library again until each pending upload has its answer", () => {
    const list = [asset(1), asset(2, { role: "product", roleSource: "auto" }), asset(3, { roleSource: "auto" })];
    expect(stillAwaitingRole([uuid(1), uuid(2), uuid(3), uuid(9)], list)).toEqual([uuid(1)]);
    expect(ROLE_READ_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeGreaterThan(15_000); // past the check's own timeout
  });

  it("fills a tray picture's role once it is recognised, never over one picked in the tray", () => {
    const pending = trayItemFromAsset(asset(1));
    expect(pending.roleCheck).toBe(true);
    expect(trayItemFromAsset(asset(1, { role: "logo", roleSource: "auto" }))).toMatchObject({ role: "logo" });
    expect(trayItemFromAsset(asset(1, { role: "logo", roleSource: "auto" })).roleCheck).toBeUndefined();
    const tray = [pending, trayItemFromAsset(asset(2))];
    expect(withRecognisedRoles(tray, [asset(1), asset(2)])).toBe(tray); // nothing yet: the same array
    const filled = withRecognisedRoles(tray, [asset(1, { role: "product", roleSource: "auto" }), asset(2, { roleSource: "auto" })]);
    expect(filled[0]).toMatchObject({ role: "product" });
    expect(filled[0]!.roleCheck).toBeUndefined();
    expect(filled[1]!.role).toBeUndefined();
    expect(filled[1]!.roleCheck).toBeUndefined();
    const picked = updateTrayItem(tray, pending.key, { role: "style" });
    expect(withRecognisedRoles(picked, [asset(1, { role: "product", roleSource: "auto" })])[0]).toMatchObject({ role: "style" });
    const cleared = updateTrayItem(tray, pending.key, { role: undefined });
    expect(withRecognisedRoles(cleared, [asset(1, { role: "product", roleSource: "auto" })])[0]!.role).toBeUndefined();
    // The marker never reaches the server.
    expect(toReferences(tray, "image")[0]).toEqual({ assetId: uuid(1) });
  });

  it("picks the role with a row of chips, one stop on Tab, never a browser select", () => {
    const copy = copyFor("ko");
    const html = renderToStaticMarkup(
      <AssetDialog asset={asset(1, { role: "logo", roleSource: "auto" })} copy={copy} onUpdate={async () => ({ ok: true })} onDelete={async () => ({ ok: true })} onClose={() => {}} />,
    );
    expect(html).not.toContain("<select");
    expect(html).toMatch(/role="radiogroup"[^>]*aria-describedby="[^"]+-role-hint"/);
    expect(html.match(/role="radio"/g)).toHaveLength(ROLE_CHOICES.length);
    expect(ROLE_CHOICES).toEqual(["", "product", "person", "logo", "style", "place", "other"]);
    // The chosen chip is the one Tab stop and reads as checked; "no role" is the first chip.
    expect(html).toMatch(/aria-checked="true" data-selected="" data-role-choice="logo" tabindex="0"/);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain(`data-role-choice="none" tabindex="-1">${copy.uploads.roleNone}<`);
    const empty = renderToStaticMarkup(<AssetDialog asset={asset(2)} copy={copy} onUpdate={async () => ({ ok: true })} onDelete={async () => ({ ok: true })} onClose={() => {}} />);
    expect(empty).toMatch(/aria-checked="true" data-selected="" data-role-choice="none" tabindex="0"/);
    // Arrows move and wrap like native radios; Home and End jump; other keys do nothing.
    expect(roleChoiceAfterKey("ArrowRight", 0)).toBe(1);
    expect(roleChoiceAfterKey("ArrowDown", 6)).toBe(0);
    expect(roleChoiceAfterKey("ArrowLeft", 0)).toBe(6);
    expect(roleChoiceAfterKey("ArrowUp", 3)).toBe(2);
    expect(roleChoiceAfterKey("Home", 4)).toBe(0);
    expect(roleChoiceAfterKey("End", 1)).toBe(6);
    expect(roleChoiceAfterKey("Enter", 1)).toBeNull();
  });

  it("marks the fill source as transient on the finishing call, and nothing else", async () => {
    const bodies: Array<{ operation: string; input: Record<string, unknown> }> = [];
    const fakeFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
      const op = bodies.at(-1)?.operation;
      const body = op === "asset.reserve" ? { ok: true, id: uuid(1), direct: false, url: "/x" } : { ok: true, asset: asset(1) };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const api = createStudioApi({ organizationId: uuid(99), fetch: fakeFetch });
    const file = new File([new Uint8Array([1, 2, 3])], "fill.png", { type: "image/png" });
    await api.upload(file, { transient: true });
    await api.upload(file);
    const completes = bodies.filter((b) => b.operation === "asset.complete").map((b) => b.input);
    expect(completes[0]).toMatchObject({ transient: true });
    expect(completes[1]).not.toHaveProperty("transient");
  });

  it("has the new line in both languages", () => {
    expect(copyFor("ko").uploads.roleAuto.trim()).not.toBe("");
    expect(copyFor("en").uploads.roleAuto.trim()).not.toBe("");
    expect(copyFor("ko").uploads.roleAuto).not.toBe(copyFor("en").uploads.roleAuto);
  });
});
