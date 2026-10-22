/**
 * In-app demo API for the public demo deployment (NEXT_PUBLIC_DEMO_MODE=1, no FastAPI, no database).
 *
 * It answers the `/api/v1/*` calls the console makes (rewritten to `/demo-api/v1/*` by next.config.ts)
 * with the SAME synthetic fixtures the research and admin Playwright suites use
 * (features/research/e2e/mock-research-api.ts: simulator data run through the real validation engine,
 * fixtures/engine-results.json + snapshot.parquet; features/admin/e2e/mock-admin-api.ts: real
 * content/games configs plus labelled fleet fixtures). Those modules are written against Playwright's
 * `page.route` API, so a small adapter drives them here instead of duplicating them.
 *
 * Read-only: every non-GET request gets 403 `demo_read_only`. Sessions are demo tokens
 * (lib/demo.ts); `/auth/me` grants the chosen role's permissions from the mirrored RBAC matrix.
 */
import type { Page } from '@playwright/test';
import { ROLE_PERMISSIONS } from '@/features/admin/settings/rbac-matrix';
import { DEMO_MODE, demoReadOnlyBody, parseDemoToken } from '@/lib/demo';

interface FulfillOptions {
  readonly status?: number;
  readonly json?: unknown;
  readonly body?: string | Uint8Array;
  readonly contentType?: string;
  readonly headers?: Record<string, string>;
}

interface DemoRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
}

type Outcome = { kind: 'fulfilled'; response: Response } | { kind: 'fallback' };

class AdapterRoute {
  outcome: Outcome | null = null;
  constructor(private readonly req: DemoRequest) {}
  request() {
    const req = this.req;
    return {
      url: () => req.url,
      method: () => req.method,
      headers: () => req.headers,
      postData: () => null,
      postDataJSON: () => null,
    };
  }
  async fulfill(opts: FulfillOptions): Promise<void> {
    const headers = new Headers(opts.headers);
    headers.set('cache-control', 'no-store');
    headers.set('x-demo-data', 'synthetic');
    let body: BodyInit | null = null;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers.set('content-type', 'application/json');
    } else if (opts.body !== undefined) {
      body = typeof opts.body === 'string' ? opts.body : new Uint8Array(opts.body);
      if (opts.contentType) headers.set('content-type', opts.contentType);
    }
    this.outcome = {
      kind: 'fulfilled',
      response: new Response(body, { status: opts.status ?? 200, headers }),
    };
  }
  async fallback(): Promise<void> {
    this.outcome = { kind: 'fallback' };
  }
}

type Handler = (route: AdapterRoute) => unknown;

/** Playwright URL glob -> RegExp (`**` crosses `/`, `*` does not). */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else out += '[^/]*';
    } else out += /[.+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${out}$`);
}

let handlers: Promise<{ re: RegExp; handler: Handler }[]> | null = null;

/** Register the fixture mocks once per server instance, in the suites' precedence order. */
function loadHandlers() {
  handlers ??= (async () => {
    const list: { re: RegExp; handler: Handler }[] = [];
    const page = {
      route: async (pattern: string, handler: Handler) => {
        list.push({ re: globToRegExp(pattern), handler });
      },
    } as unknown as Page;
    const [{ mockAdminApi }, { mockResearchApi }] = await Promise.all([
      import('@/features/admin/e2e/mock-admin-api'),
      import('@/features/research/e2e/mock-research-api'),
    ]);
    // Playwright consults the most recently registered route first: research, then admin.
    await mockAdminApi(page);
    await mockResearchApi(page);
    return list.reverse();
  })();
  handlers.catch(() => {
    handlers = null;
  });
  return handlers;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-demo-data': 'synthetic' },
  });

const READ_METHODS = new Set(['GET', 'HEAD']);

/** Answer one demo API request. `segments` is the path after `/demo-api/`. */
export async function handleDemoRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  if (!DEMO_MODE) return json({ detail: 'not found' }, 404);
  const [head, ...rest] = segments;
  if (head === 'healthz') return json({ status: 'ok', demo: true });
  if (head === 'readyz') {
    return json({
      status: 'ok',
      demo: true,
      checks: { database: 'demo (no database)', identity_database: 'demo', migration: 'demo' },
    });
  }
  if (head !== 'v1') return json({ detail: 'not found' }, 404);
  if (!READ_METHODS.has(request.method.toUpperCase())) return json(demoReadOnlyBody(), 403);

  const claims = parseDemoToken(request.headers.get('authorization'));
  if (!claims) {
    return json(
      { detail: { code: 'unauthenticated', message: 'Start a demo session first.' } },
      401,
    );
  }
  const path = `/${rest.map(encodeURIComponent).join('/')}`;
  if (path === '/auth/me') {
    const permissions = [...new Set(claims.roles.flatMap((r) => [...ROLE_PERMISSIONS[r]]))].sort();
    return json({
      sub: claims.sub,
      kind: 'user',
      roles: claims.roles,
      studies: ['*'],
      permissions,
      kiosk_id: null,
      password_change_required: false,
    });
  }

  const search = new URL(request.url).search;
  const req: DemoRequest = {
    url: `http://demo.local/api/v1${path}${search}`,
    method: 'GET',
    headers: Object.fromEntries(request.headers),
  };
  for (const { re, handler } of await loadHandlers()) {
    if (!re.test(req.url)) continue;
    const route = new AdapterRoute(req);
    await handler(route);
    if (route.outcome?.kind === 'fulfilled') return route.outcome.response;
  }
  return json(
    { detail: { code: 'demo_not_available', message: 'This view has no demo data.' } },
    404,
  );
}
