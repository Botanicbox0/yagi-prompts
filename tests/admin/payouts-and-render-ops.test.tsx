import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prerender } from "react-dom/static";
import type { ReactNode } from "react";
import type { SqlRunner } from "@/lib/db/sql-runner";

const db = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: async () => db.sql }));
vi.mock("@/lib/i18n/server", () => ({ getLocaleFromHeaders: async () => "ko" }));
vi.mock("@/lib/routing/request-surface", () => ({
  requestSurface: async () => ({ admin: true }),
  publicHref: (path: string) => `https://twings.app${path}`,
}));

import { insertRenderJob } from "@/lib/renders/repo";
import { FIXTURE_USERS } from "@/scripts/fixtures";
import { promptHarness, type PromptHarness } from "@/tests/helpers/prompts";
import { ADMIN_VIEWER, formOf } from "@/tests/helpers/admin";
import { dispatchAdmin } from "@/lib/admin/dispatch";
import { createLocalStorageDriver } from "@/lib/storage/local-driver";
import { tmpdir } from "node:os";
import {
  computeTaxPayout,
  formatPayoutsCsv,
  loadAdminPayouts,
  payoutFilter,
  resolvePayoutTaxType,
} from "@/lib/admin/payouts";
import AdminPayoutsPage from "@/app/(admin)/admin/payouts/page";
import RenderDetailPage from "@/app/(admin)/admin/renders/[id]/page";

async function html(node: ReactNode | Promise<ReactNode>) {
  const { prelude } = await prerender(await node);
  return new Response(prelude).text();
}

describe("admin payouts & tax classification (docs/ADMIN.md §7.4 & §10-3)", () => {
  it("computes 3.3% individual withholding, 10% business VAT invoice, and 0 KRW company payouts", () => {
    const ind = computeTaxPayout(100_000, "individual_3_3");
    expect(ind).toEqual({
      taxType: "individual_3_3",
      creatorShareKrw: 100_000,
      withholdingTaxKrw: 3_300,
      vatInvoiceKrw: 0,
      netPayoutKrw: 96_700,
    });

    const biz = computeTaxPayout(100_000, "business_vat");
    expect(biz).toEqual({
      taxType: "business_vat",
      creatorShareKrw: 100_000,
      withholdingTaxKrw: 0,
      vatInvoiceKrw: 10_000,
      netPayoutKrw: 110_000,
    });

    const comp = computeTaxPayout(100_000, "company");
    expect(comp).toEqual({
      taxType: "company",
      creatorShareKrw: 0,
      withholdingTaxKrw: 0,
      vatInvoiceKrw: 0,
      netPayoutKrw: 0,
    });

    expect(resolvePayoutTaxType("company", "v1")).toBe("company");
    expect(resolvePayoutTaxType("external", "v1-business-vat")).toBe("business_vat");
    expect(resolvePayoutTaxType("external", "v1-individual")).toBe("individual_3_3");
  });
});

describe("admin payouts screen, CSV export & render retry/resendNotice operations", () => {
  let h: PromptHarness;
  const retryableRenderId = randomUUID();
  const faceBlockedRenderId = randomUUID();
  const succeededRenderId = randomUUID();
  const settledRenderId = randomUUID();
  const settledPaymentId = randomUUID();

  beforeAll(async () => {
    h = await promptHarness();
    db.sql = h.sql;
    const templateId = (
      await h.sql.query<{ id: string }>("select id from prompt_items where slug = 'neon-alley-dolly'")
    ).rows[0]!.id;

    // 1. Retryable failed render (transient provider_timeout, no refund_pending)
    await insertRenderJob(h.sql, {
      id: retryableRenderId,
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
      "update render_jobs set status = 'failed', error_code = 'provider_timeout', attempts = 2, finished_at = now() where id = $1",
      [retryableRenderId],
    );

    // 2. Non-retryable failed render (face_check_failed)
    await insertRenderJob(h.sql, {
      id: faceBlockedRenderId,
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
      "update render_jobs set status = 'failed', error_code = 'face_check_failed', finished_at = now() where id = $1",
      [faceBlockedRenderId],
    );

    // 3. Succeeded render for resendNotice
    await insertRenderJob(h.sql, {
      id: succeededRenderId,
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
      `update render_jobs
          set status = 'succeeded',
              result_key = 'private/out-1.mp4',
              result_mime = 'video/mp4',
              share_token = 'tok-1',
              share_expires_at = now() + interval '1 day',
              notify_status = 'sent',
              notify_attempts = 1,
              notified_at = now(),
              finished_at = now()
        where id = $1`,
      [succeededRenderId],
    );

    // 4. Settled creator sale for /admin/payouts
    await insertRenderJob(h.sql, {
      id: settledRenderId,
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
      `update render_jobs
          set status = 'succeeded',
              result_key = 'private/out-2.mp4',
              result_mime = 'video/mp4',
              share_token = 'tok-2',
              share_expires_at = now() + interval '1 day',
              finished_at = now() - interval '10 days'
        where id = $1`,
      [settledRenderId],
    );
    await h.sql.query(
      `insert into billing_payments (id, user_id, environment, amount_krw, status, payment_key, template_id, template_slug,
         order_name, aspect, locale, render_ref, input_key, input_mime, render_id, consent_at, approved_at, expires_at)
       values ($1, $2, 'live', 10000, 'paid', $3, $4, 'neon-alley-dolly', 'settled order', '9:16', 'ko', $5,
         'private/input.jpg', 'image/jpeg', $5, now(), now(), now() + interval '1 day')`,
      [settledPaymentId, FIXTURE_USERS.free.id, `pay-${settledPaymentId}`, templateId, settledRenderId],
    );
    await h.sql.query(
      `insert into platform_creators (user_id, active, approved_by, contract_version)
       values ($1, true, $2, 'v1-individual')
       on conflict (user_id) do update set active = true, contract_version = 'v1-individual'`,
      [FIXTURE_USERS.pro.id, FIXTURE_USERS.admin.id],
    );
    await h.sql.query(
      `insert into platform_settlements (render_id, payment_id, creator_id, currency, revenue, tax, fees, provider_cost, fx, margin, creator_due, platform_margin, evidence)
       values ($1, $2, $3, 'KRW', 10000, 909, 350, 1741, 1400, 7000, 5600, 1400, 'test settlement')`,
      [settledRenderId, settledPaymentId, FIXTURE_USERS.pro.id],
    );
  });

  afterAll(async () => {
    db.sql = null;
    await h.close();
  });

  it("loads monthly payouts with 3.3% withholding tax and renders /admin/payouts + CSV", async () => {
    const report = await loadAdminPayouts(h.sql, payoutFilter({}));
    expect(report.rows.length).toBeGreaterThanOrEqual(1);
    const row = report.rows.find((r) => r.creatorId === FIXTURE_USERS.pro.id)!;
    expect(row).toBeDefined();
    expect(row.taxType).toBe("individual_3_3");
    expect(row.creatorShareKrw).toBe(5600);
    expect(row.withholdingTaxKrw).toBe(Math.floor((5600 * 33) / 1000)); // 184
    expect(row.netPayoutKrw).toBe(5600 - 184); // 5416

    const csv = formatPayoutsCsv(report.rows);
    expect(csv.startsWith("\uFEFFmonth,creator_short_id,handle,tax_type,")).toBe(true);
    expect(csv).toContain("individual_3_3,1,10000,909,350,1741,7000,5600,184,0,5416,1400");
    expect(csv).not.toContain(FIXTURE_USERS.pro.email);

    const markup = await html(AdminPayoutsPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("data-admin-payouts");
    expect(markup).toContain("data-payout-csv-link");
    expect(markup).toContain("data-payout-net");
    expect(markup).toContain("5,416원");
  });

  it("renders retry form on transient failed render, refuses face_check_failed, and resends notice on succeeded render", async () => {
    const retryMarkup = await html(RenderDetailPage({ params: Promise.resolve({ id: retryableRenderId }) }));
    expect(retryMarkup).toContain("data-admin-render-retry");
    expect(retryMarkup).toContain('name="_op" value="render.retry"');

    const blockedMarkup = await html(RenderDetailPage({ params: Promise.resolve({ id: faceBlockedRenderId }) }));
    expect(blockedMarkup).not.toContain("data-admin-render-retry");
    expect(blockedMarkup).toContain("data-admin-read-only");

    const succeededMarkup = await html(RenderDetailPage({ params: Promise.resolve({ id: succeededRenderId }) }));
    expect(succeededMarkup).toContain("data-admin-render-resend");
    expect(succeededMarkup).toContain('name="_op" value="render.resendNotice"');

    const ctx = {
      sql: h.sql,
      storage: createLocalStorageDriver(tmpdir()),
      viewer: ADMIN_VIEWER,
    };

    // Refuse retry on face_check_failed
    const refusedFace = await dispatchAdmin(
      "render.retry",
      formOf("render.retry", { id: faceBlockedRenderId, reason: "attempt face bypass", _confirm: "1" }),
      ctx,
    );
    expect(refusedFace.ok).toBe(false);

    // Succeed retry on transient provider_timeout
    const retried = await dispatchAdmin(
      "render.retry",
      formOf("render.retry", { id: retryableRenderId, reason: "provider timeout recovered", _confirm: "1" }),
      ctx,
    );
    expect(retried.ok).toBe(true);
    const afterRetry = await h.sql.query<{ status: string; attempts: number }>(
      "select status, attempts from render_jobs where id = $1",
      [retryableRenderId],
    );
    expect(afterRetry.rows[0]).toEqual({ status: "queued", attempts: 0 });

    // Succeed resendNotice on succeeded render
    const resent = await dispatchAdmin(
      "render.resendNotice",
      formOf("render.resendNotice", { id: succeededRenderId, reason: "customer requested email", _confirm: "1" }),
      ctx,
    );
    expect(resent.ok).toBe(true);
    const afterResend = await h.sql.query<{ notify_status: string; notify_attempts: number }>(
      "select notify_status, notify_attempts from render_jobs where id = $1",
      [succeededRenderId],
    );
    expect(afterResend.rows[0]).toEqual({ notify_status: "pending", notify_attempts: 0 });
  });
});
