import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: <T>(fn: T) => fn }));

import { administerPlatform } from '@/lib/creator-platform/admin';
import { activateOpenMaker } from '@/lib/makers/self-activate';
import { MAKER_TOKENS_MAX } from '@/lib/makers/tokens';
import { MAKER_WORKS_MAX } from '@/lib/makers/works';
import { MAKER_AV_FILE_MAX_BYTES, MAKER_FILE_MAX_BYTES, MAKER_FORMAT_MAX_BYTES, MAKER_REFERENCE_FILES } from '@/lib/recipes/assets';
import { MAKER_TEST_RENDERS } from '@/lib/recipes/maker';
import { parseRecipe } from '@/lib/recipes/schema';
import { GUIDE_META_MAX, GUIDE_NOTE_MAX, GUIDE_PROMPT_MAX, GUIDE_PROMPT_MIN, GUIDE_TITLE_MAX, MAX_GUIDE_CLIPS } from '@/components/recipes/guide-editor';
import { MCP_FILE_LIMIT_TEXT, MCP_TOOLS, formatMcpFileLimits, handleMcp, recipeGuide } from '@/lib/mcp/server';
import { guideTokenWarnings } from '@/lib/mcp/guide-warnings';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { FIXTURE_USERS } from '../../scripts/fixtures';

const CREATIVE = viewerOf('free');
const OTHER = FIXTURE_USERS.pro;
const TEST_ASSET = `ast_${'a'.repeat(32)}`;

const jpegBase64 = () =>
  sharp({ create: { width: 120, height: 120, channels: 3, background: { r: 220, g: 225, b: 235 } } })
    .jpeg()
    .toBuffer()
    .then((buf) => buf.toString('base64'));

function withRealAssetHandles(recipe: unknown): unknown {
  const raw = JSON.stringify(recipe).replace(/ast_<32 hex from upload_file>/g, TEST_ASSET);
  return JSON.parse(raw);
}

describe('TWINGS MCP Batch 2', () => {
  let h: PromptHarness;
  let root: string;
  let store: RenderStore;

  const deps = (userId = CREATIVE.userId!) => ({ sql: h.sql, store, userId, origin: 'https://twings.app' });
  const call = (name: string, args: Record<string, unknown> = {}, userId = CREATIVE.userId!) =>
    handleMcp(deps(userId), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const payload = (response: unknown) => JSON.parse((response as { result: { content: Array<{ text: string }> } }).result.content[0]!.text);

  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-mcp-b2-'));
    store = createLocalRenderStore(root);
    vi.stubEnv('TWINGS_FORMAT_CREATORS', 'off');
    vi.stubEnv('TWINGS_OPEN_MAKER', '');
    vi.stubEnv('TWINGS_MAKER_SELF_PUBLISH', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('documents guide[], clip card rules, tip-above-prompt placement, customer-facing meta, and initialize instructions', async () => {
    await activateOpenMaker(h.sql, CREATIVE, { rightsAgreed: true });

    const init = await handleMcp(deps(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    const instructions = (init as { result: { instructions: string } }).result.instructions;
    expect(instructions).toContain('recipe.guide[]');

    const guideTool = MCP_TOOLS.find((t) => t.name === 'get_recipe_guide')!;
    expect(guideTool.description).toContain('guide[]');
    expect(guideTool.description).toContain('multi-clip');

    const guide = payload(await call('get_recipe_guide'));
    expect(guide.guide.maxItems).toBe(MAX_GUIDE_CLIPS);
    expect(guide.limits.guideClips).toBe(MAX_GUIDE_CLIPS);
    expect(guide.guide.summary).toContain('#clips');
    expect(guide.guide.visibility).toMatch(/Signed-out visitors see numbered titles only/);
    expect(guide.guide.fields.title).toContain(`1–${GUIDE_TITLE_MAX}`);
    expect(guide.guide.fields.meta).toContain(String(GUIDE_META_MAX));
    expect(guide.guide.fields.meta).toContain('Video · 4:3 · 5s');
    expect(guide.guide.fields.meta).toMatch(/Never include model names/i);
    expect(guide.guide.fields.prompt).toContain(String(GUIDE_PROMPT_MIN));
    expect(guide.guide.fields.prompt).toContain(GUIDE_PROMPT_MAX.toLocaleString('en-US'));
    expect(guide.guide.fields.note).toContain(String(GUIDE_NOTE_MAX));
    expect(guide.guide.fields.note).toContain('ABOVE the prompt');
    expect(guide.notes).not.toContain('under that step');
    expect(guide.notes).toContain('ABOVE each prompt');
  });

  it('derives file limits from constants, drops stale 20 MB, and provides valid example + exampleWithClips', async () => {
    const guide = recipeGuide();
    const serialized = JSON.stringify({ guide, tools: MCP_TOOLS });
    expect(serialized).not.toContain('20 MB');
    expect(guide.limits.files).toBe(MCP_FILE_LIMIT_TEXT);
    expect(guide.limits.files).toContain(`${MAKER_REFERENCE_FILES} references`);
    expect(guide.limits.files).toContain(`${MAKER_FILE_MAX_BYTES / (1024 * 1024)} MB`);
    expect(guide.limits.files).toContain(`${MAKER_AV_FILE_MAX_BYTES / (1024 * 1024)} MB`);
    expect(guide.limits.files).toContain(`${MAKER_FORMAT_MAX_BYTES / (1024 * 1024)} MB`);

    expect(formatMcpFileLimits({
      references: 9,
      imageBytes: 6 * 1024 * 1024,
      avBytes: 40 * 1024 * 1024,
      formatBytes: 90 * 1024 * 1024,
    })).toBe('9 references + 1 example; images up to 6 MB, video/audio up to 40 MB (by URL), 90 MB total a template');

    expect(guide.exampleWithClips.steps).toHaveLength(1);
    expect(guide.exampleWithClips.guide).toHaveLength(3);
    for (const clip of guide.exampleWithClips.guide) {
      expect(clip.note.trim().length).toBeGreaterThan(0);
    }

    const ex1 = withRealAssetHandles(guide.example);
    const ex2 = withRealAssetHandles(guide.exampleWithClips);
    expect(parseRecipe(ex1)).toMatchObject({ ok: true });
    expect(parseRecipe(ex2)).toMatchObject({ ok: true });
    expect(guideTokenWarnings(ex2)).toEqual([]);
  });

  it('returns non-blocking warnings for unknown {{name}} tokens in guide[] without breaking valid recipes', async () => {
    await activateOpenMaker(h.sql, CREATIVE, { rightsAgreed: true });

    const cleanRecipe = {
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true } },
      steps: [
        {
          id: 'still',
          kind: 'image',
          engine: 'gpt-image-2',
          inputs: ['selfie'],
          prompt: 'Portrait of {{selfie}} in daylight.',
          params: { aspect: '4:5' },
        },
      ],
      output: { from: 'still' },
      guide: [
        { title: 'Beat 1', kind: 'video', meta: 'Video · 9:16 · 3s', prompt: 'Opening beat with {{selfie}}.', note: 'Keep eyes level.' },
        { title: 'Beat 2', kind: 'video', meta: 'Video · 9:16 · 3s', prompt: 'Cut matching {{still}}.', note: 'Keep soft daylight.' },
        { title: 'Beat 3', kind: 'video', meta: 'Video · 9:16 · 2s', prompt: 'Final look with {{selfie}}.', note: 'Hold expression.' },
      ],
    };

    expect(payload(await call('validate_recipe', { recipe: cleanRecipe }))).toEqual({ ok: true, medium: 'image' });

    const warnedRecipe = {
      ...cleanRecipe,
      guide: [
        cleanRecipe.guide[0]!,
        { title: 'Beat 2', kind: 'video', meta: 'Video · 9:16 · 3s', prompt: 'Cut with {{mystery_prop}} and {{still}}.', note: 'Tip two.' },
        cleanRecipe.guide[2]!,
      ],
    };

    const validated = payload(await call('validate_recipe', { recipe: warnedRecipe }));
    expect(validated).toMatchObject({
      ok: true,
      medium: 'image',
      warnings: [expect.objectContaining({ code: 'unknown_guide_token', clip: 2, token: 'mystery_prop' })],
    });

    const saved = payload(await call('save_template', { title: 'Warned draft', recipe: warnedRecipe }));
    expect(saved).toMatchObject({
      saved: true,
      complete: true,
      issues: [],
      editor: `https://twings.app/creators/workspace/formats/${saved.id}`,
      warnings: [expect.objectContaining({ code: 'unknown_guide_token', clip: 2, token: 'mystery_prop' })],
    });
  });

  it('passes contains_person on upload_file, adds editor/url on get_template, and reports accurate whoami fields', async () => {
    await activateOpenMaker(h.sql, CREATIVE, { rightsAgreed: true });

    const who = payload(await call('whoami'));
    expect(who).toMatchObject({
      programOpen: true,
      selfPublish: true,
      limits: {
        works: MAKER_WORKS_MAX,
        tokens: MAKER_TOKENS_MAX,
        testRendersPerTemplate: MAKER_TEST_RENDERS,
        fileMegabytes: MAKER_FILE_MAX_BYTES / (1024 * 1024),
        videoAudioFileMegabytes: MAKER_AV_FILE_MAX_BYTES / (1024 * 1024),
        templateMegabytes: MAKER_FORMAT_MAX_BYTES / (1024 * 1024),
        referenceFilesPerTemplate: MAKER_REFERENCE_FILES,
      },
    });

    // The report follows what publish_template enforces (lib/recipes/maker.ts), not the editor's button.
    vi.stubEnv('TWINGS_MAKER_SELF_PUBLISH', 'off');
    expect(payload(await call('whoami')).selfPublish).toBe(false);
    vi.stubEnv('TWINGS_OPEN_MAKER', 'off');
    vi.stubEnv('TWINGS_FORMAT_CREATORS', 'on');
    expect(payload(await call('whoami')).selfPublish).toBe(false);
    vi.stubEnv('TWINGS_MAKER_SELF_PUBLISH', '');
    vi.stubEnv('TWINGS_OPEN_MAKER', '');
    vi.stubEnv('TWINGS_FORMAT_CREATORS', 'off');

    const base64 = await jpegBase64();
    const draft = payload(await call('save_template', {
      title: 'Person ref draft',
      recipe: {
        version: 2,
        slots: { selfie: { kind: 'image', source: 'user', required: true } },
        steps: [{ id: 'still', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'Portrait of {{selfie}}.', params: { aspect: '4:5' } }],
        output: { from: 'still' },
      },
    }));

    const uploadedPerson = payload(await call('upload_file', {
      template_id: draft.id,
      role: 'reference',
      contains_person: true,
      data_base64: base64,
    }));
    expect(uploadedPerson).toMatchObject({ kind: 'image', role: 'reference', containsPerson: true });

    const gotDraft = payload(await call('get_template', { id: draft.id }));
    expect(gotDraft.editor).toBe(`https://twings.app/creators/workspace/formats/${draft.id}`);
    expect(gotDraft.url).toBeUndefined();
    expect(gotDraft.files).toEqual([expect.objectContaining({ id: uploadedPerson.file, containsPerson: true })]);

    // Link an existing published prompt_items row to simulate a published template and verify get_template adds url.
    const pub = (await h.sql.query<{ id: string; slug: string }>("select id, slug from prompt_items where status='published' limit 1")).rows[0]!;
    await h.sql.query("update platform_formats set status='accepted', template_id=$2 where id=$1", [draft.id, pub.id]);
    const gotPublished = payload(await call('get_template', { id: draft.id }));
    expect(gotPublished.editor).toBe(`https://twings.app/creators/workspace/formats/${draft.id}`);
    expect(gotPublished.url).toBe(`https://twings.app/en/t/${pub.slug}`);
  });

  it('enforces permissions: refuses accounts without an active platform_creators row and passes one-check accounts', async () => {
    // Neither CREATIVE nor OTHER has activated yet.
    expect(payload(await call('whoami', {}, OTHER.id))).toEqual({ code: 'forbidden' });
    expect(payload(await call('whoami', {}, CREATIVE.userId!))).toEqual({ code: 'forbidden' });

    // One-check activation opens MCP even when TWINGS_FORMAT_CREATORS is off.
    await activateOpenMaker(h.sql, CREATIVE, { rightsAgreed: true });
    expect(payload(await call('whoami', {}, CREATIVE.userId!))).toMatchObject({ programOpen: true });
    expect(payload(await call('whoami', {}, OTHER.id))).toEqual({ code: 'forbidden' });

    // Admin revoking the account immediately blocks tools/call again.
    await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'creator', id: CREATIVE.userId, active: false, contract: 'owl-p-v1', reason: 'Revoked' });
    expect(payload(await call('whoami', {}, CREATIVE.userId!))).toEqual({ code: 'forbidden' });
  });
});

describe('MCP file limit constants live binding', () => {
  it('recomputes guide and tool descriptions when asset limit constants change', async () => {
    vi.resetModules();
    vi.doMock('@/lib/recipes/assets', async (original) => {
      const actual = await original<typeof import('@/lib/recipes/assets')>();
      return {
        ...actual,
        MAKER_FILE_MAX_BYTES: 7 * 1024 * 1024,
        MAKER_AV_FILE_MAX_BYTES: 35 * 1024 * 1024,
        MAKER_REFERENCE_FILES: 9,
        MAKER_FORMAT_MAX_BYTES: 95 * 1024 * 1024,
      };
    });
    try {
      const reloaded = await import('@/lib/mcp/server');
      const guide = reloaded.recipeGuide();
      expect(guide.limits.files).toContain('9 references');
      expect(guide.limits.files).toContain('7 MB');
      expect(guide.limits.files).toContain('35 MB');
      expect(guide.limits.files).toContain('95 MB');
      const uploadTool = reloaded.MCP_TOOLS.find((t) => t.name === 'upload_file')!;
      expect((uploadTool.inputSchema.properties.url as { description: string }).description).toContain('7 MB');
      expect((uploadTool.inputSchema.properties.url as { description: string }).description).toContain('35 MB');
      const addWorkTool = reloaded.MCP_TOOLS.find((t) => t.name === 'add_work')!;
      expect((addWorkTool.inputSchema.properties.url as { description: string }).description).toContain('7 MB');
    } finally {
      vi.doUnmock('@/lib/recipes/assets');
      vi.resetModules();
    }
  });
});
