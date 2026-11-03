import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADMIN_OPERATIONS, ADMIN_OPERATION_NAMES } from "@/lib/admin/operations";
import { PLAYBOOK_OPERATIONS } from "@/lib/admin/playbook-operations";
import { PLATFORM_OPERATIONS } from "@/lib/admin/platform-operations";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

describe("admin overhaul slice (e) — operation registry decomposition", () => {
  it("keeps lib/admin/operations.ts as a pure registry spread file and moves playbook ops to playbook-operations.ts", () => {
    const opsSource = read("lib", "admin", "operations.ts");
    expect(opsSource).toContain("PLAYBOOK_OPERATIONS");
    expect(opsSource).not.toContain("createPlaybook");
    expect(opsSource).not.toContain("buildBlockContent");
    expect(Object.keys(PLAYBOOK_OPERATIONS)).toHaveLength(20);
  });

  it("registers all 11 explicit creative.* and community.* operations and rejects mismatched action payloads", () => {
    const explicitNames = [
      "creative.grant",
      "creative.application",
      "creative.format",
      "creative.settle",
      "community.reply",
      "community.moderate",
      "community.quality",
      "community.claim",
      "community.policy",
      "community.offer",
      "community.offerDisable",
    ] as const;

    for (const name of explicitNames) {
      expect(ADMIN_OPERATION_NAMES).toContain(name);
      expect(PLATFORM_OPERATIONS[name]).toBeDefined();
    }

    // Posting without an explicit `action` field to `community.quality` injects `action=quality`.
    const validForm = new FormData();
    validForm.set("id", "f0000000-0000-4000-8000-000000000001");
    validForm.set("score", "4.5");
    validForm.set("reason", "Studio QA score");
    const parsedValid = ADMIN_OPERATIONS["community.quality"].parse(validForm);
    expect(parsedValid.ok).toBe(true);
    if (parsedValid.ok) {
      expect(parsedValid.value).toMatchObject({ action: "quality", score: 4.5 });
    }

    // Attempting to smuggle a different `action` into a fixed operation is rejected at parse time.
    const mismatchedForm = new FormData();
    mismatchedForm.set("action", "creator");
    mismatchedForm.set("id", "f0000000-0000-4000-8000-000000000001");
    mismatchedForm.set("active", "true");
    mismatchedForm.set("contract", "v1");
    mismatchedForm.set("reason", "Escalation attempt");
    const parsedMismatch = ADMIN_OPERATIONS["community.quality"].parse(mismatchedForm);
    expect(parsedMismatch).toEqual({ ok: false, detail: "mismatched platform action" });
  });

  it("removes unreferenced brandWorkspace.settings and campaignCollaboration.revoke from the admin registry", () => {
    expect(ADMIN_OPERATION_NAMES).not.toContain("brandWorkspace.settings");
    expect(ADMIN_OPERATION_NAMES).not.toContain("campaignCollaboration.revoke");
  });

  it("uses explicit creative.* and community.* operations in /admin/community and RecipeReviewPanel", () => {
    const communityPage = read("app", "(admin)", "admin", "community", "page.tsx");
    const reviewPanel = read("components", "recipes", "review-panel.tsx");
    expect(communityPage).not.toContain('op="platform.manage"');
    expect(reviewPanel).toContain('op="creative.format"');
  });
});
