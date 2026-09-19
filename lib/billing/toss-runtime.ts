import 'server-only';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore } from '@/lib/renders/store';
import { createRenderJob } from '@/lib/renders/service';
import { getTossGateway } from './toss-gateway';

export async function getTossContext() {
  const gateway = getTossGateway();
  if (!gateway) return null;
  const sql = await getSqlRunner();
  if (!sql) return null;
  return {
    sql,
    gateway,
    store: await getRenderStore(),
    createRender: createRenderJob,
  };
}

export const TOSS_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};
export function isSameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin;
}
