import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertRenderJob } from "@/lib/renders/repo";
import { FIXTURE_USERS } from "@/scripts/fixtures";
import { promptHarness, type PromptHarness } from "@/tests/helpers/prompts";
import { loadAdminUsers, socialTone, userFilter, userHref } from "@/lib/admin/users";

/**
 * docs/ADMIN.md §7.3 — `/admin/users` reads roles, verified social follower counts, active selfie
 * counts, paid orders and renders from the real schema, never exposes e-mail/name/photos in its
 * output, and only matches e-mail when the operator enters the exact address.
 */
describe("admin user directory read model", () => {
  let h: PromptHarness;
  const selfieId = randomUUID();
  const deletedSelfieId = randomUUID();
  const renderId = randomUUID();
  const paidPaymentId = randomUUID();
  const pendingPaymentId = randomUUID();

  beforeAll(async () => {
    h = await promptHarness();
    const templateId = (
      await h.sql.query<{ id: string }>("select id from prompt_items where slug = 'neon-alley-dolly'")
    ).rows[0]!.id;

    // Give the free fixture user 1 active selfie, 1 deleted selfie, 1 paid order, 1 pending order, 1 render, and 1 verified Instagram account.
    const sha1 = createHash("sha256").update("selfie-1").digest("hex");
    const sha2 = createHash("sha256").update("selfie-2").digest("hex");
    await h.sql.query(
      `insert into identity_selfies (id, user_id, input_key, sha256, width, height, consent_at, is_default)
       values ($1, $2, 'private/selfie-active.png', $3, 1024, 1024, now(), true)`,
      [selfieId, FIXTURE_USERS.free.id, sha1],
    );
    await h.sql.query(
      `insert into identity_selfies (id, user_id, input_key, sha256, width, height, consent_at, is_default, deleted_at)
       values ($1, $2, 'private/selfie-deleted.png', $3, 1024, 1024, now(), false, now())`,
      [deletedSelfieId, FIXTURE_USERS.free.id, sha2],
    );

    await insertRenderJob(h.sql, {
      id: renderId,
      userId: FIXTURE_USERS.free.id,
      templateId,
      templateSlug: "neon-alley-dolly",
      medium: "video",
      engine: "seedance-2.0",
      aspect: "9:16",
      locale: "ko",
      inputKey: "private/in.jpg",
      inputMime: "image/jpeg",
    });

    await h.sql.query(
      `insert into billing_payments (id, user_id, environment, amount_krw, status, payment_key, template_id, template_slug,
         order_name, aspect, locale, render_ref, input_key, input_mime, render_id, consent_at, approved_at, expires_at)
       values ($1, $2, 'test', 3900, 'paid', $3, $4, 'neon-alley-dolly', 'paid order', '9:16', 'ko', $5,
         'private/input.jpg', 'image/jpeg', $5, now(), now(), now() + interval '1 day')`,
      [paidPaymentId, FIXTURE_USERS.free.id, `pay-${paidPaymentId}`, templateId, renderId],
    );
    await h.sql.query(
      `insert into billing_payments (id, user_id, environment, amount_krw, status, template_id, template_slug,
         order_name, aspect, locale, render_ref, input_key, input_mime, consent_at, expires_at)
       values ($1, $2, 'test', 3900, 'pending', $3, 'neon-alley-dolly', 'pending order', '9:16', 'ko', $4,
         'private/input-pending.jpg', 'image/jpeg', now(), now() + interval '1 day')`,
      [pendingPaymentId, FIXTURE_USERS.free.id, templateId, randomUUID()],
    );

    await h.sql.query(
      `insert into social_accounts (user_id, platform, handle, profile_url, claimed_count, follower_count, evidence_key, status, source, measured_at)
       values ($1, 'instagram', 'secret_personal_ig', 'https://instagram.com/secret_personal_ig', 14200, 14000, 'private/evidence.png', 'verified', 'manual', now())
       on conflict do nothing`,
      [FIXTURE_USERS.free.id],
    );
  });

  afterAll(async () => {
    await h.close();
  });

  it("lists accounts with role counts, active selfie counts, paid order counts and renders", async () => {
    const dir = await loadAdminUsers(h.sql, userFilter({}));
    expect(dir.allCount).toBeGreaterThanOrEqual(3);
    expect(dir.byRole.admin).toBeGreaterThanOrEqual(1);
    expect(dir.byRole.social).toBeGreaterThanOrEqual(1);

    const freeUser = dir.rows.find((row) => row.id === FIXTURE_USERS.free.id);
    expect(freeUser).toBeDefined();
    expect(freeUser!.selfieCount).toBe(1);
    expect(freeUser!.paidOrderCount).toBe(1);
    expect(freeUser!.renderCount).toBeGreaterThanOrEqual(1);
    expect(freeUser!.roles).toContain("social");
    expect(freeUser!.socials).toEqual([
      {
        platform: "instagram",
        status: "verified",
        followerCount: 14000,
      },
    ]);
  });

  it("never carries e-mail, display name, social handle, profile URL, evidence key or selfie storage key", async () => {
    const dir = await loadAdminUsers(h.sql, userFilter({}));
    for (const row of dir.rows) {
      const json = JSON.stringify(row);
      expect(json).not.toContain(FIXTURE_USERS.free.email);
      expect(json).not.toContain(FIXTURE_USERS.admin.email);
      expect(json).not.toContain("secret_personal_ig");
      expect(json).not.toContain("private/selfie");
      expect(json).not.toContain("private/evidence");
      for (const forbidden of ["email", "displayName", "inputKey", "evidenceKey", "profileUrl"]) {
        expect(row).not.toHaveProperty(forbidden);
      }
    }
  });

  it("finds an account by ID prefix or exact e-mail only, and refuses substring e-mail scraping", async () => {
    const byPrefix = await loadAdminUsers(h.sql, userFilter({ q: FIXTURE_USERS.free.id }));
    expect(byPrefix.rows.map((r) => r.id)).toEqual([FIXTURE_USERS.free.id]);

    const sharedPrefix = await loadAdminUsers(h.sql, userFilter({ q: FIXTURE_USERS.free.id.slice(0, 8) }));
    expect(sharedPrefix.rows.map((r) => r.id)).toContain(FIXTURE_USERS.free.id);

    const byExactEmail = await loadAdminUsers(
      h.sql,
      userFilter({ q: FIXTURE_USERS.free.email.toUpperCase() }),
    );
    expect(byExactEmail.rows.map((r) => r.id)).toEqual([FIXTURE_USERS.free.id]);

    // Substring or domain e-mail queries must not match any account.
    const domain = FIXTURE_USERS.free.email.split("@")[1]!;
    const byDomain = await loadAdminUsers(h.sql, userFilter({ q: `@${domain}` }));
    expect(byDomain.rows).toEqual([]);
    const partialEmail = await loadAdminUsers(
      h.sql,
      userFilter({ q: FIXTURE_USERS.free.email.slice(0, -2) }),
    );
    expect(partialEmail.rows).toEqual([]);
  });

  it("filters by role and builds clean URLs", async () => {
    const admins = await loadAdminUsers(h.sql, userFilter({ role: "admin" }));
    expect(admins.rows.length).toBeGreaterThanOrEqual(1);
    expect(admins.rows.every((r) => r.roles.includes("admin"))).toBe(true);

    const filter = userFilter({ role: "social", q: "abc", page: "2" });
    expect(userHref(filter, { page: 3 })).toBe("/admin/users?role=social&q=abc&page=3");
    expect(userHref(filter, { role: null })).toBe("/admin/users?q=abc");
    expect(userHref(userFilter({}))).toBe("/admin/users");
    expect(socialTone("verified")).toBe("done");
    expect(socialTone("submitted")).toBe("action");
    expect(socialTone("rejected")).toBe("fail");
    expect(socialTone("expired")).toBe("hold");
  });
});
