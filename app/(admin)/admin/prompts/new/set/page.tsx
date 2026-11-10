import { requireAdmin } from '@/lib/auth/viewer';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { interpolate } from '@/lib/i18n/format';
import { DEFAULT_IMAGE_ASPECT, IMAGE_ASPECTS, IMAGE_ENGINES, isImageEngine, type ImageEngineId } from '@/lib/images/engines';
import { IMAGE_SET_FRAMES_MAX, IMAGE_SET_FRAMES_MIN } from '@/lib/prompts/schemas';
import { ADMIN_PROMPT_NEW_PATH, ADMIN_PROMPT_NEW_SET_PATH } from '@/lib/prompts/links';
import { MAKER_ENGINE_IDS, STUDIO_RECIPE_ENGINE_IDS } from '@/lib/recipes/schema';
import { AdminShell, Field, INPUT, OpForm, Panel } from '@/components/admin/chrome';
import { UseCaseChecks } from '@/components/admin/prompt-fields';
import { ImageSetFields } from '@/components/admin/image-set-form';

/**
 * `/admin/prompts/new/set` — a studio image set, without a manifest or database access (2026-11-01).
 * One order makes every frame; see lib/prompts/image-templates.ts for what the set becomes.
 */
export const dynamic = 'force-dynamic';

const SET_ENGINES = [...STUDIO_RECIPE_ENGINE_IDS, ...MAKER_ENGINE_IDS].filter((id): id is ImageEngineId & typeof id => isImageEngine(id));

export default async function AdminImageSetNewPage() {
  // The layout's check is not enough on its own: a client navigation request can ask for this page
  // segment alone, and then the layout does not run. Every admin page verifies the admin itself.
  await requireAdmin();
  const locale = await getLocaleFromHeaders();
  const dict = getDictionary(locale);
  const a = dict.admin;

  return (
    <AdminShell dict={a} locale={locale} active="prompts">
      <a href={ADMIN_PROMPT_NEW_PATH} className="font-mono text-[0.72rem] opacity-60">
        ← {a.authorHeading}
      </a>
      <h1 className="mt-4 font-display text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[0.95] font-black uppercase">
        {a.setHeading}
      </h1>
      <p className="mt-3 max-w-detail font-mono text-[0.75rem] opacity-55">
        {interpolate(a.setLede, { min: IMAGE_SET_FRAMES_MIN, max: IMAGE_SET_FRAMES_MAX })}
      </p>
      <p data-publish-notice className="mt-3 max-w-detail border border-hairline px-3 py-2 font-mono text-[0.75rem]">
        {a.setPublishNotice}
      </p>

      <Panel title={a.setFormTitle}>
        <OpForm op="prompt.createSet" back={ADMIN_PROMPT_NEW_SET_PATH} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={a.fieldPromptTitle}>
              <input type="text" name="title" required minLength={3} className={INPUT} />
            </Field>
            <Field label={a.fieldPromptTitleKo}>
              <input type="text" name="titleKo" required minLength={1} className={INPUT} />
            </Field>
          </div>
          <div>
            <span className="block font-label text-eyebrow uppercase opacity-60">{a.colUseCase}</span>
            <div className="mt-1.5">
              <UseCaseChecks dict={dict} selected={[]} />
            </div>
          </div>
          <ImageSetFields
            defaultEngine="seedream-5.0-pro"
            defaultAspect={DEFAULT_IMAGE_ASPECT}
            engines={SET_ENGINES.map((id) => ({ id, label: IMAGE_ENGINES[id].label }))}
            aspects={IMAGE_ASPECTS.map((id) => ({ id, label: dict.templates.aspects[id as keyof typeof dict.templates.aspects] ?? id }))}
            labels={{
              engine: a.setEngine, aspect: a.setAspect, frames: a.setFramesHeading, dropZone: a.setDropZone, promptHint: a.setPromptHint,
              frameLabel: a.setFrameLabel, thumbnail: a.setThumbnail, moveUp: a.setMoveUp, moveDown: a.setMoveDown, remove: a.setRemove,
              promptLabel: a.setPromptLabel, publish: a.setPublish, errCount: a.setErrCount, errTitles: a.setErrTitles, errImage: a.setErrImage,
              errAspect: a.setErrAspect, errPromptShort: a.setErrPromptShort, errPromptLong: a.setErrPromptLong, errNoPhoto: a.setErrNoPhoto, errOtherReference: a.setErrOtherReference,
              errBraces: a.setErrBraces, errManifest: a.setErrManifest, errFile: a.setErrFile, uploading: a.setFrameUploading, done: a.setFrameDone,
              failed: a.setFrameFailed, invalid: a.errInvalid, upload: a.mediaUploadFailed, session: a.mediaUploadSession,
              uncertain: a.promptPublishUncertain, retained: a.promptInputsRetained, publishing: a.promptPublishing,
            }}
          />
        </OpForm>
      </Panel>
    </AdminShell>
  );
}
