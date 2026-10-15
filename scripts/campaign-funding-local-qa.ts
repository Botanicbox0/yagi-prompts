/** Explicit local Toss TEST fixture and server. Never imports cloud DB/storage or writes an env file. */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { parse } from "dotenv";
import { applyCoreMigrations } from "@/lib/db/migrations";
import { makeSingleConnectionRunner } from "@/lib/db/sql-runner";
import { issueFundingQuote } from "@/lib/campaigns/funding/service";
import type { Viewer } from "@/lib/auth/identity";

const root = resolve(process.cwd()),
  qaRoot = join(root, ".pglite", "campaign-funding-qa-20261016"),
  dbDir = join(qaRoot, "data"),
  manifestPath = join(qaRoot, "manifest.json");
const origin = "http://127.0.0.1:3107";
interface Manifest {
  ownerId: string;
  adminId: string;
  organizationId: string;
  projectId: string;
  campaignId: string;
  quoteId: string;
  caseId: string;
  syntheticAmountKrw: number;
  createdAt: string;
}
function manifest(): Manifest {
  if (!existsSync(manifestPath)) throw Error("Run seed first.");
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}
async function seed() {
  if (existsSync(manifestPath)) {
    console.log(
      JSON.stringify({
        fixtureAlreadyExists: true,
        ...manifest(),
        url: `${origin}/brand/projects/${manifest().projectId}/funding`,
      }),
    );
    return;
  }
  if (existsSync(dbDir))
    throw Error(
      "Existing local QA data without a manifest; inspect it before retrying. No data was deleted.",
    );
  await mkdir(qaRoot, { recursive: true });
  const db = new PGlite({ dataDir: dbDir });
  await db.waitReady;
  try {
    await db.exec(
      "create schema if not exists auth; create table if not exists auth.users(id uuid primary key);",
    );
    await applyCoreMigrations(db);
    const sql = makeSingleConnectionRunner(
      async <T = Record<string, unknown>>(
        text: string,
        values: unknown[] = [],
      ) => ({ rows: (await db.query<T>(text, values as never[])).rows }),
    );
    const ownerId = randomUUID(),
      adminId = randomUUID(),
      organizationId = randomUUID(),
      projectId = randomUUID(),
      campaignId = randomUUID();
    for (const [id, email, isAdmin] of [
      [ownerId, "funding-owner@twings.test", false],
      [adminId, "funding-admin@twings.test", true],
    ] as const) {
      await sql.query("insert into auth.users(id) values($1)", [id]);
      await sql.query(
        "insert into profiles(id,email,locale,plan,is_admin) values($1,$2,'ko','free',$3)",
        [id, email, isAdmin],
      );
    }
    await sql.query(
      "insert into brand_organizations(id,name,created_by,request_id) values($1,$2,$3,$4)",
      [organizationId, "TEST ONLY · TWINGS Funding QA", adminId, randomUUID()],
    );
    await sql.query(
      "insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')",
      [organizationId, ownerId],
    );
    await sql.query(
      "insert into brand_projects(id,organization_id,title,objective,production_mode,status,client_visible,created_by,request_id) values($1,$2,'TEST ONLY · Noncharge campaign checkout','Synthetic local payment-widget verification only','creator','active',true,$3,$4)",
      [projectId, organizationId, adminId, randomUUID()],
    );
    await sql.query(
      "insert into campaigns(id,slug,status,title,summary,host_name,platforms,slots) values($1,$2,'draft',$3::jsonb,$3::jsonb,'TEST ONLY',array['instagram'],1)",
      [
        campaignId,
        `test-funding-${campaignId}`,
        JSON.stringify({
          ko: "TEST ONLY · 캠페인 결제 검증",
          en: "TEST ONLY · Campaign payment QA",
        }),
      ],
    );
    await sql.query(
      "insert into campaign_collaboration_links(campaign_id,project_id,created_by) values($1,$2,$3)",
      [campaignId, projectId, adminId],
    );
    const admin: Viewer = {
      userId: adminId,
      isAdmin: true,
      email: "funding-admin@twings.test",
      locale: "ko",
      tier: "admin",
    };
    const result = await issueFundingQuote({ sql }, admin, {
      campaignId,
      requestId: randomUUID(),
      totalKrw: 1000,
      taxBasis:
        "TEST ONLY · 실거래가 아닌 합성 테스트 금액. 운영 견적의 세금 기준을 의미하지 않습니다.",
      termsSummary:
        "TEST ONLY · 실제 서비스·상품·참여자 보상을 구매하지 않습니다. 제공 범위: 격리된 로컬 DB와 Toss 테스트 승인/취소 확인. 시작 조건: 테스트 환경 표시를 확인한 담당자가 위젯을 직접 실행. 환불 조건: 테스트 승인 확인 후 관리자 전액 취소를 검증합니다. 실제 자금이 차감되는 live 키는 이 서버에서 허용하지 않습니다.",
      termsRef: "TEST-FIXTURE-2026-10-16-NOT-A-COMMERCIAL-QUOTE",
      validUntil: new Date(Date.now() + 86400000).toISOString(),
    });
    if (!result.ok) throw Error(`Local quote refused: ${result.code}`);
    const record: Manifest = {
      ownerId,
      adminId,
      organizationId,
      projectId,
      campaignId,
      quoteId: result.id,
      caseId: result.caseId,
      syntheticAmountKrw: 1000,
      createdAt: new Date().toISOString(),
    };
    await writeFile(manifestPath, JSON.stringify(record, null, 2));
    console.log(
      JSON.stringify({
        ...record,
        url: `${origin}/brand/projects/${projectId}/funding`,
      }),
    );
  } finally {
    await db.close();
  }
}
async function serve(role: string) {
  if (!["owner", "admin"].includes(role))
    throw Error("Use serve owner or serve admin.");
  const m = manifest();
  // Parse the canonical file in memory, forwarding ONLY the two Toss TEST keys to the child.
  const canonical = parse(readFileSync("D:/dev/twings/.env.local", "utf8")),
    client = canonical.TOSS_CLIENT_KEY ?? "",
    secret = canonical.TOSS_SECRET_KEY ?? "";
  if (!client.startsWith("test_gck_") || !secret.startsWith("test_gsk_"))
    throw Error(
      "A matched Toss widget TEST key pair is required; live or missing keys are refused.",
    );
  const env: NodeJS.ProcessEnv = { NODE_ENV: "development" };
  for (const [key, value] of Object.entries(process.env)) {
    if (
      /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(
        key,
      )
    )
      env[key] = value;
  }
  Object.assign(env, {
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    PLAYBOOK_MODE: "local",
    STORAGE_DRIVER: "local",
    PLAYBOOK_LOCAL_DB_DIR: dbDir,
    PLAYBOOK_LOCAL_DB: join(qaRoot, "no-fallback-snapshot.tar.gz"),
    PLAYBOOK_DEV_IDENTITY: role === "owner" ? m.ownerId : m.adminId,
    CAMPAIGN_FUNDING_PUBLIC: "on",
    CAMPAIGN_FUNDING_POLICY_READY: "on",
    TOSS_CLIENT_KEY: client,
    TOSS_SECRET_KEY: secret,
  });
  const require_ = createRequire(import.meta.url),
    child = spawn(
      process.execPath,
      [
        require_.resolve("next/dist/bin/next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3107",
      ],
      { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
  const log = join(qaRoot, "server-sanitized.log");
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = "";
    stream?.on("data", (bytes: Buffer) => {
      buffer += bytes.toString("utf8");
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const safe = line
          .split(client)
          .join("[redacted]")
          .split(secret)
          .join("[redacted]")
          .replace(/(\S*\/)\S*\?[^\s]*/g, "$1[query-redacted]")
          .replace(
            /(?:test|live)_(?:gck|gsk|ck|sk)_[A-Za-z0-9_-]+/g,
            "[redacted]",
          );
        appendFileSync(log, safe + "\n");
        if (/Ready in/.test(safe))
          console.log(
            JSON.stringify({
              ready: true,
              role,
              identity: role === "owner" ? m.ownerId : m.adminId,
              url:
                role === "owner"
                  ? `${origin}/brand/projects/${m.projectId}/funding`
                  : `${origin}/admin/funding`,
              testPairPresent: true,
              cloudCredentialsForwarded: false,
            }),
          );
      }
    });
  }
  child.on("error", () => {
    console.error("The local Next child could not start.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      child.kill(signal);
    });
}
async function main() {
  if (process.env.VERCEL) throw Error("Local QA is refused on Vercel.");
  const [command, role = "owner"] = process.argv.slice(2);
  if (command === "seed") await seed();
  else if (command === "serve") await serve(role);
  else throw Error("Use seed or serve owner|admin.");
}
main().catch(() => {
  console.error(
    "Local funding QA could not complete. No secret values are printed; inspect the selected local paths and TEST key configuration.",
  );
  process.exitCode = 1;
});
