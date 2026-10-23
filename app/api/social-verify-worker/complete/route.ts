import { socialWorkerRoute } from '@/lib/influencers/worker-http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const POST = (request: Request) => socialWorkerRoute(request, 'complete');
