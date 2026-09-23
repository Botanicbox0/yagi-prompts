import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The invitation accept form itself (ActionForm, operation `invitation.accept`): where a success lands,
 * what each refusal says, and that the sign-out escape posts natively instead of being swallowed.
 * React state is stubbed so every setter call is observable.
 */
const mocks = vi.hoisted(() => ({ set: vi.fn(), refresh: vi.fn(), assign: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }) }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: () => {},
  useState: (value: unknown) => [value, mocks.set],
  useRef: (value: unknown) => ({ current: value }),
  useId: () => "id",
}));
import { ActionForm } from "@/components/brand-workspace/action-form";
import { getDictionary } from "@/lib/i18n/dictionaries";

const ORG = "a0000000-0000-4000-8000-00000000000a", PROJECT = "b0000000-0000-4000-8000-00000000000b";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function submit(result: Record<string, unknown>, locale: "ko" | "en" = "ko", submitter?: unknown) {
  const NativeFormData = FormData;
  vi.stubGlobal("FormData", class extends NativeFormData { constructor() { super(); } });
  const fetch = vi.fn().mockResolvedValue({ ok: result.ok === true, json: async () => result });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("location", { assign: mocks.assign });
  vi.stubGlobal("sessionStorage", { removeItem: vi.fn() });
  const form = ActionForm({ operation: "invitation.accept", fixed: { token: "t".repeat(43) }, b: getDictionary(locale).brandWorkspace, submit: "Accept" });
  const event = { preventDefault: vi.fn(), currentTarget: { querySelectorAll: () => [] }, nativeEvent: submitter ? { submitter } : undefined };
  await form.props.onSubmit(event);
  return { fetch, event };
}
const notices = () => mocks.set.mock.calls.map(([v]) => v).filter((v) => typeof v === "string" && v !== "");

describe("invitation accept form", () => {
  it("opens the brand the invitation was for", async () => {
    await submit({ ok: true, organizationId: ORG });
    expect(mocks.assign).toHaveBeenCalledExactlyOnceWith(`/brand?organizationId=${ORG}`);
  });

  it("opens a shared campaign with its brand, and a not-yet-shared one at home", async () => {
    await submit({ ok: true, organizationId: ORG, projectId: PROJECT, projectShared: true });
    expect(mocks.assign).toHaveBeenLastCalledWith(`/brand/projects/${PROJECT}?organizationId=${ORG}`);
    await submit({ ok: true, organizationId: ORG, projectId: PROJECT, projectShared: false });
    expect(mocks.assign).toHaveBeenLastCalledWith("/brand");
  });

  it.each(["ko", "en"] as const)("says a wrong account must switch and offers sign-out (%s)", async (locale) => {
    const b = getDictionary(locale).brandWorkspace;
    await submit({ ok: false, code: "forbidden" }, locale);
    expect(notices()).toEqual([b.inviteWrongAccount]);
    expect(mocks.set).toHaveBeenCalledWith(true); // switchAccount (and failed)
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(b.inviteWrongAccount).not.toBe(b.denied);
  });

  it.each(["not_found", "invalid"])("calls an unusable link invalid (%s), never 'content changed'", async (code) => {
    const b = getDictionary("ko").brandWorkspace;
    await submit({ ok: false, code });
    expect(notices()).toEqual([b.inviteInvalid]);
    expect(notices()).not.toContain(b.conflict);
  });

  it("lets the sign-out button post natively without calling the workspace API", async () => {
    const { fetch, event } = await submit({ ok: true }, "ko", { dataset: { signOut: "true" } });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
