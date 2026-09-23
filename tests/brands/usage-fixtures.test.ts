import { afterEach, describe, expect, it, vi } from "vitest";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import { FIXTURE_USERS } from "@/scripts/fixtures";
import { seedBrandWorkspaceFixtures } from "@/scripts/brand-workspace-fixtures";
import { loadBrandUsage } from "@/lib/brands/usage/service";
import type { StorageDriver } from "@/lib/storage";

/** The local-only fixture gives browser QA an empty-state inquiry and a payable quote; it refuses non-local mode. */
afterEach(() => vi.unstubAllEnvs());
describe("local secondary-usage fixtures", () => {
  it("seed one cost-only inquiry and one tax-inclusive quote on shared local terms", async () => {
    vi.stubEnv("PLAYBOOK_MODE", "local");
    const db = await freshDb(), sql = runner(db);
    for (const kind of ["free", "admin"] as const) await seedProfile(sql, { id: FIXTURE_USERS[kind].id, email: FIXTURE_USERS[kind].email, isAdmin: kind === "admin" });
    const files = new Map<string, Uint8Array>();
    const storage = { name: "local", putStaging: async (k: string, b: Uint8Array) => { files.set(k, b); }, read: async (_b: string, k: string) => files.get(k)! } as unknown as StorageDriver;
    await seedBrandWorkspaceFixtures(sql, storage);
    const projectId = String((await sql.query("select project_id from brand_usage_cases limit 1")).rows[0]!.project_id);
    const owner = { userId: FIXTURE_USERS.free.id, email: FIXTURE_USERS.free.email, isAdmin: false, tier: "free" as const, locale: "ko" as const };
    const view = (await loadBrandUsage({ sql, paymentsOpen: true }, owner, projectId))!;
    expect(view.cases.map((c) => c.state).sort()).toEqual(["quoted", "submitted"]);
    expect(view.cases.find((c) => c.state === "quoted")!.actions).toMatchObject({ accept: true });
    await db.close();
  });
  it("refuses outside explicit local mode", async () => {
    vi.stubEnv("PLAYBOOK_MODE", "cloud");
    const db = await freshDb();
    await expect(seedBrandWorkspaceFixtures(runner(db), { name: "local" } as unknown as StorageDriver)).rejects.toThrow(/local/);
    await db.close();
  });
});
