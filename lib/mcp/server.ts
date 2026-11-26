import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RenderStore } from '@/lib/renders/store';
import type { StorageDriver } from '@/lib/storage';
import { selfPublishOpen } from '@/lib/recipes/self-publish';
import { PlatformError } from '@/lib/creator-platform/contract';
import { IMAGE_ASPECTS, VIDEO_ASPECTS } from '@/lib/images/engines';
import { videoEngineSpec } from '@/lib/video/models';
import { revalidateMakerProfile } from '@/lib/cache';
import { creativeGate, creativeProgramOpen } from '@/lib/makers/access';
import { decodeBase64Media, fetchPublicMedia, MediaFetchError } from '@/lib/makers/fetch-media';
import { makerHref, makerWorkSrc } from '@/lib/makers/links';
import { MakerProfileError, loadMakerSettings, patchMakerProfile } from '@/lib/makers/profile';
import { MAKER_TOKENS_MAX } from '@/lib/makers/tokens';
import { WorkError, MAKER_WORKS_MAX, deleteMakerWork, listMakerWorks, storeMakerWork } from '@/lib/makers/works';
import { makerStats } from '@/lib/makers/stats';
import { MAKER_AV_FILE_MAX_BYTES, MAKER_FILE_MAX_BYTES, MAKER_FORMAT_MAX_BYTES, MAKER_REFERENCE_FILES } from '@/lib/recipes/assets';
import { loadMakerDraft, makerAction, MAKER_TEST_RENDERS, RecipeRejected, uploadMakerFile } from '@/lib/recipes/maker';
import { ROYALTY_DEFAULT_KRW, ROYALTY_MAX_KRW, ROYALTY_MIN_KRW } from '@/lib/recipes/pricing';
import { INTRO_MAX, MAKER_ENGINE_IDS, MIN_STEP_PROMPT_CHARS, NOTE_MAX, OUTRO_MAX, makerEnginesFor, parseRecipe } from '@/lib/recipes/schema';
import { GUIDE_META_MAX, GUIDE_NOTE_MAX, GUIDE_PROMPT_MAX, GUIDE_PROMPT_MIN, GUIDE_TITLE_MAX, MAX_GUIDE_CLIPS } from '@/components/recipes/guide-editor';
import { isVideoEngine } from '@/lib/images/engines';
import { DEFAULT_PROMPT_CHARS, SEEDANCE_25_PROMPT_CHARS, formatPromptChars, promptCharLimit } from '@/lib/engines/prompt-limits';
import { guideTokenWarnings } from './guide-warnings';

/** The step prompt rule as the guide and the tools state it — built from the constants so it cannot drift again. */
export const MCP_PROMPT_LIMIT_TEXT = `${MIN_STEP_PROMPT_CHARS}–${formatPromptChars(DEFAULT_PROMPT_CHARS)} characters a step; a Seedance 2.5 video step takes up to ${formatPromptChars(SEEDANCE_25_PROMPT_CHARS)}. A step is one clip, so the limit is per clip, never a total: two clips have ${formatPromptChars(SEEDANCE_25_PROMPT_CHARS)} each.`;

const BYTES_PER_MB = 1024 * 1024;
const bytesToMb = (bytes: number) => Math.round((bytes / BYTES_PER_MB) * 10) / 10;

export const MCP_IMAGE_FILE_MAX_MB = bytesToMb(MAKER_FILE_MAX_BYTES);
export const MCP_AV_FILE_MAX_MB = bytesToMb(MAKER_AV_FILE_MAX_BYTES);
export const MCP_FORMAT_MAX_MB = bytesToMb(MAKER_FORMAT_MAX_BYTES);

export function formatMcpFileLimits(limits = {
  references: MAKER_REFERENCE_FILES,
  imageBytes: MAKER_FILE_MAX_BYTES,
  avBytes: MAKER_AV_FILE_MAX_BYTES,
  formatBytes: MAKER_FORMAT_MAX_BYTES,
}): string {
  return `${limits.references} references + 1 example; images up to ${bytesToMb(limits.imageBytes)} MB, video/audio up to ${bytesToMb(limits.avBytes)} MB (by URL), ${bytesToMb(limits.formatBytes)} MB total a template`;
}

export const MCP_FILE_LIMIT_TEXT = formatMcpFileLimits();

/**
 * docs/PLATFORM-2.0.md §20.5 — the TWINGS MCP server: an AI creative's own agent (Claude, Codex,
 * Cursor…) reads the recipe guide, saves drafts, uploads source files and works, test-renders and
 * submits — the same domain calls the studio makes, under the same gate and limits. Nothing here is
 * a new power: a tool is a thin JSON wrapper around a function the studio already uses.
 *
 * Transport: MCP Streamable HTTP, stateless, JSON responses only (no SSE stream is ever opened).
 * Auth: `Authorization: Bearer twk_…` (lib/makers/tokens.ts), resolved by the route before this runs.
 */

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const MCP_SERVER_INFO = { name: 'twings', title: 'TWINGS for AI creatives', version: '1.0.0' } as const;

export interface McpDeps { sql: SqlRunner; store: RenderStore; storage?: StorageDriver; userId: string; origin: string; afterRender?: (renderId: string) => void }
interface JsonRpcRequest { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
type JsonRpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

const str = { type: 'string' } as const;
const tool = (name: string, title: string, description: string, properties: Record<string, unknown> = {}, required: string[] = [], readOnly = false) => ({
  name, title, description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
});
const uploadMediaSource = {
  url: {
    type: 'string',
    description: `A public https URL of the image, video or audio file. Images up to ${MCP_IMAGE_FILE_MAX_MB} MB; video/audio up to ${MCP_AV_FILE_MAX_MB} MB.`,
  },
  data_base64: {
    type: 'string',
    description: `The file as base64 (a data: URL is fine). Decoded size up to ${MCP_IMAGE_FILE_MAX_MB} MB (effectively ~3 MB over the JSON request body; use url for larger video/audio).`,
  },
};
const workMediaSource = {
  url: {
    type: 'string',
    description: `A public https URL of the image or video. Up to ${MCP_IMAGE_FILE_MAX_MB} MB.`,
  },
  data_base64: {
    type: 'string',
    description: `The file as base64 (a data: URL is fine). Decoded size up to ${MCP_IMAGE_FILE_MAX_MB} MB (effectively ~3 MB over the JSON request body).`,
  },
};

export const MCP_TOOLS = [
  tool('whoami', 'Who am I', 'Your TWINGS creative account: handle, public profile URL, whether the program and self-publishing are open, and your limits.', {}, [], true),
  tool('get_recipe_guide', 'Recipe guide', 'How a TWINGS template recipe (version 2) is written: slots, steps, display-only clip cards (guide[]), engines, aspects, durations, notes, file limits, disclosure and complete examples (including multi-clip). Read this before save_template.', {}, [], true),
  tool('validate_recipe', 'Validate a recipe', 'Checks a recipe JSON against every rule without saving it. Returns ok or the list of issues to fix, plus non-blocking warnings if guide[] clip prompts use unknown {{name}} tokens.', { recipe: { type: 'object' } }, ['recipe'], true),
  tool('list_templates', 'My templates', 'Your templates (drafts, in review, published, declined) with status, review note and how many members opened each published recipe.', {}, [], true),
  tool('get_template', 'One template', 'One of your templates with its recipe JSON, uploaded files (their ast_ ids), test renders, web editor URL (editor) and live template URL (url) when published.', { id: str }, ['id'], true),
  tool('save_template', 'Save a draft', 'Creates or updates a DRAFT. Omit id to create one. Returns the id, the web editor URL (editor), any remaining recipe issues (a draft may be incomplete), and non-blocking warnings if guide[] uses unknown {{name}} tokens.', {
    id: { type: 'string', description: 'Draft id (uuid). Omit to create a new draft.' },
    title: { type: 'string', description: 'English title, 3–120 characters.' },
    title_ko: { type: 'string', description: 'Korean title (optional).' },
    recipe: { type: 'object', description: `Recipe v2 JSON — see get_recipe_guide. Step prompts: ${MCP_PROMPT_LIMIT_TEXT}` },
    show_prompts: { type: 'boolean', description: 'Show your prompts to signed-in members on the template page (default false).' },
    show_files: { type: 'boolean', description: 'Let signed-in members view and download your source files (default false).' },
    presentation: { type: 'string', enum: ['make-first', 'story-first'] },
    royalty_krw: { type: 'integer', minimum: ROYALTY_MIN_KRW, maximum: ROYALTY_MAX_KRW },
    example_url: { type: 'string', description: 'Link to your own post showing the result (Instagram, TikTok, YouTube).' },
  }, ['title', 'recipe']),
  tool('upload_file', 'Upload a source file', 'Uploads a reference image, video or audio file (role "reference", referenced from a creator slot by its ast_ id) or the example result (role "example") to one of your drafts.', {
    template_id: str,
    role: { type: 'string', enum: ['reference', 'example'] },
    contains_person: { type: 'boolean', description: 'Optional. Set true if this file shows a real person’s face (matches the web editor’s "Contains a person’s face" option; disables direct download by members even when source files are disclosed).' },
    ...uploadMediaSource,
  }, ['template_id']),
  tool('delete_file', 'Delete a file', 'Removes one uploaded file (ast_ id) from a draft.', { template_id: str, file: str }, ['template_id', 'file']),
  tool('test_render', 'Test render', `Makes the draft's IMAGE steps once with your own saved selfie through the real pipeline (at most ${MAKER_TEST_RENDERS} per template, at TWINGS's cost). A test never makes video: video steps are skipped and made only when a buyer pays. A template with no image step to test is refused (video_test_unavailable) and no test is used.`, { template_id: str }, ['template_id']),
  tool('publish_template', 'Publish', 'Publishes a draft as a live TWINGS template, credited to you — no studio review. Needs a passing recipe, an uploaded example file (upload_file role "example") and one succeeded test_render. A template with no image step to test needs an uploaded example VIDEO instead of a test_render. The price is set automatically (cost floor + your royalty). You confirm you hold the rights to everything in it.', { template_id: str, rights_confirmed: { type: 'boolean', const: true } }, ['template_id', 'rights_confirmed']),
  tool('submit_template', 'Submit for review', 'Sends a complete draft to the TWINGS studio for review instead of publishing it yourself. You confirm you hold the rights to everything in it.', { template_id: str, rights_confirmed: { type: 'boolean', const: true } }, ['template_id', 'rights_confirmed']),
  tool('update_profile', 'Update my profile', 'Changes any of your public profile fields; fields you leave out keep their value. Set public_profile true to publish the page.', {
    display_name: str, handle: str, headline: str, bio: str, country: { type: 'string', description: 'ISO 3166-1 alpha-2, e.g. KR, US, FR.' }, city: str,
    links: { type: 'array', items: str, maxItems: 6, description: 'https links: Instagram, TikTok, YouTube, X, Threads, Higgsfield, Behance, website…' },
    public_email: { type: 'string', description: 'An email to show on your page, or "" to hide it.' },
    tools: { type: 'array', items: str, maxItems: 8, description: 'What you make with, e.g. "Seedance 2.5", "Midjourney".' },
    open_to_brands: { type: 'boolean' }, public_profile: { type: 'boolean' },
  }),
  tool('list_works', 'My works', 'Your representative works on your profile.', {}, [], true),
  tool('add_work', 'Add a work', `Adds one representative work (image or short film) to your profile. Max ${MAKER_WORKS_MAX} works.`, {
    ...workMediaSource, title: str, caption: str, link: { type: 'string', description: 'https link to the original post (optional).' },
  }),
  tool('remove_work', 'Remove a work', 'Removes one work (wrk_ id) from your profile.', { id: str }, ['id']),
  tool('get_stats', 'My stats', 'How many signed-in members opened each of your published recipes, in total and in the last 7 days.', {}, [], true),
];

class ToolFailure extends Error {
  constructor(readonly code: string, readonly detail?: unknown) { super(code); }
}

export function recipeGuide() {
  return {
    summary: 'A recipe turns ONE customer selfie into a finished result. Slot "selfie" is always the customer photo; every other slot is a file YOU upload (upload_file → ast_ id). Steps run in order; a prompt refers to slots and earlier steps only as {{name}}.',
    limits: {
      steps: 'image then video (max 2), or 1–10 images (a carousel)',
      guideClips: MAX_GUIDE_CLIPS,
      prompt: MCP_PROMPT_LIMIT_TEXT,
      note: `${NOTE_MAX} characters a step`,
      intro: INTRO_MAX,
      outro: OUTRO_MAX,
      files: MCP_FILE_LIMIT_TEXT,
      royaltyKrw: [ROYALTY_MIN_KRW, ROYALTY_MAX_KRW],
      royaltyDefaultKrw: ROYALTY_DEFAULT_KRW,
    },
    engines: MAKER_ENGINE_IDS.map((id) => (isVideoEngine(id)
      ? { id, kind: 'video', aspects: VIDEO_ASPECTS, durationSeconds: [videoEngineSpec(id).minDurationSeconds, videoEngineSpec(id).maxDurationSeconds], resolutions: videoEngineSpec(id).resolutions, promptMaxChars: promptCharLimit(id) }
      : { id, kind: 'image', aspects: IMAGE_ASPECTS, promptMaxChars: promptCharLimit(id) })),
    imageEngines: makerEnginesFor('image'),
    videoEngines: makerEnginesFor('video'),
    publishing: 'publish_template makes the draft a live template with no studio review once: the recipe passes, an example FILE is uploaded (role "example"), and one test_render has succeeded. test_render makes the image steps only; a template with no image step to test needs an example VIDEO file instead. Price = cost floor + royalty_krw, set automatically.',
    disclosure: 'show_prompts / show_files decide what signed-in members see on the template page. Anonymous visitors only see an outline (steps, engines, inputs, and clip card titles only) and are asked to sign in. Off by default.',
    presentation: '"make-first": example → make → how it was made. "story-first": your story and steps first.',
    notes: 'notes.intro (shown to everyone above the outline), steps[].note and guide[].note (shown as a highlighted tip box ABOVE each prompt, members only — visible even when the prompt is folded) and notes.outro (e.g. "post yours and tag me") are display-only; no engine reads them.',
    guide: {
      summary: `Optional display-only clip cards (1–${MAX_GUIDE_CLIPS} cards) for multi-clip or beat-by-beat templates. No engine reads guide[]; it renders on the template page in the full-width "Clip by clip" section (#clips).`,
      visibility: 'Signed-in members see every clip card (number, title, meta, tip box above the prompt, foldable prompt and copy button). Signed-out visitors see numbered titles only — never meta, prompts or tips.',
      maxItems: MAX_GUIDE_CLIPS,
      fields: {
        title: `1–${GUIDE_TITLE_MAX} characters. Customer-facing clip title (shown even to signed-out visitors). Never include model names or internal procedure names.`,
        kind: '"image" | "video"',
        meta: `Optional, up to ${GUIDE_META_MAX} characters. Customer-facing spec line shown under the title (e.g. "Video · 4:3 · 5s"). Never include model names, engine ids, or internal workflow labels.`,
        prompt: `${GUIDE_PROMPT_MIN}–${formatPromptChars(GUIDE_PROMPT_MAX)} characters per clip (same per-clip cap as step prompts). Use {{name}} only for declared slot names in slots and step ids in steps[].id; any other {{name}} renders wrongly on the buyer screen and triggers a non-blocking warning in validate_recipe and save_template.`,
        note: `Optional, up to ${GUIDE_NOTE_MAX} characters. Displayed to signed-in members in a tip box ABOVE the prompt.`,
      },
    },
    example: {
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true }, scene: { kind: 'image', source: 'creator', asset: 'ast_<32 hex from upload_file>' } },
      steps: [
        { id: 'still', kind: 'image', engine: 'gpt-image-2.5-flare', inputs: ['selfie', 'scene'], prompt: 'Full-body studio portrait of the person in {{selfie}} standing inside the set of {{scene}}, soft daylight, 35mm film look.', note: 'Front-facing selfies with even light keep the likeness best.', params: { aspect: '9:16' } },
        { id: 'film', kind: 'video', engine: 'seedance-2.5', inputs: ['still'], prompt: 'The person in {{still}} turns toward the camera and smiles as the light slowly warms. One unbroken shot, locked-off camera.', params: { aspect: '9:16', duration: 10, resolution: '720p' } },
      ],
      output: { from: 'film' },
      notes: { intro: 'Two steps: a still from your selfie, then a 10-second film.', outro: 'Post yours and tag me — I repost my favourites.' },
    },
    exampleWithClips: {
      version: 2,
      slots: {
        selfie: { kind: 'image', source: 'user', required: true },
        wardrobe: { kind: 'image', source: 'creator', asset: 'ast_<32 hex from upload_file>' },
      },
      steps: [
        {
          id: 'film',
          kind: 'video',
          engine: 'seedance-2.5',
          inputs: ['selfie', 'wardrobe'],
          prompt: 'The person in {{selfie}} walks along an evening cobblestone street wearing the coat from {{wardrobe}}, continuous steadicam movement across three beats.',
          note: 'Front-facing selfies with clear shoulder framing transfer best into the walking cut.',
          params: { aspect: '9:16', duration: 8, resolution: '720p' },
        },
      ],
      output: { from: 'film' },
      guide: [
        {
          title: 'Street arrival',
          kind: 'video',
          meta: 'Video · 9:16 · 3s',
          prompt: 'Wide tracking shot as {{selfie}} steps onto the wet pavement wearing {{wardrobe}}, cool dusk light across the coat silhouette.',
          note: 'Avoid busy street signs behind the subject so the outline stays crisp.',
        },
        {
          title: 'Shoulder turn',
          kind: 'video',
          meta: 'Video · 9:16 · 3s',
          prompt: 'Medium shot following {{selfie}} turning gently toward camera while the fabric of {{wardrobe}} catches warm storefront reflections.',
          note: 'Even exposure on the face keeps skin tone steady across the turn.',
        },
        {
          title: 'Closing portrait',
          kind: 'video',
          meta: 'Video · 9:16 · 2s',
          prompt: 'Close portrait of {{selfie}} pausing under soft tungsten light with the collar of {{wardrobe}} framing the jawline.',
          note: 'Look slightly past the lens on the final beat for a calmer finish.',
        },
      ],
      notes: {
        intro: 'One 8-second runway walk broken into three clip cards you can study beat by beat.',
        outro: 'Post your version and tag me so I can share it.',
      },
    },
  };
}

function viewerOf(userId: string): Viewer {
  return { tier: 'free', userId, email: null, isAdmin: false, locale: null };
}

async function mediaBytes(args: Record<string, unknown>, urlMaxBytes = MAKER_FILE_MAX_BYTES): Promise<Uint8Array> {
  if (typeof args.url === 'string' && args.url) return fetchPublicMedia(args.url, urlMaxBytes);
  if (typeof args.data_base64 === 'string' && args.data_base64) return decodeBase64Media(args.data_base64, MAKER_FILE_MAX_BYTES);
  throw new ToolFailure('media_required');
}

async function refresh(deps: McpDeps) {
  const settings = await loadMakerSettings(deps.sql, deps.userId);
  if (settings?.handle) revalidateMakerProfile([settings.handle]);
}

async function callTool(deps: McpDeps, name: string, args: Record<string, unknown>): Promise<unknown> {
  // The same open rule the gate just applied (lib/makers/access.ts); the domain re-checks the active row.
  const access = { creators: await creativeProgramOpen(deps.sql) };
  const viewer = viewerOf(deps.userId);
  const store = deps.store;
  switch (name) {
    case 'whoami': {
      const settings = await loadMakerSettings(deps.sql, deps.userId);
      return {
        handle: settings?.handle ?? null, publicProfile: settings?.publicProfile ?? false,
        profileUrl: settings?.handle && settings.publicProfile ? `${deps.origin}${makerHref('en', settings.handle)}` : null,
        programOpen: access.creators, extendedProfile: settings?.extended ?? false,
        // What publish_template will actually do: lib/recipes/maker.ts refuses a publish while the kill switch is off.
        selfPublish: selfPublishOpen(),
        limits: {
          works: MAKER_WORKS_MAX,
          tokens: MAKER_TOKENS_MAX,
          testRendersPerTemplate: MAKER_TEST_RENDERS,
          fileMegabytes: MCP_IMAGE_FILE_MAX_MB,
          videoAudioFileMegabytes: MCP_AV_FILE_MAX_MB,
          templateMegabytes: MCP_FORMAT_MAX_MB,
          referenceFilesPerTemplate: MAKER_REFERENCE_FILES,
        },
      };
    }
    case 'get_recipe_guide': return recipeGuide();
    case 'validate_recipe': {
      const checked = parseRecipe(args.recipe);
      const warnings = guideTokenWarnings(args.recipe);
      const extra = warnings.length ? { warnings } : {};
      return checked.ok ? { ok: true, medium: checked.medium, ...extra } : { ok: false, issues: checked.issues, ...extra };
    }
    case 'list_templates': {
      const { rows } = await deps.sql.query<{ id: string; title: string; status: string; medium: string; review_note: string | null; updated_at: unknown; slug: string | null }>(
        `select f.id,f.title,f.status,f.medium,to_jsonb(f.*)->>'review_note' review_note,f.updated_at,p.slug from platform_formats f
          left join prompt_items p on p.id=f.template_id and p.status='published' where f.user_id=$1 order by f.updated_at desc limit 50`, [deps.userId]);
      const stats = new Map((await makerStats(deps.sql, deps.userId)).map((row) => [row.slug, row]));
      return rows.map((row) => ({
        id: row.id, title: row.title, status: row.status, medium: row.medium, reviewNote: row.review_note,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
        url: row.slug ? `${deps.origin}/en/t/${row.slug}` : null, recipeOpens: row.slug ? stats.get(row.slug)?.members ?? 0 : null,
      }));
    }
    case 'get_template': {
      const draft = await loadMakerDraft(deps.sql, viewer, String(args.id ?? ''), access);
      if (!draft) throw new ToolFailure('not_found');
      const { rows } = await deps.sql.query<{ slug: string | null }>(
        `select p.slug from platform_formats f
          join prompt_items p on p.id=f.template_id and p.status='published'
          where f.id=$1 and f.user_id=$2 limit 1`,
        [draft.id, deps.userId],
      );
      const slug = rows[0]?.slug ?? null;
      return {
        ...draft,
        editor: `${deps.origin}/creators/workspace/formats/${draft.id}`,
        ...(slug ? { url: `${deps.origin}/en/t/${slug}` } : {}),
      };
    }
    case 'save_template': {
      const id = typeof args.id === 'string' && args.id ? args.id : randomUUID();
      const existing = typeof args.id === 'string' && args.id ? await loadMakerDraft(deps.sql, viewer, id, access) : null;
      await makerAction({ sql: deps.sql, store }, viewer, {
        action: 'save', id, title: args.title, titleKo: typeof args.title_ko === 'string' ? args.title_ko : existing?.titleKo ?? undefined, recipe: args.recipe,
        example: typeof args.example_url === 'string' ? args.example_url : existing?.exampleUrl ?? '',
        disclosure: { prompts: typeof args.show_prompts === 'boolean' ? args.show_prompts : existing?.disclosure.prompts ?? false, assets: typeof args.show_files === 'boolean' ? args.show_files : existing?.disclosure.assets ?? false },
        presentation: args.presentation === 'story-first' || args.presentation === 'make-first' ? args.presentation : existing?.presentation ?? 'make-first',
        royalty: typeof args.royalty_krw === 'number' ? args.royalty_krw : existing?.royaltyKrw ?? ROYALTY_DEFAULT_KRW,
      }, access);
      const checked = parseRecipe(args.recipe);
      const warnings = guideTokenWarnings(args.recipe);
      return {
        id,
        saved: true,
        complete: checked.ok,
        issues: checked.ok ? [] : checked.issues,
        ...(warnings.length ? { warnings } : {}),
        editor: `${deps.origin}/creators/workspace/formats/${id}`,
      };
    }
    case 'upload_file': {
      const bytes = await mediaBytes(args, MAKER_AV_FILE_MAX_BYTES);
      const file = await uploadMakerFile({ sql: deps.sql, store }, viewer, {
        formatId: String(args.template_id ?? ''),
        role: args.role === 'example' ? 'example' : 'reference',
        bytes,
        ...(typeof args.contains_person === 'boolean' ? { containsPerson: args.contains_person } : {}),
      }, access);
      return {
        file: file.id,
        kind: file.kind,
        role: file.role,
        bytes: file.bytes,
        containsPerson: Boolean(file.containsPerson),
        use: file.role === 'reference' ? `Reference it from a creator slot: { "kind": "${file.kind}", "source": "creator", "asset": "${file.id}" }` : 'This is the template\'s example result.',
      };
    }
    case 'delete_file':
      return makerAction({ sql: deps.sql, store }, viewer, { action: 'deleteFile', id: args.template_id, file: args.file }, access);
    case 'test_render': {
      const result = await makerAction({ sql: deps.sql, store }, viewer, { action: 'test', id: args.template_id }, access);
      if (result.renderId) deps.afterRender?.(result.renderId);
      const skippedNote = result.skipped?.length ? ` Video steps ${result.skipped.join(', ')} were not made: a test makes images only, and video is made when a buyer pays.` : '';
      return { ...result, note: `The render runs in the background; get_template shows its status.${skippedNote}` };
    }
    case 'publish_template': {
      if (args.rights_confirmed !== true) throw new ToolFailure('rights_required');
      const published = await makerAction({ sql: deps.sql, store, storage: deps.storage }, viewer, { action: 'publish', id: args.template_id, rights: true }, access);
      await refresh(deps);
      return { ...published, status: 'published', url: published.slug ? `${deps.origin}/en/t/${published.slug}` : null };
    }
    case 'submit_template':
      if (args.rights_confirmed !== true) throw new ToolFailure('rights_required');
      return { ...(await makerAction({ sql: deps.sql, store }, viewer, { action: 'submit', id: args.template_id, rights: true }, access)), status: 'submitted' };
    case 'update_profile': {
      const before = await loadMakerSettings(deps.sql, deps.userId);
      const settings = await patchMakerProfile(deps.sql, deps.userId, {
        handle: args.handle, bio: args.bio, publicProfile: args.public_profile, displayName: args.display_name, headline: args.headline,
        country: args.country, city: args.city, links: args.links, publicEmail: args.public_email, tools: args.tools, openToBrands: args.open_to_brands,
      });
      revalidateMakerProfile([before?.handle, settings.handle].filter((handle): handle is string => !!handle));
      return { ...settings, profileUrl: settings.handle && settings.publicProfile ? `${deps.origin}${makerHref('en', settings.handle)}` : null };
    }
    case 'list_works':
      return (await listMakerWorks(deps.sql, deps.userId)).map((work) => ({ ...work, src: `${deps.origin}${makerWorkSrc(work.id, work.mime)}` }));
    case 'add_work': {
      const bytes = await mediaBytes(args);
      const { work, unchanged } = await storeMakerWork(deps.sql, store, { userId: deps.userId, bytes, title: args.title, caption: args.caption, link: args.link });
      await refresh(deps);
      return { ...work, unchanged };
    }
    case 'remove_work':
      await deleteMakerWork(deps.sql, store, deps.userId, String(args.id ?? ''));
      await refresh(deps);
      return { removed: true };
    case 'get_stats':
      return makerStats(deps.sql, deps.userId);
    default:
      throw new ToolFailure('unknown_tool');
  }
}

function toolResult(value: unknown, isError = false) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : { structuredContent: Array.isArray(value) ? { items: value } : value }) };
}

function failureOf(error: unknown): { code: string; detail?: unknown } {
  if (error instanceof RecipeRejected) return { code: 'recipe_invalid', detail: error.issues };
  if (error instanceof ToolFailure) return { code: error.code, detail: error.detail };
  if (error instanceof PlatformError || error instanceof WorkError || error instanceof MakerProfileError || error instanceof MediaFetchError) return { code: error.code };
  return { code: 'unavailable' };
}

async function handleOne(deps: McpDeps, message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null;
  const method = typeof message.method === 'string' ? message.method : '';
  const isNotification = message.id === undefined;
  const error = (code: number, text: string, data?: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message: text, ...(data === undefined ? {} : { data }) } });
  if (message.jsonrpc !== '2.0' || !method) return isNotification ? null : error(-32600, 'Invalid Request');
  if (method.startsWith('notifications/')) return null;
  const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>;
  switch (method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return { jsonrpc: '2.0', id, result: {
        protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: MCP_SERVER_INFO,
        instructions: 'TWINGS turns one selfie into a finished film or photo set. You act for one AI creative. Read get_recipe_guide before writing a recipe; upload source files with upload_file and reference their ast_ ids; save_template keeps a draft; for multi-clip templates add display-only clip cards in recipe.guide[] (title, customer-facing meta, prompt and tip); test_render and publish_template only when the creative asks. Never invent a selfie or upload faces the creative has no rights to.',
      } };
    }
    case 'ping': return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!MCP_TOOLS.some((item) => item.name === name)) return error(-32602, `Unknown tool: ${name}`);
      const args = (params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {}) as Record<string, unknown>;
      // Every call re-checks the gate: a token outlives a revoked creative only until its next call.
      const gate = await creativeGate(deps.sql, deps.userId);
      if (!gate.ok) return { jsonrpc: '2.0', id, result: toolResult({ code: gate.code }, true) };
      try {
        return { jsonrpc: '2.0', id, result: toolResult(await callTool(deps, name, args)) };
      } catch (failure) {
        return { jsonrpc: '2.0', id, result: toolResult(failureOf(failure), true) };
      }
    }
    default:
      return isNotification ? null : error(-32601, `Method not found: ${method}`);
  }
}

/** One POST body (a message, or a batch from an older client) → the response body, or null for 202. */
export async function handleMcp(deps: McpDeps, body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    const out: JsonRpcResponse[] = [];
    for (const message of body) {
      const response = await handleOne(deps, (message && typeof message === 'object' ? message : {}) as JsonRpcRequest);
      if (response) out.push(response);
    }
    return out.length ? out : null;
  }
  if (!body || typeof body !== 'object') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  return handleOne(deps, body as JsonRpcRequest);
}
