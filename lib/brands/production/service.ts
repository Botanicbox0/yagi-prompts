import { ARK_MODELS } from "@/lib/ark/models";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import { loadPromptById, type PromptRow } from "@/lib/prompts/repo";

export interface ProductionDeps {
  sql: SqlRunner;
  now?: Date;
}
export type ProductionCode =
  | "sign_in_required"
  | "not_found"
  | "forbidden"
  | "invalid"
  | "conflict"
  | "contract_inactive"
  | "quota_exhausted";
export type ProductionResult<T = { id: string }> =
  ({ ok: true } & T) | { ok: false; code: ProductionCode };
type Row = Record<string, unknown>;
class Denied extends Error {
  constructor(readonly code: ProductionCode) {
    super(code);
  }
}
const uuid = z.string().uuid();
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const contractSchema = z
  .object({
    organizationId: uuid,
    projectId: uuid,
    documentId: uuid.nullish(),
    title: z.string().trim().min(2).max(120),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    limit: z.number().int().positive().max(100000),
    requestId: uuid,
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt));
const templateSchema = z.object({
  contractId: uuid,
  previewAttachmentId: uuid.nullish(),
  title: z.string().trim().min(2).max(120),
  titleKo: z.string().trim().min(2).max(120),
  promptText: z.string().trim().min(10).max(20000),
  seconds: z
    .number()
    .int()
    .min(ARK_MODELS["seedance-2.5"].minDurationSeconds)
    .max(ARK_MODELS["seedance-2.5"].maxDurationSeconds),
  aspect: z.enum(["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"]),
  requestId: uuid,
});
async function actor(sql: SqlRunner, viewer: Viewer, admin = false) {
  if (!uuid.safeParse(viewer.userId).success)
    throw new Denied("sign_in_required");
  const p = (
    await sql.query<{ is_admin: boolean }>(
      "select is_admin from profiles where id=$1 for share",
      [viewer.userId],
    )
  ).rows[0];
  if (!p) throw new Denied("sign_in_required");
  if (admin && !p.is_admin) throw new Denied("forbidden");
  return viewer.userId!;
}
async function member(
  sql: SqlRunner,
  userId: string,
  orgId: string,
  write = false,
) {
  const m = (
    await sql.query<{ role: string }>(
      "select role from brand_memberships where organization_id=$1 and user_id=$2 and status='active' for share",
      [orgId, userId],
    )
  ).rows[0];
  if (!m) throw new Denied("not_found");
  if (write && m.role === "viewer") throw new Denied("forbidden");
  return m.role;
}
async function mutate<T>(
  deps: ProductionDeps,
  fn: (tx: SqlRunner) => Promise<T>,
): Promise<ProductionResult<T>> {
  try {
    return await deps.sql.transaction(async (tx) => ({
      ok: true as const,
      ...(await fn(tx)),
    }));
  } catch (e) {
    if (e instanceof Denied) return { ok: false, code: e.code };
    if ((e as { code?: string }).code === "23505")
      return { ok: false, code: "conflict" };
    throw e;
  }
}
export async function createProductionContract(
  deps: ProductionDeps,
  viewer: Viewer,
  input: unknown,
) {
  const parsed = contractSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid" as const };
  const v = parsed.data;
  return mutate(deps, async (sql) => {
    const user = await actor(sql, viewer, true);
    const p = (
      await sql.query(
        "select id from brand_projects where id=$1 and organization_id=$2 for share",
        [v.projectId, v.organizationId],
      )
    ).rows[0];
    if (!p) throw new Denied("not_found");
    if (
      v.documentId &&
      !(
        await sql.query(
          "select id from brand_contract_documents where id=$1 and project_id=$2",
          [v.documentId, v.projectId],
        )
      ).rows[0]
    )
      throw new Denied("not_found");
    const prior = (
      await sql.query<Row>(
        "select * from brand_production_contracts where created_by=$1 and request_id=$2",
        [user, v.requestId],
      )
    ).rows[0];
    if (prior) {
      if (
        prior.organization_id !== v.organizationId ||
        prior.project_id !== v.projectId ||
        prior.title !== v.title ||
        Number(prior.generation_limit) !== v.limit ||
        Date.parse(iso(prior.starts_at)) !== Date.parse(v.startsAt) ||
        Date.parse(iso(prior.ends_at)) !== Date.parse(v.endsAt) ||
        (prior.document_id ?? null) !== (v.documentId ?? null)
      )
        throw new Denied("conflict");
      return { id: String(prior.id) };
    }
    const id = randomUUID();
    await sql.query(
      "insert into brand_production_contracts(id,organization_id,project_id,document_id,title,starts_at,ends_at,generation_limit,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        v.organizationId,
        v.projectId,
        v.documentId ?? null,
        v.title,
        v.startsAt,
        v.endsAt,
        v.limit,
        user,
        v.requestId,
      ],
    );
    return { id };
  });
}
export async function setProductionContractEnabled(
  deps: ProductionDeps,
  viewer: Viewer,
  input: unknown,
) {
  const parsed = z
    .object({
      contractId: uuid,
      enabled: z.boolean(),
      expectedRevision: z.number().int().min(0),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid" as const };
  const v = parsed.data;
  return mutate(deps, async (sql) => {
    await actor(sql, viewer, true);
    const r = await sql.query(
      "update brand_production_contracts set enabled=$2,revision=revision+1 where id=$1 and revision=$3 returning id",
      [v.contractId, v.enabled, v.expectedRevision],
    );
    if (!r.rows.length) throw new Denied("conflict");
    return { id: v.contractId };
  });
}
export async function createProductionTemplate(
  deps: ProductionDeps,
  viewer: Viewer,
  input: unknown,
) {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid" as const };
  const v = parsed.data;
  return mutate(deps, async (sql) => {
    const user = await actor(sql, viewer, true);
    if (
      !(
        await sql.query(
          "select id from brand_production_contracts where id=$1 for update",
          [v.contractId],
        )
      ).rows[0]
    )
      throw new Denied("not_found");
    if (
      v.previewAttachmentId &&
      !(
        await sql.query(
          `select a.id from brand_attachments a join brand_production_contracts c on c.project_id=a.project_id where c.id=$1 and a.id=$2 and a.status='ready' and a.access_scope='workspace' and (a.mime like 'image/%' or a.mime like 'video/%')`,
          [v.contractId, v.previewAttachmentId],
        )
      ).rows.length
    )
      throw new Denied("not_found");
    const prior = (
      await sql.query<Row>(
        "select p.*,t.preview_attachment_id from brand_production_templates t join prompt_items p on p.id=t.id where t.created_by=$1 and t.request_id=$2 and t.contract_id=$3",
        [user, v.requestId, v.contractId],
      )
    ).rows[0];
    if (prior) {
      if (
        (prior.preview_attachment_id ?? null) !==
          (v.previewAttachmentId ?? null) ||
        prior.title !== v.title ||
        prior.title_ko !== v.titleKo ||
        prior.prompt_text !== v.promptText ||
        Number(prior.runtime_seconds) !== v.seconds ||
        prior.aspect_default !== v.aspect
      )
        throw new Denied("conflict");
      return { id: String(prior.id) };
    }
    const id = randomUUID();
    await sql.query(
      `insert into prompt_items(id,slug,source,status,models,title,title_ko,prompt_text,text_visibility,media,use_case,medium,price_cents,price_krw,runtime_seconds,engine,aspect_default,published_at,audience)
    values($1,$2,'yagi','published',ARRAY['seedance-2.5'],$3,$4,$5,'hidden',null,'{}','video',0,0,$6,'seedance-2.5',$7,now(),'brand')`,
      [
        id,
        `brand-${id}`,
        v.title,
        v.titleKo,
        v.promptText,
        v.seconds,
        v.aspect,
      ],
    );
    await sql.query(
      "insert into brand_production_templates(id,contract_id,created_by,request_id,preview_attachment_id) values($1,$2,$3,$4,$5)",
      [id, v.contractId, user, v.requestId, v.previewAttachmentId ?? null],
    );
    return { id };
  });
}

export interface ProductionContractView {
  id: string;
  projectId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  limit: number;
  used: number;
  remaining: number;
  enabled: boolean;
  active: boolean;
  revision: number;
  templates: Array<{
    id: string;
    title: string;
    titleKo: string;
    seconds: number;
    aspect: string;
    previewUrl: string | null;
    previewMime: string | null;
  }>;
}
export interface ProductionWorkspace {
  role: string;
  contracts: ProductionContractView[];
  jobs: Array<{
    id: string;
    title: string;
    titleKo: string;
    status: string;
    released: boolean;
    createdAt: string;
  }>;
}
export async function loadProductionWorkspace(
  deps: ProductionDeps,
  viewer: Viewer,
  organizationId: string,
  studio = false,
): Promise<ProductionWorkspace | null> {
  if (!uuid.safeParse(organizationId).success) return null;
  try {
    return await deps.sql.transaction(async (sql) => {
      const user = await actor(sql, viewer, studio),
        role = studio ? "studio" : await member(sql, user, organizationId);
      const now = +(deps.now ?? new Date());
      const rows = (
        await sql.query<Row>(
          `select c.*,(select count(*)::int from brand_production_reservations r where r.contract_id=c.id and r.released_at is null) as used from brand_production_contracts c where c.organization_id=$1 order by c.created_at desc`,
          [organizationId],
        )
      ).rows;
      const contracts: ProductionContractView[] = [];
      for (const r of rows) {
        const templates = (
          await sql.query<Row>(
            "select p.id,p.title,p.title_ko,p.runtime_seconds,p.aspect_default,a.id as preview_id,a.mime as preview_mime,bp.client_visible from brand_production_templates t join prompt_items p on p.id=t.id left join brand_attachments a on a.id=t.preview_attachment_id left join brand_projects bp on bp.id=a.project_id where t.contract_id=$1 order by t.created_at",
            [r.id],
          )
        ).rows;
        contracts.push({
          id: String(r.id),
          projectId: String(r.project_id),
          title: String(r.title),
          startsAt: iso(r.starts_at),
          endsAt: iso(r.ends_at),
          limit: Number(r.generation_limit),
          used: Number(r.used),
          remaining: Math.max(0, Number(r.generation_limit) - Number(r.used)),
          enabled: Boolean(r.enabled),
          active:
            Boolean(r.enabled) &&
            Date.parse(iso(r.starts_at)) <= now &&
            now < Date.parse(iso(r.ends_at)),
          revision: Number(r.revision),
          templates: templates.map((t) => ({
            id: String(t.id),
            title: String(t.title),
            titleKo: String(t.title_ko),
            seconds: Number(t.runtime_seconds),
            aspect: String(t.aspect_default),
            previewUrl:
              t.preview_id && (studio || t.client_visible)
                ? `/api/brand-workspace/attachments/${t.preview_id}`
                : null,
            previewMime: t.preview_mime ? String(t.preview_mime) : null,
          })),
        });
      }
      const jobs = (
        await sql.query<Row>(
          `select j.id,p.title,p.title_ko,j.status,r.released_at,j.created_at from brand_production_reservations r join brand_production_contracts c on c.id=r.contract_id join render_jobs j on j.id=r.render_id join prompt_items p on p.id=j.template_id where c.organization_id=$1 order by j.created_at desc limit 50`,
          [organizationId],
        )
      ).rows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        titleKo: String(r.title_ko),
        status: String(r.status),
        released: !!r.released_at,
        createdAt: iso(r.created_at),
      }));
      return { role, contracts, jobs };
    });
  } catch (e) {
    if (e instanceof Denied) return null;
    throw e;
  }
}

/** Contract row lock serializes every reservation across users. No external provider call here. */
export async function reserveProduction<F extends string>(
  deps: ProductionDeps,
  viewer: Viewer,
  input: {
    contractId: string;
    templateId: string;
    requestId: string;
    fingerprint: string;
  },
  enqueue: (
    sql: SqlRunner,
    template: PromptRow,
  ) => Promise<
    { ok: true; id: string; held: boolean } | { ok: false; code: F }
  >,
): Promise<
  | { ok: true; id: string; held: boolean }
  | { ok: false; code: ProductionCode | F }
> {
  const valid = z
    .object({
      contractId: uuid,
      templateId: uuid,
      requestId: uuid,
      fingerprint: z.string().min(1).max(200),
    })
    .safeParse(input);
  if (!valid.success) return { ok: false, code: "invalid" };
  try {
    return await deps.sql.transaction(async (sql) => {
      const user = await actor(sql, viewer);
      const contract = (
        await sql.query<Row>(
          "select * from brand_production_contracts where id=$1 for update",
          [input.contractId],
        )
      ).rows[0];
      if (!contract) throw new Denied("not_found");
      await member(sql, user, String(contract.organization_id), true);
      const prior = (
        await sql.query<Row>(
          "select r.*,j.status from brand_production_reservations r join render_jobs j on j.id=r.render_id where r.user_id=$1 and r.request_id=$2",
          [user, input.requestId],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.contract_id !== input.contractId ||
          prior.template_id !== input.templateId ||
          prior.fingerprint !== input.fingerprint
        )
          throw new Denied("conflict");
        return {
          ok: true,
          id: String(prior.render_id),
          held: prior.status === "held",
        };
      }
      const now = +(deps.now ?? new Date());
      if (
        !contract.enabled ||
        now < Date.parse(iso(contract.starts_at)) ||
        now >= Date.parse(iso(contract.ends_at))
      )
        throw new Denied("contract_inactive");
      if (
        !(
          await sql.query(
            "select id from brand_production_templates where id=$1 and contract_id=$2",
            [input.templateId, input.contractId],
          )
        ).rows[0]
      )
        throw new Denied("not_found");
      const template = await loadPromptById(sql, input.templateId);
      if (
        !template ||
        template.audience !== "brand" ||
        template.engine !== "seedance-2.5"
      )
        throw new Denied("not_found");
      const used = Number(
        (
          await sql.query<{ n: number }>(
            "select count(*)::int as n from brand_production_reservations where contract_id=$1 and released_at is null",
            [input.contractId],
          )
        ).rows[0]!.n,
      );
      if (used >= Number(contract.generation_limit))
        throw new Denied("quota_exhausted");
      const created = await enqueue(sql, template);
      if (!created.ok) return created;
      await sql.query(
        "insert into brand_production_reservations(render_id,contract_id,template_id,user_id,request_id,fingerprint) values($1,$2,$3,$4,$5,$6)",
        [
          created.id,
          input.contractId,
          input.templateId,
          user,
          input.requestId,
          input.fingerprint,
        ],
      );
      return created;
    });
  } catch (e) {
    if (e instanceof Denied) return { ok: false, code: e.code };
    if ((e as { code?: string }).code === "23505")
      return { ok: false, code: "conflict" };
    throw e;
  }
}

/** Output only, never the creator's input portrait, cost, prompt or share token. */
export async function loadProductionOutput(
  deps: ProductionDeps,
  viewer: Viewer,
  id: string,
) {
  if (!uuid.safeParse(id).success) return null;
  try {
    return await deps.sql.transaction(async (sql) => {
      const user = await actor(sql, viewer);
      const row = (
        await sql.query<Row>(
          `select j.id,j.status,j.result_key,j.result_mime,c.organization_id,p.title,p.title_ko,r.released_at from brand_production_reservations r join brand_production_contracts c on c.id=r.contract_id join render_jobs j on j.id=r.render_id join prompt_items p on p.id=j.template_id where j.id=$1`,
          [id],
        )
      ).rows[0];
      if (!row) return null;
      await member(sql, user, String(row.organization_id));
      return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        status: String(row.status),
        title: String(row.title),
        titleKo: String(row.title_ko),
        released: !!row.released_at,
        resultKey: row.result_key ? String(row.result_key) : null,
        resultMime: row.result_mime ? String(row.result_mime) : null,
      };
    });
  } catch (e) {
    if (e instanceof Denied) return null;
    throw e;
  }
}
