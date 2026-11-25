import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShareReviewDialog } from "@/components/brand-studio/share-review-dialog";

/**
 * "검수 · 공유" from the image viewer (founder review 2026-11-25): the viewer is a native modal `<dialog>`
 * (top layer), so a share window drawn as an ordinary element sat behind it whatever its z-index. The share
 * window is itself a native dialog element (shown with showModal, so it stacks above the viewer and makes
 * it inert) and carries its own name; the markers other screens read stay on it.
 */
describe("share review window stacking", () => {
  const ORG = "00000000-0000-4000-8000-0000000000aa";
  const html = renderToStaticMarkup(
    createElement(ShareReviewDialog, { target: { organizationId: ORG, outputId: "30000000-0000-4000-8000-0000000000a1" }, locale: "ko", onClose: () => {} }),
  );

  it("is a native dialog element, so it can open in the top layer above the viewer", () => {
    expect(html.startsWith("<dialog")).toBe(true);
    const open = /^<dialog[^>]*>/.exec(html)?.[0] ?? "";
    expect(open).toContain("data-share-review-dialog");
  });

  it("is named by its heading on the dialog itself, with no second dialog role inside", () => {
    const open = /^<dialog[^>]*>/.exec(html)?.[0] ?? "";
    const labelled = /aria-labelledby="([^"]+)"/.exec(open)?.[1];
    expect(labelled).toBeTruthy();
    expect(html).toContain(`id="${labelled}"`);
    expect(html).not.toContain('role="dialog"');
  });
});
