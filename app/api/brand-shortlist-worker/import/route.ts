import { shortlistWorkerRoute } from '@/lib/brands/shortlist/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const POST = (request: Request) => shortlistWorkerRoute(request);
