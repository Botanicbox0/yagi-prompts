import { riskWorkerRoute } from '@/lib/campaigns/risk/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const POST = (request: Request) => riskWorkerRoute(request, 'complete');
