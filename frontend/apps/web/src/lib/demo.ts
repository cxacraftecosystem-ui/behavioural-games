/**
 * Demo mode (`NEXT_PUBLIC_DEMO_MODE=1`): the public Vercel deployment, which has no FastAPI backend
 * and no database.
 *
 * - Sign-in issues a client-side demo session (an unsigned, clearly labelled token carrying the chosen
 *   role). No credentials exist and nothing is verified: the demo API trusts the token because it only
 *   ever serves synthetic fixtures.
 * - `/api/v1/*` is rewritten to the in-app demo API (`src/app/demo-api/[...path]/route.ts`), which
 *   serves the same synthetic fixtures the research/admin Playwright suites use, through the same
 *   typed client layer.
 * - Writes are refused (client-side, before any network call, and again by the demo API).
 * - The kiosk runs fully offline: no upload endpoint, the outbox only queues locally.
 *
 * Every demo surface carries a "Demo data — synthetic, not study results" banner.
 */

/** `process.env.NEXT_PUBLIC_DEMO_MODE` must be referenced literally so Next inlines it. */
export function isDemoValue(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export const DEMO_MODE: boolean = isDemoValue(process.env.NEXT_PUBLIC_DEMO_MODE);

export const DEMO_BANNER_TITLE = 'Demo data — synthetic, not study results';
export const DEMO_READ_ONLY_MESSAGE =
  'This is a read-only demo with no backend connected, so changes are disabled.';

/** Roles offered by the demo sign-in. */
export const DEMO_ROLES = ['researcher', 'admin'] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export function isDemoRole(value: unknown): value is DemoRole {
  return typeof value === 'string' && (DEMO_ROLES as readonly string[]).includes(value);
}

export interface DemoClaims {
  readonly sub: string;
  readonly roles: readonly DemoRole[];
  readonly exp: number;
}

const TOKEN_PREFIX = 'demo';
const TOKEN_SUFFIX = 'not-a-credential';

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64urlDecode(text: string): string {
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A demo session token: `demo.<base64url claims>.not-a-credential`. */
export function createDemoToken(role: DemoRole, nowMs: number = Date.now(), ttlHours = 8) {
  const exp = Math.floor(nowMs / 1000) + ttlHours * 3600;
  const claims: DemoClaims = { sub: `demo-${role}`, roles: [role], exp };
  return { token: `${TOKEN_PREFIX}.${b64urlEncode(JSON.stringify(claims))}.${TOKEN_SUFFIX}`, exp };
}

/** Parse a demo token (or an `Authorization: Bearer` header value); null when invalid or expired. */
export function parseDemoToken(
  value: string | null | undefined,
  nowMs: number = Date.now(),
): DemoClaims | null {
  const token = (value ?? '').replace(/^Bearer\s+/i, '').trim();
  const [prefix, body, suffix] = token.split('.');
  if (prefix !== TOKEN_PREFIX || suffix !== TOKEN_SUFFIX || !body) return null;
  try {
    const raw = JSON.parse(b64urlDecode(body)) as Partial<DemoClaims>;
    const roles = Array.isArray(raw.roles) ? raw.roles.filter(isDemoRole) : [];
    if (typeof raw.sub !== 'string' || roles.length === 0 || typeof raw.exp !== 'number') {
      return null;
    }
    if (raw.exp * 1000 <= nowMs) return null;
    return { sub: raw.sub, roles, exp: raw.exp };
  } catch {
    return null;
  }
}

/** Body of the 403 every write gets in demo mode (same shape as the API's error envelope). */
export function demoReadOnlyBody() {
  return { detail: { code: 'demo_read_only', message: DEMO_READ_ONLY_MESSAGE } };
}
