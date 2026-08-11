import { createHash, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { Localized } from '@/lib/content/schemas';
import type { Visibility } from '@/lib/content/visibility';
import type { StorageDriver } from '@/lib/storage';

/** Minimal draft playbook builders for the RPC/trigger acceptance suites. */

export interface DraftBlockSpec {
  kind: 'prompt' | 'params' | 'asset' | 'note' | 'link' | 'workflow_file';
  visibility?: Visibility | null;
  content: Record<string, unknown>;
}

export interface DraftOptions {
  slug: string;
  playbookId?: string;
  revisionId?: string;
  revNo?: number;
  isShowcase?: boolean;
  title?: Partial<Localized>;
  summary?: Partial<Localized>;
  stepTitle?: Partial<Localized>;
  changeNote?: Partial<Localized> | null;
  withHero?: boolean;
  blocks?: DraftBlockSpec[];
}

export interface DraftFixture {
  playbookId: string;
  revisionId: string;
  stepId: string;
  blockIds: string[];
  /** staging key -> bytes, for callers that want to stage extra objects later. */
  stage: (label: string, ext: string, mime: string) => Promise<Record<string, unknown>>;
}

const bytesFor = (label: string) => new TextEncoder().encode(`fixture:${label}`);
const shaFor = (label: string) => createHash('sha256').update(bytesFor(label)).digest('hex');

export function assetRef(revisionId: string, label: string, ext = 'png', mime = 'image/png') {
  return {
    staging_key: `content/rev/${revisionId}/${label}.${ext}`,
    sha256: shaFor(label),
    mime,
  };
}

export async function stageAsset(
  storage: StorageDriver,
  revisionId: string,
  label: string,
  ext = 'png',
  mime = 'image/png',
) {
  const ref = assetRef(revisionId, label, ext, mime);
  await storage.putStaging(ref.staging_key, bytesFor(label), mime);
  return ref;
}

export async function createDraft(
  db: PGlite,
  storage: StorageDriver,
  options: DraftOptions,
): Promise<DraftFixture> {
  const playbookId = options.playbookId ?? randomUUID();
  const revisionId = options.revisionId ?? randomUUID();
  const stepId = randomUUID();
  const revNo = options.revNo ?? 1;

  const title = { en: 'Fixture title', ko: '픽스처 제목', ...options.title };
  const summary = { en: 'Fixture summary', ko: '픽스처 요약', ...options.summary };
  const stepTitle = { en: 'Fixture step', ko: '픽스처 스텝', ...options.stepTitle };
  const changeNote =
    options.changeNote === null || options.changeNote === undefined
      ? null
      : { en: 'note', ko: '노트', ...options.changeNote };

  await db.query(
    `insert into playbooks (id, slug, status, category, sort)
     values ($1, $2, 'draft', 'pipeline', 0)
     on conflict (id) do nothing`,
    [playbookId, options.slug],
  );

  let hero: Record<string, unknown> | null = null;
  if (options.withHero) {
    hero = await stageAsset(storage, revisionId, `hero-${revNo}`, 'jpg', 'image/jpeg');
  }

  await db.query(
    `insert into playbook_revisions
       (id, playbook_id, rev_no, state, is_showcase, title, summary, change_note, hero_asset)
     values ($1, $2, $3, 'draft', $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)`,
    [
      revisionId,
      playbookId,
      revNo,
      options.isShowcase ?? false,
      JSON.stringify(title),
      JSON.stringify(summary),
      changeNote === null ? null : JSON.stringify(changeNote),
      hero === null ? null : JSON.stringify(hero),
    ],
  );

  await db.query(
    `insert into steps (id, revision_id, "order", title) values ($1, $2, 1, $3::jsonb)`,
    [stepId, revisionId, JSON.stringify(stepTitle)],
  );

  const specs: DraftBlockSpec[] = options.blocks ?? [
    { kind: 'prompt', content: { text: 'fixture prompt' } },
  ];
  const blockIds: string[] = [];
  for (const [index, spec] of specs.entries()) {
    const id = randomUUID();
    blockIds.push(id);
    await db.query(
      `insert into blocks (id, step_id, "order", kind, content, visibility)
       values ($1, $2, $3, $4, $5::jsonb, $6::visibility)`,
      [id, stepId, index + 1, spec.kind, JSON.stringify(spec.content), spec.visibility ?? null],
    );
  }

  return {
    playbookId,
    revisionId,
    stepId,
    blockIds,
    stage: (label, ext, mime) => stageAsset(storage, revisionId, label, ext, mime),
  };
}
