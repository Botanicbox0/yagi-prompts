import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The brand workspace error boundary is a client component. It must not pull the full ko/en
 * dictionaries into the client bundle: importing them here fails the test.
 */
vi.mock("@/lib/i18n/dictionaries", () => { throw new Error("dictionaries imported by the error boundary"); });
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import BrandError from "@/app/(brand)/brand/error";
import { BrandErrorCopyProvider } from "@/components/brand-workspace/error-copy";

describe("brand error boundary", () => {
  it("shows the copy the layout provides, in the request language", () => {
    const html = renderToStaticMarkup(
      <BrandErrorCopyProvider copy={{ title: "Fixture title", retry: "Fixture retry" }}>
        <BrandError error={new Error("x")} reset={() => {}} />
      </BrandErrorCopyProvider>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("<h1>Fixture title</h1>");
    expect(html).toContain("Fixture retry");
  });
});
