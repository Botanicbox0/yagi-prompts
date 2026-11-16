/**
 * Documents (PDF, PPTX) as material for a revision (docs/BRAND-STUDIO-V6-PLAN.md §4.7).
 *
 * Closed unless all three hold (`studioDocumentsReady`): `BRAND_STUDIO_DOCUMENTS=on`, migration 0092
 * applied (the `page_count` column exists and the kind check takes 'document'), and the storage driver
 * keeps private objects. While closed every request and answer is what it was before documents existed.
 *
 * A document's bytes live only in the private store at `orgs/{orgId}/studio/documents/{assetId}`; the
 * public media domain never sees them, and the browser reads one only through the authenticated route
 * (`documentUrl`), which hands out a <=60 s signed download. They go when the asset is deleted.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { PrivateObjectStore } from '@/lib/storage';
import { STUDIO_UPLOAD_MIMES } from '../contracts';
import type { StudioDeps } from '../types';
import { inspectPptx, type PptxProblem } from './pptx';

export const PDF_MIME = 'application/pdf';
export const PPTX_MIME = STUDIO_UPLOAD_MIMES.document[1];

const RECHECK_MS = 60_000;
let probe: { ready: boolean; at: number } | null = null;

/** True once migration 0092 is applied. A miss is looked up again after a minute; a hit is kept. */
export async function assetDocumentKindReady(sql: SqlRunner, now = Date.now()): Promise<boolean> {
  if (probe && (probe.ready || now - probe.at < RECHECK_MS)) return probe.ready;
  let ready = false;
  try {
    const found = await sql.query<{ column: number; kind: number }>(
      `select
         (select count(*)::int from information_schema.columns
           where table_schema = current_schema() and table_name = 'brand_studio_assets' and column_name = 'page_count') as column,
         (select count(*)::int from pg_constraint
           where conname = 'brand_studio_assets_kind' and pg_get_constraintdef(oid) like '%document%') as kind`,
    );
    ready = Number(found.rows[0]?.column) > 0 && Number(found.rows[0]?.kind) > 0;
  } catch {
    ready = false;
  }
  probe = { ready, at: now };
  return ready;
}

/** Forget the lookup (tests change the schema under one process). */
export function resetDocumentProbe(): void {
  probe = null;
}

/** The private store documents live in, or null when documents are closed. */
export async function studioDocumentStore(deps: Pick<StudioDeps, 'env' | 'staging'>, sql: SqlRunner): Promise<PrivateObjectStore | null> {
  if (!deps.env.documents || !deps.staging.privateObjects) return null;
  return (await assetDocumentKindReady(sql)) ? deps.staging.privateObjects : null;
}

/** The flag, the migration and private storage, all three. */
export async function studioDocumentsReady(deps: Pick<StudioDeps, 'env' | 'staging'>, sql: SqlRunner): Promise<boolean> {
  return (await studioDocumentStore(deps, sql)) !== null;
}

export function documentKey(organizationId: string, assetId: string): string {
  return `orgs/${organizationId}/studio/documents/${assetId}`;
}

export function isDocumentKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && /^orgs\/[0-9a-f-]{36}\/studio\/documents\/[0-9a-f-]{36}$/.test(key);
}

/** Where the browser opens a document: the authenticated route (app/api/brand-studio/documents/[id]). */
export function documentUrl(organizationId: string, assetId: string): string {
  return `/api/brand-studio/documents/${assetId}?organizationId=${organizationId}`;
}

export type DocumentProblem = PptxProblem | 'not_pdf';

/**
 * Whether the bytes are a document the studio reads: a PDF that is not encrypted, or a PPTX within the
 * slide and size limits. `pages` is a PPTX's slide count; for a PDF it is null (not counted without a
 * real parser, so never shown).
 */
export function inspectDocument(bytes: Uint8Array, mime: string): { ok: true; pages: number | null } | { ok: false; problem: DocumentProblem } {
  if (mime === PDF_MIME) {
    const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1024)).toString('latin1');
    if (!head.startsWith('%PDF-')) return { ok: false, problem: 'not_pdf' };
    const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
    if (/\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(text)) return { ok: false, problem: 'encrypted' };
    return { ok: true, pages: null };
  }
  if (mime === PPTX_MIME) {
    const deck = inspectPptx(bytes);
    return deck.ok ? { ok: true, pages: deck.slides } : deck;
  }
  return { ok: false, problem: 'not_pdf' };
}
