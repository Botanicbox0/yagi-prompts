import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import {
  createStudioOrganization,
  createStudioProject,
} from "@/lib/brands/workspace/service";
import {
  createProductionContract,
  createProductionTemplate,
  loadProductionOutput,
  loadProductionWorkspace,
  setProductionContractEnabled,
  reserveProduction,
} from "@/lib/brands/production/service";
import {
  createBrandRenderJob,
  createRenderJob,
  loadOwnRender,
  loadSharedRender,
  runRenderPass,
} from "@/lib/renders/service";
import { markRenderSucceeded } from "@/lib/renders/repo";
import { newShareToken } from "@/lib/renders/share";
import type { RenderStore } from "@/lib/renders/store";
import { insertRenderJob } from "@/lib/renders/repo";
import { loadPublishedPrompts, loadPromptById } from "@/lib/prompts/repo";
import { authorizePromptCopy } from "@/lib/prompts/access";
const adminId = randomUUID(),
  userId = randomUUID(),
  strangerId = randomUUID();
const view = (id: string, admin = false): Viewer => ({
  userId: id,
  isAdmin: admin,
  tier: admin ? "admin" : "free",
  locale: "ko",
  email: `${id}@example.test`,
});
const admin = view(adminId, true),
  user = view(userId),
  stranger = view(strangerId);
let db: PGlite,
  sql: SqlRunner,
  organizationId: string,
  projectId: string,
  contractId: string,
  templateId: string;
const now = new Date("2026-09-22T00:00:00Z");
const idOf = (r: { ok: boolean; id?: string; code?: string }) => {
  if (!r.ok || !r.id) throw Error(r.code);
  return r.id;
};
beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, userId, strangerId])
    await seedProfile(sql, {
      id,
      isAdmin: id === adminId,
      email: `${id}@example.test`,
    });
  organizationId = idOf(
    await createStudioOrganization({ sql }, admin, {
      name: "Production fixture",
      requestId: randomUUID(),
    }),
  );
  projectId = idOf(
    await createStudioProject({ sql }, admin, {
      organizationId,
      title: "Contract fixture",
      objective: "Private creation",
      productionMode: "studio",
      budgetKrw: null,
      requestId: randomUUID(),
    }),
  );
  await sql.query(
    "insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')",
    [organizationId, userId],
  );
  contractId = idOf(
    await createProductionContract({ sql, now }, admin, {
      organizationId,
      projectId,
      title: "Signed production scope",
      startsAt: "2026-09-21T00:00:00Z",
      endsAt: "2026-10-21T00:00:00Z",
      limit: 1,
      requestId: randomUUID(),
    }),
  );
  templateId = idOf(
    await createProductionTemplate({ sql, now }, admin, {
      contractId,
      title: "Private template",
      titleKo: "비공개 템플릿",
      promptText: "Use the identity reference for a studio film.",
      seconds: 5,
      aspect: "9:16",
      requestId: randomUUID(),
    }),
  );
});
afterEach(async () => {
  await db?.close();
});
function reserve(requestId = randomUUID(), v = user) {
  return reserveProduction(
    { sql, now },
    v,
    { contractId, templateId, requestId, fingerprint: "fixture" },
    async (tx, prompt) => {
      const id = randomUUID();
      await insertRenderJob(tx, {
        id,
        userId: v.userId!,
        templateId: prompt.id,
        templateSlug: prompt.slug,
        medium: "video",
        engine: "seedance-2.5",
        aspect: "9:16",
        locale: "ko",
        inputKey: `${id}/input.png`,
        inputMime: "image/png",
        status: "queued",
      });
      return { ok: true as const, id, held: false };
    },
  );
}
it("uses real administrator authority and fails closed for non-members and viewers", async () => {
  expect(
    await createProductionContract(
      { sql, now },
      { ...user, isAdmin: true },
      {
        organizationId,
        projectId,
        title: "Forgery",
        startsAt: now.toISOString(),
        endsAt: "2026-10-21T00:00:00Z",
        limit: 1,
        requestId: randomUUID(),
      },
    ),
  ).toMatchObject({ ok: false, code: "forbidden" });
  expect(await reserve(randomUUID(), stranger)).toMatchObject({
    ok: false,
    code: "not_found",
  });
  await sql.query(
    "update brand_memberships set role='viewer' where user_id=$1",
    [userId],
  );
  expect(await reserve()).toMatchObject({ ok: false, code: "forbidden" });
});
it("reserves once, rejects mismatched retries and refuses an exhausted contract", async () => {
  const requestId = randomUUID(),
    first = await reserve(requestId);
  expect(first.ok).toBe(true);
  expect(await reserve(requestId)).toEqual(first);
  expect(
    await reserveProduction(
      { sql, now },
      user,
      { contractId, templateId, requestId, fingerprint: "changed" },
      async () => {
        throw Error("must not create");
      },
    ),
  ).toMatchObject({ ok: false, code: "conflict" });
  expect(await reserve()).toMatchObject({ ok: false, code: "quota_exhausted" });
  expect(
    (await sql.query("select * from brand_production_reservations")).rows,
  ).toHaveLength(1);
});
it("restores a terminal failure once, retaining failed request idempotency", async () => {
  const requestId = randomUUID(),
    r = await reserve(requestId);
  if (!r.ok) throw Error(r.code);
  await sql.query(
    "update render_jobs set status='failed',error_code='engine_error',finished_at=now() where id=$1",
    [r.id],
  );
  await sql.query(
    "update render_jobs set status='failed',error_code='engine_error',finished_at=now() where id=$1",
    [r.id],
  );
  expect(await reserve(requestId)).toEqual(r);
  expect(
    (await loadProductionWorkspace({ sql, now }, user, organizationId))
      ?.contracts[0]?.remaining,
  ).toBe(1);
  expect((await reserve()).ok).toBe(true);
});
it("does not consume quota when enqueue rejects or throws", async () => {
  expect(
    await reserveProduction(
      { sql, now },
      user,
      {
        contractId,
        templateId,
        requestId: randomUUID(),
        fingerprint: "fixture",
      },
      async () => ({ ok: false as const, code: "identity_required" }),
    ),
  ).toMatchObject({ ok: false, code: "identity_required" });
  await expect(
    reserveProduction(
      { sql, now },
      user,
      {
        contractId,
        templateId,
        requestId: randomUUID(),
        fingerprint: "fixture",
      },
      async () => {
        throw Error("storage down");
      },
    ),
  ).rejects.toThrow("storage down");
  expect((await reserve()).ok).toBe(true);
});
it("prevents creation after expiry, pause or membership revocation", async () => {
  expect(
    await reserveProduction(
      { sql, now: new Date("2026-10-22") },
      user,
      {
        contractId,
        templateId,
        requestId: randomUUID(),
        fingerprint: "fixture",
      },
      async () => {
        throw Error("must not create");
      },
    ),
  ).toMatchObject({ ok: false, code: "contract_inactive" });
  expect(
    await setProductionContractEnabled({ sql, now }, admin, {
      contractId,
      enabled: false,
      expectedRevision: 0,
    }),
  ).toMatchObject({ ok: true });
  expect(await reserve()).toMatchObject({
    ok: false,
    code: "contract_inactive",
  });
  await sql.query(
    "update brand_memberships set status='revoked' where user_id=$1",
    [userId],
  );
  expect(
    await loadProductionWorkspace({ sql, now }, user, organizationId),
  ).toBeNull();
});
it("keeps private templates off consumer catalogue and copy API, even for administrators", async () => {
  expect(
    (await loadPublishedPrompts(sql)).some((p) => p.id === templateId),
  ).toBe(false);
  expect(await authorizePromptCopy(sql, admin, templateId)).toEqual({
    status: "not_found",
  });
  expect((await loadPromptById(sql, templateId))?.audience).toBe("brand");
  await expect(
    sql.query("update prompt_items set audience='public' where id=$1", [
      templateId,
    ]),
  ).rejects.toThrow();
});
it("keeps outputs in the organization after expiry, blocks public sharing and revoked members", async () => {
  const r = await reserve();
  if (!r.ok) throw Error(r.code);
  const token = newShareToken();
  await markRenderSucceeded(sql, r.id, {
    resultKey: `${r.id}/result.mp4`,
    resultMime: "video/mp4",
    resultBytes: 10,
    provider: "modelark",
    costUsd: 1,
    shareToken: token,
    shareExpiresAt: new Date("2026-10-01"),
    finishedAt: now,
  });
  expect(
    await loadProductionOutput(
      { sql, now: new Date("2026-11-01") },
      user,
      r.id,
    ),
  ).toMatchObject({ status: "succeeded" });
  expect(await loadProductionOutput({ sql }, stranger, r.id)).toBeNull();
  expect(await loadOwnRender(sql, user, r.id)).toBeNull();
  expect(await loadSharedRender(sql, r.id, token, now)).toEqual({
    status: "not_found",
  });
  await sql.query(
    "update brand_memberships set status='revoked' where user_id=$1",
    [userId],
  );
  expect(await loadProductionOutput({ sql }, user, r.id)).toBeNull();
});
it("requires the selected own portrait, preserves identity gates, and restores a real terminal render failure", async () => {
  const objects = new Map<string, Uint8Array>();
  const store: RenderStore = {
    name: "local",
    put: async (k, v) => {
      objects.set(k, v);
    },
    read: async (k) => {
      const v = objects.get(k);
      if (!v) throw Error("missing");
      return v;
    },
    url: async () => null,
  };
  const portraitId = randomUUID(),
    key = `${portraitId}/result.png`;
  objects.set(key, new Uint8Array([1, 2, 3]));
  await sql.query(
    `insert into identity_portrait_attempts(id,user_id,request_id,slot,status,model,prompt_version,input_key,result_key,consent_at,completed_at) values($1,$2,$3,1,'succeeded','gpt-image-2.5-sunburst','fixture',$4,$4,now(),now())`,
    [portraitId, userId, randomUUID(), key],
  );
  const input = {
    contractId,
    templateId,
    requestId: randomUUID(),
    portraitId,
    ownFaceConfirmed: true,
    locale: "ko",
  };
  expect(
    await createBrandRenderJob({ sql, store, now }, user, input),
  ).toMatchObject({ ok: false, code: "identity_required" });
  await sql.query(
    "insert into identity_portrait_selections(user_id,attempt_id) values($1,$2)",
    [userId, portraitId],
  );
  expect(
    await createBrandRenderJob({ sql, store, now }, user, {
      ...input,
      ownFaceConfirmed: false,
    }),
  ).toMatchObject({ ok: false, code: "consent_required" });
  expect(
    await createBrandRenderJob(
      { sql, store, now, mode: "liveness" },
      user,
      input,
    ),
  ).toMatchObject({ ok: false, code: "identity_required" });
  const job = await createBrandRenderJob(
    { sql, store, now, mode: "virtual" },
    user,
    input,
  );
  if (!job.ok) throw Error(job.code);
  expect(await createBrandRenderJob({ sql, store, now }, user, input)).toEqual(
    job,
  );
  // No provider configured: the existing identity guard must fail, rather than send raw face bytes.
  await runRenderPass(
    {
      sql,
      store,
      now,
      mode: "virtual",
      assets: null,
      engines: { ark: null },
      tossGateway: null,
      notifier: null,
      siteUrl: "https://example.test",
    },
    { jobId: job.id, limit: 1 },
  );
  expect(await loadProductionOutput({ sql }, user, job.id)).toMatchObject({
    status: "failed",
    released: true,
  });
  expect(
    (await loadProductionWorkspace({ sql, now }, user, organizationId))
      ?.contracts[0]?.remaining,
  ).toBe(1);
  expect(
    await createRenderJob({ sql, store, now }, admin, {
      templateSlug: `brand-${templateId}`,
      aspect: "9:16",
      photo: { bytes: new Uint8Array([1]), mime: "image/png" },
      locale: "ko",
    }),
  ).toMatchObject({ ok: false, code: "not_found" });
});
it("does not allow one contract to consume another contract’s template", async () => {
  const other = idOf(
    await createProductionContract({ sql, now }, admin, {
      organizationId,
      projectId,
      title: "Other agreement",
      startsAt: "2026-09-21T00:00:00Z",
      endsAt: "2026-10-21T00:00:00Z",
      limit: 1,
      requestId: randomUUID(),
    }),
  );
  expect(
    await reserveProduction(
      { sql, now },
      user,
      {
        contractId: other,
        templateId,
        requestId: randomUUID(),
        fingerprint: "fixture",
      },
      async () => {
        throw Error("must not create");
      },
    ),
  ).toMatchObject({ ok: false, code: "not_found" });
});
