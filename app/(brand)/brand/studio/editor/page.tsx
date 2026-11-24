import { notFound } from 'next/navigation';
import { EditorV2 } from '@/components/brand-studio/editor-v2/editor-v2';
import { studioUploadErrorLine } from '@/components/brand-studio/copy';
import { studioRouteContext } from '@/components/brand-studio/route-context';
import { exportAutoDownload, exportPathOverride } from '@/lib/brand-studio/editor-v2/decode-plan';
import { EDITOR_WORKSPACES, type EditorWorkspace } from '@/lib/brand-studio/editor-v2/model';
import { EDITOR_ASSET_LIMIT, assetRecordOf, editorSources } from '@/lib/brand-studio/editor-v2/sources';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { assetView, assetsOf, jobsOf, viewsOf } from '@/lib/brand-studio/repo';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { brandStudioEditorV2DefaultFor, brandStudioEditorV2Open, brandWorkspacePrototypeLayerOpen } from '@/lib/flags';

/**
 * `/brand/studio/editor` — the editing studio v2 (docs/BRAND-EDITING-STUDIO-V2.md §10, §11 V1).
 *
 * The studio route guard runs first: a sandboxed organization, an organization whose policy closes
 * generative media, a project-only guest, a brand without a studio seat (showroom) and a deployment with
 * `BRAND_STUDIO_V2` off all get 404 before anything else is decided. Then the page's own flag,
 * `BRAND_STUDIO_EDITOR_V2` (default off).
 *
 * For an organization on the list (`BRAND_STUDIO_EDITOR_V2_ORGS`, lib/flags.ts) it opens the
 * organization's own film: the film the current editor (`/brand/studio/compose`) keeps in this browser,
 * with the same clips the current editor offers (video assets and finished video-studio results, loaded
 * the same way). Every other organization gets the sample film, which reads and writes nothing of the
 * organization's, as the structure prototype did; `ws=` picks the workspace it opens on. A listed
 * organization gets the sample film with `?sample=1` only while `BRAND_WORKSPACE_PROTOTYPE_LAYER=on` (the
 * switch the current editor's link to it obeys); off, the address opens its own film and the own film's
 * locked workspaces offer no sample film.
 * `exportPath=seek|decoder` forces the export's picture path for the checks (spec F, F5; no UI), and
 * `exportDownload=off` skips the finished file's automatic download for them (spec H, F9; no UI).
 */
export const dynamic = 'force-dynamic';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function StudioEditorV2Page({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[]; sample?: string | string[]; ws?: string | string[]; exportPath?: string | string[]; exportDownload?: string | string[] }>;
}) {
  const params = await searchParams;
  const ctx = await studioRouteContext(params.organizationId);
  if (!brandStudioEditorV2Open()) notFound();
  const { choice, dict, access } = ctx;
  const ws = first(params.ws);
  const initialWorkspace: EditorWorkspace = (EDITOR_WORKSPACES as readonly string[]).includes(ws ?? '') ? (ws as EditorWorkspace) : 'cut';
  const exportPath = exportPathOverride(params.exportPath);
  const autoDownload = exportAutoDownload(params.exportDownload);

  // The way back to the current editor carries `classic=1`, so it opens that editor even for an
  // organization whose `/brand/studio/compose` would send it here (lib/flags.ts).
  const currentEditorHref = scopedHref('/brand/studio/compose?classic=1', choice);

  // Only an organization on the list (`BRAND_STUDIO_EDITOR_V2_ORGS`) opens its own film here. Every other
  // one gets the sample film whatever the address says (`sample`, `clip`, anything): nothing of its own
  // is loaded or written, as before the switch (review round 1, item 2).
  const ownFilm = brandStudioEditorV2DefaultFor(choice.id);
  // The sample film is part of the prototype layer, like the current editor's link to it (compose/page.tsx):
  // off (the default), a listed organization's `?sample=1` opens its own film, and the film's locked
  // workspaces offer no sample film.
  const sampleFilm = brandWorkspacePrototypeLayerOpen();
  if (!ownFilm || (sampleFilm && first(params.sample) === '1')) {
    return <EditorV2 copy={dict.studioEditor} currentEditorHref={currentEditorHref} initialWorkspace={initialWorkspace} exportPath={exportPath} autoDownload={autoDownload} real={null} />;
  }

  const { deps } = ctx;
  const media = createStudioMediaStore();
  const [rawAssets, rawJobs] = await Promise.all([assetsOf(deps.sql, choice.id, 200), jobsOf(deps.sql, choice.id, 60)]);
  const assets = rawAssets.filter((asset) => asset.kind === 'video').map((asset) => assetView(asset, media));
  const jobs = await viewsOf(deps.sql, rawJobs, media);
  const videoOutputs = jobs.flatMap((job) =>
    job.outputs
      .filter((output) => output.kind === 'video')
      .map((output, index) => ({ ...output, label: job.prompt.trim().slice(0, 36) || `${dict.studioVideo.title} ${index + 1}` })),
  );
  // The same rule as the current editor: the studio team looking in and viewers only watch.
  const canEdit = !access.staff && (choice.role === 'owner' || choice.role === 'editor');
  // "에셋에 저장" and "검수 · 공유" on the finished export speak the current editor's words, taken from its
  // dictionary here (none is copied into the new editor's), and the library's sentence for a file over its limit.
  const { actions, status } = dict.studioCompose;
  const keep = {
    copy: {
      actions: { saveToAssets: actions.saveToAssets, savingToAssets: actions.savingToAssets, savedToAssets: actions.savedToAssets, shareReview: actions.shareReview },
      status: { saveQuotaExceeded: status.saveQuotaExceeded, saveFailed: status.saveFailed, reviewOpened: status.reviewOpened, reviewNeedsSave: status.reviewNeedsSave },
      fileTooLarge: studioUploadErrorLine(dict.brandStudio, 'file_too_large'),
    },
    locale: ctx.locale,
  };

  return (
    <EditorV2
      copy={dict.studioEditor}
      currentEditorHref={currentEditorHref}
      initialWorkspace={initialWorkspace}
      exportPath={exportPath}
      autoDownload={autoDownload}
      real={{
        organizationId: choice.id,
        organizationName: choice.name,
        canEdit,
        sources: editorSources(choice.id, assets, videoOutputs),
        // Every live, ready asset this read holds (all kinds), and whether it holds all of them: what confirms a
        // cut's file is missing (audit A4). Studio results are not in it, so their cuts are never called missing.
        assets: assetRecordOf(rawAssets.map((asset) => String(asset.id)), EDITOR_ASSET_LIMIT),
        sampleBase: sampleFilm ? scopedHref('/brand/studio/editor?sample=1', choice) : null,
        gradeNames: { presets: dict.studioCompose.colorGrade.presets, reference: dict.studioCompose.colorGrade.activeRef },
      }}
      keep={keep}
    />
  );
}
