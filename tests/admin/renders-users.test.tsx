import { describe, expect, it } from "vitest";
import { ADMIN_NAV_GROUPS, ADMIN_NAV_PATHS, adminNextActions } from "@/lib/admin/workflow";
import { dispatchAdmin } from "@/lib/admin/dispatch";
import { maskEmailForAdmin, loadAdminRenderBoard, loadAdminUserView } from "@/lib/admin/renders-users";
import { adminHarness, formOf } from "../helpers/admin";

describe("admin render board and user view (§10)", () => {
  it("registers /admin/renders in operations and /admin/users in system navigation", () => {
    expect(ADMIN_NAV_PATHS.renders).toBe("/admin/renders");
    expect(ADMIN_NAV_PATHS.users).toBe("/admin/users");
    const ops = ADMIN_NAV_GROUPS.find((g) => g.key === "operations");
    const sys = ADMIN_NAV_GROUPS.find((g) => g.key === "system");
    expect(ops?.items).toContain("renders");
    expect(sys?.items).toContain("users");
  });

  it("links paymentsManual and rendersFailed on home queue directly to /admin/renders", () => {
    const actions = adminNextActions({
      posts: 0,
      applicants: 0,
      payouts: 0,
      studio: 0,
      inquiries: 0,
      feedback: 0,
      templates: 0,
      paymentsManual: 1,
      rendersFailed: 2,
    });
    expect(actions.find((a) => a.key === "paymentsManual")?.href).toBe(
      "/admin/renders?tab=payments",
    );
    expect(actions.find((a) => a.key === "rendersFailed")?.href).toBe(
      "/admin/renders?status=failed",
    );
  });

  it("masks user emails for privacy-minimized user view", () => {
    expect(maskEmailForAdmin("yagi@twings.app")).toBe("y***@twings.app");
    expect(maskEmailForAdmin("a@b.co")).toBe("a***@b.co");
    expect(maskEmailForAdmin(null)).toBeNull();
  });

  it("loads render board and user view, and allows safe retry of a failed provider render without bypassing safety refusals", async () => {
    const harness = await adminHarness();
    try {
      const sql = harness.ctx().sql;
      const jobId = "11111111-1111-4111-8111-111111111111";
      const blockedJobId = "22222222-2222-4222-8222-222222222222";
      const tplId = "33333333-3333-4333-8333-333333333333";
      const tplSlug = "render-board-template";
      const userId = "44444444-4444-4444-8444-444444444444";

      await sql.query("insert into auth.users (id) values ($1) on conflict do nothing", [userId]);
      await sql.query(
        "insert into profiles (id, email, display_name, locale, plan) values ($1, 'member@twings.app', 'Member', 'ko', 'free') on conflict do nothing",
        [userId],
      );

      await sql.query(
        `insert into prompt_items (
          id, slug, source, status, models, title, prompt_text, text_visibility, medium
        ) values (
          $1, $2, 'yagi', 'pending', array['seedance-2.0'], 'Test', 'test prompt', 'public', 'video'
        )`,
        [tplId, tplSlug],
      );

      await sql.query(
        `insert into render_jobs (
          id, user_id, template_id, template_slug, medium, engine, aspect, locale,
          status, input_key, input_mime, provider, attempts, error_code, error_message, cost_usd, notify_status
        ) values
        ($1, $3, $4, $5, 'video', 'seedance-2.0', '9:16', 'ko', 'failed', 'k/in.jpg', 'image/jpeg', 'modelark', 3, 'provider_timeout', 'upstream timed out', 0.42, 'failed'),
        ($2, $3, $4, $5, 'video', 'seedance-2.0', '9:16', 'ko', 'failed', 'k/in2.jpg', 'image/jpeg', 'modelark', 1, 'face_check_refused', 'face check refused', 0, 'sent')`,
        [jobId, blockedJobId, userId, tplId, tplSlug],
      );

      const board = await loadAdminRenderBoard(sql, { status: "failed" });
      expect(board.jobs.some((j) => j.id === jobId)).toBe(true);

      // Retry the provider_timeout job via render.retry
      const retryRes = await dispatchAdmin(
        "render.retry",
        formOf("render.retry", {
          id: jobId,
          reason: "Upstream timeout resolved",
          _confirm: "1",
        }),
        harness.ctx(),
      );
      expect(retryRes.ok).toBe(true);

      const afterRetry = await sql.query<{ status: string; attempts: number }>(
        "select status, attempts from render_jobs where id = $1",
        [jobId],
      );
      expect(afterRetry.rows[0]).toEqual({ status: "queued", attempts: 0 });

      // Attempting to retry a face_check_refused job is refused
      const refusedRes = await dispatchAdmin(
        "render.retry",
        formOf("render.retry", {
          id: blockedJobId,
          reason: "Try anyway",
          _confirm: "1",
        }),
        harness.ctx(),
      );
      expect(refusedRes.ok).toBe(false);

      // User view loads privacy-minimized rows without raw selfie storage keys
      const view = await loadAdminUserView(sql, {});
      expect(view.users.length).toBeGreaterThanOrEqual(1);
      for (const u of view.users) {
        expect(typeof u.selfieCount).toBe("number");
        expect("storageKey" in u).toBe(false);
      }
    } finally {
      await harness.close();
    }
  });
});
