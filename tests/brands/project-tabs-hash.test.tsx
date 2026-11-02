import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The campaign tabs' URL-fragment handling, exercised through the component's own effect. The repo has
 * no DOM test environment, so React's `useEffect`/`useState` are captured for this file only: the
 * effect the component registers is run against a stubbed `location`/`window`/`document`, and the
 * state setter records which tab it opens. Nothing else about React is replaced.
 */
const hooks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, set: vi.fn() }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useEffect: (fn: () => void | (() => void)) => { hooks.effects.push(fn); }, useState: <T,>(initial: T) => [initial, hooks.set] };
});
import { ProjectTabs, tabForViewer } from "@/components/brand-workspace/project-tabs";
import { getDictionary } from "@/lib/i18n/dictionaries";

const b = getDictionary("en").brandWorkspace;
let listeners: Record<string, Array<() => void>>, scrolled: string[], location: { hash: string };

beforeEach(() => {
  hooks.effects.length = 0; hooks.set.mockReset(); listeners = {}; scrolled = []; location = { hash: "" };
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: () => void) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type: string, fn: () => void) => { listeners[type] = (listeners[type] ?? []).filter((x) => x !== fn); },
  });
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { fn(); return 0; });
  vi.stubGlobal("document", { getElementById: (id: string) => ({ scrollIntoView: () => scrolled.push(id) }) });
});
afterEach(() => { vi.unstubAllGlobals(); });

/** Renders the tabs, then runs the effect as the browser would after hydration. */
function mount(usage: boolean, hash: string) {
  location.hash = hash;
  const html = renderToStaticMarkup(<ProjectTabs b={b} usage={usage}><div /></ProjectTabs>);
  expect(hooks.effects).toHaveLength(1);
  const cleanup = hooks.effects[0]!();
  return { html, cleanup, navigate: (next: string) => { location.hash = next; for (const fn of listeners.hashchange ?? []) fn(); } };
}

describe("campaign tab fragments", () => {
  it("opens the results tab, not an empty panel, when a guest follows a #usage link", () => {
    const { html, navigate } = mount(false, "#usage");
    expect(html).not.toContain('href="#usage"');
    expect(hooks.set).toHaveBeenLastCalledWith("performance");
    expect(scrolled).toEqual(["performance"]);
    navigate("#usage=post:00000000-0000-4000-8000-000000000001");
    expect(hooks.set).toHaveBeenLastCalledWith("performance");
    expect(hooks.set).not.toHaveBeenCalledWith("usage");
  });

  it("keeps an authorized #usage=post:<id> deep link on the contracts and usage tab", () => {
    const { html, navigate } = mount(true, "#usage=post:00000000-0000-4000-8000-000000000001");
    expect(html).toContain('href="#contracts"');
    expect(hooks.set).toHaveBeenLastCalledWith("contracts");
    navigate("#review");
    expect(hooks.set).toHaveBeenLastCalledWith("review");
    navigate("#usage=content_version:00000000-0000-4000-8000-000000000002");
    expect(hooks.set).toHaveBeenLastCalledWith("contracts");
    expect(scrolled).toEqual(["usage", "usage"]);
  });

  it("opens ordinary tabs for every viewer", () => {
    for (const usage of [false, true]) {
      hooks.effects.length = 0; hooks.set.mockReset();
      mount(usage, "#reports");
      expect(hooks.set).toHaveBeenLastCalledWith("reports");
    }
  });

  it("ignores fragments that are not tabs, without throwing or switching tabs", () => {
    const { navigate } = mount(false, "#studio-actions");
    expect(hooks.set).not.toHaveBeenCalled();
    expect(scrolled).toEqual([]);
    for (const junk of ["#", "", "#%E0%A4%A", "#=usage", "#performance-extra", "#constructor", "#__proto__"]) navigate(junk);
    expect(hooks.set).not.toHaveBeenCalled();
  });

  it("stops listening when unmounted", () => {
    const { cleanup } = mount(true, "");
    expect(listeners.hashchange).toHaveLength(1);
    (cleanup as () => void)();
    expect(listeners.hashchange).toHaveLength(0);
  });

  it("resolves fragments against the viewer's tabs", () => {
    const guest = ["performance", "brief", "review", "reports", "conversation", "contracts"] as const;
    expect(tabForViewer("#usage", guest, false)).toBe("performance");
    expect(tabForViewer("#usage=post:x", guest, true)).toBe("contracts");
    expect(tabForViewer("#files", guest)).toBe("conversation");
    // A guest has no applicants or payment tab: those fragments open the overview.
    expect(tabForViewer("#applicants", guest)).toBe("performance");
    expect(tabForViewer("#payments", [...guest, "applicants", "payments"])).toBe("payments");
    expect(tabForViewer("#nope", guest)).toBeNull();
  });
});
