/**
 * Demo API (NEXT_PUBLIC_DEMO_MODE=1 only; 404 otherwise). next.config.ts rewrites `/api/v1/*`,
 * `/healthz` and `/readyz` here in demo builds. See features/demo/demo-api.server.ts.
 */
import { handleDemoRequest } from '@/features/demo/demo-api.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(request: Request, { params }: Ctx): Promise<Response> {
  const { path } = await params;
  return handleDemoRequest(request, path);
}

export {
  handle as DELETE,
  handle as GET,
  handle as HEAD,
  handle as PATCH,
  handle as POST,
  handle as PUT,
};
