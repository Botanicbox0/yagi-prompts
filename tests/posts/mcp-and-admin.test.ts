import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  unstable_cache: <T>(fn: T) => fn,
}));

import { dispatchAdmin, outcomeUrl } from '@/lib/admin/dispatch';
import { loadAdminCommunity } from '@/lib/admin/community';
import { PLATFORM_OPERATIONS } from '@/lib/admin/platform-operations';
import { saveMakerProfile } from '@/lib/makers/profile';
import { activateOpenMaker } from '@/lib/makers/self-activate';
import { handleMcp, MCP_POST_TOOLS, MCP_TOOLS } from '@/lib/mcp/server';
import { POST_MAX_BLOCKS, POST_MAX_JSON_BYTES, POST_MAX_PER_MAKER } from '@/lib/posts/schema';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

const CREATIVE = viewerOf('free');

describe('maker blog MCP tools and admin moderation', () => {
  let h: PromptHarness;
  let root: string;
  let store: RenderStore;

  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-mcp-blog-'));
    store = createLocalRenderStore(root);
    vi.stubEnv('TWINGS_FORMAT_CREATORS', 'on');
    await activateOpenMaker(h.sql, CREATIVE, { rightsAgreed: true });
    await saveMakerProfile(h.sql, CREATIVE.userId!, { handle: 'alpha_maker', publicProfile: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('hides blog MCP tools and rejects calls with not_open when TWINGS_MAKER_BLOG is off', async () => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'off');
    const deps = {
      sql: h.sql,
      store,
      storage: h.storage,
      userId: CREATIVE.userId!,
      origin: 'http://127.0.0.1:3000',
    };

    const listRes = (await handleMcp(deps, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
      result: { tools: Array<{ name: string }> };
    };
    const names = listRes.result.tools.map((tool) => tool.name);
    expect(names).toHaveLength(MCP_TOOLS.length);
    for (const postTool of MCP_POST_TOOLS) {
      expect(names).not.toContain(postTool.name);
      const callRes = (await handleMcp(deps, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: postTool.name, arguments: {} },
      })) as { result: { isError: boolean; content: Array<{ text: string }> } };
      expect(callRes.result.isError).toBe(true);
      expect(JSON.parse(callRes.result.content[0]!.text).code).toBe('not_open');
    }

    const board = await loadAdminCommunity(h.sql);
    expect(board.ready).toBe(true);
    if (board.ready) {
      expect(board.posts).toEqual([]);
    }
  });

  it('supports MCP save/get/list/publish/unpublish workflow when TWINGS_MAKER_BLOG is on', async () => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'on');
    const deps = {
      sql: h.sql,
      store,
      storage: h.storage,
      userId: CREATIVE.userId!,
      origin: 'http://127.0.0.1:3000',
    };

    const listRes = (await handleMcp(deps, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listRes.result.tools).toHaveLength(MCP_TOOLS.length + MCP_POST_TOOLS.length);

    const guideRes = (await handleMcp(deps, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_post_guide', arguments: {} },
    })) as {
      result: { structuredContent: { maxBlocks: number; maxJsonBytes: number; maxPostsPerMaker: number } };
    };
    expect(guideRes.result.structuredContent.maxBlocks).toBe(POST_MAX_BLOCKS);
    expect(guideRes.result.structuredContent.maxJsonBytes).toBe(POST_MAX_JSON_BYTES);
    expect(guideRes.result.structuredContent.maxPostsPerMaker).toBe(POST_MAX_PER_MAKER);

    const savedRes = (await handleMcp(deps, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'save_post',
        arguments: {
          title: 'MCP Post Walkthrough',
          blocks: [{ type: 'heading', text: 'Setup' }, { type: 'text', text: 'Clean lighting first.' }],
        },
      },
    })) as { result: { structuredContent: { created: boolean; post: { id: string; status: string } } } };
    expect(savedRes.result.structuredContent.created).toBe(true);
    const postId = savedRes.result.structuredContent.post.id;

    const pubRes = (await handleMcp(deps, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'publish_post', arguments: { id: postId, rightsConfirmed: true } },
    })) as { result: { structuredContent: { post: { status: string }; publicUrl: string } } };
    expect(pubRes.result.structuredContent.post.status).toBe('published');
    expect(pubRes.result.structuredContent.publicUrl).toContain('/ko/makers/alpha_maker/blog/');

    const unpubRes = (await handleMcp(deps, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'unpublish_post', arguments: { id: postId } },
    })) as { result: { structuredContent: { post: { status: string } } } };
    expect(unpubRes.result.structuredContent.post.status).toBe('draft');

    const getRes = (await handleMcp(deps, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'get_post', arguments: { id: postId } },
    })) as { result: { structuredContent: { post: { id: string; blocks: unknown[] } } } };
    expect(getRes.result.structuredContent.post.id).toBe(postId);
    expect(getRes.result.structuredContent.post.blocks).toHaveLength(2);
  });

  it('dispatches admin post.hide and post.restore via PLATFORM_OPERATIONS and surfaces posts in community board', async () => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'on');
    expect(PLATFORM_OPERATIONS['post.hide']).toBeDefined();
    expect(PLATFORM_OPERATIONS['post.restore']).toBeDefined();

    const deps = {
      sql: h.sql,
      store,
      storage: h.storage,
      userId: CREATIVE.userId!,
      origin: 'http://127.0.0.1:3000',
    };
    const saved = (await handleMcp(deps, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'save_post',
        arguments: { title: 'Post to moderate', blocks: [{ type: 'text', text: 'Body copy' }] },
      },
    })) as { result: { structuredContent: { post: { id: string } } } };
    const postId = saved.result.structuredContent.post.id;

    await handleMcp(deps, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'publish_post', arguments: { id: postId, rightsConfirmed: true } },
    });

    const boardBefore = await loadAdminCommunity(h.sql);
    expect(boardBefore.ready).toBe(true);
    if (boardBefore.ready) {
      expect(boardBefore.posts?.some((row) => row.id === postId && row.status === 'published')).toBe(true);
    }

    const hideForm = new FormData();
    hideForm.set('id', postId);
    hideForm.set('reason', 'Policy check needed');
    const hideOutcome = await dispatchAdmin('post.hide', hideForm, {
      sql: h.sql,
      storage: h.storage,
      viewer: ADMIN_VIEWER,
    });
    expect(outcomeUrl('/admin/community', hideOutcome)).toContain('ok=saved');

    const restoreForm = new FormData();
    restoreForm.set('id', postId);
    restoreForm.set('reason', 'Cleared after review');
    const restoreOutcome = await dispatchAdmin('post.restore', restoreForm, {
      sql: h.sql,
      storage: h.storage,
      viewer: ADMIN_VIEWER,
    });
    expect(outcomeUrl('/admin/community', restoreOutcome)).toContain('ok=saved');

    const boardAfter = await loadAdminCommunity(h.sql);
    expect(boardAfter.ready).toBe(true);
    if (boardAfter.ready) {
      expect(boardAfter.posts?.find((row) => row.id === postId)?.status).toBe('published');
    }
  });
});
