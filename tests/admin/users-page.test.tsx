import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prerender } from "react-dom/static";
import type { ReactNode } from "react";
import type { SqlRunner } from "@/lib/db/sql-runner";

const db = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
// Each admin page verifies the admin itself; these tests render the page as one.
vi.mock("@/lib/auth/viewer", () => ({ requireAdmin: async () => ({ isAdmin: true }) }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: async () => db.sql }));
vi.mock("@/lib/i18n/server", () => ({ getLocaleFromHeaders: async () => "ko" }));
vi.mock("@/lib/routing/request-surface", () => ({
  requestSurface: async () => ({ admin: true }),
  publicHref: (path: string) => `https://twings.app${path}`,
}));

import { FIXTURE_USERS } from "@/scripts/fixtures";
import { promptHarness, type PromptHarness } from "@/tests/helpers/prompts";
import { getDictionary } from "@/lib/i18n/dictionaries";
import AdminUsersPage from "@/app/(admin)/admin/users/page";

async function html(node: ReactNode | Promise<ReactNode>) {
  const { prelude } = await prerender(await node);
  return new Response(prelude).text();
}

const ko = getDictionary("ko").adminConsole;

/** docs/ADMIN.md §7.3 — `/admin/users` minimal-PII screen rendered from a real schema. */
describe("admin users screen", () => {
  let h: PromptHarness;

  beforeAll(async () => {
    h = await promptHarness();
    db.sql = h.sql;
    const sha = createHash("sha256").update("selfie-ui").digest("hex");
    await h.sql.query(
      `insert into identity_selfies (id, user_id, input_key, sha256, width, height, consent_at, is_default)
       values ($1, $2, 'private/selfie-ui.png', $3, 1024, 1024, now(), true)`,
      [randomUUID(), FIXTURE_USERS.free.id, sha],
    );
  });

  afterAll(async () => {
    db.sql = null;
    await h.close();
  });

  it("renders the user directory with role filters, active nav, short IDs, and zero PII", async () => {
    const markup = await html(AdminUsersPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("data-admin-users");
    expect(markup).toMatch(
      /data-admin-nav="users"[^>]*aria-current="page"|aria-current="page"[^>]*data-admin-nav="users"/,
    );
    expect(markup).toContain(`data-user-row="${FIXTURE_USERS.free.id.slice(0, 8)}"`);
    expect(markup).toContain("data-user-masked-email");
    expect(markup).toContain("***@");
    expect(markup).toContain(`href="/admin/users?role=admin"`);
    expect(markup).toContain(`href="/admin/users?role=creative"`);
    expect(markup).not.toContain(FIXTURE_USERS.free.email);
    expect(markup).not.toContain(FIXTURE_USERS.admin.email);
    expect(markup).not.toContain("private/selfie-ui.png");
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("shows the empty filter state when no user matches a search", async () => {
    const markup = await html(
      AdminUsersPage({ searchParams: Promise.resolve({ q: "no-such-user-prefix" }) }),
    );
    expect(markup).not.toContain("data-user-row=");
    expect(markup).toContain(ko.users.empty);
  });
});
