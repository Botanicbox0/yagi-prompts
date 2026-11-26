import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { getSqlRunner } from '@/lib/db/connect';
import { makerBlogOpen } from '@/lib/posts/flag';
import { PostError, UUID_PATTERN } from '@/lib/posts/repo';
import { POST_MAX_JSON_BYTES } from '@/lib/posts/schema';
import {
  deleteMakerPost,
  listMakerPosts,
  loadMakerPost,
  publishMakerPost,
  saveMakerPost,
  unpublishMakerPost,
} from '@/lib/posts/service';

/**
 * `/api/makers/posts` — private workspace API for an active AI creative's blog posts.
 * Same-origin, signed-in, active creative (`creativeGate`), completely 404 while
 * `TWINGS_MAKER_BLOG` is off.
 */
export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

const STATUS: Record<string, number> = {
  not_open: 404,
  sign_in_required: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  too_large: 413,
  limit_reached: 409,
  hidden_locked: 409,
  not_draft: 409,
  rights_required: 400,
  empty_blocks: 400,
  invalid_work: 400,
  invalid_template: 400,
  unavailable: 503,
};

function failed(error: unknown) {
  if (error instanceof PostError) {
    return json({ code: error.code }, STATUS[error.code] ?? 400);
  }
  return json({ code: 'unavailable' }, 503);
}

async function authorize(request: Request, write: boolean) {
  if (!makerBlogOpen()) return { error: json({ code: 'not_open' }, 404) } as const;
  if (write && !isSameOrigin(request)) return { error: json({ code: 'forbidden' }, 403) } as const;
  const viewer = await getViewer();
  if (!viewer.userId) return { error: json({ code: 'sign_in_required' }, 401) } as const;
  const sql = await getSqlRunner();
  if (!sql) return { error: json({ code: 'unavailable' }, 503) } as const;
  return { sql, userId: viewer.userId } as const;
}

export async function GET(request: Request) {
  const auth = await authorize(request, false);
  if ('error' in auth) return auth.error;
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (id !== null) {
      if (!UUID_PATTERN.test(id)) return json({ code: 'not_found' }, 404);
      const post = await loadMakerPost(auth.sql, auth.userId, id);
      if (!post) return json({ code: 'not_found' }, 404);
      return json({ ok: true, post });
    }
    const posts = await listMakerPosts(auth.sql, auth.userId);
    return json({ ok: true, posts });
  } catch (error) {
    return failed(error);
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request, true);
  if ('error' in auth) return auth.error;
  try {
    const bytes = await readBoundedBody(request, POST_MAX_JSON_BYTES + 16_384);
    if (!bytes) return json({ code: 'too_large' }, 413);

    let body: Record<string, unknown>;
    try {
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
        return json({ code: 'invalid' }, 400);
      }
      body = decoded as Record<string, unknown>;
    } catch {
      return json({ code: 'invalid' }, 400);
    }

    const action = typeof body.action === 'string' ? body.action : 'save';
    switch (action) {
      case 'save': {
        const result = await saveMakerPost(auth.sql, auth.userId, {
          ...(body.id !== undefined ? { id: body.id } : {}),
          title: body.title,
          summary: body.summary,
          coverWorkId: body.coverWorkId,
          blocks: body.blocks,
        });
        return json({ ok: true, post: result.post, created: result.created }, result.created ? 201 : 200);
      }
      case 'publish': {
        const id = typeof body.id === 'string' ? body.id : '';
        const post = await publishMakerPost(auth.sql, auth.userId, id, {
          rightsConfirmed: body.rightsConfirmed === true,
        });
        return json({ ok: true, post });
      }
      case 'unpublish': {
        const id = typeof body.id === 'string' ? body.id : '';
        const post = await unpublishMakerPost(auth.sql, auth.userId, id);
        return json({ ok: true, post });
      }
      case 'delete': {
        const id = typeof body.id === 'string' ? body.id : '';
        await deleteMakerPost(auth.sql, auth.userId, id);
        return json({ ok: true });
      }
      default:
        return json({ code: 'invalid' }, 400);
    }
  } catch (error) {
    return failed(error);
  }
}
